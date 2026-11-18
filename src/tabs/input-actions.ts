/** Prompt submission, locally queued follow-ups and RPC abort handling. */
import type { TextareaRenderable } from "@opentui/core";
import type { Accessor } from "solid-js";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import type { LocalQueuedMessage } from "../state/input-continuity.ts";
import type { StartupPhase } from "../state/startup.ts";
import type { RpcExtensionUIRequest, Toast } from "../types.ts";
import { InputController } from "./input-controller.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

export interface InputActionsPorts {
	readonly logger: DiagnosticLogger;
	readonly tabRuntimeIsActive: (id: string) => boolean;
	readonly trimMessageWindowIfFollowingLatest: () => void;
	readonly conversationTouch: (reason?: "stream" | "structure") => void;
	readonly scrollToBottom: () => void;
	readonly clearRuntimeMainDraftIfMatches: (
		runtime: ConversationTabRuntime,
		text: string,
	) => void;
	readonly toast: (
		text: string,
		tone: Toast["tone"],
		durationMs?: number,
	) => void;
	readonly activeRuntime: () => ConversationTabRuntime;
	readonly startupPhase: Accessor<StartupPhase>;
	readonly dialog: Accessor<RpcExtensionUIRequest | undefined>;
	readonly expandedPromptText: () => string;
	readonly handleSlashCommand: (
		text: string,
		runtime: ConversationTabRuntime,
	) => Promise<boolean>;
	readonly clearMainDraft: () => void;
	readonly syncMainDraft: (text: string) => void;
	readonly touch: () => void;
	readonly getPrompt: () => TextareaRenderable | undefined;
	readonly queuedFollowUps: () => LocalQueuedMessage[];
}

export interface InputActions {
	readonly sendText: (
		text: string,
		runtime?: ConversationTabRuntime,
	) => Promise<"sent" | "queued">;
	readonly submit: () => Promise<void>;
	readonly queueFollowUp: () => void;
	readonly editQueuedFollowUp: (messageId: string) => void;
	readonly restoreQueuedFollowUp: () => void;
	readonly flushQueuedFollowUp: (
		runtime?: ConversationTabRuntime,
	) => Promise<void>;
	readonly abortActiveWork: () => void;
}

export function createInputActions(ports: InputActionsPorts): InputActions {
	const inputController = new InputController<ConversationTabRuntime>(
		ports.logger,
		{
			isActive: ports.tabRuntimeIsActive,
			onChange: () => ports.touch(),
			onOptimisticSubmit: () => {
				ports.trimMessageWindowIfFollowingLatest();
				ports.conversationTouch();
				ports.scrollToBottom();
			},
			onQueuedPromptSent: (runtime, text) =>
				ports.clearRuntimeMainDraftIfMatches(runtime, text),
			notify: (message, tone) => ports.toast(message, tone),
		},
	);
	const sendText = (
		text: string,
		runtime: ConversationTabRuntime = ports.activeRuntime(),
	): Promise<"sent" | "queued"> => inputController.sendText(text, runtime);

	const submit = async () => {
		const runtime = ports.activeRuntime();
		if (ports.startupPhase().kind !== "ready") {
			ports.toast(
				ports.startupPhase().kind === "failed"
					? "Pi is unavailable. Restart PiTTy to retry."
					: "Pi is still starting. Wait for the conversation to load.",
				"warning",
			);
			return;
		}
		if (!runtime.startupResolved) {
			ports.toast("This tab is still loading its conversation.", "warning");
			return;
		}
		if (ports.dialog()) return;
		const text = ports.expandedPromptText().trim();
		if (!text) return;
		if (runtime.submitInFlight) {
			ports.toast(
				"The previous message is still awaiting Pi acknowledgment.",
				"info",
			);
			return;
		}
		runtime.submitInFlight = true;
		runtime.promptHistory.recordSubmitted(text);
		try {
			if (await ports.handleSlashCommand(text, runtime)) {
				ports.clearRuntimeMainDraftIfMatches(runtime, text);
				return;
			}
			const result = await sendText(text, runtime);
			if (result === "sent")
				ports.clearRuntimeMainDraftIfMatches(runtime, text);
		} catch (error) {
			ports.logger.error("ui.submit_failed", error);
			runtime.conversation.system(
				error instanceof Error ? error.message : String(error),
				"error",
			);
			runtime.onConversationChange();
		} finally {
			runtime.submitInFlight = false;
		}
	};

	const queueFollowUp = () => {
		if (ports.dialog()) return;
		const text = ports.expandedPromptText().trim();
		if (!text) return;
		if (!ports.activeRuntime().conversation.isStreaming) {
			void submit();
			return;
		}
		if (text.startsWith("/")) {
			ports.toast(
				"Command-like input must be submitted with Enter.",
				"warning",
			);
			return;
		}
		ports.clearMainDraft();
		const runtime = ports.activeRuntime();
		inputController.queueFollowUp(runtime, text);
		ports.logger.info("ui.followup_queued", { chars: text.length });
		ports.toast("Follow-up queued. Alt+Up restores it for editing.", "success");
	};

	const editQueuedFollowUp = (messageId: string) => {
		const runtime = ports.activeRuntime();
		const current = runtime.queuedFollowUps;
		const selected = current.find((item) => item.id === messageId);
		if (!selected) return;
		runtime.queuedFollowUps = current.filter((item) => item.id !== messageId);
		ports.touch();
		ports.syncMainDraft(selected.text);
		ports.getPrompt()?.focus();
		ports.toast("Queued follow-up restored to editor.", "info");
	};

	const restoreQueuedFollowUp = () => {
		const current = ports.queuedFollowUps();
		const last = current.at(-1);
		if (!last) {
			const sentCount =
				ports.activeRuntime().conversation.steering.length +
				ports.activeRuntime().conversation.followUp.length;
			ports.toast(
				sentCount > 0
					? "Those messages were already sent to Pi. Pi RPC cannot dequeue them; use Alt+Enter for an editable local follow-up."
					: "No editable local follow-up is queued.",
				"warning",
				5200,
			);
			return;
		}
		editQueuedFollowUp(last.id);
	};

	const flushQueuedFollowUp = (
		runtime: ConversationTabRuntime = ports.activeRuntime(),
	): Promise<void> => inputController.flushQueuedFollowUp(runtime);
	const abortActiveWork = (): void =>
		inputController.abort(ports.activeRuntime());

	return {
		sendText,
		submit,
		queueFollowUp,
		editQueuedFollowUp,
		restoreQueuedFollowUp,
		flushQueuedFollowUp,
		abortActiveWork,
	};
}
