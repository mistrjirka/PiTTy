import { readFileSync } from "node:fs";
import * as path from "node:path";
import { createTwoFilesPatch } from "diff";
import type { AssistantItem, ConversationItem, PiEvent, SystemItem, ToolItem, UserItem } from "../types.ts";

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function contentBlocks(message: unknown): Array<Record<string, unknown>> {
  if (!message || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
}

export function extractText(message: unknown): string {
  return contentBlocks(message)
    .filter((block) => block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("");
}

export function extractThinking(message: unknown): string {
  return contentBlocks(message)
    .filter((block) => block.type === "thinking" || block.type === "reasoning")
    .map((block) => {
      if (typeof block.thinking === "string") return block.thinking;
      if (typeof block.text === "string") return block.text;
      return "";
    })
    .join("\n\n");
}

function messageRole(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const role = (message as Record<string, unknown>).role;
  return typeof role === "string" ? role : undefined;
}

function messageTimestamp(message: unknown): number {
  if (!message || typeof message !== "object") return Date.now();
  const timestamp = (message as Record<string, unknown>).timestamp;
  return typeof timestamp === "number" ? timestamp : Date.now();
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function toolOutput(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as Record<string, unknown>).content;
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content
    .filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object")
    .map((part) => (typeof part.text === "string" ? part.text : typeof part.data === "string" ? part.data : ""))
    .filter(Boolean)
    .join("\n");
}


function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function mutationPath(args: unknown): string | undefined {
  const record = objectRecord(args);
  const value = record?.path ?? record?.file_path;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mutationContent(toolName: string, args: unknown, oldContent: string): string | undefined {
  const record = objectRecord(args);
  if (!record) return undefined;
  const normalizedName = toolName.toLowerCase();
  if (normalizedName === "write" || normalizedName.endsWith(".write") || normalizedName.includes("write_file")) {
    return typeof record.content === "string" ? record.content : undefined;
  }
  if (!(normalizedName === "edit" || normalizedName.endsWith(".edit") || normalizedName.includes("edit_file"))) return undefined;
  const rawEdits = Array.isArray(record.edits)
    ? record.edits
    : typeof record.oldText === "string" && typeof record.newText === "string"
      ? [{ oldText: record.oldText, newText: record.newText }]
      : [];
  let updated = oldContent;
  for (const raw of rawEdits) {
    const edit = objectRecord(raw);
    if (typeof edit?.oldText !== "string" || typeof edit?.newText !== "string") continue;
    const position = updated.indexOf(edit.oldText);
    if (position < 0) continue;
    updated = updated.slice(0, position) + edit.newText + updated.slice(position + edit.oldText.length);
  }
  return updated === oldContent && rawEdits.length ? undefined : updated;
}

function resultDiff(result: unknown): string | undefined {
  const details = objectRecord(objectRecord(result)?.details);
  const patch = details?.patch;
  if (typeof patch === "string" && patch.trim()) return patch;
  const diff = details?.diff;
  return typeof diff === "string" && diff.trim() ? diff : undefined;
}

function createMutationDiff(toolName: string, args: unknown, cwd: string | undefined): { diff?: string; path?: string } {
  const requestedPath = mutationPath(args);
  if (!requestedPath) return {};
  const absolutePath = path.isAbsolute(requestedPath) ? requestedPath : path.resolve(cwd ?? process.cwd(), requestedPath);
  let before = "";
  let existed = false;
  try {
    before = readFileSync(absolutePath, "utf8");
    existed = true;
  } catch {}
  const after = mutationContent(toolName, args, before);
  if (after === undefined || after === before) return { path: requestedPath };
  const oldName = existed ? `a/${requestedPath}` : "/dev/null";
  const newName = `b/${requestedPath}`;
  return {
    path: requestedPath,
    diff: createTwoFilesPatch(oldName, newName, before, after, "", "", { context: 3 }),
  };
}

function eventDelta(event: Record<string, unknown>): { text: string; thinking: string } {
  const raw = event.assistantMessageEvent;
  if (!raw || typeof raw !== "object") return { text: "", thinking: "" };
  const assistantEvent = raw as Record<string, unknown>;
  const type = typeof assistantEvent.type === "string" ? assistantEvent.type : "";
  const delta = typeof assistantEvent.delta === "string" ? assistantEvent.delta : "";
  if (!delta) return { text: "", thinking: "" };
  if (type === "text_delta") return { text: delta, thinking: "" };
  if (type === "thinking_delta" || type === "reasoning_delta" || type.includes("thinking") || type.includes("reasoning")) {
    return { text: "", thinking: delta };
  }
  return { text: "", thinking: "" };
}

function mergeStreamingText(existing: string, full: string, delta: string): string {
  // Provider snapshots occasionally lag behind the already-rendered deltas. Never
  // replace a longer live value with a shorter snapshot: shrinking streaming text
  // leaves stale terminal cells and visually cuts thoughts off.
  if (full) {
    if (!existing) return full;
    if (full.startsWith(existing)) return full;
    if (existing.startsWith(full)) return existing;
    if (full.length > existing.length) return full;
  }
  if (delta && !existing.endsWith(delta)) return existing + delta;
  return existing;
}

type PersistedToolCallMetadata = {
  toolCallId: string;
  name: string;
  arguments: unknown;
};

function persistedToolCallMetadata(message: unknown): PersistedToolCallMetadata[] {
  return contentBlocks(message).flatMap((block): PersistedToolCallMetadata[] => {
    if (block.type !== "toolCall") return [];
    const rawId = typeof block.id === "string" && block.id.trim() ? block.id : block.toolCallId;
    if (typeof rawId !== "string" || !rawId.trim() || typeof block.name !== "string" || !block.name.trim()) return [];
    if (!("arguments" in block)) return [];
    const args = block.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) return [];
    return [{ toolCallId: rawId, name: block.name, arguments: args }];
  });
}

function toolTimeoutMs(args: unknown): number | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  const raw = typeof record.timeoutMs === "number" ? record.timeoutMs : typeof record.timeout === "number" ? record.timeout : undefined;
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return undefined;
  // If value is less than 1000, assume it's in seconds and convert to milliseconds
  const ms = raw < 1000 ? raw * 1000 : raw;
  return Math.floor(ms);
}

export function initialItems(messages: unknown[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  const toolCalls = new Map<string, PersistedToolCallMetadata>();
  for (const message of messages) {
    for (const call of persistedToolCallMetadata(message)) toolCalls.set(call.toolCallId, call);
  }
  for (const message of messages) {
    const role = messageRole(message);
    if (role === "user") {
      const text = extractText(message);
      if (text) items.push({ kind: "user", id: id("history-user"), text, timestamp: messageTimestamp(message), optimistic: false });
    } else if (role === "assistant") {
      const text = extractText(message);
      const thinking = extractThinking(message);
      if (text || thinking) {
        items.push({ kind: "assistant", id: id("history-assistant"), text, thinking, timestamp: messageTimestamp(message), status: "done" });
      }
    } else if (role === "toolResult" || role === "tool") {
      const record = message as Record<string, unknown>;
      const output = toolOutput(message);
      const toolCallId = typeof record.toolCallId === "string" && record.toolCallId.trim() ? record.toolCallId : id("tool-call");
      const call = toolCalls.get(toolCallId);
      items.push({
        kind: "tool",
        id: id("history-tool"),
        toolCallId,
        name: call?.name ?? (typeof record.toolName === "string" && record.toolName.trim() ? record.toolName : "tool"),
        args: call?.arguments,
        output,
        details: record.details,
        timestamp: messageTimestamp(message),
        startedAt: messageTimestamp(message),
        endedAt: messageTimestamp(message),
        status: "done",
        isError: Boolean(record.isError),
      });
    }
  }
  return items;
}

export class ConversationModel {
  readonly items: ConversationItem[] = [];
  isStreaming = false;
  steering: readonly string[] = [];
  followUp: readonly string[] = [];

  constructor(seed: ConversationItem[] = [], private readonly cwd?: string) {
    this.items.push(...seed);
  }

  optimisticUser(text: string): string {
    const itemId = id("user");
    this.items.push({ kind: "user", id: itemId, text, timestamp: Date.now(), optimistic: true });
    return itemId;
  }

  system(text: string, tone: SystemItem["tone"] = "muted"): void {
    this.items.push({ kind: "system", id: id("system"), text, timestamp: Date.now(), tone });
  }

  apply(event: PiEvent): void {
    if (!event || typeof event !== "object" || typeof event.type !== "string") return;
    switch (event.type) {
      case "agent_start":
        this.isStreaming = true;
        return;
      case "agent_settled":
      case "agent_end": {
        this.isStreaming = false;
        for (let index = 0; index < this.items.length; index++) {
          const item = this.items[index];
          if ((item?.kind === "assistant" || item?.kind === "tool") && item.status === "streaming") {
            this.items[index] = { ...item, status: "done" };
          }
        }
        this.removeEmptyAssistantItems();
        return;
      }
      case "queue_update": {
        const queue = event as unknown as { steering?: readonly string[]; followUp?: readonly string[] };
        this.steering = queue.steering ?? [];
        this.followUp = queue.followUp ?? [];
        return;
      }
      case "message_start":
      case "message_end":
      case "message_update":
        this.applyMessageEvent(event as unknown as Record<string, unknown>);
        return;
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end":
        this.applyToolEvent(event as unknown as Record<string, unknown>);
        return;
      case "compaction_start":
        this.system("Compacting context…", "info");
        return;
      case "compaction_end": {
        const compact = event as unknown as { aborted?: boolean; errorMessage?: string };
        this.system(compact.errorMessage ? `Compaction failed: ${compact.errorMessage}` : compact.aborted ? "Compaction aborted." : "Context compacted.", compact.errorMessage ? "error" : "success");
        return;
      }
      case "auto_retry_start": {
        const retry = event as unknown as { attempt?: number; maxAttempts?: number; errorMessage?: string };
        this.system(`Retrying ${retry.attempt ?? "?"}/${retry.maxAttempts ?? "?"}: ${retry.errorMessage ?? "transient error"}`, "warning");
        return;
      }
      case "extension_error": {
        const ext = event as unknown as { error?: string; extensionPath?: string };
        this.system(`Extension error${ext.extensionPath ? ` in ${ext.extensionPath}` : ""}: ${ext.error ?? "unknown error"}`, "error");
        return;
      }
    }
  }

  private applyMessageEvent(event: Record<string, unknown>): void {
    const message = event.message;
    const role = messageRole(message);
    if (role === "user") {
      const text = extractText(message);
      if (!text) return;
      const timestamp = messageTimestamp(message);
      const normalized = normalizedText(text);
      let existingIndex = -1;
      for (let index = this.items.length - 1; index >= 0; index--) {
        const item = this.items[index];
        if (item?.kind !== "user" || normalizedText(item.text) !== normalized) continue;
        if (item.optimistic || Math.abs(item.timestamp - timestamp) < 60_000) {
          existingIndex = index;
          break;
        }
      }
      if (existingIndex >= 0) {
        const existing = this.items[existingIndex] as UserItem;
        this.items[existingIndex] = { ...existing, text, timestamp, optimistic: false };
      } else {
        this.items.push({ kind: "user", id: id("user-event"), text, timestamp, optimistic: false });
      }
      return;
    }
    if (role !== "assistant") return;

    const timestamp = messageTimestamp(message);
    const fullText = extractText(message);
    const fullThinking = extractThinking(message);
    const delta = eventDelta(event);

    let currentIndex = -1;
    for (let index = this.items.length - 1; index >= 0; index--) {
      const item = this.items[index];
      if (item?.kind === "assistant" && item.status === "streaming" && item.timestamp === timestamp) {
        currentIndex = index;
        break;
      }
    }
    if (currentIndex < 0) {
      for (let index = this.items.length - 1; index >= 0; index--) {
        const item = this.items[index];
        if (item?.kind === "assistant" && item.status === "streaming") {
          currentIndex = index;
          break;
        }
      }
    }

    const hasVisibleContent = Boolean(fullText || fullThinking || delta.text || delta.thinking);
    if (currentIndex < 0 && hasVisibleContent) {
      const item: AssistantItem = {
        kind: "assistant",
        id: id("assistant"),
        text: "",
        thinking: "",
        timestamp,
        status: "streaming",
      };
      this.items.push(item);
      currentIndex = this.items.length - 1;
    }
    if (currentIndex < 0) return;

    const current = this.items[currentIndex] as AssistantItem;
    const assistantEvent = event.assistantMessageEvent;
    const assistantRecord = assistantEvent && typeof assistantEvent === "object"
      ? assistantEvent as Record<string, unknown>
      : undefined;
    const messageRecord = message && typeof message === "object" ? message as Record<string, unknown> : undefined;
    const stop = typeof assistantRecord?.reason === "string"
      ? assistantRecord.reason
      : typeof messageRecord?.stopReason === "string"
        ? messageRecord.stopReason
        : current.stopReason;
    const errored = assistantRecord?.type === "error" || stop === "error";

    const updated: AssistantItem = {
      ...current,
      timestamp,
      text: mergeStreamingText(current.text, fullText, delta.text),
      thinking: mergeStreamingText(current.thinking, fullThinking, delta.thinking),
      status: event.type === "message_end" ? (errored ? "error" : "done") : errored ? "error" : "streaming",
      ...(stop ? { stopReason: stop } : {}),
    };
    this.items[currentIndex] = updated;

    if (event.type === "message_end") this.removeEmptyAssistantItems();
  }

  private removeEmptyAssistantItems(): void {
    for (let index = this.items.length - 1; index >= 0; index--) {
      const item = this.items[index];
      if (item?.kind === "assistant" && !item.text.trim() && !item.thinking.trim()) this.items.splice(index, 1);
    }
  }

  private applyToolEvent(event: Record<string, unknown>): void {
    const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : id("unknown-tool");
    let index = this.items.findIndex((entry) => entry.kind === "tool" && entry.toolCallId === toolCallId);
    if (index < 0) {
      const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
      const preview = createMutationDiff(toolName, event.args, this.cwd);
      const item: ToolItem = {
        kind: "tool",
        id: id("tool"),
        toolCallId,
        name: toolName,
        args: event.args,
        output: "",
        ...(preview.diff ? { diff: preview.diff } : {}),
        ...(preview.path ? { diffPath: preview.path } : {}),
        timestamp: Date.now(),
        startedAt: Date.now(),
        timeoutMs: toolTimeoutMs(event.args),
        status: "pending",
        isError: false,
      };
      this.items.push(item);
      index = this.items.length - 1;
    }

    const current = this.items[index] as ToolItem;
    if (event.type === "tool_execution_start") {
      const nextArgs = event.args ?? current.args;
      const preview = createMutationDiff(current.name, nextArgs, this.cwd);
      this.items[index] = {
        ...current,
        args: nextArgs,
        ...(preview.diff ? { diff: preview.diff } : {}),
        ...(preview.path ? { diffPath: preview.path } : {}),
        startedAt: current.startedAt ?? Date.now(),
        timeoutMs: toolTimeoutMs(event.args) ?? current.timeoutMs,
        status: "streaming",
      };
      return;
    }
    const result = event.type === "tool_execution_update" ? event.partialResult : event.result;
    const settledDiff = event.type === "tool_execution_end" ? resultDiff(result) : undefined;
    this.items[index] = {
      ...current,
      output: toolOutput(result),
      ...(objectRecord(result)?.details !== undefined ? { details: objectRecord(result)?.details } : {}),
      ...(settledDiff ? { diff: settledDiff } : {}),
      status: event.type === "tool_execution_end" ? (event.isError ? "error" : "done") : "streaming",
      ...(event.type === "tool_execution_end" ? { endedAt: Date.now() } : {}),
      isError: Boolean(event.isError),
    };
  }
}
