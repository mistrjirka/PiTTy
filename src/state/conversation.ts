import { parseQueueState, type QueueState } from "../rpc/queue-types.ts";
import { id, extractText, extractThinking, assistantErrorMessage, objectRecord, stringArrayField, normalizedText, eventDelta, mergeStreamingText, stringField, numberField, messageRole, messageTimestamp, customItemFromMessage } from "./conversation-shared.ts";
import { codeCellObservation, codeResultStatus } from "./code-tool-presentation.ts";
import { mergeNestedCallMetadata } from "./nested-tool-history.ts";
import { toolCompletionFromEvent } from "./tool-completions.ts";




import { applyConversationToolEvent } from "./conversation-tools.ts";
import type { AssistantItem, ConversationItem, PiEvent, SystemItem, UserItem } from "../types.ts";

export { extractText, extractThinking } from "./conversation-shared.ts";
export { initialItems, sessionToolCalls, isConversationEvent } from "./conversation-history.ts";
export type { SessionToolCall } from "./conversation-history.ts";

export class ConversationModel {
	readonly items: ConversationItem[] = [];
	private liveAssistantMessage: Record<string, unknown> | undefined;
	private liveUserItemId: string | undefined;
	// Repeated stream updates must not scan the complete chat transcript.
	private activeAssistantIndex = -1;
	private readonly toolIndices = new Map<string, number>();
	private readonly userIndices = new Map<string, number[]>();
	isStreaming = false;
	isCompacting = false;
	steering: readonly string[] = [];
	followUp: readonly string[] = [];
	queue: QueueState | undefined;

	constructor(
		seed: ConversationItem[] = [],
		private readonly cwd?: string,
	) {
		this.items.push(...seed);
		this.rebuildIndices();
	}

	/** Keep lookup indexes consistent when loading a different session or removing an optimistic item. */
	replaceItems(items: readonly ConversationItem[]): void {
		this.items.splice(0, this.items.length, ...items);
		this.liveAssistantMessage = undefined;
		this.rebuildIndices();
	}

	removeItem(itemId: string): boolean {
		const index = this.items.findIndex((item) => item.id === itemId);
		if (index < 0) return false;
		this.items.splice(index, 1);
		this.rebuildIndices();
		return true;
	}

	private rebuildIndices(): void {
		this.toolIndices.clear();
		this.userIndices.clear();
		this.liveUserItemId = undefined;
		this.activeAssistantIndex = -1;
		for (const [index, item] of this.items.entries()) {
			if (item.kind === "tool") this.toolIndices.set(item.toolCallId, index);
			else if (item.kind === "user") this.indexUser(normalizedText(item.text), index);
			else if (item.kind === "assistant" && item.status === "streaming")
				this.activeAssistantIndex = index;
		}
	}

