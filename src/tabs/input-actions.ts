/** Prompt submission, queued-message editing, and RPC abort handling. */
import { randomUUID } from "node:crypto";
import type { TextareaRenderable } from "@opentui/core";
import type { Accessor } from "solid-js";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import type { LocalQueuedMessage } from "../state/input-continuity.ts";
import type { StartupPhase } from "../state/startup.ts";
import type { RpcExtensionUIRequest, Toast } from "../types.ts";
import { InputController } from "./input-controller.ts";
import { createQueuedInputActions, type QueuedInputActions } from "./queued-input-actions.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

export interface InputActionsPorts {
	readonly logger: DiagnosticLogger;
	readonly tabRuntimeIsActive: (id: string) => boolean;
	readonly trimMessageWindowIfFollowingLatest: () => void;
	readonly conversationTouch: (reason?: "stream" | "structure") => void;
	readonly scrollToBottom: () => void;
	readonly clearRuntimeMainDraftIfMatches: (runtime: ConversationTabRuntime, text: string) => void;
	readonly toast: (text: string, tone: Toast["tone"], durationMs?: number) => void;
	readonly activeRuntime: () => ConversationTabRuntime;
	readonly startupPhase: Accessor<StartupPhase>;
	readonly dialog: Accessor<RpcExtensionUIRequest | undefined>;
	readonly expandedPromptText: () => string;
	readonly handleSlashCommand: (text: string, runtime: ConversationTabRuntime) => Promise<boolean>;
	readonly clearMainDraft: () => void;
	readonly syncMainDraft: (text: string) => void;
	readonly syncRuntimeMainDraft: (runtime: ConversationTabRuntime, text: string) => void;
	readonly touch: () => void;
	readonly getPrompt: () => TextareaRenderable | undefined;
	readonly queuedFollowUps: () => LocalQueuedMessage[];
	readonly queueRevision?: () => number;
}

export interface InputActions {
	readonly sendText: (text: string, runtime?: ConversationTabRuntime) => Promise<"sent" | "queued">;
	readonly submit: () => Promise<void>;
	readonly queueFollowUp: () => void;
	readonly editQueuedFollowUp: (messageId: string) => void;
	readonly restoreQueuedFollowUp: () => void;
	readonly queuedInput: QueuedInputActions;
	readonly flushQueuedFollowUp: (runtime?: ConversationTabRuntime) => Promise<void>;
	readonly abortActiveWork: () => void;
}

export function createInputActions(ports: InputActionsPorts): InputActions {
	const inputController = new InputController<ConversationTabRuntime>(ports.logger, {
		isActive: ports.tabRuntimeIsActive,
		onChange: () => ports.touch(),
		onOptimisticSubmit: () => {
			ports.trimMessageWindowIfFollowingLatest();
			ports.conversationTouch();
			ports.scrollToBottom();
		},
		onQueuedPromptSent: (runtime, text) => ports.clearRuntimeMainDraftIfMatches(runtime, text),
		notify: (message, tone) => ports.toast(message, tone),
	});
	const sendText = (
		text: string,
		runtime: ConversationTabRuntime = ports.activeRuntime(),
	): Promise<"sent" | "queued"> => inputController.sendText(text, runtime);
	const flushQueuedFollowUp = (
		runtime: ConversationTabRuntime = ports.activeRuntime(),
	): Promise<void> => inputController.flushQueuedFollowUp(runtime);
	const queuedInput = createQueuedInputActions({ ...ports, flushQueuedFollowUp });

	const submit = async (behavior?: "followUp") => {
		const runtime = ports.activeRuntime();
		if (ports.startupPhase().kind !== "ready") {
			ports.toast(
				ports.startupPhase().kind === "failed"
					? "Pi is unavailable. Restart PiTTy to retry."
					: "Pi is still starting. Wait for the conversation to load.", "warning");
			return;
		}
		if (!runtime.startupResolved) {
			ports.toast("This tab is still loading its conversation.", "warning");
			return;
		}
		if (ports.dialog()) return;
		const text = ports.expandedPromptText().trim();
		if (!text) return;
		if (runtime.pendingInputEdit) {
			await queuedInput.saveEdit(text);
			return;
		}
		if (behavior && text.startsWith("/")) {
			ports.toast("Command-like input must be submitted with Enter.", "warning");
			return;
		}
		if (runtime.submittingTexts.has(text)) {
			ports.toast("This message is still awaiting Pi acknowledgment.", "info");
			return;
		}
		runtime.submittingTexts.add(text);
		runtime.submitInFlight = true;
		runtime.promptHistory.recordSubmitted(text);
		try {
			if (!behavior && await ports.handleSlashCommand(text, runtime)) {
				ports.clearRuntimeMainDraftIfMatches(runtime, text);
				return;
			}
			if (behavior) {
				if (runtime.conversation.queue) await runtime.client.followUp(text, randomUUID());
				else inputController.queueFollowUp(runtime, text);
				ports.toast("Follow-up queued. Alt+Up edits the last pending message.", "success");
			} else {
				await sendText(text, runtime);
			}
			// Queue acceptance owns the draft too, including during compaction.
			ports.clearRuntimeMainDraftIfMatches(runtime, text);
		} catch (error) {
			ports.logger.error("ui.submit_failed", error);
			runtime.conversation.system(error instanceof Error ? error.message : String(error), "error");
			runtime.onConversationChange();
		} finally {
			runtime.submittingTexts.delete(text);
			runtime.submitInFlight = runtime.submittingTexts.size > 0;
		}
	};
	const queueFollowUp = () => {
		const runtime = ports.activeRuntime();
		void submit(runtime.conversation.isStreaming || runtime.conversation.isCompacting ? "followUp" : undefined);
	};
	const editQueuedFollowUp = (messageId: string) => {
		const item = queuedInput.messages().find((entry) => entry.id === messageId && entry.source === "local");
		if (item) queuedInput.edit(item);
	};
	const restoreQueuedFollowUp = () => {
		const last = queuedInput.messages().at(-1);
		if (last) {
			queuedInput.edit(last);
			return;
		}
		const conversation = ports.activeRuntime().conversation;
		ports.toast(
			conversation.steering.length + conversation.followUp.length > 0
				? "This Pi runtime does not support editing queued messages. Upgrade PiTTy's managed runtime."
				: "No message is queued.", "warning", 5200);
	};
	const abortActiveWork = (): void => inputController.abort(ports.activeRuntime());
	return { sendText, submit, queueFollowUp, editQueuedFollowUp, restoreQueuedFollowUp, queuedInput, flushQueuedFollowUp, abortActiveWork };
}
