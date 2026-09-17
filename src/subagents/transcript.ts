import * as fs from "node:fs";
import { initialItems } from "../state/conversation.ts";
import { normalizeResultDetails } from "../state/result-diff.ts";
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
  mtimeMs: number;
  size: number;
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

function recordTimestamp(record: Record<string, unknown>): number {
  return typeof record.ts === "number" ? record.ts : Date.now();
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
  text: string;
  toolName: string;
  toolCallId?: string | undefined;
  ts: number;
};

type ProfiledStreamCacheEntry = {
  mtimeMs: number;
  size: number;
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
  const ts = typeof parsed.ts === "number" && Number.isFinite(parsed.ts) ? parsed.ts : Date.now();
  return {
    kind,
    key: `${runId}::${blockId}`,
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
  const cached = profiledStreamCache.get(eventsPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.events;
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
  const lines = content.split("\n");
  const events: ProfiledStreamEvent[] = [];
  for (let index = Math.max(0, lines.length - MAX_PROFILED_STREAM_EVENTS); index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined || !line.trim()) continue;
    const event = parseProfiledStreamEvent(line);
    if (event && (event.kind === "tool_start" || event.kind === "tool_end" || event.text)) events.push(event);
  }
  profiledStreamCache.delete(eventsPath);
  profiledStreamCache.set(eventsPath, { mtimeMs: stat.mtimeMs, size: stat.size, events });
  while (profiledStreamCache.size > MAX_PROFILED_STREAM_CACHE_ENTRIES) {
    const oldest = profiledStreamCache.keys().next().value;
    if (typeof oldest !== "string") break;
    profiledStreamCache.delete(oldest);
  }
  return events;
}

/**
 * Append in-flight live-stream items from the profiled `events.jsonl` file:
 * consecutive `thinking`/`text` lines sharing `(runId, blockId)` accumulate
 * into ONE synthetic assistant item with `status: "streaming"` (thinking
 * goes to the item's `thinking`, text to its `text`); a new `blockId`
 * starts a new item; `tool_start` creates a streaming `ToolItem` and the
 * matching `tool_end` (by `toolCallId`, else by name) completes it.
 *
 * ONLY while the run is actually live (`profiledRunIsLive`). Once the run
 * is not live the child session JSONL is authoritative — rendering both
 * would show the completed message alongside its streamed chunks.
 *
 * Laziness: this runs inside `readSubagentConversation`, which the app only
 * invokes for the inspected target while the detail pane is open
 * (`inspectSubagent()` via `createSubagentTranscriptCache`); no second
 * polling timer is added, the existing refresh path drives re-reads and the
 * `(mtimeMs, size)` cache above bounds the IO.
 */
function appendProfiledStreamItems(run: SubagentRun, items: ConversationItem[]): void {
  if (!run.eventsPath || !profiledRunIsLive(run)) return;
  const events = readProfiledStreamEvents(run.eventsPath);
  if (events.length === 0) return;
  const streamToolByCallId = new Map<string, number[]>();
  const streamToolByName = new Map<string, number[]>();
  let currentKey: string | undefined;
  let currentIndex: number | undefined;
  let counter = 0;
  for (const event of events) {
    if (event.kind === "thinking" || event.kind === "text") {
      let index = currentKey === event.key ? currentIndex : undefined;
      if (index === undefined) {
        counter += 1;
        const fresh: AssistantItem = {
          kind: "assistant",
          id: `subagent-stream-${run.runId}-${counter}`,
          text: "",
          thinking: "",
          timestamp: event.ts,
          status: "streaming",
        };
        items.push(fresh);
        index = items.length - 1;
        currentKey = event.key;
        currentIndex = index;
      }
      const current = items[index];
      if (current?.kind === "assistant") {
        if (event.kind === "thinking") current.thinking += event.text;
        else current.text += event.text;
        current.timestamp = event.ts;
      }
      continue;
    }
    currentKey = undefined;
    currentIndex = undefined;
    if (event.kind === "tool_start") {
      counter += 1;
      const callId = event.toolCallId ?? `subagent-stream-${run.runId}-${counter}-call`;
      const item: ToolItem = {
        kind: "tool",
        id: `subagent-stream-${run.runId}-${counter}`,
        toolCallId: callId,
        name: event.toolName,
        args: undefined,
        output: "",
        timestamp: event.ts,
        startedAt: event.ts,
        status: "streaming",
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
    const queue = event.toolCallId !== undefined
      ? streamToolByCallId.get(event.toolCallId)
      : streamToolByName.get(event.toolName);
    const targetIndex = queue?.find((index) => {
      const candidate = items[index];
      return candidate?.kind === "tool" && candidate.status === "streaming" && candidate.endedAt === undefined;
    });
    if (targetIndex === undefined) continue;
    const tool = items[targetIndex];
    if (tool?.kind === "tool") items[targetIndex] = { ...tool, endedAt: event.ts, status: "done" };
  }
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
  const cached = transcriptRecordCache.get(transcriptPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size)
    return cached.records;
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }
  const records = parseJsonlTail(content);
  transcriptRecordCache.delete(transcriptPath);
  transcriptRecordCache.set(transcriptPath, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
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
    const sessionItems = initialItems(readSessionMessages(run, stepIndex));
    if (sessionItems.length > 0) {
      const tail = sessionItems.slice(-maxItems);
      appendProfiledStreamItems(run, tail);
      return tail.slice(-maxItems);
    }
  }
  const pendingByName = new Map<string, number[]>();
  const pendingByCallId = new Map<string, number[]>();
  const resolvedTools = new Set<number>();
  let previousUser: { text: string; record: Record<string, unknown>; index: number } | undefined;

  for (const { record, index } of artifactRecords) {
    const timestamp = recordTimestamp(record);
    const base = `subagent-${text(record.runId) || run.runId}-${timestamp}-${index}`;
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

  appendProfiledStreamItems(run, items);
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