	private indexUser(text: string, index: number): void {
		const found = this.userIndices.get(text);
		if (found) found.push(index);
		else this.userIndices.set(text, [index]);
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
		this.indexUser(normalizedText(text), this.items.length - 1);
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

	applyQueueState(queue: QueueState): void {
		if (this.queue && queue.revision < this.queue.revision) return;
		this.queue = queue;
		this.steering = queue.messages.filter((item) => item.mode === "steer").map((item) => item.message);
		this.followUp = queue.messages.filter((item) => item.mode === "followUp").map((item) => item.message);
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
				const processExited = objectRecord(event)?.processExited === true;
				for (let index = 0; index < this.items.length; index++) {
					const item = this.items[index];
					if (
						(item?.kind === "assistant" || item?.kind === "tool") &&
						item.status === "streaming" &&
						!(item.kind === "tool" && item.parentToolCallId && !processExited)
					) {
						this.items[index] = processExited && item.kind === "tool" ? {
							...item, status: "error", isError: true, endedAt: Date.now(),
							output: item.output + (item.output ? "\n" : "") + "Runtime exited before completion was confirmed.",
						} : { ...item, status: item.kind === "assistant" && item.errorMessage ? "error" : "done" };
					}
				}
				this.removeEmptyAssistantItems();
				return;
			}
			case "entry_appended": {
				const completion = toolCompletionFromEvent(event);
				if (!completion) return;
				const original = this.items[this.toolIndices.get(completion.toolCallId) ?? -1];
				if (original?.kind === "tool") {
					const before = codeCellObservation(original.name, original.details);
					const after = codeCellObservation(completion.toolName, completion.result.details);
					if (original.name !== completion.toolName || (before && (!after || before.id !== after.id))) return;
				}
				this.applyToolEvent({ type: "tool_execution_end", ...completion,
					isError: completion.result.isError === true || codeResultStatus(completion.toolName, completion.result.details) === "error" });
				return;
			}
			case "queue_update": {
				const queue = objectRecord(event);
				const state = parseQueueState(queue);
				if (state) this.applyQueueState(state);
				else {
					this.steering = stringArrayField(queue?.steering);
					this.followUp = stringArrayField(queue?.followUp);
				}
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
			const matches = this.userIndices.get(normalized) ?? [];
			for (let offset = matches.length - 1; offset >= 0; offset--) {
				const index = matches[offset]!;
				const item = this.items[index];
				if (item?.kind !== "user") continue;
				if (item.optimistic || (eventType !== "message_start" && item.id === this.liveUserItemId)) {
					existingIndex = index;
					break;
				}
			}
			let userItemId: string;
			if (existingIndex >= 0) {
				const existing = this.items[existingIndex] as UserItem;
				userItemId = existing.id;
				this.items[existingIndex] = {
					...existing,
					text,
					timestamp,
					optimistic: false,
				};
			} else {
				userItemId = id("user-event");
				this.items.push({
					kind: "user",
					id: userItemId,
					text,
					timestamp,
					optimistic: false,
				});
				this.indexUser(normalized, this.items.length - 1);
			}
			// Distinct submissions can contain identical text and timestamps.
			// Only pair start/end events belonging to the currently emitted user message.
			if (eventType === "message_start") this.liveUserItemId = userItemId;
			else if (eventType === "message_end") this.liveUserItemId = undefined;
			return;
		}
		if (role === "toolResult" || role === "tool") {
			const result = objectRecord(message);
			const callId = stringField(result, "toolCallId");
			if (!result || !callId) return;
			if (!this.toolIndices.has(callId)) this.applyToolEvent({
				type: "tool_execution_end", toolCallId: callId, toolName: stringField(result, "toolName") ?? "tool",
				result, isError: result.isError === true,
			});
			// Final nested evidence can be attached after tool_execution_end.
			mergeNestedCallMetadata(this.items, this.toolIndices, result, callId, messageTimestamp(result));
			return;
		}
		if (role !== "assistant") return;

		const timestamp = messageTimestamp(message);
		// Delta-only events carry no cumulative message. Extracting content from
		// the growing assistant snapshot on each token caused quadratic work.
		// message_end supplies the authoritative complete text when it arrives.
		const fullText = suppliedMessage ? extractText(suppliedMessage) : "";
		const fullThinking = suppliedMessage ? extractThinking(suppliedMessage) : "";
		const authoritativeEnd = event.type === "message_end" && Boolean(suppliedMessage);
		const deltaOnly = !suppliedMessage && Boolean(this.liveAssistantMessage);
		const delta = eventDelta(event);
		const assistantRecord = objectRecord(event.assistantMessageEvent);
		const terminalError = assistantRecord?.type === "error" && assistantRecord.reason === "error";
		const errorMessage = assistantErrorMessage(suppliedMessage) ??
			(terminalError ? assistantErrorMessage(assistantRecord.error) ??
				"Provider returned an error without details." : undefined);


		let currentIndex = this.activeAssistantIndex;
		if (currentIndex >= 0) {
			const previous = this.items[currentIndex];
			if (previous?.kind !== "assistant" || previous.status !== "streaming")
				currentIndex = -1;
		}
		// Fallback for restored sessions, replaced rows, or nonstandard streams.
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
			fullText || fullThinking || delta.text || delta.thinking || errorMessage,
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
		this.activeAssistantIndex = currentIndex;

		const current = this.items[currentIndex] as AssistantItem;
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
		const finalError = errorMessage ?? (stop === "error" || terminalError ? current.errorMessage : undefined);
		const errored = stop === "error" || terminalError || Boolean(finalError);

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
			// Keep the active row until message_end; the error delta and final
			// snapshot describe the same response, not two separate failures.
			status: event.type === "message_end" ? errored ? "error" : "done" : "streaming",
			...(stop ? { stopReason: stop } : {}),
			...(finalError ? { errorMessage: finalError } : {}),
		};
		this.items[currentIndex] = updated;
		if (updated.status !== "streaming") this.activeAssistantIndex = -1;

		if (event.type === "message_end") this.removeEmptyAssistantItems();
	}

	private removeEmptyAssistantItems(): void {
		let removed = false;
		for (let index = this.items.length - 1; index >= 0; index--) {
			const item = this.items[index];
			if (
				item?.kind === "assistant" &&
				!item.text.trim() &&
				!item.thinking.trim() &&
				!item.errorMessage
			) {
				this.items.splice(index, 1);
				removed = true;
			}
		}
		if (removed) this.rebuildIndices();
	}

	private applyToolEvent(event: Record<string, unknown>): void {
		applyConversationToolEvent(this.items, this.toolIndices, event, this.cwd);
	}
}
