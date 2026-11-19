/** Edit, cancel and explicitly combine messages that are still queued. */
import type { TextareaRenderable } from "@opentui/core";
import type { QueueState } from "../rpc/queue-types.ts";
import type { LocalQueuedMessage } from "../state/input-continuity.ts";
import type { Toast } from "../types.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

export type PendingInputItem = {
	id: string;
	source: "local" | "pi";
	mode: "steer" | "followUp";
	text: string;
};

export type PendingInputEdit = PendingInputItem & { previousDraft: string };

export interface QueuedInputActions {
	messages: () => PendingInputItem[];
	editing: () => PendingInputEdit | undefined;
	busy: () => boolean;
	queueSupported: () => boolean;
	edit: (item: PendingInputItem) => void;
	cancel: (item: PendingInputItem) => Promise<void>;
	combineWithNext: (item: PendingInputItem) => Promise<void>;
	saveEdit: (text: string) => Promise<void>;
	cancelEdit: () => void;
}

export interface QueuedInputPorts {
	activeRuntime: () => ConversationTabRuntime;
	queuedFollowUps: () => LocalQueuedMessage[];
	queueRevision?: () => number;
	expandedPromptText: () => string;
	syncMainDraft: (text: string) => void;
	syncRuntimeMainDraft: (runtime: ConversationTabRuntime, text: string) => void;
	getPrompt: () => TextareaRenderable | undefined;
	touch: () => void;
	toast: (text: string, tone: Toast["tone"], durationMs?: number) => void;
	flushQueuedFollowUp: (runtime: ConversationTabRuntime) => Promise<void>;
}

function itemsFor(runtime: ConversationTabRuntime): PendingInputItem[] {
	return [
		...(runtime.conversation.queue?.messages ?? []).map((item): PendingInputItem => ({
			id: item.id, source: "pi", mode: item.mode, text: item.message,
		})),
		...runtime.queuedFollowUps.map((item): PendingInputItem => ({
			id: item.id, source: "local", mode: "followUp", text: item.text,
		})),
	];
}

