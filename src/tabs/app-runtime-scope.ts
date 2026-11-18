/** Own Pi tabs, session lifecycle, account usage, and extension event routing. */
import type {
	CliRenderer,
	ScrollBoxRenderable,
	TextareaRenderable,
} from "@opentui/core";
import type { Accessor } from "solid-js";
import type { AppOptions } from "../app.tsx";
import type { PiRpcClient } from "../rpc/pi-rpc-client.ts";
import type { AppSignals } from "../state/app-signals.ts";
import type { BackgroundTaskSelection } from "../state/background-tasks.ts";
import type { ConversationModel } from "../state/conversation.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { Toast } from "../types.ts";
import type { CommandChoice } from "../ui/command-suggestions.tsx";
import type { CacheWarning } from "./cache-miss-watch.ts";
import { createClaudeAccountActions } from "./claude-account-actions.ts";
import { createFooterModel } from "./footer-model.ts";
import type { ConversationTabRuntime } from "./runtime.ts";
import { createTabRuntime } from "./runtime.ts";
import { SessionController } from "./session-controller.ts";
import { createTabLifecycle } from "./tab-lifecycle.ts";

type SetUpdater<T> = T | ((current: T) => T);

export interface AppRuntimeScopePorts {
	props: AppOptions;
	signals: AppSignals;
	renderer: CliRenderer;
	dimensions: Accessor<{ width: number; height: number }>;
	client: PiRpcClient;
	conversation: ConversationModel;
	claudeLaunchEnv: NodeJS.ProcessEnv | undefined;
	status: Accessor<string>;
	setStatus: (value: string) => void;
	toast: (text: string, tone: Toast["tone"], durationMs?: number) => void;
	streaming: () => boolean;
	availableSubagentTargets: () => SubagentTarget[];
	touch: () => void;
	getPrompt: () => TextareaRenderable | undefined;
	getSubagentScroll: () => ScrollBoxRenderable | undefined;
	backgroundSelection: Accessor<BackgroundTaskSelection | undefined>;
	closeBackgroundTask: () => void;
	dropRefreshCoordinator: (id: string) => void;
	resetMessageWindow: (count: number) => void;
	selectedSubagentTarget: () => SubagentTarget | undefined;
	scrollToBottom: () => void;
	syncMainDraft: (text: string) => void;
	refreshState: (runtime: ConversationTabRuntime) => Promise<boolean>;
	conversationTouch: (reason?: "stream" | "structure") => void;
	flushQueuedFollowUp: (runtime: ConversationTabRuntime) => Promise<void>;
	isExtensionUiRequest: (
		value: unknown,
	) => value is import("../types.ts").RpcExtensionUIRequest;
	setDraftSwitchGuard: (value: boolean) => void;
}

export interface AppRuntimeScope {
	bootRuntime: ConversationTabRuntime;
	activeRuntime: () => ConversationTabRuntime;
	refreshCommandChoices: (
		runtime: ConversationTabRuntime,
		force?: boolean,
		now?: number,
	) => Promise<CommandChoice[]>;
	claudeEffectiveSlot: () => number | undefined;
	applyCswapUsage: (
		snapshot: import("../integrations/claude-swap.ts").CswapSnapshot,
	) => void;
	chooseClaudeAccount: (
		choice: import("../integrations/claude-swap.ts").ClaudeAccountChoice,
	) => void;
	selectedTargetKey: () => string | undefined;
	inspectSubagent: () => boolean;
	forkingConversation: () => boolean;
	setExtensionStatus: (value: string) => void;
	footerStatusText: () => string;
	footerHintText: () => string;
	footerUsageSegments: () => import("../ui/usage-footer.ts").UsageFooterSegment[];
	setSelectedTargetKey: (key: string | undefined) => void;
	setInspectSubagent: (value: boolean) => void;
	routeRuntimeEvent: (
		event: import("../types.ts").PiEvent,
		runtime: ConversationTabRuntime,
	) => void;
	handleExtensionRequest: (
		envelope: import("./extension-router.ts").ExtensionRequestEnvelope,
	) => void;
	activateTab: (id: string) => void;
	closeTab: (id: string) => void;
	createTab: (sessionFile?: string) => string | undefined;
	forkAt: (
		entryId: string,
		item?: import("../types.ts").ConversationItem,
	) => Promise<void>;
	openForkPicker: () => Promise<void>;
	tabRuntimeIsActive: (id: string) => boolean;
	sessionController: SessionController;
	loadRuntimeHistory: (runtime: ConversationTabRuntime) => Promise<void>;
	notifyCacheWarning: (
		warning: CacheWarning,
		runtime: ConversationTabRuntime,
	) => void;
	setExpandedToolIds: (update: SetUpdater<Set<string>>) => void;
	setExpandedDiffIds: (update: SetUpdater<Set<string>>) => void;
	setThinkingExpansionOverrides: (
		update: SetUpdater<Map<string, boolean>>,
	) => void;
}

