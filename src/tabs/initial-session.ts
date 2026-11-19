/** Starts the initial Pi RPC session and reports boot state to the owning UI. */
import { parseQueueState } from "../rpc/queue-types.ts";
import type { Accessor, Setter } from "solid-js";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import type { OptionalIntegrationStatus } from "../integrations/detect.ts";
import { initialItems } from "../state/conversation.ts";
import {
	type StartupPhase,
	startupFailureReason,
	withStartupDeadline,
} from "../state/startup.ts";
import type { CommandChoice } from "../ui/command-suggestions.tsx";
import type { ModelChoice } from "../ui/model-selector.tsx";
import {
	checkForUpdates,
	defaultUpdateCheckConfig,
	isUpdateCheckDisabled,
	type UpdateEnvironment,
} from "../update/check.ts";
import { appVersion } from "../version.ts";
import type { CommandCatalogService } from "./command-catalog.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

type ToastTone = "info" | "warning" | "error" | "success";

export interface InitialSessionPorts {
	readonly runtime: ConversationTabRuntime;
	readonly logger: DiagnosticLogger;
	readonly cwd: string;
	readonly sidebar: boolean;
	readonly themeWarning: string | undefined;
	readonly integrations: OptionalIntegrationStatus;
	readonly openSessionSelectorOnStartup: boolean;
	readonly startupPhase: Accessor<StartupPhase>;
	readonly setStartupPhase: Setter<StartupPhase>;
	readonly setStatus: (value: string) => void;
	readonly setExtensionStatus: (value: string) => void;
	readonly setRpcAvailable: (available: boolean) => void;
	readonly isRuntimeActive: (id: string) => boolean;
	readonly commandCatalog: Pick<CommandCatalogService, "refresh">;
	readonly setCommandChoices: Setter<CommandChoice[]>;
	readonly resetMessageWindow: (count: number) => void;
	readonly rememberThinkingLevel: (runtime: ConversationTabRuntime) => void;
	readonly fetchAvailableModels: () => Promise<ModelChoice[]>;
	readonly touch: () => void;
	readonly conversationTouch: () => void;
	readonly scrollToLatest: () => void;
	readonly openSessionSelector: () => void;
	readonly focusPrompt: () => void;
	readonly discoverCurrentSessions: () => Promise<void>;
	readonly refreshState: (runtime: ConversationTabRuntime) => Promise<boolean>;
	readonly toast: (text: string, tone: ToastTone, durationMs?: number) => void;
	readonly sessionLoadTimeoutMs: number;
	readonly startupDeadlineMs: number;
	readonly updateEnvironment: UpdateEnvironment;
}

