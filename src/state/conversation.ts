import { readFileSync } from "node:fs";
import * as path from "node:path";
import { createTwoFilesPatch } from "diff";
import { stableHash } from "../subagents/cache-key.ts";
import { normalizeResultDetails } from "./result-diff.ts";
import type {
	AssistantItem,
	ConversationItem,
	CustomItem,
	PiEvent,
	SystemItem,
	ToolItem,
	UserItem,
} from "../types.ts";

function id(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function contentBlocks(message: unknown): Array<Record<string, unknown>> {
	if (!message || typeof message !== "object") return [];
	const content = (message as Record<string, unknown>).content;
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (!Array.isArray(content)) return [];
	return content.filter(
		(entry): entry is Record<string, unknown> =>
			Boolean(entry) && typeof entry === "object",
	);
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

function messageTimestamp(message: unknown, stable = false): number {
	if (!message || typeof message !== "object") return stable ? 0 : Date.now();
	const timestamp = (message as Record<string, unknown>).timestamp;
	if (typeof timestamp === "number") return timestamp;
	// Stable mode (child-transcript reads) must not mint a fresh Date.now()
	// per poll: it would defeat both item identity and the deep-compare cache.
	return stable ? 0 : Date.now();
}

function normalizedText(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

function customItemFromMessage(
	message: unknown,
	prefix: string,
	makeId: (prefix: string, key?: string) => string = id,
	stable = false,
): CustomItem | undefined {
	const record = objectRecord(message);
	if (!record || record.display === false) return undefined;
	const customType =
		typeof record.customType === "string" && record.customType.trim()
			? record.customType
			: typeof record.type === "string" && record.type.trim()
				? record.type
				: "custom";
	const text = extractText(message);
	return {
		kind: "custom",
		id:
			typeof record.id === "string" && record.id.trim()
				? record.id
				: makeId(prefix, stable ? stableHash(`${customType}\u0000${text}`) : undefined),
		customType,
		text,
		...(record.details !== undefined ? { details: record.details } : {}),
		timestamp: messageTimestamp(message, stable),
	};
}

function toolOutput(result: unknown): string {
	if (!result || typeof result !== "object") return "";
	const content = (result as Record<string, unknown>).content;
	if (!Array.isArray(content))
		return typeof content === "string" ? content : "";
	return content
		.filter(
			(part): part is Record<string, unknown> =>
				Boolean(part) && typeof part === "object",
		)
		.map((part) =>
			typeof part.text === "string"
				? part.text
				: typeof part.data === "string"
					? part.data
					: "",
		)
		.filter(Boolean)
		.join("\n");
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Guarded field readers for the event boundary: a malformed payload must
 * fall back to the default, never flow a wrong-typed value into state. */
function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayField(value: unknown): string[] {
	return Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string")
		? [...value]
		: [];
}

function mutationPath(args: unknown): string | undefined {
	const record = objectRecord(args);
	const value = record?.path ?? record?.file_path;
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mutationContent(
	toolName: string,
	args: unknown,
	oldContent: string,
): string | undefined {
	const record = objectRecord(args);
	if (!record) return undefined;
	const normalizedName = toolName.toLowerCase();
	if (
		normalizedName === "write" ||
		normalizedName.endsWith(".write") ||
		normalizedName.includes("write_file")
	) {
		return typeof record.content === "string" ? record.content : undefined;
	}
	if (
		!(
			normalizedName === "edit" ||
			normalizedName.endsWith(".edit") ||
			normalizedName.includes("edit_file")
		)
	)
		return undefined;
	const rawEdits = Array.isArray(record.edits)
		? record.edits
		: typeof record.oldText === "string" && typeof record.newText === "string"
			? [{ oldText: record.oldText, newText: record.newText }]
			: [];
	let updated = oldContent;
	for (const raw of rawEdits) {
		const edit = objectRecord(raw);
		if (typeof edit?.oldText !== "string" || typeof edit?.newText !== "string")
			continue;
		const position = updated.indexOf(edit.oldText);
		if (position < 0) continue;
		updated =
			updated.slice(0, position) +
			edit.newText +
			updated.slice(position + edit.oldText.length);
	}
	return updated === oldContent && rawEdits.length ? undefined : updated;
}


function createMutationDiff(
	toolName: string,
	args: unknown,
	cwd: string | undefined,
): { diff?: string; path?: string } {
	const requestedPath = mutationPath(args);
	if (!requestedPath) return {};
	const absolutePath = path.isAbsolute(requestedPath)
		? requestedPath
		: path.resolve(cwd ?? process.cwd(), requestedPath);
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
		diff: createTwoFilesPatch(oldName, newName, before, after, "", "", {
			context: 3,
		}),
	};
}

function eventDelta(event: Record<string, unknown>): {
	text: string;
	thinking: string;
} {
	const raw = event.assistantMessageEvent;
	if (!raw || typeof raw !== "object") return { text: "", thinking: "" };
	const assistantEvent = raw as Record<string, unknown>;
	const type =
		typeof assistantEvent.type === "string" ? assistantEvent.type : "";
	const delta =
		typeof assistantEvent.delta === "string" ? assistantEvent.delta : "";
	if (!delta) return { text: "", thinking: "" };
	if (type === "text_delta") return { text: delta, thinking: "" };
	// Exact protocol types only: substring matching routed unrelated future
	// event types containing "thinking"/"reasoning" into the thought stream.
	if (type === "thinking_delta" || type === "reasoning_delta") {
		return { text: "", thinking: delta };
	}
	return { text: "", thinking: "" };
}

function mergeStreamingText(
	existing: string,
	full: string,
	delta: string,
): string {
	// Provider snapshots occasionally lag behind the already-rendered deltas. Never
	// replace a longer live value with a shorter snapshot: shrinking streaming text
	// leaves stale terminal cells and visually cuts thoughts off.
	if (full) {
		if (!existing) return full;
		if (full.startsWith(existing)) return full;
		if (existing.startsWith(full)) return existing;
		if (full.length > existing.length) return full;
	}
	// The delta protocol carries no sequence/offset, so there is nothing to
	// dedupe against: every delta is appended unconditionally. (The old
	// `endsWith` check silently dropped a legitimate repeated delta, e.g.
	// streaming a repeated token or "\u2026".) Snapshot overlap is handled by
	// the `full` branch above, and the delta-only path below never dedupes.
	if (delta) return existing + delta;
	return existing;
}

type PersistedToolCallMetadata = {
	toolCallId: string;
	name: string;
	arguments: unknown;
};

function persistedToolCallMetadata(
	message: unknown,
): PersistedToolCallMetadata[] {
	return contentBlocks(message).flatMap(
		(block): PersistedToolCallMetadata[] => {
			if (block.type !== "toolCall") return [];
			const rawId =
				typeof block.id === "string" && block.id.trim()
					? block.id
					: block.toolCallId;
			if (
				typeof rawId !== "string" ||
				!rawId.trim() ||
				typeof block.name !== "string" ||
				!block.name.trim()
			)
				return [];
			if (!("arguments" in block)) return [];
			const args = block.arguments;
			if (!args || typeof args !== "object" || Array.isArray(args)) return [];
			return [{ toolCallId: rawId, name: block.name, arguments: args }];
		},
	);
}

export type SessionToolCall = {
	name: string;
	args: unknown;
	output?: string | undefined;
};

/**
 * Session-file join table for stream tool items, keyed by toolCallId.
 * `toolCall` blocks carry the arguments — present while the tool is still in
 * flight, before any result exists — and `toolResult` messages carry the
 * output. First invocation wins for args; results only fill the output.
 */
export function sessionToolCalls(messages: unknown[]): Map<string, SessionToolCall> {
	const calls = new Map<string, SessionToolCall>();
	for (const message of messages) {
		for (const block of contentBlocks(message)) {
			if (block.type !== "toolCall") continue;
			const rawId =
				typeof block.id === "string" && block.id.trim()
					? block.id
					: typeof block.toolCallId === "string" && block.toolCallId.trim()
						? block.toolCallId
						: undefined;
			if (!rawId || typeof block.name !== "string" || !block.name.trim()) continue;
			if (!("arguments" in block) || calls.has(rawId)) continue;
			calls.set(rawId, { name: block.name, args: block.arguments });
		}
	}
	for (const message of messages) {
		const role = messageRole(message);
		if (role !== "toolResult" && role !== "tool") continue;
		const record = objectRecord(message);
		const toolCallId =
			typeof record?.toolCallId === "string" && record.toolCallId.trim() ? record.toolCallId : undefined;
		if (!toolCallId) continue;
		const previous = calls.get(toolCallId);
		const toolName =
			typeof record?.toolName === "string" && record.toolName.trim() ? record.toolName : undefined;
		calls.set(toolCallId, {
			name: previous?.name ?? toolName ?? "tool",
			args: previous?.args,
			output: toolOutput(message),
		});
	}
	return calls;
}

function toolTimeoutMs(args: unknown): number | undefined {
	if (!args || typeof args !== "object" || Array.isArray(args))
		return undefined;
	const record = args as Record<string, unknown>;
	const raw =
		typeof record.timeoutMs === "number"
			? record.timeoutMs
			: typeof record.timeout === "number"
				? record.timeout
				: undefined;
	if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return undefined;
	// The field is named `timeoutMs`: take the value as milliseconds. A bare
	// small value is NOT converted from seconds — there is no evidence any
	// producer mixes units, and guessing turned an honest 500 ms timeout into
	// a fabricated 500 s one.
	return Math.floor(raw);
}

export function initialItems(messages: unknown[], options?: { stableIds?: boolean }): ConversationItem[] {
	const items: ConversationItem[] = [];
	const stable = options?.stableIds === true;
	// Stable mode (child-transcript reads) derives ids from content so the
	// same message keeps the same id across polls; `<For each>` then keeps
	// rows instead of destroying/recreating them. Duplicate content gets a
	// deterministic occurrence suffix, which is stable under appends.
	const occurrences = new Map<string, number>();
	const makeId = (prefix: string, key?: string): string => {
		if (!stable || key === undefined) return id(prefix);
		const seen = occurrences.get(key) ?? 0;
		occurrences.set(key, seen + 1);
		return seen === 0 ? `${prefix}-${key}` : `${prefix}-${key}-n${seen}`;
	};
	const toolCalls = new Map<string, PersistedToolCallMetadata>();
	for (const message of messages) {
		for (const call of persistedToolCallMetadata(message))
			toolCalls.set(call.toolCallId, call);
	}
	for (const message of messages) {
		const role = messageRole(message);
		if (role === "user") {
			const text = extractText(message);
			if (text)
				items.push({
					kind: "user",
					id: makeId("history-user", stableHash(text)),
					text,
					timestamp: messageTimestamp(message, stable),
					optimistic: false,
				});
		} else if (role === "custom") {
			const custom = customItemFromMessage(message, "history-custom", makeId, stable);
			if (custom) items.push(custom);
		} else if (role === "assistant") {
			const text = extractText(message);
			const thinking = extractThinking(message);
			if (text || thinking) {
				items.push({
					kind: "assistant",
					id: makeId("history-assistant", stableHash(`${text}\u0000${thinking}`)),
					text,
					thinking,
					timestamp: messageTimestamp(message, stable),
					status: "done",
				});
			}
		} else if (role === "toolResult" || role === "tool") {
			const record = message as Record<string, unknown>;
			const output = toolOutput(message);
			const rawCallId =
				typeof record.toolCallId === "string" && record.toolCallId.trim() ? record.toolCallId : undefined;
			const toolName =
				typeof record.toolName === "string" && record.toolName.trim() ? record.toolName : "tool";
			const toolCallId =
				rawCallId ??
				(stable ? `history-tool-call-${stableHash(`${toolName}\u0000${output}`)}` : id("tool-call"));
			const call = toolCalls.get(toolCallId);
			const normalizedResult = normalizeResultDetails(record.details);
			items.push({
				kind: "tool",
				id: makeId("history-tool", toolCallId),
				toolCallId,
				name: call?.name ?? toolName,
				args: call?.arguments,
				output,
				...(normalizedResult.diff ? { diff: normalizedResult.diff } : {}),
				...(normalizedResult.path ? { diffPath: normalizedResult.path } : {}),
				details: record.details,
				timestamp: messageTimestamp(message, stable),
				startedAt: messageTimestamp(message, stable),
				endedAt: messageTimestamp(message, stable),
				status: "done",
				isError: Boolean(record.isError),
			});
		}
	}
	return items;
}

export function isConversationEvent(event: PiEvent): boolean {
	if (!event || typeof event !== "object" || typeof event.type !== "string") return false;
	switch (event.type) {
		case "agent_start":
		case "agent_settled":
		case "agent_end":
		case "queue_update":
		case "message_start":
		case "message_end":
		case "message_update":
		case "tool_execution_start":
		case "tool_execution_update":
		case "tool_execution_end":
		case "compaction_start":
		case "compaction_end":
		case "auto_retry_start":
		case "extension_error":
			return true;
		default:
			return false;
	}
}

export class ConversationModel {
	readonly items: ConversationItem[] = [];
	private liveAssistantMessage: Record<string, unknown> | undefined;
	isStreaming = false;
	isCompacting = false;
	steering: readonly string[] = [];
	followUp: readonly string[] = [];

	constructor(
		seed: ConversationItem[] = [],
		private readonly cwd?: string,
	) {
		this.items.push(...seed);
	}

	optimisticUser(text: string): string {
		const itemId = id("user");
		this.items.push({
			kind: "user",
			id: itemId,
			text,
			timestamp: Date.now(),
			optimistic: true,
		});
		return itemId;
	}

	assignEntryIds(entryIds: readonly (string | undefined)[]): boolean {
		let userIndex = 0;
		let changed = false;
		for (const item of this.items) {
			if (item.kind !== "user") continue;
			const entryId = entryIds[userIndex];
			if (item.entryId !== entryId) changed = true;
			if (entryId) item.entryId = entryId;
			else delete item.entryId;
			userIndex += 1;
		}
		return changed;
	}

	system(text: string, tone: SystemItem["tone"] = "muted"): void {
		this.items.push({
			kind: "system",
			id: id("system"),
			text,
			timestamp: Date.now(),
			tone,
		});
	}

	apply(event: PiEvent): void {
		if (!event || typeof event !== "object" || typeof event.type !== "string")
			return;
		switch (event.type) {
			case "agent_start":
				this.isStreaming = true;
				return;
			case "agent_settled": {
				this.isStreaming = false;
				for (let index = 0; index < this.items.length; index++) {
					const item = this.items[index];
					if (
						(item?.kind === "assistant" || item?.kind === "tool") &&
						item.status === "streaming"
					) {
						this.items[index] = { ...item, status: "done" };
					}
				}
				this.removeEmptyAssistantItems();
				return;
			}
			case "queue_update": {
				const queue = objectRecord(event);
				this.steering = stringArrayField(queue?.steering);
				this.followUp = stringArrayField(queue?.followUp);
				return;
			}
			case "message_start":
			case "message_end":
			case "message_update": {
				const messageEvent = objectRecord(event);
				if (messageEvent) this.applyMessageEvent(messageEvent);
				return;
			}
			case "tool_execution_start":
			case "tool_execution_update":
			case "tool_execution_end": {
				const toolEvent = objectRecord(event);
				if (toolEvent) this.applyToolEvent(toolEvent);
				return;
			}
			case "compaction_start":
				this.isCompacting = true;
				this.system("Compacting context…", "info");
				return;
			case "compaction_end": {
				this.isCompacting = false;
				const compact = objectRecord(event);
				const errorMessage = stringField(compact, "errorMessage");
				const aborted = compact?.aborted === true;
				this.system(
					errorMessage
						? `Compaction failed: ${errorMessage}`
						: aborted
							? "Compaction aborted."
							: "Context compacted.",
					errorMessage ? "error" : "success",
				);
				return;
			}
			case "auto_retry_start": {
				const retry = objectRecord(event);
				const attempt = numberField(retry, "attempt");
				const maxAttempts = numberField(retry, "maxAttempts");
				const errorMessage = stringField(retry, "errorMessage");
				this.system(
					`Retrying ${attempt ?? "?"}/${maxAttempts ?? "?"}: ${errorMessage ?? "transient error"}`,
					"warning",
				);
				return;
			}
			case "extension_error": {
				const ext = objectRecord(event);
				const error = stringField(ext, "error");
				const extensionPath = stringField(ext, "extensionPath");
				this.system(
					`Extension error${extensionPath ? ` in ${extensionPath}` : ""}: ${error ?? "unknown error"}`,
					"error",
				);
				return;
			}
		}
	}

	private applyMessageEvent(event: Record<string, unknown>): void {
		// Pi's JSON/RPC adapter removes cumulative message snapshots from message_update;
		// message_start seeds this accumulator and message_end remains authoritative.
		const rawMessage = event.message;
		const suppliedMessage =
			rawMessage && typeof rawMessage === "object" && !Array.isArray(rawMessage)
				? (rawMessage as Record<string, unknown>)
				: undefined;
		const eventType = event.type;
		if (eventType === "message_start" && suppliedMessage && messageRole(suppliedMessage) === "assistant") {
			this.liveAssistantMessage = { ...suppliedMessage };
		} else if (eventType === "message_end" && suppliedMessage) {
			this.liveAssistantMessage = undefined;
		}
		const message = suppliedMessage ?? this.liveAssistantMessage;
		const role = messageRole(message);
		if (role === "custom") {
			const custom = customItemFromMessage(message, "custom-event");
			if (!custom) return;
			const duplicate = this.items.some(
				(item) =>
					item.kind === "custom" &&
					item.customType === custom.customType &&
					item.text === custom.text &&
					Math.abs(item.timestamp - custom.timestamp) <= 5_000,
			);
			if (!duplicate) this.items.push(custom);
			return;
		}
		if (role === "user") {
			const text = extractText(message);
			if (!text) return;
			const timestamp = messageTimestamp(message);
			const normalized = normalizedText(text);
			let existingIndex = -1;
			for (let index = this.items.length - 1; index >= 0; index--) {
				const item = this.items[index];
				if (item?.kind !== "user" || normalizedText(item.text) !== normalized)
					continue;
				if (item.optimistic || Math.abs(item.timestamp - timestamp) < 60_000) {
					existingIndex = index;
					break;
				}
			}
			if (existingIndex >= 0) {
				const existing = this.items[existingIndex] as UserItem;
				this.items[existingIndex] = {
					...existing,
					text,
					timestamp,
					optimistic: false,
				};
			} else {
				this.items.push({
					kind: "user",
					id: id("user-event"),
					text,
					timestamp,
					optimistic: false,
				});
			}
			return;
		}
		if (role !== "assistant") return;

		const timestamp = messageTimestamp(message);
		const fullText = extractText(message);
		const fullThinking = extractThinking(message);
		const authoritativeEnd = event.type === "message_end" && Boolean(suppliedMessage);
		const deltaOnly = !suppliedMessage && Boolean(this.liveAssistantMessage);
		const delta = eventDelta(event);
		if (!suppliedMessage && this.liveAssistantMessage && (delta.text || delta.thinking)) {
			const blocks = contentBlocks(this.liveAssistantMessage).map((block) => ({ ...block }));
			const rawAssistantEvent = event.assistantMessageEvent;
			const assistantEvent =
				rawAssistantEvent && typeof rawAssistantEvent === "object"
					? (rawAssistantEvent as Record<string, unknown>)
					: undefined;
			const contentIndex =
				typeof assistantEvent?.contentIndex === "number" && assistantEvent.contentIndex >= 0
					? Math.floor(assistantEvent.contentIndex)
					: 0;
			const blockType = delta.thinking ? "thinking" : "text";
			const block = blocks[contentIndex];
			if (block?.type === blockType) {
				const field = blockType === "thinking" ? "thinking" : "text";
				block[field] = `${typeof block[field] === "string" ? block[field] : ""}${
					delta.thinking || delta.text
				}`;
			} else {
				blocks[contentIndex] =
					blockType === "thinking"
						? { type: "thinking", thinking: delta.thinking }
						: { type: "text", text: delta.text };
			}
			this.liveAssistantMessage.content = blocks;
		}

		let currentIndex = -1;
		for (let index = this.items.length - 1; index >= 0; index--) {
			const item = this.items[index];
			if (
				item?.kind === "assistant" &&
				item.status === "streaming" &&
				item.timestamp === timestamp
			) {
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

		const hasVisibleContent = Boolean(
			fullText || fullThinking || delta.text || delta.thinking,
		);
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
		const assistantRecord =
			assistantEvent && typeof assistantEvent === "object"
				? (assistantEvent as Record<string, unknown>)
				: undefined;
		const messageRecord =
			message && typeof message === "object"
				? (message as Record<string, unknown>)
				: undefined;
		const stop =
			typeof assistantRecord?.reason === "string"
				? assistantRecord.reason
				: typeof messageRecord?.stopReason === "string"
					? messageRecord.stopReason
					: current.stopReason;
		const errored = assistantRecord?.type === "error" || stop === "error";

		const updated: AssistantItem = {
			...current,
			timestamp,
			text: authoritativeEnd
				? fullText
				: deltaOnly
					? current.text + delta.text
					: mergeStreamingText(current.text, fullText, delta.text),
			thinking: authoritativeEnd
				? fullThinking
				: deltaOnly
					? current.thinking + delta.thinking
					: mergeStreamingText(
							current.thinking,
							fullThinking,
							delta.thinking,
						),
			status:
				event.type === "message_end"
					? errored
						? "error"
						: "done"
					: errored
						? "error"
						: "streaming",
			...(stop ? { stopReason: stop } : {}),
		};
		this.items[currentIndex] = updated;

		if (event.type === "message_end") this.removeEmptyAssistantItems();
	}

	private removeEmptyAssistantItems(): void {
		for (let index = this.items.length - 1; index >= 0; index--) {
			const item = this.items[index];
			if (
				item?.kind === "assistant" &&
				!item.text.trim() &&
				!item.thinking.trim()
			)
				this.items.splice(index, 1);
		}
	}

	private applyToolEvent(event: Record<string, unknown>): void {
		const toolCallId =
			typeof event.toolCallId === "string"
				? event.toolCallId
				: id("unknown-tool");
		let index = this.items.findIndex(
			(entry) => entry.kind === "tool" && entry.toolCallId === toolCallId,
		);
		if (index < 0) {
			const toolName =
				typeof event.toolName === "string" ? event.toolName : "tool";
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
		const result =
			event.type === "tool_execution_update"
				? event.partialResult
				: event.result;
		const normalizedResult = event.type === "tool_execution_end"
			? normalizeResultDetails(objectRecord(result)?.details)
			: {};
		const settledDiff = normalizedResult.diff;
		this.items[index] = {
			...current,
			output: toolOutput(result),
			...(objectRecord(result)?.details !== undefined
				? { details: objectRecord(result)?.details }
				: {}),
			...(settledDiff ? { diff: settledDiff } : {}),
			...(normalizedResult.path ? { diffPath: normalizedResult.path } : {}),
			status:
				event.type === "tool_execution_end"
					? event.isError
						? "error"
						: "done"
					: "streaming",
			...(event.type === "tool_execution_end" ? { endedAt: Date.now() } : {}),
			isError: Boolean(event.isError),
		};
	}
}
