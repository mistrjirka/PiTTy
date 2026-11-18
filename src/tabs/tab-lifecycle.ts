/** Tab activation, fork creation, extension events and lifecycle ownership. */
import type {
	CliRenderer,
	ScrollBoxRenderable,
	TextareaRenderable,
} from "@opentui/core";
import type { Accessor, Setter } from "solid-js";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import type { BackgroundTaskSelection } from "../state/background-tasks.ts";
import { sessionDrafts } from "../state/input-continuity.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type {
	ConversationItem,
	PiEvent,
	RpcExtensionUIRequest,
	Toast,
} from "../types.ts";
import type { CommandChoice } from "../ui/command-suggestions.tsx";
import { inspectedTargetScrollY } from "../ui/subagent-inspector.tsx";
import type { CacheWarning } from "./cache-miss-watch.ts";
import type { CommandCatalogService } from "./command-catalog.ts";
import { CompactionController } from "./compaction-controller.ts";
import type { ForkPickerOption } from "./entry-index.ts";
import type {
	ExtensionRequestEnvelope,
	ExtensionRequestRouter,
} from "./extension-router.ts";
import { ExtensionStatusController } from "./extension-status-controller.ts";
import type { TabManager, TabManagerState } from "./manager.ts";
import {
	blankTabPiArgs,
	type ConversationTabRuntime,
	createTabRuntime,
	resolveTabDraftSwitch,
	startTabRuntime,
} from "./runtime.ts";
import { createTabForkActions } from "./tab-fork-actions.ts";

export interface TabLifecyclePorts {
	readonly cwd: string;
	readonly piArgs: string[];
	readonly piExecutable: string | undefined;
	readonly claudeLaunchEnv: NodeJS.ProcessEnv | undefined;
	readonly logger: DiagnosticLogger;
	readonly renderer: Pick<CliRenderer, "setTerminalTitle">;
	readonly tabManager: TabManager;
	readonly tabState: Accessor<TabManagerState>;
	readonly setTabState: Setter<TabManagerState>;
	readonly extensionRouter: ExtensionRequestRouter;
	readonly runtimeMap: Accessor<Map<string, ConversationTabRuntime>>;
	readonly setRuntimeMap: Setter<Map<string, ConversationTabRuntime>>;
	readonly activeTabId: Accessor<string>;
	readonly setActiveTabId: Setter<string>;
	readonly activeRuntime: () => ConversationTabRuntime;
	readonly isRuntimeActive: (id: string) => boolean;
	readonly setCommandChoices: Setter<CommandChoice[]>;
	readonly commandCatalog: CommandCatalogService;
	readonly setCompactionRevision: Setter<number>;
	readonly setExtensionStatus: (value: string) => void;
	readonly setStatus: (value: string) => void;
	readonly dialogOwnerRuntimeId: Accessor<string | undefined>;
	readonly setDialogOwnerRuntimeId: Setter<string | undefined>;
	readonly setDialog: Setter<RpcExtensionUIRequest | undefined>;
	readonly setModelSelectorOpen: Setter<boolean>;
	readonly setPromptMapOpen: Setter<boolean>;
	readonly toast: (
		text: string,
		tone: Toast["tone"],
		durationMs?: number,
	) => void;
	readonly touch: () => void;
	readonly backgroundSelection: Accessor<BackgroundTaskSelection | undefined>;
	readonly closeBackgroundTask: () => void;
	readonly dropRefreshCoordinator: (id: string) => void;
	readonly refreshCommandChoices: (
		runtime: ConversationTabRuntime,
		force?: boolean,
	) => Promise<CommandChoice[]>;
	readonly resetMessageWindow: (totalItems: number) => void;
	readonly selectedSubagentTarget: () => SubagentTarget | undefined;
	readonly subagentScroll: () => ScrollBoxRenderable | undefined;
	readonly scrollToBottom: () => void;
	readonly prompt: () => TextareaRenderable | undefined;
	readonly setDraftSwitchGuard: (value: boolean) => void;
	readonly syncMainDraft: (text: string) => void;
	readonly loadRuntimeHistory: (
		runtime: ConversationTabRuntime,
	) => Promise<void>;
	readonly refreshState: (runtime: ConversationTabRuntime) => Promise<boolean>;
	readonly conversationTouch: (reason?: "stream" | "structure") => void;
	readonly notifyCacheWarning: (
		warning: CacheWarning,
		runtime: ConversationTabRuntime,
	) => void;
	readonly flushQueuedFollowUp: (
		runtime: ConversationTabRuntime,
	) => Promise<void>;
	readonly isExtensionUiRequest: (
		event: unknown,
	) => event is RpcExtensionUIRequest;
	readonly provisionalRuntimes: Set<ConversationTabRuntime>;
	readonly setForkPickerOptions: Setter<ForkPickerOption[]>;
	readonly setForkPickerOpen: Setter<boolean>;
}