export function createQueuedInputActions(ports: QueuedInputPorts): QueuedInputActions {
	const track = () => {
		ports.queuedFollowUps();
		ports.queueRevision?.();
	};
	const messages = () => { track(); return itemsFor(ports.activeRuntime()); };
	const editing = () => { track(); return ports.activeRuntime().pendingInputEdit; };
	const busy = () => { track(); return Boolean(ports.activeRuntime().queueMutationInFlight); };
	const finishEdit = (runtime: ConversationTabRuntime, submittedText?: string) => {
		const edit = runtime.pendingInputEdit;
		if (!edit) return;
		delete runtime.pendingInputEdit;
		if (submittedText !== undefined && ports.activeRuntime().id === runtime.id &&
			ports.expandedPromptText().trim() !== submittedText.trim()) {
			if (edit.previousDraft) runtime.promptHistory.recordDraft(edit.previousDraft);
		} else ports.syncRuntimeMainDraft(runtime, edit.previousDraft);
		ports.touch();
	};
	const edit = (item: PendingInputItem) => {
		const runtime = ports.activeRuntime();
		if (runtime.queueMutationInFlight) return;
		if (runtime.pendingInputEdit) {
			ports.toast("Save or cancel the current edit first.", "info");
			return;
		}
		const current = itemsFor(runtime).find((entry) => entry.id === item.id && entry.source === item.source);
		if (!current) {
			ports.toast("That message is no longer queued.", "warning");
			return;
		}
		runtime.pendingInputEdit = { ...current, previousDraft: ports.expandedPromptText() };
		ports.syncMainDraft(current.text);
		ports.touch();
		ports.getPrompt()?.focus();
	};
	const mutate = async (
		runtime: ConversationTabRuntime,
		operation: () => Promise<void>,
	): Promise<void> => {
		if (runtime.queueMutationInFlight) return;
		runtime.queueMutationInFlight = true;
		ports.touch();
		try {
			await operation();
		} catch (error) {
			ports.toast(error instanceof Error ? error.message : String(error), "warning", 6000);
		} finally {
			delete runtime.queueMutationInFlight;
			ports.touch();
		}
	};
	const apply = (runtime: ConversationTabRuntime, queue: QueueState, sessionId: string | undefined) => {
		if (runtime.sessionState?.sessionId !== sessionId) return;
		// A later queue event may already have consumed this response's messages.
		runtime.conversation.applyQueueState(queue);
		runtime.onConversationChange();
	};
	const cancel = async (item: PendingInputItem): Promise<void> => {
		const runtime = ports.activeRuntime();
		if (runtime.pendingInputEdit) {
			ports.toast("Save or cancel the current edit first.", "info");
			return;
		}
		const sessionId = runtime.sessionState?.sessionId;
		await mutate(runtime, async () => {
			if (item.source === "pi") {
				apply(runtime, await runtime.client.removeQueuedMessage(item.id, runtime.conversation.queue?.revision), sessionId);
			} else {
				runtime.queuedFollowUps = runtime.queuedFollowUps.filter((entry) => entry.id !== item.id);
			}
			ports.toast("Queued message cancelled.", "success");
		});
	};
	const combineWithNext = async (item: PendingInputItem): Promise<void> => {
		const runtime = ports.activeRuntime();
		if (runtime.pendingInputEdit) {
			ports.toast("Save or cancel the current edit first.", "info");
			return;
		}
		const sessionId = runtime.sessionState?.sessionId;
		await mutate(runtime, async () => {
			const current = itemsFor(runtime);
			const index = current.findIndex((entry) => entry.id === item.id && entry.source === item.source);
			const first = current[index], next = current[index + 1];
			if (!first || !next || first.source !== next.source || first.mode !== next.mode)
				throw new Error("Only consecutive messages with the same delivery mode can be combined.");
			if (first.source === "pi") {
				apply(runtime, await runtime.client.combineQueuedMessages([first.id, next.id], runtime.conversation.queue?.revision), sessionId);
			} else {
				runtime.queuedFollowUps = runtime.queuedFollowUps
					.filter((entry) => entry.id !== next.id)
					.map((entry) => entry.id === first.id ? { ...entry, text: first.text + "\n\n" + next.text } : entry);
			}
			ports.toast("Queued messages combined.", "success");
		});
	};
	const saveEdit = async (text: string): Promise<void> => {
		const runtime = ports.activeRuntime();
		const currentEdit = runtime.pendingInputEdit;
		if (!currentEdit || !text.trim()) return;
		const sessionId = runtime.sessionState?.sessionId;
		await mutate(runtime, async () => {
			const current = itemsFor(runtime).find((entry) => entry.id === currentEdit.id && entry.source === currentEdit.source);
			if (!current) throw new Error("That message is no longer queued. Your edited text is still in the editor.");
			if (current.text !== currentEdit.text)
				throw new Error("That queued message changed. Cancel this edit and open it again. Your text is still in the editor.");
			if (currentEdit.source === "pi") {
				apply(runtime, await runtime.client.updateQueuedMessage(currentEdit.id, text, runtime.conversation.queue?.revision), sessionId);
			} else {
				runtime.queuedFollowUps = runtime.queuedFollowUps.map((entry) =>
					entry.id === currentEdit.id ? { ...entry, text } : entry);
			}
			if (runtime.pendingInputEdit === currentEdit) finishEdit(runtime, text);
			ports.toast("Queued message updated.", "success");
			if (currentEdit.source === "local") void ports.flushQueuedFollowUp(runtime);
		});
	};
	const cancelEdit = () => {
		const runtime = ports.activeRuntime();
		if (runtime.queueMutationInFlight) return;
		const wasLocal = runtime.pendingInputEdit?.source === "local";
		finishEdit(runtime);
		ports.getPrompt()?.focus();
		if (wasLocal) void ports.flushQueuedFollowUp(runtime);
	};
	const queueSupported = () => { track(); return Boolean(ports.activeRuntime().conversation.queue); };
	return { messages, editing, busy, queueSupported, edit, cancel, combineWithNext, saveEdit, cancelEdit };
}
