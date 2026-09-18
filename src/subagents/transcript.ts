import * as fs from "node:fs";
import { initialItems, sessionToolCalls, type SessionToolCall } from "../state/conversation.ts";
import { normalizeResultDetails } from "../state/result-diff.ts";
import { fileContentKey, stableHash } from "./cache-key.ts";
import { profiledRunIsLive } from "./profiled.ts";
import type {
  AssistantItem,
  ConversationItem,
  SubagentRun,
  SubagentStep,
  SubagentTranscriptEntry,
  ToolItem,
} from "../types.ts";

export const MAX_SUBAGENT_SESSION_LINES = 700;

/** Byte bound matching the producer's 2 MB cap on `events.jsonl`. */
const PROFILED_STREAM_TAIL_BYTES = 2 * 1024 * 1024;
/** Newest live-stream events kept per read; older ones are already in the session file. */
const MAX_PROFILED_STREAM_EVENTS = 400;

type ParsedTranscriptRecord = {
  record: Record<string, unknown>;
  index: number;
};

type TranscriptRecordCacheEntry = {
  key: string;
  records: ParsedTranscriptRecord[];
};

const transcriptRecordCache = new Map<string, TranscriptRecordCacheEntry>();
const MAX_TRANSCRIPT_RECORD_CACHE_ENTRIES = 128;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function messageBlocks(message: unknown): Array<Record<string, unknown>> {
  const record = objectRecord(message);
  if (!record) return [];
  const content = record.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content)
    ? content.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function messageText(message: unknown, type: "text" | "thinking"): string {
  return messageBlocks(message)
    .filter((block) =>
      type === "text"
        ? block.type === "text"
        : block.type === "thinking" || block.type === "reasoning",
    )
    .map((block) =>
      type === "thinking"
        ? text(block.thinking) || text(block.text)
        : text(block.text),
    )
    .filter(Boolean)
    .join("");
}

function recordTimestamp(record: Record<string, unknown>, fallback = 0): number {
  // Never Date.now(): a missing `ts` must not mint a fresh timestamp per
  // poll. Callers thread the previous timestamp through as the fallback so
  // undated records sit with their neighbors deterministically.
  const ts = record.ts;
  return typeof ts === "number" && Number.isFinite(ts) ? ts : fallback;
}

/**
 * Content-stable identity for one transcript record. Never Date.now(), never
 * the tail-slice position, never enumeration order: records carrying an `id`
 * or `toolCallId` key on it; anything else hashes the stable fields so the
 * same record keeps the same id across reads. Callers disambiguate genuinely
 * duplicated content with a deterministic per-key occurrence suffix (stable
 * under appends, since JSONL is append-only).
 */
