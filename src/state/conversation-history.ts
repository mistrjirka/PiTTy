/** Decode persisted Pi messages into stable conversation items. */
import { stableHash } from "../subagents/cache-key.ts";
import type { ConversationItem, PiEvent } from "../types.ts";
import {
	contentBlocks,
	customItemFromMessage,
	extractText,
	extractThinking,
	id,
	messageRole,
	messageTimestamp,
	objectRecord,
	stringField,
	toolOutput,
	toolTimeLimits,
} from "./conversation-shared.ts";
import { compactTokenCount } from "./compaction-results.ts";
import { normalizeResultDetails } from "./result-diff.ts";

/** Pi's code tool returns opaque resume state in details.state, often >10 MiB.
 * Its state belongs to the Pi session, not the terminal view. Retaining every
 * snapshot in conversation items can consume hundreds of MiB.
 */
export function displayToolDetails(
	toolName: string,
	details: unknown,
): unknown {
	if (toolName.toLowerCase() !== "code") return details;
	const record = objectRecord(details);
	if (!record || !("state" in record)) return details;
	const visible = { ...record };
	delete visible.state;
	return Object.keys(visible).length > 0 ? visible : undefined;
}

export type PersistedToolCallMetadata = {
	toolCallId: string;
	name: string;
	arguments: unknown;
};

export function persistedToolCallMetadata(
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
export function sessionToolCalls(
	messages: unknown[],
): Map<string, SessionToolCall> {
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
			if (!rawId || typeof block.name !== "string" || !block.name.trim())
				continue;
			if (!("arguments" in block) || calls.has(rawId)) continue;
			calls.set(rawId, { name: block.name, args: block.arguments });
		}
	}
	for (const message of messages) {
		const role = messageRole(message);
		if (role !== "toolResult" && role !== "tool") continue;
		const record = objectRecord(message);
		const toolCallId =
			typeof record?.toolCallId === "string" && record.toolCallId.trim()
				? record.toolCallId
				: undefined;
		if (!toolCallId) continue;
		const previous = calls.get(toolCallId);
		const toolName =
			typeof record?.toolName === "string" && record.toolName.trim()
				? record.toolName
				: undefined;
		calls.set(toolCallId, {
			name: previous?.name ?? toolName ?? "tool",
			args: previous?.args,
			output: toolOutput(message),
		});
	}
	return calls;
}

export function initialItems(
	messages: unknown[],
	options?: { stableIds?: boolean },
): ConversationItem[] {
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
	let assistantMessageSeq = 0;
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
		} else if (role === "compactionSummary") {
			// Pi projects each compaction as this message. The live path shows
			// `Context compacted.`; a restored or child transcript says the same,
			// so earlier turns never run straight into later ones unmarked.
			// TODO: render the expandable CompactedSummary card here as the live
			// path does; it needs a CompactionCompletion built from the message.
			const record = objectRecord(message);
			const tokensBefore = record?.tokensBefore;
			const text = typeof tokensBefore === "number" && tokensBefore > 0
				? `Context compacted · ${compactTokenCount(tokensBefore)} tokens summarized`
				: "Context compacted.";
			items.push({
				kind: "system",
				id: makeId("history-compaction", stableHash(`${text}\u0000${messageTimestamp(message, stable)}`)),
				text,
				timestamp: messageTimestamp(message, stable),
				tone: "success",
			});
		} else if (role === "custom") {
			const custom = customItemFromMessage(
				message,
				"history-custom",
				makeId,
				stable,
			);
			if (custom) items.push(custom);
		} else if (role === "assistant") {
			assistantMessageSeq += 1;
			const text = extractText(message);
			const thinking = extractThinking(message);
			const record = objectRecord(message);
			const stopReason = stringField(record, "stopReason");
			const sourceEntryId = stringField(record, "__pittyEntryId");
			const sourceParentId = stringField(record, "__pittyParentId");
			if (text || thinking) {
				items.push({
					kind: "assistant",
					id: makeId(
						"history-assistant",
						stableHash(`${text}\u0000${thinking}`),
					),
					text,
					thinking,
					timestamp: messageTimestamp(message, stable),
					status: stopReason === "error" ? "error" : "done",
					...(stopReason ? { stopReason } : {}),
					sourceMessageSeq: assistantMessageSeq,
					...(sourceEntryId ? { sourceEntryId } : {}),
					...(sourceParentId ? { sourceParentId } : {}),
				});
			}
		} else if (role === "toolResult" || role === "tool") {
			const record = message as Record<string, unknown>;
			const output = toolOutput(message);
			const rawCallId =
				typeof record.toolCallId === "string" && record.toolCallId.trim()
					? record.toolCallId
					: undefined;
			const toolName =
				typeof record.toolName === "string" && record.toolName.trim()
					? record.toolName
					: "tool";
			const toolCallId =
				rawCallId ??
				(stable
					? `history-tool-call-${stableHash(`${toolName}\u0000${output}`)}`
					: id("tool-call"));
			const call = toolCalls.get(toolCallId);
			const normalizedResult = normalizeResultDetails(record.details);
			items.push({
				kind: "tool",
				id: makeId("history-tool", toolCallId),
				toolCallId,
				name: call?.name ?? toolName,
				args: call?.arguments,
				...toolTimeLimits(call?.name ?? toolName, call?.arguments),
				output,
				...(normalizedResult.diff ? { diff: normalizedResult.diff } : {}),
				...(normalizedResult.path ? { diffPath: normalizedResult.path } : {}),
				details: displayToolDetails(call?.name ?? toolName, record.details),
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
	if (!event || typeof event !== "object" || typeof event.type !== "string")
		return false;
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
