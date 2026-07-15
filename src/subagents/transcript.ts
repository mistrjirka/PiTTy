import * as fs from "node:fs";
import type {
  ConversationItem,
  SubagentRun,
  SubagentStep,
  SubagentTranscriptEntry,
  ToolItem,
} from "../types.ts";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function messageBlocks(message: unknown): Array<Record<string, unknown>> {
  const record = objectRecord(message);
  if (!record) return [];
  const content = record.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content)
    ? content.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function messageText(message: unknown, type: "text" | "thinking"): string {
  return messageBlocks(message)
    .filter((block) => type === "text" ? block.type === "text" : block.type === "thinking" || block.type === "reasoning")
    .map((block) => type === "thinking" ? text(block.thinking) || text(block.text) : text(block.text))
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
  const details = objectRecord(detailsValue);
  const patch = details?.patch;
  if (typeof patch === "string" && patch.trim()) return patch;
  const diff = details?.diff;
  return typeof diff === "string" && diff.trim() ? diff : undefined;
}

function resultPath(detailsValue: unknown, tool: ToolItem): string | undefined {
  const details = objectRecord(detailsValue);
  const direct = details?.path ?? details?.filePath ?? details?.file_path;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (/write|edit|patch|replace/i.test(tool.name) && typeof tool.args === "string") {
    const firstLine = tool.args.split(/\r?\n/, 1)[0]?.trim();
    if (firstLine && !firstLine.includes(" ")) return firstLine;
  }
  return undefined;
}

export function activeSubagentStep(run: SubagentRun): SubagentStep | undefined {
  const indexed = run.currentStep !== undefined ? run.steps[run.currentStep] : undefined;
  return indexed ?? run.steps.find((step) => step.status === "running") ?? run.steps.at(-1);
}

export function subagentTranscriptPath(run: SubagentRun, stepIndex?: number): string | undefined {
  const selected = stepIndex !== undefined ? run.steps.find((step) => step.index === stepIndex) : undefined;
  const active = selected?.transcriptPath ?? activeSubagentStep(run)?.transcriptPath ?? run.transcriptPath;
  if (active) return active;
  for (let index = run.steps.length - 1; index >= 0; index--) {
    const transcriptPath = run.steps[index]?.transcriptPath;
    if (transcriptPath) return transcriptPath;
  }
  return undefined;
}

function readRecords(run: SubagentRun, stepIndex?: number): Array<{ record: Record<string, unknown>; index: number }> {
  const transcriptPath = subagentTranscriptPath(run, stepIndex);
  if (!transcriptPath) return [];
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  const records: Array<{ record: Record<string, unknown>; index: number }> = [];
  for (let index = Math.max(0, lines.length - 700); index < lines.length; index++) {
    try {
      const parsed = JSON.parse(lines[index]!) as unknown;
      const record = objectRecord(parsed);
      if (record) records.push({ record, index });
    } catch {
      // The writer may leave the final JSONL line incomplete briefly.
    }
  }
  return records;
}

function findPendingTool(
  items: ConversationItem[],
  pendingByName: Map<string, number[]>,
  toolName: string,
  predicate: (tool: ToolItem) => boolean,
): number | undefined {
  const queue = pendingByName.get(toolName) ?? [];
  for (const index of queue) {
    const item = items[index];
    if (item?.kind === "tool" && predicate(item)) return index;
  }
  return undefined;
}

/**
 * Parse a pi-subagents JSONL transcript into the same ConversationItem model
 * used by the main chat. This lets the inspector reuse MessageView rather than
 * maintaining a second, visually inconsistent transcript renderer.
 */