function stableRecordKey(record: Record<string, unknown>): string {
  const recordId = text(record.id);
  if (recordId) return `id-${recordId}`;
  const callId = text(record.toolCallId);
  if (callId) return `call-${text(record.recordType) || text(record.role) || "tool"}-${callId}`;
  return `blob-${stableHash(
    JSON.stringify({
      recordType: text(record.recordType),
      role: text(record.role),
      toolName: text(record.toolName),
      subtype: text(record.subtype) || text(record.messageType),
      ts: typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : 0,
      text: text(record.text),
      argsPreview: text(record.argsPreview),
      message: record.message ?? null,
      errorMessage: text(record.errorMessage),
      isError: Boolean(record.isError),
      details: record.details ?? null,
    }),
  )}`;
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function resultDiff(detailsValue: unknown): string | undefined {
  return normalizeResultDetails(detailsValue).diff;
}

function resultPath(detailsValue: unknown, tool: ToolItem): string | undefined {
  const details = objectRecord(detailsValue);
  const direct = details?.path ?? details?.filePath ?? details?.file_path;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (
    /write|edit|patch|replace/i.test(tool.name) &&
    typeof tool.args === "string"
  ) {
    const firstLine = tool.args.split(/\r?\n/, 1)[0]?.trim();
    if (firstLine && !firstLine.includes(" ")) return firstLine;
  }
  return undefined;
}

export function activeSubagentStep(run: SubagentRun): SubagentStep | undefined {
  const indexed =
    run.currentStep === undefined ? undefined : run.steps[run.currentStep];
  return (
    indexed ??
    run.steps.find((step) => step.status === "running") ??
    run.steps.at(-1)
  );
}

export function subagentTranscriptPath(
  run: SubagentRun,
  stepIndex?: number,
): string | undefined {
  const selected =
    stepIndex === undefined
      ? undefined
      : run.steps.find((step) => step.index === stepIndex);
  const active =
    selected?.transcriptPath ??
    activeSubagentStep(run)?.transcriptPath ??
    run.transcriptPath;
  if (active) return active;
  for (let index = run.steps.length - 1; index >= 0; index--) {
    const transcriptPath = run.steps[index]?.transcriptPath;
    if (transcriptPath) return transcriptPath;
  }
  return undefined;
}

function parseJsonlTail(content: string): ParsedTranscriptRecord[] {
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  const records: ParsedTranscriptRecord[] = [];
  for (
    let index = Math.max(0, lines.length - MAX_SUBAGENT_SESSION_LINES);
    index < lines.length;
    index++
  ) {
    const line = lines[index];
    if (line === undefined) continue;
    try {
      const record = objectRecord(JSON.parse(line));
      if (record) records.push({ record, index });
    } catch {
      // The writer may leave the final JSONL line incomplete briefly.
    }
  }
  return records;
}

type ProfiledStreamKind = "thinking" | "text" | "tool_start" | "tool_end";

type ProfiledStreamEvent = {
  kind: ProfiledStreamKind;
  /** Accumulation key: `<runId>::<blockId>` (blockId falls back to kind). */
  key: string;
  /** Event's own runId (may be empty when the producer omits it). */
  runId: string;
  /** Block id (falls back to kind); the stable part of stream item ids. */
  blockId: string;
  text: string;
  toolName: string;
  toolCallId?: string | undefined;
  /** 0 when the producer omits `ts`; callers resolve it deterministically. */
  ts: number;
};

type ProfiledStreamCacheEntry = {
  key: string;
  events: ProfiledStreamEvent[];
};

const profiledStreamCache = new Map<string, ProfiledStreamCacheEntry>();
const MAX_PROFILED_STREAM_CACHE_ENTRIES = 64;

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalStreamText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Narrow one `events.jsonl` line. A torn final line (concurrent appender),
 * unknown kinds and unknown fields are ignored; `seq` is never required to
 * be contiguous (the producer drops lines under its size cap).
 */
function parseProfiledStreamEvent(line: string): ProfiledStreamEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isUnknownRecord(parsed) || parsed.v !== 1) return undefined;
  const kind = parsed.kind;
  if (kind !== "thinking" && kind !== "text" && kind !== "tool_start" && kind !== "tool_end") return undefined;
  const runId = optionalStreamText(parsed.runId) ?? "";
  const blockId = optionalStreamText(parsed.blockId) ?? kind;
  // Never Date.now(): an undated event must resolve identically on every
  // read. Callers fill it from neighboring events / the run deterministically.
  const ts = typeof parsed.ts === "number" && Number.isFinite(parsed.ts) ? parsed.ts : 0;
  return {
    kind,
    key: `${runId}::${blockId}`,
    runId,
    blockId,
    text: optionalStreamText(parsed.text) ?? "",
    toolName: optionalStreamText(parsed.toolName) ?? "tool",
    ...(optionalStreamText(parsed.toolCallId) ? { toolCallId: optionalStreamText(parsed.toolCallId) } : {}),
    ts,
  };
}