export function startInitialSession(ports: InitialSessionPorts): Promise<void> {
	const { logger, runtime } = ports;
	logger.info("ui.mount", { cwd: ports.cwd, sidebar: ports.sidebar });
	const themeWarning = ports.themeWarning;
	if (themeWarning) {
		queueMicrotask(() => ports.toast(themeWarning, "warning", 10_000));
	}
	if (!isUpdateCheckDisabled(ports.updateEnvironment)) {
		void checkForUpdates(
			defaultUpdateCheckConfig(
				appVersion,
				ports.updateEnvironment,
				logger,
				(version) => {
					ports.toast(
						`A newer PiTTy release is available (${version}). Run \`pitty upgrade\`.`,
						"info",
						7000,
					);
				},
			),
		);
	}
	const missingIntegrations = [
		!ports.integrations.subagents.installed
			? "a supported subagent runtime (@mistrjirka/pi-subagent or pi-subagents)"
			: undefined,
		!ports.integrations.todos.installed
			? "@juicesharp/rpiv-todo (Todo panel)"
			: undefined,
	].filter((value): value is string => value !== undefined);
	if (missingIntegrations.length) {
		queueMicrotask(() =>
			ports.toast(
				`Optional Pi packages not detected: ${missingIntegrations.join(", ")}. PiTTy will continue without them.`,
				"info",
				7000,
			),
		);
	}

	let startupFailure: Error | undefined;
	runtime.client.on("protocol-error", (error: Error) => {
		if (ports.startupPhase().kind !== "ready") {
			startupFailure = error;
			ports.setStartupPhase({ kind: "failed", reason: "protocol" });
		}
		logger.error("ui.protocol_error", error);
	});
	runtime.client.on("stderr", (chunk: string) => {
		if (!ports.isRuntimeActive(runtime.id)) return;
		const line = chunk.trim().split("\n").at(-1);
		if (!line) return;
		if (ports.startupPhase().kind === "ready") ports.setExtensionStatus(line);
		else ports.setStatus("loading extensions/session…");
	});
	runtime.client.on("exit", (error: Error) => {
		if (ports.startupPhase().kind !== "ready") {
			startupFailure = error;
			ports.setStartupPhase({ kind: "failed", reason: "exit" });
		}
		logger.error("ui.pi_exit", error);
		if (ports.isRuntimeActive(runtime.id)) ports.setRpcAvailable(false);
	});

	return (async () => {
		try {
			await runtime.client.start();
			logger.info("ui.pi_started");
			const deadlineAt = Date.now() + ports.startupDeadlineMs;
			const remainingMs = () => Math.max(1, deadlineAt - Date.now());
			const state = await withStartupDeadline(
				runtime.client.getState(ports.sessionLoadTimeoutMs),
				remainingMs(),
			);
			if (startupFailure) throw startupFailure;
			ports.setStartupPhase({ kind: "history" });
			ports.setStatus("loading conversation…");
			const [messages, remoteCommands] = await withStartupDeadline(
				Promise.all([
					runtime.client.getMessages(ports.sessionLoadTimeoutMs),
					ports.commandCatalog.refresh(runtime.client, { force: true }),
				]),
				remainingMs(),
			);
			if (startupFailure) throw startupFailure;
			ports.setCommandChoices(remoteCommands);
			const historyItems = initialItems(messages);
			runtime.conversation.replaceItems(historyItems);
			ports.resetMessageWindow(historyItems.length);
			logger.info("ui.history_loaded", {
				rpcMessages: messages.length,
				renderedItems: historyItems.length,
				userItems: historyItems.filter((item) => item.kind === "user").length,
				assistantItems: historyItems.filter((item) => item.kind === "assistant")
					.length,
				toolItems: historyItems.filter((item) => item.kind === "tool").length,
				textChars: historyItems.reduce(
					(sum, item) =>
						sum +
						("text" in item
							? item.text.length
							: item.kind === "tool"
								? item.output.length
								: 0),
					0,
				),
			});
			runtime.sessionState = state;
			const queue = parseQueueState(state.queue);
			if (queue) runtime.conversation.applyQueueState(queue);
			runtime.conversation.isCompacting = state.isCompacting;
			ports.rememberThinkingLevel(runtime);
			runtime.startupResolved = true;
			void ports.fetchAvailableModels().catch(() => undefined);
			runtime.conversation.isStreaming = state.isStreaming;
			ports.setStartupPhase({ kind: "ready" });
			ports.setStatus(state.isStreaming ? "working" : "ready");
			ports.touch();
			ports.conversationTouch();
			queueMicrotask(ports.scrollToLatest);
			if (ports.openSessionSelectorOnStartup) ports.openSessionSelector();
			else ports.focusPrompt();
			if (!ports.openSessionSelectorOnStartup)
				void ports.discoverCurrentSessions();
			if (ports.isRuntimeActive(runtime.id)) await ports.refreshState(runtime);
		} catch (error) {
			ports.setRpcAvailable(false);
			const previousPhase = ports.startupPhase();
			const reason = startupFailureReason(error, previousPhase);
			ports.setStartupPhase({ kind: "failed", reason });
			const message = error instanceof Error ? error.message : String(error);
			logger.error("ui.start_failed", error);
			if (previousPhase.kind !== "failed")
				runtime.conversation.system(message, "error");
			ports.touch();
			ports.conversationTouch();
			ports.setStatus(
				reason === "timeout" ? "startup timed out" : "failed to start Pi",
			);
		}
	})();
}