export interface TabLifecycleActions {
	readonly routeRuntimeEvent: (
		event: PiEvent,
		runtime: ConversationTabRuntime,
	) => void;
	readonly handleExtensionRequest: (envelope: ExtensionRequestEnvelope) => void;
	readonly activateTab: (id: string) => void;
	readonly closeTab: (id: string) => void;
	readonly createTab: (sessionFile?: string) => string | undefined;
	readonly forkAt: (
		entryId: string,
		userItem?: ConversationItem,
	) => Promise<void>;
	readonly openForkPicker: () => Promise<void>;
}

export function createTabLifecycle(
	ports: TabLifecyclePorts,
): TabLifecycleActions {
	let tabCounter = 0;
	const refreshTabs = () => ports.setTabState(ports.tabManager.snapshot);
	const finishExtensionRequest = (envelope: ExtensionRequestEnvelope): void => {
		const next = ports.extensionRouter.complete(
			envelope.runtimeId,
			envelope.request.id,
		);
		if (next && ports.isRuntimeActive(envelope.runtimeId))
			handleExtensionRequest(next);
	};

	const handleExtensionRequest = (envelope: ExtensionRequestEnvelope): void => {
		const runtime = ports.runtimeMap().get(envelope.runtimeId);
		if (!runtime || ports.activeTabId() !== envelope.runtimeId) return;
		const event = envelope.request;
		if (event.method === "notify") {
			ports.toast(
				event.message,
				event.notifyType === "error"
					? "error"
					: event.notifyType === "warning"
						? "warning"
						: "info",
			);
			finishExtensionRequest(envelope);
			return;
		}
		if (event.method === "setStatus") {
			if (event.statusText) ports.setExtensionStatus(event.statusText);
			finishExtensionRequest(envelope);
			return;
		}
		if (event.method === "setTitle") {
			ports.renderer.setTerminalTitle(event.title);
			finishExtensionRequest(envelope);
			return;
		}
		if (event.method === "set_editor_text") {
			ports.syncMainDraft(event.text);
			finishExtensionRequest(envelope);
			return;
		}
		if (event.method === "setWidget") {
			finishExtensionRequest(envelope);
			return;
		}
		ports.setModelSelectorOpen(false);
		ports.setPromptMapOpen(false);
		ports.setDialogOwnerRuntimeId(envelope.runtimeId);
		ports.setDialog(event);
	};
	const notifyCompactionChange = (tabRuntime: ConversationTabRuntime): void => {
		if (tabRuntime.id === ports.activeTabId())
			ports.setCompactionRevision((value) => value + 1);
		tabRuntime.onConversationChange();
	};
	const compactionController = new CompactionController(
		notifyCompactionChange,
		ports.logger,
	);
	const extensionStatusController = new ExtensionStatusController((runtime) => {
		if (runtime.id === ports.activeTabId()) ports.touch();
	});
	const routeRuntimeEvent = (
		event: PiEvent,
		tabRuntime: ConversationTabRuntime,
	): void => {
		compactionController.handleStart(event, tabRuntime);
		if (ports.isExtensionUiRequest(event)) {
			if (compactionController.handleStatus(event, tabRuntime)) return;
			if (extensionStatusController.handle(event, tabRuntime)) return;
			const envelope = ports.extensionRouter.enqueue(tabRuntime.id, event);
			if (tabRuntime.id !== ports.activeTabId()) {
				ports.tabManager.incrementBadge(tabRuntime.id, "extension");
				refreshTabs();
			} else if (envelope) handleExtensionRequest(envelope);
			return;
		}
		compactionController.handleEnd(event, tabRuntime);
		if (
			tabRuntime.id === ports.activeTabId() &&
			(event.type === "message_end" || event.type === "agent_settled")
		)
			ports.touch();
		if (tabRuntime.id === ports.activeTabId() && event.type === "agent_start")
			ports.setStatus("working");
		if (tabRuntime.id === ports.activeTabId() && event.type === "agent_settled")
			ports.setStatus("ready");
		if (event.type === "agent_settled" || event.type === "compaction_end")
			void ports.flushQueuedFollowUp(tabRuntime);
	};

	const activateTab = (id: string) => {
		const targetRuntime = ports.runtimeMap().get(id);
		if (!targetRuntime) return;
		const targetText = sessionDrafts(
			targetRuntime.drafts,
			targetRuntime.sessionState?.sessionId ?? ports.cwd,
		).main;
		if (ports.backgroundSelection()?.runtimeId !== id)
			ports.closeBackgroundTask();
		if (ports.dialogOwnerRuntimeId() && ports.dialogOwnerRuntimeId() !== id) {
			ports.setDialog(undefined);
			ports.setDialogOwnerRuntimeId(undefined);
		}
		ports.tabManager.activate(id);
		ports.setActiveTabId(id);
		ports.setCommandChoices(
			ports.commandCatalog.snapshot(targetRuntime.client),
		);
		if (targetRuntime.startupResolved)
			void ports.refreshCommandChoices(targetRuntime);
		ports.tabManager.clearBadges(id);
		refreshTabs();
		const nextExtension = ports.extensionRouter.setActive(id);
		if (nextExtension) handleExtensionRequest(nextExtension);
		ports.resetMessageWindow(targetRuntime.conversation.items.length);
		queueMicrotask(() =>
			queueMicrotask(() => {
				if (targetRuntime.inspectSubagent)
					ports
						.subagentScroll()
						?.scrollTo(inspectedTargetScrollY(ports.selectedSubagentTarget()));
				else ports.scrollToBottom();
			}),
		);
		ports.setDraftSwitchGuard(true);
		const draft = resolveTabDraftSwitch(
			ports.prompt()?.plainText ?? "",
			targetText,
		);
		const editor = ports.prompt();
		if (editor) {
			editor.setText(draft.editorText);
			editor.cursorOffset = draft.editorText.length;
		}
		ports.syncMainDraft(draft.editorText);
		queueMicrotask(() => {
			ports.setDraftSwitchGuard(false);
		});
		if (targetRuntime.startupResolved) {
			if (targetRuntime.conversation.items.length === 0)
				void ports.loadRuntimeHistory(targetRuntime);
			void ports.refreshState(targetRuntime).then(() => {
				void ports.flushQueuedFollowUp(targetRuntime);
			});
		}
	};
	const closeTab = (id: string) => {
		const runtime = ports.runtimeMap().get(id);
		if (!runtime || !ports.tabManager.canClose(id)) return;
		const wasActive = ports.activeTabId() === id;
		if (ports.dialogOwnerRuntimeId() === id) {
			ports.setDialog(undefined);
			ports.setDialogOwnerRuntimeId(undefined);
		}
		ports.extensionRouter.remove(id);
		ports.dropRefreshCoordinator(id);
		runtime.messageUpdates.dispose();
		runtime.coalescer.flush();
		void runtime.client.stop();
		ports.setRuntimeMap((current) => {
			const next = new Map(current);
			next.delete(id);
			return next;
		});
		ports.tabManager.close(id);
		if (wasActive) activateTab(ports.tabManager.snapshot.activeId);
		else refreshTabs();
	};
	const createTab = (sessionFile?: string): string | undefined => {
		const id = `tab-${++tabCounter}`;
		if (!ports.tabManager.create({ id, badges: 0 })) {
			ports.toast("Maximum of 8 conversation tabs.", "warning");
			return undefined;
		}
		const runtime = createTabRuntime({
			id,
			cwd: ports.cwd,
			args: sessionFile ? ports.piArgs : blankTabPiArgs(ports.piArgs),
			...(ports.piExecutable ? { executable: ports.piExecutable } : {}),
			...(sessionFile ? { sessionFile } : {}),
			logger: ports.logger,
			...(ports.claudeLaunchEnv ? { env: ports.claudeLaunchEnv } : {}),
			onCacheWarning: ports.notifyCacheWarning,
			onEvent: routeRuntimeEvent,
			onConversationChange: (tabRuntime, reason) => {
				if (tabRuntime.id === ports.activeTabId())
					ports.conversationTouch(reason);
			},
		});
		ports.setRuntimeMap((current) => new Map(current).set(id, runtime));
		activateTab(id);
		void startTabRuntime(runtime)
			.then(async () => {
				runtime.startupResolved = false;
				await ports.loadRuntimeHistory(runtime);
				runtime.startupResolved = true;
				void ports.refreshCommandChoices(runtime);
				if (ports.isRuntimeActive(id)) {
					ports.touch();
					await ports.refreshState(runtime);
				}
			})
			.catch((error) =>
				ports.toast(
					error instanceof Error ? error.message : String(error),
					"error",
					5000,
				),
			);
		return id;
	};
	const { forkAt, openForkPicker } = createTabForkActions(ports, {
		nextForkId: () => "fork-" + String(++tabCounter),
		activateTab,
		refreshTabs,
		routeRuntimeEvent,
	});

	return {
		routeRuntimeEvent,
		handleExtensionRequest,
		activateTab,
		closeTab,
		createTab,
		forkAt,
		openForkPicker,
	};
}