export function readSubagentConversation(run: SubagentRun, maxItems = 160, stepIndex?: number): ConversationItem[] {
  const items: ConversationItem[] = [];
  const pendingByName = new Map<string, number[]>();
  const resolvedTools = new Set<number>();
  const seenUsers = new Set<string>();

  for (const { record, index } of readRecords(run, stepIndex)) {
    const timestamp = recordTimestamp(record);
    const base = `subagent-${text(record.runId) || run.runId}-${timestamp}-${index}`;
    const recordType = text(record.recordType);
    const role = text(record.role);

    if (recordType === "tool_start") {
      const name = text(record.toolName) || "tool";
      const item: ToolItem = {
        kind: "tool",
        id: `${base}-tool`,
        toolCallId: `${base}-call`,
        name,
        args: text(record.argsPreview) || undefined,
        output: "",
        timestamp,
        startedAt: timestamp,
        status: "streaming",
        isError: false,
      };
      items.push(item);
      const queue = pendingByName.get(name) ?? [];
      queue.push(items.length - 1);
      pendingByName.set(name, queue);
      continue;
    }

    if (recordType === "tool_end") {
      const name = text(record.toolName) || "tool";
      const targetIndex = findPendingTool(items, pendingByName, name, (tool) => tool.endedAt === undefined);
      if (targetIndex !== undefined) {
        const tool = items[targetIndex] as ToolItem;
        items[targetIndex] = { ...tool, endedAt: timestamp, status: "pending" };
      }
      continue;
    }

    if (recordType === "stderr") {
      const value = text(record.text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
      if (value) {
        items.push({ kind: "system", id: `${base}-stderr`, text: value, timestamp, tone: "error" });
      }
      continue;
    }

    if (recordType !== "message") continue;

    const rawMessage = objectRecord(record.message);
    const direct = text(record.text);

    if (role === "assistant") {
      const thinking = messageText(rawMessage, "thinking");
      const assistant = direct || messageText(rawMessage, "text");
      if (!thinking && !assistant) continue;
      const stopReason = text(rawMessage?.stopReason);
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
      const name = text(rawMessage?.toolName) || text(record.toolName) || "tool";
      const toolCallId = text(rawMessage?.toolCallId) || `${base}-call`;
      const isError = Boolean(rawMessage?.isError ?? record.isError);
      const details = rawMessage?.details ?? record.details;
      const matchedIndex = pendingByName.get(name)?.find((index) => !resolvedTools.has(index));
      if (matchedIndex !== undefined) {
        const tool = items[matchedIndex] as ToolItem;
        items[matchedIndex] = {
          ...tool,
          toolCallId,
          output,
          details,
          diff: resultDiff(details),
          diffPath: resultPath(details, tool),
          endedAt: tool.endedAt ?? timestamp,
          status: isError ? "error" : "done",
          isError,
        };
        resolvedTools.add(matchedIndex);
      } else {
        const fallback: ToolItem = {
          kind: "tool",
          id: `${base}-tool-result`,
          toolCallId,
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
        fallback.diffPath = resultPath(details, fallback);
        items.push(fallback);
      }
      continue;
    }

    if (role === "user") {
      const userText = direct || messageText(rawMessage, "text");
      if (!userText) continue;
      const key = normalized(userText);
      // pi-subagents commonly writes the same task once as initial_prompt and
      // again as message_end. Keep the first copy only.
      if (seenUsers.has(key)) continue;
      seenUsers.add(key);
      items.push({
        kind: "user",
        id: `${base}-user`,
        text: userText.slice(0, 4_000),
        timestamp,
        optimistic: false,
      });
    }
  }

  return items.slice(-maxItems);
}

/** Legacy entry view retained for callers/tests that only need plain records. */
export function readSubagentTranscript(run: SubagentRun, maxEntries = 120): SubagentTranscriptEntry[] {
  const entries: SubagentTranscriptEntry[] = [];
  for (const item of readSubagentConversation(run, maxEntries)) {
    if (item.kind === "user") {
      entries.push({ id: item.id, timestamp: item.timestamp, kind: "user", label: "task", text: item.text });
    } else if (item.kind === "assistant") {
      if (item.thinking) entries.push({ id: `${item.id}-thinking`, timestamp: item.timestamp, kind: "thinking", label: "thinking", text: item.thinking });
      if (item.text) entries.push({ id: `${item.id}-answer`, timestamp: item.timestamp, kind: "assistant", label: "assistant", text: item.text });
    } else if (item.kind === "tool") {
      const args = typeof item.args === "string" ? item.args : item.args === undefined ? "" : JSON.stringify(item.args);
      entries.push({ id: item.id, timestamp: item.timestamp, kind: "tool", label: item.name, text: item.output || args, isError: item.isError });
    } else if (item.kind === "system") {
      entries.push({ id: item.id, timestamp: item.timestamp, kind: "system", label: item.tone, text: item.text, isError: item.tone === "error" });
    }
  }
  return entries.slice(-maxEntries);
}