function readProfiledStreamEvents(eventsPath: string | undefined): ProfiledStreamEvent[] {
  if (!eventsPath) return [];
  let stat: fs.Stats;
  try {
    stat = fs.statSync(eventsPath);
    if (!stat.isFile()) return [];
  } catch {
    return [];
  }
  let content: string;
  try {
    const fd = fs.openSync(eventsPath, "r");
    try {
      const length = Math.min(stat.size, PROFILED_STREAM_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      const bytes = fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
      content = buffer.subarray(0, bytes).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
  const key = fileContentKey(stat, content);
  const cached = profiledStreamCache.get(eventsPath);
  if (cached && cached.key === key) return cached.events;
  const lines = content.split("\n");
  const events: ProfiledStreamEvent[] = [];
  for (let index = Math.max(0, lines.length - MAX_PROFILED_STREAM_EVENTS); index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined || !line.trim()) continue;
    const event = parseProfiledStreamEvent(line);
    if (event && (event.kind === "tool_start" || event.kind === "tool_end" || event.text)) events.push(event);
  }
  profiledStreamCache.delete(eventsPath);
  profiledStreamCache.set(eventsPath, { key, events });
  while (profiledStreamCache.size > MAX_PROFILED_STREAM_CACHE_ENTRIES) {
    const oldest = profiledStreamCache.keys().next().value;
    if (typeof oldest !== "string") break;
    profiledStreamCache.delete(oldest);
  }
  return events;
}

/**
 * Fold the profiled `events.jsonl` stream into the transcript: consecutive
 * `thinking`/`text` lines sharing `(runId, blockId)` accumulate into ONE
 * synthetic assistant item (thinking goes to the item's `thinking`, text to
 * its `text`); a new `blockId` starts a new item; `tool_start` creates a
 * `ToolItem` and the matching `tool_end` (by `toolCallId`, else by name)
 * completes it.
 *
 * While the run is live (`profiledRunIsLive`) the synthetic items are
 * appended with `status: "streaming"`. Once the run has stopped the stream
 * is STILL read — it is the only plaintext copy when the session file's
 * thinking blocks are encrypted reasoning with empty plaintext — but merged
 * growth-only into the persisted items: a stream chunk is skipped when a
 * persisted item already contains it, extends a persisted field only when the
 * stream value is longer (persisted content is never replaced by a shorter
 * stream value), and otherwise becomes one `status: "done"` item. Stream
 * tool events for a stopped run are likewise skipped when the session already
 * carries the same `toolCallId`, so nothing renders twice.
 *
 * Stream item ids derive from `(runId, blockId)` / `toolCallId` — never a
 * per-read counter — so re-reads keep the same ids. Stream `ToolItem`s are
 * backfilled with `args`/`output` from the session file's `toolCall` /
 * `toolResult` entries for the same `toolCallId`.
 *
 * Laziness: this runs inside `readSubagentConversation`, which the app only
 * invokes for the inspected target while the detail pane is open
 * (`inspectSubagent()` via `createSubagentTranscriptCache`); no second
 * polling timer is added, the existing refresh path drives re-reads and the
 * content-keyed cache above bounds the IO.
 */
type StreamTextGroup = {
  key: string;
  runId: string;
  blockId: string;
  /** Deterministic disambiguation when one key yields several groups. */
  occurrence: number;
  thinking: string;
  text: string;
  ts: number;
};

function streamTextGroupId(runId: string, group: StreamTextGroup): string {
  const base = `subagent-stream-${runId}-${group.blockId}`;
  return group.occurrence > 0 ? `${base}-g${group.occurrence}` : base;
}

/**
 * Growth-only merge of one stopped-run stream group into the persisted
 * assistant items: skip what the session already contains, extend a field
 * only with a longer stream value (never shrink), else append one
 * `status: "done"` item carrying whatever did not merge.
 */
function mergeStreamGroup(items: ConversationItem[], group: StreamTextGroup, id: string): void {
  let thinking = group.thinking;
  let text = group.text;
  for (const item of items) {
    if (item.kind !== "assistant") continue;
    if (thinking) {
      if (item.thinking.includes(thinking)) thinking = "";
      else if (thinking.includes(item.thinking) && thinking.length > item.thinking.length) {
        item.thinking = thinking;
        thinking = "";
      }
    }
    if (text) {
      if (item.text.includes(text)) text = "";
      else if (text.includes(item.text) && text.length > item.text.length) {
        item.text = text;
        text = "";
      }
    }
    if (!thinking && !text) return;
  }
  if (!thinking && !text) return;
  const fresh: AssistantItem = {
    kind: "assistant",
    id,
    text,
    thinking,
    timestamp: group.ts,
    status: "done",
  };
  items.push(fresh);
}

function appendProfiledStreamItems(run: SubagentRun, items: ConversationItem[], stepIndex?: number): void {
  if (!run.eventsPath) return;
  const live = profiledRunIsLive(run);
  const events = readProfiledStreamEvents(run.eventsPath);
  if (events.length === 0) return;
  // Undated events resolve deterministically: previous event, else the run.
  let lastTs = 0;
  const eventTs = (event: ProfiledStreamEvent): number => {
    const ts = event.ts || lastTs || run.lastUpdate || run.startedAt || 0;
    lastTs = ts;
    return ts;
  };
  // Single pass in events.jsonl wire order: consecutive same-key
  // thinking/text chunks accumulate into one group; the group is flushed
  // inline at its wire position (on key change, on a tool event, or at the
  // end) so `think, tool, think, tool` renders interleaved instead of all
  // assistants first. Tool events are likewise handled inline at their wire
  // position, with args/output backfilled from the session file's
  // `toolCall`/`toolResult` entries for the same `toolCallId` (built lazily:
  // only when a stream tool actually needs it).
  let sessionTools: Map<string, SessionToolCall> | undefined;
  const getSessionTools = (): Map<string, SessionToolCall> =>
    (sessionTools ??= sessionToolCalls(readSessionMessages(run, stepIndex)));
  // Session-authoritative diff backfill for stream-built tools: the session's
  // `toolResult` messages carry `details` from which `initialItems` derives
  // the diff via `normalizeResultDetails`, but `sessionToolCalls` only joins
  // {name, args, output}. Without this map the stream item's Changes section
  // stays empty. No `createMutationDiff`: child-cwd files are unreadable
  // from here; the session is authoritative. Lazily built, like the join.
  let sessionDiffs: Map<string, { diff: string; diffPath?: string; details: unknown }> | undefined;
  const getSessionDiffs = (): Map<string, { diff: string; diffPath?: string; details: unknown }> => {
    if (sessionDiffs) return sessionDiffs;
    const map = new Map<string, { diff: string; diffPath?: string; details: unknown }>();
    for (const message of readSessionMessages(run, stepIndex)) {
      const record = objectRecord(message);
      const role = typeof record?.role === "string" ? record.role : "";
      if (role !== "toolResult" && role !== "tool") continue;
      const toolCallId = text(record?.toolCallId).trim();
      if (!toolCallId) continue;
      const normalized = normalizeResultDetails(record?.details);
      if (!normalized.diff) continue;
      map.set(toolCallId, {
        diff: normalized.diff,
        ...(normalized.path ? { diffPath: normalized.path } : {}),
        details: record?.details,
      });
    }
    sessionDiffs = map;
    return map;
  };
  const persistedToolCallIds = new Set<string>();
  for (const item of items) {
    if (item.kind === "tool") persistedToolCallIds.add(item.toolCallId);
  }
  const groupOccurrences = new Map<string, number>();
  const streamToolByCallId = new Map<string, number[]>();
  const streamToolByName = new Map<string, number[]>();
  const toolFallbackCounts = new Map<string, number>();
  let current: StreamTextGroup | undefined;
  const flushCurrent = (): void => {
    const group = current;
    current = undefined;
    if (!group || (!group.thinking && !group.text)) return;
    const id = streamTextGroupId(group.runId || run.runId, group);
    if (live) {
      const fresh: AssistantItem = {
        kind: "assistant",
        id,
        text: group.text,
        thinking: group.thinking,
        timestamp: group.ts,
        status: "streaming",
      };
      items.push(fresh);
    } else {
      mergeStreamGroup(items, group, id);
    }
  };
  for (const event of events) {
    const ts = eventTs(event);
    if (event.kind === "thinking" || event.kind === "text") {
      if (!current || current.key !== event.key) {
        flushCurrent();
        const occurrence = groupOccurrences.get(event.key) ?? 0;
        groupOccurrences.set(event.key, occurrence + 1);
        current = {
          key: event.key,
          runId: event.runId,
          blockId: event.blockId,
          occurrence,
          thinking: "",
          text: "",
          ts,
        };
      }
      if (event.kind === "thinking") current.thinking += event.text;
      else current.text += event.text;
      current.ts = ts;
      continue;
    }
    flushCurrent();
    if (event.kind === "tool_start") {
      // The session row is authoritative for tools it already renders (it
      // carries the final output/diff natively): a stream twin would render
      // the same call twice — once at start, once at finish. Skip it live
      // or stopped. While the session lacks the result there is no session
      // row, so the stream row below is still created and transitions
      // streaming→done; once the result lands, the next read renders the
      // single session row instead.
      if (event.toolCallId !== undefined && persistedToolCallIds.has(event.toolCallId)) continue;
      const backfill = event.toolCallId !== undefined ? getSessionTools().get(event.toolCallId) : undefined;
      const diffBackfill = event.toolCallId !== undefined ? getSessionDiffs().get(event.toolCallId) : undefined;
      const fallbackKey = event.toolCallId ?? `name-${event.toolName}`;
      const fallbackCount = toolFallbackCounts.get(fallbackKey) ?? 0;
      toolFallbackCounts.set(fallbackKey, fallbackCount + 1);
      const suffix = fallbackCount > 0 ? `-n${fallbackCount}` : "";
      const callId =
        event.toolCallId ?? `subagent-stream-${run.runId}-tool-${event.toolName}${suffix}-call`;
      const item: ToolItem = {
        kind: "tool",
        id: `subagent-stream-${run.runId}-tool-${event.toolCallId ?? `${event.toolName}${suffix}`}`,
        toolCallId: callId,
        name: event.toolName,
        args: backfill?.args,
        output: backfill?.output ?? "",
        ...(diffBackfill ? { diff: diffBackfill.diff } : {}),
        ...(diffBackfill?.diffPath ? { diffPath: diffBackfill.diffPath } : {}),
        ...(diffBackfill ? { details: diffBackfill.details } : {}),
        timestamp: ts,
        startedAt: ts,
        status: live ? "streaming" : "done",
        isError: false,
      };
      items.push(item);
      const itemIndex = items.length - 1;
      const byName = streamToolByName.get(item.name) ?? [];
      byName.push(itemIndex);
      streamToolByName.set(item.name, byName);
      const byCall = streamToolByCallId.get(callId) ?? [];
      byCall.push(itemIndex);
      streamToolByCallId.set(callId, byCall);
      continue;
    }
    const queue =
      event.toolCallId !== undefined
        ? streamToolByCallId.get(event.toolCallId)
        : streamToolByName.get(event.toolName);
    const targetIndex = queue?.find((index) => {
      const candidate = items[index];
      return candidate?.kind === "tool" && candidate.endedAt === undefined;
    });
    if (targetIndex === undefined) continue;
    const tool = items[targetIndex];
    if (tool?.kind === "tool") {
      const backfill = getSessionTools().get(tool.toolCallId);
      const diffBackfill = getSessionDiffs().get(tool.toolCallId);
      items[targetIndex] = {
        ...tool,
        endedAt: ts,
        status: "done",
        output: tool.output || backfill?.output || "",
        ...(diffBackfill && !tool.diff ? { diff: diffBackfill.diff } : {}),
        ...(diffBackfill?.diffPath && !tool.diffPath ? { diffPath: diffBackfill.diffPath } : {}),
        ...(diffBackfill && tool.details === undefined ? { details: diffBackfill.details } : {}),
      };
    }
  }
  flushCurrent();
}

function readSessionMessages(run: SubagentRun, stepIndex?: number): unknown[] {
  const selected =
    stepIndex === undefined
      ? undefined
      : run.steps.find((step) => step.index === stepIndex)?.sessionFile;
  const sessionFile = selected ?? run.sessionFile;
  if (!sessionFile) return [];
  let content: string;
  try {
    content = fs.readFileSync(sessionFile, "utf8");
  } catch {
    return [];
  }
  const messages: unknown[] = [];
  for (const { record } of parseJsonlTail(content)) {
    const message = record.message;
    if (message && objectRecord(message)) messages.push(message);
  }
  return messages;
}

function readRecords(
  run: SubagentRun,
  stepIndex?: number,
): ParsedTranscriptRecord[] {
  const transcriptPath = subagentTranscriptPath(run, stepIndex);
  if (!transcriptPath) return [];
  let stat: fs.Stats;
  try {
    stat = fs.statSync(transcriptPath);
  } catch {
    return [];
  }
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }
  // Key on stat + content, not (mtimeMs, size): same-size rewrites inside
  // one mtime tick must not serve the previous parse.
  const key = fileContentKey(stat, content);
  const cached = transcriptRecordCache.get(transcriptPath);
  if (cached && cached.key === key) return cached.records;
  const records = parseJsonlTail(content);
  transcriptRecordCache.delete(transcriptPath);
  transcriptRecordCache.set(transcriptPath, {
    key,
    records,
  });
  while (transcriptRecordCache.size > MAX_TRANSCRIPT_RECORD_CACHE_ENTRIES) {
    const oldest = transcriptRecordCache.keys().next().value;
    if (typeof oldest !== "string") break;
    transcriptRecordCache.delete(oldest);
  }
  return records;
}

function substantiveRecordTimestamp(
  record: Record<string, unknown>,
): number | undefined {
  const recordType = text(record.recordType);
  const role = text(record.role);
  if (
    recordType !== "tool_start" &&
    recordType !== "tool_end" &&
    role !== "tool" &&
    role !== "toolResult"
  ) {
    return undefined;
  }
  return typeof record.ts === "number" ? record.ts : undefined;
}

export function subagentActivityAt(
  run: SubagentRun,
  stepIndex?: number,
): number | undefined {
  const step =
    stepIndex === undefined
      ? undefined
      : run.steps.find((candidate) => candidate.index === stepIndex);
  const persisted = step
    ? (step.lastActivityAt ??
      step.currentToolStartedAt ??
      step.endedAt ??
      run.endedAt)
    : stepIndex === undefined
      ? (run.lastActivityAt ?? run.currentToolStartedAt ?? run.endedAt)
      : undefined;
  if (run.runtime === "profiled-subagents") return persisted ?? run.lastActivityAt ?? run.lastUpdate;
  return persisted ?? substantiveSubagentActivityAt(run, stepIndex);
}

/** Return the latest recorded tool activity, ignoring streaming/UI-only updates. */
export function substantiveSubagentActivityAt(
  run: SubagentRun,
  stepIndex?: number,
): number | undefined {
  let latest: number | undefined;
  for (const { record } of readRecords(run, stepIndex)) {
    const timestamp = substantiveRecordTimestamp(record);
    if (timestamp !== undefined && (latest === undefined || timestamp > latest))
      latest = timestamp;
  }
  return latest;
}

function findPendingTool(
  items: ConversationItem[],
  pending: Map<string, number[]>,
  key: string,
  predicate: (tool: ToolItem) => boolean,
): number | undefined {
  const queue = pending.get(key) ?? [];
  for (const index of queue) {
    const item = items[index];
    if (item?.kind === "tool" && predicate(item)) return index;
  }
  return undefined;
}

function userRecordSubtype(record: Record<string, unknown>): string {
  return text(record.subtype) || text(record.messageType);
}

function isKnownDuplicateUserRecord(
  previous: { text: string; record: Record<string, unknown>; index: number } | undefined,
  current: { text: string; record: Record<string, unknown>; index: number },
): boolean {
  if (!previous || normalized(previous.text) !== normalized(current.text)) return false;
  const previousId = text(previous.record.id);
  const currentId = text(current.record.id);
  if (previousId && currentId && previousId === currentId) return true;
  const previousSubtype = userRecordSubtype(previous.record);
  const currentSubtype = userRecordSubtype(current.record);
  return previous.index + 1 === current.index &&
    ((previousSubtype === "initial_prompt" && currentSubtype === "message_end") ||
      (previousSubtype === "message_end" && currentSubtype === "initial_prompt"));
}

/**
 * Parse a pi-subagents JSONL transcript into the same ConversationItem model
 * used by the main chat. This lets the inspector reuse MessageView rather than
 * maintaining a second, visually inconsistent transcript renderer.
 */
export function readSubagentConversation(
  run: SubagentRun,
  maxItems = 160,
  stepIndex?: number,
): ConversationItem[] {
  const items: ConversationItem[] = [];
  const artifactRecords = readRecords(run, stepIndex);
  if (artifactRecords.length === 0) {
    const sessionItems = initialItems(readSessionMessages(run, stepIndex), { stableIds: true });
    if (sessionItems.length > 0) {
      const tail = sessionItems.slice(-maxItems);
      appendProfiledStreamItems(run, tail, stepIndex);
      return tail.slice(-maxItems);
    }
  }
  const pendingByName = new Map<string, number[]>();
  const pendingByCallId = new Map<string, number[]>();
  const resolvedTools = new Set<number>();
  const keyOccurrences = new Map<string, number>();
  let previousUser: { text: string; record: Record<string, unknown>; index: number } | undefined;
  let lastTimestamp = 0;

  for (const { record, index } of artifactRecords) {
    const timestamp = recordTimestamp(record, lastTimestamp);
    lastTimestamp = timestamp;
    // Content-stable identity: the same record keeps the same id across
    // reads, and appending a line leaves earlier records' ids unchanged.
    // Duplicated content gets a deterministic occurrence suffix.
    const key = stableRecordKey(record);
    const occurrence = keyOccurrences.get(key) ?? 0;
    keyOccurrences.set(key, occurrence + 1);
    const base = `subagent-${text(record.runId) || run.runId}-${key}${occurrence > 0 ? `-dup${occurrence}` : ""}`;
    const recordType = text(record.recordType);
    const role = text(record.role);

    if (recordType === "tool_start") {
      const name = text(record.toolName) || "tool";
      const callId = text(record.toolCallId);
      const item: ToolItem = {
        kind: "tool",
        id: `${base}-tool`,
        toolCallId: callId || `${base}-call`,
        name,
        args: text(record.argsPreview) || undefined,
        output: "",
        timestamp,
        startedAt: timestamp,
        status: "streaming",
        isError: false,
      };
      items.push(item);
      const itemIndex = items.length - 1;
      const queue = pendingByName.get(name) ?? [];
      queue.push(itemIndex);
      pendingByName.set(name, queue);
      if (callId) {
        const callQueue = pendingByCallId.get(callId) ?? [];
        callQueue.push(itemIndex);
        pendingByCallId.set(callId, callQueue);
      }
      continue;
    }

    if (recordType === "tool_end") {
      const name = text(record.toolName) || "tool";
      const callId = text(record.toolCallId);
      const targetIndex = callId
        ? findPendingTool(items, pendingByCallId, callId, (tool) => tool.endedAt === undefined)
        : findPendingTool(
            items,
            pendingByName,
            name,
            (tool) => tool.endedAt === undefined,
          );
      if (targetIndex !== undefined) {
        const tool = items[targetIndex] as ToolItem;
        items[targetIndex] = { ...tool, endedAt: timestamp, status: "pending" };
      }
      continue;
    }

    if (recordType === "stderr") {
      const value = text(record.text)
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
        .trim();
      if (value) {
        items.push({
          kind: "system",
          id: `${base}-stderr`,
          text: value,
          timestamp,
          tone: "error",
        });
      }
      continue;
    }

    if (recordType !== "message") continue;

    const rawMessage = objectRecord(record.message);
    const direct = text(record.text);

    if (role === "assistant") {
      const thinking = messageText(rawMessage, "thinking");
      const assistant = direct || messageText(rawMessage, "text");
      const stopReason = text(rawMessage?.stopReason);
      const errorMessage =
        text(rawMessage?.errorMessage) || text(record.errorMessage);
      if (!thinking && !assistant) {
        if (stopReason === "error" || errorMessage) {
          items.push({
            kind: "system",
            id: `${base}-error`,
            text: errorMessage || "Subagent assistant failed.",
            timestamp,
            tone: "error",
          });
        }
        continue;
      }
      items.push({
        kind: "assistant",
        id: `${base}-assistant`,
        text: assistant,
        thinking,
        timestamp,
        status: stopReason === "error" ? "error" : "done",
        ...(stopReason ? { stopReason } : {}),
      });
      continue;
    }

    if (role === "toolResult" || role === "tool") {
      const output = direct || messageText(rawMessage, "text");
      const name =
        text(rawMessage?.toolName) || text(record.toolName) || "tool";
      const toolCallId = text(rawMessage?.toolCallId) || text(record.toolCallId);
      const displayToolCallId = toolCallId || `${base}-call`;
      const isError = Boolean(rawMessage?.isError ?? record.isError);
      const details = rawMessage?.details ?? record.details;
      const matchedIndex = toolCallId
        ? findPendingTool(items, pendingByCallId, toolCallId, (tool) => !resolvedTools.has(items.indexOf(tool)))
        : pendingByName.get(name)?.find((index) => !resolvedTools.has(index));
      if (matchedIndex === undefined) {
        const fallback: ToolItem = {
          kind: "tool",
          id: `${base}-tool-result`,
          toolCallId: displayToolCallId,
          name,
          args: undefined,
          output,
          details,
          diff: resultDiff(details),
          timestamp,
          startedAt: timestamp,
          endedAt: timestamp,
          status: isError ? "error" : "done",
          isError,
        };
        fallback.diffPath = normalizeResultDetails(details).path ?? resultPath(details, fallback);
        items.push(fallback);
      } else {
        const tool = items[matchedIndex] as ToolItem;
        items[matchedIndex] = {
          ...tool,
          toolCallId: displayToolCallId,
          output,
          details,
          diff: resultDiff(details),
          diffPath: normalizeResultDetails(details).path ?? resultPath(details, tool),
          endedAt: tool.endedAt ?? timestamp,
          status: isError ? "error" : "done",
          isError,
        };
        resolvedTools.add(matchedIndex);
      }
      continue;
    }

    if (role === "user") {
      const userText = direct || messageText(rawMessage, "text");
      if (!userText) continue;
      if (userText === "[prompt redacted]; live Prompt Audit only.") continue;
      const currentUser = { text: userText, record, index };
      // pi-subagents commonly writes the same task once as initial_prompt and
      // again as message_end. Suppress only that known duplicate pair (or an
      // exact repeated record id), never an unrelated repeated prompt.
      if (isKnownDuplicateUserRecord(previousUser, currentUser)) continue;
      previousUser = currentUser;
      items.push({
        kind: "user",
        id: `${base}-user`,
        text: userText.slice(0, 4_000),
        timestamp,
        optimistic: false,
      });
    }
  }

  appendProfiledStreamItems(run, items, stepIndex);
  return items.slice(-maxItems);
}

/** Legacy entry view retained for callers/tests that only need plain records. */
export function readSubagentTranscript(
  run: SubagentRun,
  maxEntries = 120,
): SubagentTranscriptEntry[] {
  const entries: SubagentTranscriptEntry[] = [];
  for (const item of readSubagentConversation(run, maxEntries)) {
    if (item.kind === "user") {
      entries.push({
        id: item.id,
        timestamp: item.timestamp,
        kind: "user",
        label: "task",
        text: item.text,
      });
    } else if (item.kind === "assistant") {
      if (item.thinking)
        entries.push({
          id: `${item.id}-thinking`,
          timestamp: item.timestamp,
          kind: "thinking",
          label: "thinking",
          text: item.thinking,
        });
      if (item.text)
        entries.push({
          id: `${item.id}-answer`,
          timestamp: item.timestamp,
          kind: "assistant",
          label: "assistant",
          text: item.text,
        });
    } else if (item.kind === "tool") {
      const args =
        typeof item.args === "string"
          ? item.args
          : item.args === undefined
            ? ""
            : JSON.stringify(item.args);
      entries.push({
        id: item.id,
        timestamp: item.timestamp,
        kind: "tool",
        label: item.name,
        text: item.output || args,
        isError: item.isError,
      });
    } else if (item.kind === "system") {
      entries.push({
        id: item.id,
        timestamp: item.timestamp,
        kind: "system",
        label: item.tone,
        text: item.text,
        isError: item.tone === "error",
      });
    }
  }
  return entries.slice(-maxEntries);
}