export function createAppRuntimeScope(
	ports: AppRuntimeScopePorts,
): AppRuntimeScope {
	const { renderer, dimensions, client, conversation, claudeLaunchEnv } = ports;
	const SESSION_LOAD_REQUEST_TIMEOUT_MS = 120_000;
	const {
		activeTabId: [activeTabId, setActiveTabId],
		runtimeMap: [runtimeMap, setRuntimeMap],
		tabState: [tabState, setTabState],
		tabManager,
		commandCatalog,
		extensionRouter,
		provisionalRuntimes,
		commandChoices: [, setCommandChoices],
		compactionRevision: [, setCompactionRevision],
		dialogOwnerRuntimeId: [dialogOwnerRuntimeId, setDialogOwnerRuntimeId],
		dialog: [, setDialog],
		modelSelectorOpen: [, setModelSelectorOpen],
		promptMapOpen: [, setPromptMapOpen],
		forkPickerOptionsSignal: [, setForkPickerOptions],
		forkPickerOpen: [, setForkPickerOpen],
		revision: [revision],
		cswapSnapshot: [cswapSnapshot],
		claudeAccountChoice: [claudeAccountChoice, setClaudeAccountChoice],
		claudeUsage: [claudeUsage, setClaudeUsage],
		claudeHint: [claudeHint, setClaudeHint],
		codexUsage: [codexUsage],
		codexUsageStats: [codexUsageStats],
		opencodeUsage: [opencodeUsage],
		opencodeUsageStats: [opencodeUsageStats],
		settingsRoute: [, setSettingsRoute],
	} = ports.signals;
	const backgroundSelection = ports.backgroundSelection;
	const clockNow = ports.signals.clockNow[0];
	const status = ports.status;
	const setStatus = ports.setStatus;
	const toast = ports.toast;
	const streaming = ports.streaming;
	const availableSubagentTargets = ports.availableSubagentTargets;
	const touch = ports.touch;
	const resetMessageWindow = ports.resetMessageWindow;
	const scrollToBottom = ports.scrollToBottom;
	const closeBackgroundTask = ports.closeBackgroundTask;
	const dropRefreshCoordinator = ports.dropRefreshCoordinator;
	const selectedSubagentTarget = ports.selectedSubagentTarget;
	const syncMainDraft = ports.syncMainDraft;
	const refreshState = ports.refreshState;
	const conversationTouch = ports.conversationTouch;
	const flushQueuedFollowUp = ports.flushQueuedFollowUp;
	const isExtensionUiRequest = ports.isExtensionUiRequest;
	const activeRuntime = () => runtimeMap().get(activeTabId()) ?? bootRuntime;
	const refreshCommandChoices = async (
		runtime: ConversationTabRuntime,
		force = false,
		now = Date.now(),
	): Promise<CommandChoice[]> => {
		const choices = await commandCatalog.refresh(runtime.client, {
			force,
			now,
		});
		// In-flight tab switches must not replace the active tab's command list.
		if (activeRuntime().client === runtime.client) setCommandChoices(choices);
		return choices;
	};
	const { claudeEffectiveSlot, applyCswapUsage, chooseClaudeAccount } =
		createClaudeAccountActions({
			activeTabId,
			activeRuntime,
			cswapSnapshot,
			claudeAccountChoice,
			setClaudeAccountChoice,
			setClaudeUsage,
			setClaudeHint,
			setSettingsRoute,
			toast: (text, tone, durationMs) => toast(text, tone, durationMs),
		});
	const selectedTargetKey = () => {
		revision();
		return activeRuntime().selectedTargetKey;
	};
	const inspectSubagent = () => {
		revision();
		return activeRuntime().inspectSubagent;
	};
	const forkingConversation = () => {
		revision();
		return activeRuntime().forkInProgress;
	};
	const {
		setExtensionStatus,
		footerStatusText,
		footerHintText,
		footerUsageSegments,
	} = createFooterModel({
		forkingConversation,
		status: () => status(),
		setStatus: (value) => setStatus(value),
		streaming: () => streaming(),
		activeRuntime,
		inspectSubagent,
		availableSubagentTargets: () => availableSubagentTargets(),
		dimensions,
		claudeUsage,
		cswapSnapshot,
		claudeEffectiveSlot,
		claudeHint,
		codexUsage,
		codexUsageStats,
		opencodeUsage,
		opencodeUsageStats,
		clockNow,
	});
	const setSelectedTargetKey = (key: string | undefined) => {
		const runtime = activeRuntime();
		if (runtime.selectedTargetKey === key) return;
		if (key === undefined) delete runtime.selectedTargetKey;
		else runtime.selectedTargetKey = key;
		touch();
	};
	const setInspectSubagent = (value: boolean) => {
		const runtime = activeRuntime();
		if (runtime.inspectSubagent === value) return;
		runtime.inspectSubagent = value;
		touch();
	};
	const {
		routeRuntimeEvent,
		handleExtensionRequest,
		activateTab,
		closeTab,
		createTab,
		forkAt,
		openForkPicker,
	} = createTabLifecycle({
		cwd: ports.props.cwd,
		piArgs: ports.props.piArgs,
		piExecutable: ports.props.piExecutable,
		claudeLaunchEnv,
		logger: ports.props.logger,
		renderer,
		tabManager,
		tabState,
		setTabState,
		extensionRouter,
		runtimeMap,
		setRuntimeMap,
		activeTabId,
		setActiveTabId,
		activeRuntime,
		isRuntimeActive: (id) => activeTabId() === id,
		setCommandChoices,
		commandCatalog,
		setCompactionRevision,
		setExtensionStatus,
		setStatus: (value) => setStatus(value),
		dialogOwnerRuntimeId,
		setDialogOwnerRuntimeId,
		setDialog,
		setModelSelectorOpen,
		setPromptMapOpen,
		toast: (text, tone, durationMs) => toast(text, tone, durationMs),
		touch: () => touch(),
		backgroundSelection: () => backgroundSelection(),
		closeBackgroundTask: () => closeBackgroundTask(),
		dropRefreshCoordinator: (id) => dropRefreshCoordinator(id),
		refreshCommandChoices,
		resetMessageWindow: (count) => resetMessageWindow(count),
		selectedSubagentTarget: () => selectedSubagentTarget(),
		subagentScroll: () => ports.getSubagentScroll(),
		scrollToBottom: () => scrollToBottom(),
		prompt: () => ports.getPrompt(),
		setDraftSwitchGuard: (value) => {
			ports.setDraftSwitchGuard(value);
		},
		syncMainDraft: (text) => syncMainDraft(text),
		loadRuntimeHistory: (runtime) => loadRuntimeHistory(runtime),
		refreshState: (runtime) => refreshState(runtime),
		conversationTouch: (reason) => conversationTouch(reason),
		notifyCacheWarning: (warning, runtime) =>
			notifyCacheWarning(warning, runtime),
		flushQueuedFollowUp: (runtime) => flushQueuedFollowUp(runtime),
		isExtensionUiRequest,
		provisionalRuntimes,
		setForkPickerOptions,
		setForkPickerOpen,
	});
	const tabRuntimeIsActive = (id: string) => activeTabId() === id;
	const sessionController = new SessionController(ports.props.logger);
	const loadRuntimeHistory = async (runtime: ConversationTabRuntime) => {
		const loaded = await sessionController.loadHistory(
			runtime,
			SESSION_LOAD_REQUEST_TIMEOUT_MS,
		);
		if (loaded && tabRuntimeIsActive(runtime.id)) {
			resetMessageWindow(runtime.conversation.items.length);
			conversationTouch();
		}
	};
	const notifyCacheWarning = (
		warning: import("./cache-miss-watch.ts").CacheWarning,
		runtime: ConversationTabRuntime,
	) => {
		ports.props.logger.warn("cache.large_rewrite", {
			runtimeId: runtime.id,
			...warning,
		});
		if (runtime.id === activeTabId())
			toast(
				`Possible Claude cache rebuild: ${Math.round(warning.currentWrite / 1000)}k tokens rewritten (previous cache hit: ${Math.round(warning.previousRead / 1000)}k)`,
				"warning",
				8500,
			);
	};
	const bootRuntime = createTabRuntime({
		id: "main",
		cwd: ports.props.cwd,
		client,
		conversation,
		onCacheWarning: notifyCacheWarning,
		onEvent: routeRuntimeEvent,
		onConversationChange: (tabRuntime, reason) => {
			if (tabRuntime.id === activeTabId()) conversationTouch(reason);
		},
	});
	extensionRouter.setActive("main");
	setRuntimeMap(new Map([["main", bootRuntime]]));

	const setExpandedToolIds = (update: SetUpdater<Set<string>>) => {
		const current = activeRuntime().expandedToolIds;
		activeRuntime().expandedToolIds =
			typeof update === "function" ? update(current) : update;
		touch();
	};
	const setExpandedDiffIds = (update: SetUpdater<Set<string>>) => {
		const current = activeRuntime().expandedDiffIds;
		activeRuntime().expandedDiffIds =
			typeof update === "function" ? update(current) : update;
		touch();
	};
	const setThinkingExpansionOverrides = (
		update: SetUpdater<Map<string, boolean>>,
	) => {
		const current = activeRuntime().thinkingExpansionOverrides;
		activeRuntime().thinkingExpansionOverrides =
			typeof update === "function" ? update(current) : update;
		touch();
	};
	return {
		activeRuntime,
		refreshCommandChoices,
		claudeEffectiveSlot,
		applyCswapUsage,
		chooseClaudeAccount,
		selectedTargetKey,
		inspectSubagent,
		forkingConversation,
		setExtensionStatus,
		footerStatusText,
		footerHintText,
		footerUsageSegments,
		setSelectedTargetKey,
		setInspectSubagent,
		routeRuntimeEvent,
		handleExtensionRequest,
		activateTab,
		closeTab,
		createTab,
		forkAt,
		openForkPicker,
		tabRuntimeIsActive,
		sessionController,
		loadRuntimeHistory,
		notifyCacheWarning,
		bootRuntime,
		setExpandedToolIds,
		setExpandedDiffIds,
		setThinkingExpansionOverrides,
	};
}
