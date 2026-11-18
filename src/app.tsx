import { createConversationSelectors } from "./tabs/conversation-selectors.ts";
import { createModalNavigation } from "./tabs/modal-navigation.ts";
import { createAppSignals } from "./state/app-signals.ts";
import { createInspectorProjection } from "./subagents/inspector-projection.ts";
import { createFooterModel } from "./tabs/footer-model.ts";
import { createClaudeAccountActions } from "./tabs/claude-account-actions.ts";
import { AppDialogs } from "./ui/app-dialogs.tsx";
import { AppMainContents } from "./ui/app-main-contents.tsx";
import { createRuntimeRefresh } from "./tabs/runtime-refresh.ts";
import { createInputActions } from "./tabs/input-actions.ts";
import { createMessageRenderer } from "./ui/message-renderer.tsx";
import {
	createModelCatalogActions,
	cachedAvailableModels,
} from "./tabs/model-catalog-actions.ts";
import { createBackgroundActions } from "./tabs/background-actions.ts";
import { createPromptDraftActions } from "./tabs/prompt-draft-actions.ts";
import { createTabLifecycle } from "./tabs/tab-lifecycle.ts";

import {
	createSettingsMutations,
	type ThemeViewportSnapshot,
} from "./tabs/settings-mutations.ts";
import { createExtensionModelActions } from "./tabs/extension-model-actions.ts";
import { createSessionPickerActions } from "./tabs/session-picker-actions.ts";
import { createMcpActions } from "./tabs/mcp-controller.ts";
import { startInitialSession } from "./tabs/initial-session.ts";
import { startUiMonitoring } from "./tabs/ui-monitoring.ts";
import { startUsagePolling } from "./tabs/usage-polling.ts";
export { streamingCtrlCDecision } from "./ui/app-navigation.ts";
import { registerAppKeyboard } from "./tabs/app-keyboard.ts";

import { buildSettingsDescriptors } from "./ui/settings-descriptors.ts";

export {
	settingsBackRoute,
	subagentNavigationAction,
	subagentInspectDecision,
	nextDetailToggle,
	isUnmodifiedEnterKey,
} from "./ui/app-navigation.ts";
export type {
	SettingsRoute,
	DetailToggleState,
	SubagentInspectDecision,
	SubagentNavigationAction,
	SubagentKeyModifiers,
} from "./ui/app-navigation.ts";

export {
	footerHintTiers,
	globalFooterHint,
	selectFooterHint,
} from "./ui/footer-hints.ts";

import { appendNotificationHistory } from "./state/notification-history.ts";
export { appendNotificationHistory } from "./state/notification-history.ts";
import { attachTranscriptSelectionCache } from "./ui/transcript-selection-cache.ts";
export { attachTranscriptSelectionCache } from "./ui/transcript-selection-cache.ts";
export type { TranscriptSelectionCache } from "./ui/transcript-selection-cache.ts";

import {
	type MouseEvent,
	type ScrollBoxRenderable,
	type TextareaRenderable,
	type Renderable,
} from "@opentui/core";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js";
import {
	createDynamic,
	useRenderer,
	useTerminalDimensions,
} from "@opentui/solid";
import type {
	RpcExtensionUIRequest,
	SubagentRun,
	Toast,
	NotificationRecord,
} from "./types.ts";
import type { DiagnosticLogger } from "./diagnostics/logger.ts";

import { PiRpcClient } from "./rpc/pi-rpc-client.ts";
import { ConversationModel } from "./state/conversation.ts";

import {
	prunePromptPasteBlocks,
	stripCollapsedPromptPasteFragments,
} from "./state/paste-blocks.ts";
import {
	clearTargetDraft,
	reconcilePendingSteers,
} from "./state/input-continuity.ts";
import { type StartupPhase } from "./state/startup.ts";

import { createSubagentControlActions } from "./subagents/action-controller.ts";

import { SessionController } from "./tabs/session-controller.ts";

import {
	SlashCommandController,
	isThinkingLevel,
} from "./tabs/slash-commands.ts";

import {
	createTabRuntime,
	type ConversationTabRuntime,
} from "./tabs/runtime.ts";
import { readModelPerformanceHistory } from "./tabs/model-performance-history.ts";

import { type ModelChoice } from "./ui/model-selector.tsx";

import { type ThemeConfigDocument } from "./config/theme-config.ts";

import { type ThemeController } from "./ui/theme.ts";

import {
	type BackgroundOutputPage,
	type BackgroundTaskSelection,
} from "./state/background-tasks.ts";

import { inspectedTargetScrollY } from "./ui/subagent-inspector.tsx";

import { subagentTargets, type SubagentTarget } from "./subagents/targets.ts";

import { computeSpawnGroups, type SpawnGroup } from "./ui/spawn-group.tsx";
import { type CommandChoice } from "./ui/command-suggestions.tsx";

import { type OptionalIntegrationStatus } from "./integrations/detect.ts";

import {
	readClaudeAccountPreference,
	resolveClaudeLaunchConfig,
} from "./config/claude-account.ts";

import {
	INITIAL_MESSAGE_WINDOW,
	MAX_LIVE_MESSAGE_WINDOW,
	MESSAGE_LOAD_BATCH,
	initialMessageWindowStart,
	loadOlderMessageWindowStart,
	trimMessageWindowStart,
} from "./ui/message-window.ts";

export type AppOptions = {
	cwd: string;
	piExecutable?: string | undefined;
	piArgs: string[];
	sidebar: boolean;
	logger: DiagnosticLogger;
	integrations: OptionalIntegrationStatus;
	openSessionSelector?: boolean;
	themeWarning?: string;
	themeConfig?: ThemeConfigDocument;
	themeController?: ThemeController;
};

function contextWindowForModel(
	modelName: string | undefined,
): number | undefined {
	const availableModelsCache = cachedAvailableModels();
	if (!modelName || !availableModelsCache) return undefined;
	const exact = availableModelsCache.find(
		(model) => `${model.provider}/${model.id}` === modelName,
	);
	if (exact) return exact.contextWindow;
	return availableModelsCache.find((model) => model.id === modelName)
		?.contextWindow;
}
const SESSION_LOAD_REQUEST_TIMEOUT_MS = 120_000;
const STARTUP_DEADLINE_MS = 180_000;

function isExtensionUiRequest(value: unknown): value is RpcExtensionUIRequest {
	return Boolean(
		value &&
			typeof value === "object" &&
			(value as Record<string, unknown>).type === "extension_ui_request",
	);
}

function modelThinkingKey(provider: string, modelId: string): string {
	return `${provider}\0${modelId}`;
}

export function shouldShowEmptyDashboard(renderedItemCount: number): boolean {
	return renderedItemCount === 0;
}

export function App(props: AppOptions) {
	const selectedAccount = readClaudeAccountPreference();
	const initialClaudeLaunch = resolveClaudeLaunchConfig(selectedAccount);
	if (initialClaudeLaunch.error)
		throw new Error(
			`Cannot start Pi with selected cswap account: ${initialClaudeLaunch.error}`,
		);
	const claudeLaunchEnv = initialClaudeLaunch.configDir
		? { CLAUDE_CONFIG_DIR: initialClaudeLaunch.configDir }
		: undefined;
	const renderer = useRenderer();
	const dimensions = useTerminalDimensions();
	const client = new PiRpcClient({
		cwd: props.cwd,
		args: props.piArgs,
		...(claudeLaunchEnv ? { env: claudeLaunchEnv } : {}),
		...(props.piExecutable ? { executable: props.piExecutable } : {}),
		logger: props.logger,
	});
	const conversation = new ConversationModel([], props.cwd);
	const {
		revision: [revision, setRevision],
		conversationRevision: [conversationRevision, setConversationRevision],
		conversationStructureRevision: [
			conversationStructureRevision,
			setConversationStructureRevision,
		],
		compactionRevision: [compactionRevision, setCompactionRevision],
		messageWindowStart: [messageWindowStart, setMessageWindowStart],
		sidebarEnabled: [sidebarEnabled, setSidebarEnabled],
		expandedTools: [expandedTools, setExpandedTools],
		showJumpLatest: [showJumpLatest, setShowJumpLatest],
		pendingSteers: [pendingSteers, setPendingSteers],
		autoRetryEnabled: [autoRetryEnabled, setAutoRetryEnabled],
		spinnerIndex: [spinnerIndex, setSpinnerIndex],
		clockNow: [clockNow, setClockNow],
		codexUsage: [codexUsage, setCodexUsage],
		codexUsageStats: [codexUsageStats, setCodexUsageStats],
		claudeUsage: [claudeUsage, setClaudeUsage],
		cswapSnapshot: [cswapSnapshot, setCswapSnapshot],
		claudeAccountChoice: [claudeAccountChoice, setClaudeAccountChoice],
		claudeHint: [claudeHint, setClaudeHint],
		opencodeUsage: [opencodeUsage, setOpencodeUsage],
		opencodeUsageStats: [opencodeUsageStats, setOpencodeUsageStats],
		subagentSelectorOpen: [subagentSelectorOpen, setSubagentSelectorOpen],
		dialog: [dialog, setDialog],
		dialogOwnerRuntimeId: [dialogOwnerRuntimeId, setDialogOwnerRuntimeId],
		modelSelectorOpen: [modelSelectorOpen, setModelSelectorOpen],
		modelOptions: [modelOptions, setModelOptions],
		modelListNotice: [modelListNotice, setModelListNotice],
		modelSelectorLoading: [modelSelectorLoading, setModelSelectorLoading],
		sessionSelectorOpen: [sessionSelectorOpen, setSessionSelectorOpen],
		skillSelectorOpen: [skillSelectorOpen, setSkillSelectorOpen],
		forkPickerOpen: [forkPickerOpen, setForkPickerOpen],
		forkPickerOptionsSignal: [forkPickerOptionsSignal, setForkPickerOptions],
		compactionSummaryExpanded: [
			compactionSummaryExpanded,
			setCompactionSummaryExpanded,
		],
		settingsRoute: [settingsRoute, setSettingsRoute],
		mcpScope: [mcpScope, setMcpScope],
		mcpView: [mcpView, setMcpView],
		mcpSnapshot: [mcpSnapshot, setMcpSnapshot],
		mcpPreview: [mcpPreview, setMcpPreview],
		mcpError: [mcpError, setMcpError],
		mcpInstallState: [mcpInstallState, setMcpInstallState],
		nativeMcpSummary: [, setNativeMcpSummary],
		mcpBackend,
		mcpConfiguredSummary,
		mcpConfigState: [mcpConfigState, setMcpConfigState],
		settingsSelectedId: [settingsSelectedId, setSettingsSelectedId],
		rpcAvailable: [rpcAvailable, setRpcAvailable],
		settingsBusy: [settingsBusy, setSettingsBusy],
		settingsErrors: [settingsErrors, setSettingsErrors],
		compactionModelState: [compactionModelState, setCompactionModelState],
		subagentModelEntries: [subagentModelEntries, setSubagentModelEntries],
		selectedSubagentModelId: [
			selectedSubagentModelId,
			setSelectedSubagentModelId,
		],
		detailSettingSelectedId: [
			detailSettingSelectedId,
			setDetailSettingSelectedId,
		],
		themeConfig: [themeConfig, setThemeConfig],
		themeController,
		sessionDiscovery: [sessionDiscovery, setSessionDiscovery],
		sessionSwitching: [sessionSwitching, setSessionSwitching],
		pendingSession: [pendingSession, setPendingSession],
		pendingSessionReason: [pendingSessionReason, setPendingSessionReason],
		promptMapOpen: [promptMapOpen, setPromptMapOpen],
		memoryBrowserOpen: [memoryBrowserOpen, setMemoryBrowserOpen],
		memorySnapshot: [memorySnapshot, setMemorySnapshot],
		thinkingExpanded: [thinkingExpanded, setThinkingExpanded],
		compactionExpanded: [compactionExpanded, setCompactionExpanded],
		promptText: [promptText, setPromptText],
		promptCursorOffset: [promptCursorOffset, setPromptCursorOffset],
		commandCatalog,
		commandChoices: [commandChoices, setCommandChoices],
		commandSuggestionIndex: [commandSuggestionIndex, setCommandSuggestionIndex],
		toasts: [toasts, setToasts],
		tabManager,
		tabState: [tabState, setTabState],
		activeTabId: [activeTabId, setActiveTabId],
		runtimeMap: [runtimeMap, setRuntimeMap],
		extensionRouter,
		provisionalRuntimes,
		setMcpActivationPending,
	} = createAppSignals({
		sidebar: props.sidebar,
		cwd: props.cwd,
		logger: props.logger,
		integrations: props.integrations,
		themeConfig: props.themeConfig,
		themeController: props.themeController,
	});
	const queuedFollowUps = () => {
		revision();
		return activeRuntime().queuedFollowUps;
	};
	let draftSwitchGuard = false;
	let settingsOrigin: Renderable | null = null;

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
		cwd: props.cwd,
		piArgs: props.piArgs,
		piExecutable: props.piExecutable,
		claudeLaunchEnv,
		logger: props.logger,
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
		subagentScroll: () => subagentScroll,
		scrollToBottom: () => scrollToBottom(),
		prompt: () => prompt,
		setDraftSwitchGuard: (value) => {
			draftSwitchGuard = value;
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
	const sessionController = new SessionController(props.logger);
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
		warning: import("./tabs/cache-miss-watch.ts").CacheWarning,
		runtime: ConversationTabRuntime,
	) => {
		props.logger.warn("cache.large_rewrite", {
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
		cwd: props.cwd,
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
	type SetUpdater<T> = T | ((current: T) => T);
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
	const [notificationHistory, setNotificationHistory] = createSignal<
		NotificationRecord[]
	>([]);
	const [notificationDetailId, setNotificationDetailId] =
		createSignal<string>();
	const [backgroundSelection, setBackgroundSelection] = createSignal<
		BackgroundTaskSelection | undefined
	>();
	const [backgroundOutput, setBackgroundOutput] =
		createSignal<BackgroundOutputPage>();
	const [backgroundOutputError, setBackgroundOutputError] =
		createSignal<string>();
	const [backgroundOutputBusy, setBackgroundOutputBusy] = createSignal(false);
	const [todoDetailId, setTodoDetailId] = createSignal<string>();
	const [status, setStatus] = createSignal("starting Pi…");
	const startupStartedAt = Date.now();
	const [startupPhase, setStartupPhase] = createSignal<StartupPhase>({
		kind: "starting",
	});
	let prompt: TextareaRenderable | undefined;
	let scroll: ScrollBoxRenderable | undefined;
	let subagentScroll: ScrollBoxRenderable | undefined;
	// Snapshot of the last finished transcript mouse selection. Stream chunks
	// or node swaps between mouse-up and Ctrl+C would otherwise make the live
	// query resolve against mutated content.
	const isTranscriptSelectionContainer = (
		container: Renderable | null,
	): boolean => {
		let current: Renderable | null = container;
		while (current) {
			// The prompt editor owns its selection (prompt.getSelection()); never
			// route it through the transcript cache.
			if (prompt && current === prompt) return false;
			if (current === scroll || current === subagentScroll) return true;
			current = current.parent;
		}
		return false;
	};
	const transcriptSelectionCache = attachTranscriptSelectionCache(
		renderer,
		isTranscriptSelectionContainer,
	);
	onCleanup(() => transcriptSelectionCache.dispose());

	const reconcileSteers = (nextRuns: readonly SubagentRun[]) => {
		const nextTargets = subagentTargets(nextRuns, subagentTools(), {
			contextWindowForModel,
			ownerPid: activeRuntime().client.getProcessPid(),
		});
		setPendingSteers((entries) =>
			reconcilePendingSteers(
				entries,
				nextTargets.map((target) => ({
					runId: target.run.runId,
					targetKey: target.key,
					steerCount: target.run.steerCount,
					active: target.active,
				})),
			),
		);
	};

	const sessionState = () => {
		revision();
		return activeRuntime().sessionState;
	};
	const sessionStats = () => {
		revision();
		return activeRuntime().sessionStats;
	};
	const runs = () => {
		revision();
		return activeRuntime().runs;
	};
	const mcpStatus = () => {
		revision();
		return activeRuntime().mcpStatus;
	};
	const mcpCounts = () => {
		revision();
		return activeRuntime().mcpCounts;
	};
	const lastRequestPerformance = () => {
		revision();
		return activeRuntime().lastRequestPerformance;
	};
	const requestTimingHistory = () => {
		revision();
		return activeRuntime().timingHistory;
	};
	const setRuns = (nextRuns: SubagentRun[]) => {
		activeRuntime().runs = nextRuns;
		touch();
	};
	const currentSessionKey = () => sessionState()?.sessionId ?? props.cwd;
	const rememberThinkingLevel = (
		runtime: ConversationTabRuntime,
		level = runtime.sessionState?.thinkingLevel,
	): void => {
		const model = runtime.sessionState?.model;
		if (model && level && isThinkingLevel(level))
			runtime.effectiveThinkingLevels.set(
				modelThinkingKey(model.provider, model.id),
				level,
			);
	};
	const applyRememberedThinkingLevel = async (
		runtime: ConversationTabRuntime,
		provider: string,
		modelId: string,
	): Promise<void> => {
		const level = runtime.effectiveThinkingLevels.get(
			modelThinkingKey(provider, modelId),
		);
		if (level) await runtime.client.setThinkingLevel(level);
	};
	const {
		currentDrafts,
		syncPromptPlaceholder,
		syncMainDraft,
		clearMainDraft,
		clearRuntimeMainDraftIfMatches,
		promptValue,
		expandedPromptText,
		expandCollapsedPromptPaste,
		handlePromptKeyDown,
		handlePromptPaste,
	} = createPromptDraftActions({
		cwd: props.cwd,
		currentSessionKey,
		revision,
		activeRuntime,
		isRuntimeActive: tabRuntimeIsActive,
		getPrompt: () => prompt,
		setPromptText,
		setPromptCursorOffset,
		setCommandSuggestionIndex,
		toast: (text, tone, duration) => toast(text, tone, duration),
	});
	createEffect(() => {
		if (inspectSubagent()) {
			prompt = undefined;
			return;
		}
		const value = currentDrafts().main;
		if (prompt && prompt.plainText !== value) prompt.setText(value);
		setPromptText(value);
		setPromptCursorOffset(prompt?.cursorOffset ?? value.length);
	});

	const touch = () => setRevision((value) => value + 1);
	const conversationTouch = (reason: "stream" | "structure" = "structure") => {
		setConversationRevision((value) => value + 1);
		if (reason === "structure")
			setConversationStructureRevision((value) => value + 1);
	};
	const {
		visibleSidebar,
		items,
		structureItems,
		visibleItems,
		hiddenMessageCount,
		visibleMessageIds,
		promptMapEntries,
		todos,
		subagentsAvailable,
		todosAvailable,
		commandSuggestions,
		thinkingIsExpanded,
		setAllThinkingExpanded,
		toggleThinkingItem,
		streaming,
		compactionView,
		lastCompactionCompletion,
		showWorkingIndicator,
	} = createConversationSelectors({
		sidebarEnabled,
		dimensions,
		conversationRevision,
		conversationStructureRevision,
		messageWindowStart,
		activeRuntime,
		subagentsInstalled: props.integrations.subagents.installed,
		todosInstalled: props.integrations.todos.installed,
		runs,
		promptText,
		promptCursorOffset,
		commandChoices,
		clockNow,
		startupPhase,
		refreshCommandChoices,
		revision,
		thinkingExpanded,
		setThinkingExpanded,
		setThinkingExpansionOverrides,
		compactionRevision,
	});
	const {
		subagentTools,
		availableSubagentTargets,
		displaySubagentTargets,
		ownedVisibleSubagentTargets,
		selectedSubagentTarget,
		inspectedTarget,
		inspectedTranscript,
	} = createInspectorProjection({
		cwd: props.cwd,
		clockNow,
		runs,
		structureItems,
		visibleItems,
		contextWindowForModel,
		activeRuntime,
		selectedTargetKey,
		inspectSubagent,
	});
	// Pi publishes queue_update before consuming a queued user message. Do not
	// filter by recent transcript text: repeated inputs are separate messages.
	const steeringQueue = createMemo(() => {
		conversationRevision();
		return [...activeRuntime().conversation.steering];
	});
	const followUpQueue = createMemo(() => {
		conversationRevision();
		return [...activeRuntime().conversation.followUp];
	});

	const toast = (
		text: string,
		tone: Toast["tone"] = "info",
		duration = 2800,
	) => {
		const createdAt = Date.now();
		const entry: Toast = {
			id: crypto.randomUUID(),
			text,
			tone,
			expiresAt: createdAt + duration,
		};
		const record: NotificationRecord = {
			id: entry.id,
			text,
			tone: entry.tone,
			createdAt,
			read: false,
		};
		setNotificationHistory((current) =>
			appendNotificationHistory(current, record),
		);
		setToasts((current) => [...current.slice(-2), entry]);
		setTimeout(
			() =>
				setToasts((current) => current.filter((item) => item.id !== entry.id)),
			duration,
		).unref?.();
	};

	const { refreshSubagentRuns, refreshState, dropRefreshCoordinator } =
		createRuntimeRefresh({
			logger: props.logger,
			cwd: props.cwd,
			subagentsInstalled: props.integrations.subagents.installed,
			reconcileSteers,
			setRuns,
			subagentTools,
			contextWindowForModel,
			activeRuntime,
			selectedTargetKey,
			availableSubagentTargets,
			setSelectedTargetKey,
			rememberThinkingLevel,
			tabRuntimeIsActive,
			setStatus: (value) => setStatus(value),
			setRpcAvailable,
			touch,
			toast,
			startupPhase,
		});
	const updateScrollPosition = () => {
		if (!scroll || inspectSubagent()) {
			setShowJumpLatest(false);
			return;
		}
		const viewportHeight = Math.max(
			1,
			scroll.height || dimensions().height - 8,
		);
		const maxTop = Math.max(0, scroll.scrollHeight - viewportHeight);
		setShowJumpLatest(scroll.scrollTop < maxTop - 2);
	};

	const captureThemeViewport = (): ThemeViewportSnapshot => ({
		mainTop: scroll?.scrollTop,
		subagentTop: subagentScroll?.scrollTop,
	});
	const restoreThemeViewport = (snapshot: ThemeViewportSnapshot) => {
		queueMicrotask(() =>
			queueMicrotask(() =>
				setTimeout(() => {
					if (snapshot.mainTop !== undefined)
						scroll?.scrollTo({ x: 0, y: snapshot.mainTop });
					if (snapshot.subagentTop !== undefined)
						subagentScroll?.scrollTo({ x: 0, y: snapshot.subagentTop });
					updateScrollPosition();
				}, 0),
			),
		);
	};

	const scrollToBottom = () => {
		scroll?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER });
		setShowJumpLatest(false);
	};

	const resetMessageWindow = (
		totalItems = activeRuntime().conversation.items.length,
	) => {
		setMessageWindowStart(
			initialMessageWindowStart(totalItems, INITIAL_MESSAGE_WINDOW),
		);
	};

	const trimMessageWindowIfFollowingLatest = () => {
		if (showJumpLatest() || inspectSubagent()) return;
		setMessageWindowStart((current) =>
			trimMessageWindowStart(
				activeRuntime().conversation.items.length,
				current,
				MAX_LIVE_MESSAGE_WINDOW,
			),
		);
	};

	const loadOlderMessages = () => {
		const capturedRuntime = activeRuntime();
		const capturedTabId = activeTabId();
		const current = messageWindowStart();
		if (current <= 0) return;
		const oldHeight = scroll?.scrollHeight ?? 0;
		const oldTop = scroll?.scrollTop ?? 0;
		setMessageWindowStart(
			loadOlderMessageWindowStart(current, MESSAGE_LOAD_BATCH),
		);
		// Keep the previously first visible message in place after prepending older
		// children. Two microtasks allow OpenTUI to finish the new layout first.
		queueMicrotask(() =>
			queueMicrotask(() => {
				if (
					!tabRuntimeIsActive(capturedTabId) ||
					activeRuntime() !== capturedRuntime
				)
					return;
				if (!scroll) return;
				const addedHeight = Math.max(0, scroll.scrollHeight - oldHeight);
				scroll.scrollTo({ x: 0, y: oldTop + addedHeight });
				updateScrollPosition();
			}),
		);
	};

	const toolExpanded = (toolId: string): boolean => {
		revision();
		return expandedTools() || activeRuntime().expandedToolIds.has(toolId);
	};
	const toggleTool = (toolId: string) => {
		setExpandedToolIds((current) => {
			const next = new Set(current);
			if (next.has(toolId)) next.delete(toolId);
			else next.add(toolId);
			return next;
		});
	};

	const diffExpanded = (toolId: string): boolean => {
		revision();
		return activeRuntime().expandedDiffIds.has(toolId);
	};
	const toggleDiff = (toolId: string) => {
		setExpandedDiffIds((current) => {
			const next = new Set(current);
			if (next.has(toolId)) next.delete(toolId);
			else next.add(toolId);
			return next;
		});
	};

	const inspectSubagentTarget = (targetKey: string) => {
		setSelectedTargetKey(targetKey);
		setInspectSubagent(true);
		const target = availableSubagentTargets().find(
			(entry) => entry.key === targetKey,
		);
		queueMicrotask(() =>
			subagentScroll?.scrollTo(inspectedTargetScrollY(target)),
		);
	};

	// Contiguous parallel-spawn batches collapse into one grouped card (see
	// `./ui/spawn-group.tsx`). Group keys are synthetic `group:<firstItemId>`
	// ids that cannot collide with real item ids, so the existing per-runtime
	// `expandedToolIds` plumbing (reset per session like the other expansion
	// state) is reused without a second store.
	const spawnGroups = createMemo(() =>
		computeSpawnGroups(visibleItems(), ownedVisibleSubagentTargets()),
	);
	const spawnGroupByFirstId = createMemo(() => {
		const map = new Map<string, SpawnGroup>();
		for (const group of spawnGroups()) {
			const first = group.memberIds[0];
			if (first !== undefined) map.set(first, group);
		}
		return map;
	});
	const spawnGroupMemberIds = createMemo(() => {
		const ids = new Set<string>();
		for (const group of spawnGroups())
			for (const memberId of group.memberIds.slice(1)) ids.add(memberId);
		return ids;
	});

	// Today's per-item transcript path, shared by standalone items and by
	// expanded group members so the raw cards stay exactly reachable.
	const renderItemEntry = createMessageRenderer({
		visibleItems,
		activeRuntime,
		lastCompactionCompletion,
		compactionSummaryExpanded,
		setCompactionSummaryExpanded,
		viewportHeight: () => dimensions().height,
		ownedVisibleSubagentTargets,
		thinkingIsExpanded,
		toggleThinkingItem,
		toolExpanded,
		toggleTool,
		diffExpanded,
		toggleDiff,
		streaming,
		forkAt,
		inspectSubagentTarget,
		clockNow,
	});

	const addSystemToRuntime = (
		runtime: ConversationTabRuntime,
		text: string,
		tone: "muted" | "info" | "warning" | "error" | "success" = "info",
	): void => {
		runtime.conversation.system(text, tone);
		if (!tabRuntimeIsActive(runtime.id)) return;
		trimMessageWindowIfFollowingLatest();
		conversationTouch();
		queueMicrotask(scrollToBottom);
	};

	const insertSuggestedCommand = (command: CommandChoice) => {
		const value = `/${command.name} `;
		syncMainDraft(value);
		setCommandSuggestionIndex(0);
		queueMicrotask(() => prompt?.focus());
	};

	const cycleThinkingEffort = async () => {
		try {
			const runtime = activeRuntime();
			const result = await runtime.client.cycleThinkingLevel();
			await refreshState(runtime);
			const level =
				result?.level ?? runtime.sessionState?.thinkingLevel ?? "unknown";
			rememberThinkingLevel(
				runtime,
				isThinkingLevel(level) ? level : undefined,
			);
			toast(`Thinking effort: ${level}`, "success", 1600);
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), "error");
		}
	};

	const afterSessionLoaded = async (
		runtime: ConversationTabRuntime,
		historyLength: number,
	) => {
		rememberThinkingLevel(runtime);
		if (tabRuntimeIsActive(runtime.id)) {
			resetMessageWindow(historyLength);
			conversationTouch();
			queueMicrotask(scrollToBottom);
		}
		await refreshState(runtime);
	};
	const loadCurrentSession = async (
		runtime: ConversationTabRuntime = activeRuntime(),
	) => {
		const historyLength = await sessionController.loadCurrent(
			runtime,
			SESSION_LOAD_REQUEST_TIMEOUT_MS,
		);
		await afterSessionLoaded(runtime, historyLength);
	};

	const slashCommandController =
		new SlashCommandController<ConversationTabRuntime>({
			addSystem: addSystemToRuntime,
			openSessionSelector: () => openSessionSelector(),
			openSettings: () => openSettings(),
			expandedTools,
			setExpandedTools,
			setExpandedToolIds: (ids) => setExpandedToolIds(ids),
			sidebarEnabled,
			setSidebarEnabled,
			refreshState,
			autoRetryEnabled,
			setAutoRetryEnabled,
			refreshCommands: (runtime) => refreshCommandChoices(runtime, true),
			rememberThinkingLevel,
			applyRememberedThinkingLevel,
			fetchAvailableModels: () => fetchAvailableModels(),
			loadCurrentSession,
			setSkillSelectorOpen,
			setAllThinkingExpanded,
			thinkingExpanded,
			promptMapCount: () => promptMapEntries().length,
			setPromptMapOpen,
			openMemoryBrowser: () => openMemoryBrowser(),
		});
	const handleSlashCommand = (
		text: string,
		runtime: ConversationTabRuntime = activeRuntime(),
	): Promise<boolean> => slashCommandController.handle(text, runtime);

	const {
		sendText,
		submit,
		queueFollowUp,
		editQueuedFollowUp,
		restoreQueuedFollowUp,
		flushQueuedFollowUp,
		abortActiveWork,
	} = createInputActions({
		logger: props.logger,
		tabRuntimeIsActive,
		trimMessageWindowIfFollowingLatest,
		conversationTouch,
		scrollToBottom,
		clearRuntimeMainDraftIfMatches,
		toast,
		activeRuntime,
		startupPhase,
		dialog,
		expandedPromptText,
		handleSlashCommand,
		clearMainDraft,
		syncMainDraft,
		touch,
		getPrompt: () => prompt,
		queuedFollowUps,
	});

	const copySelection = (): boolean => {
		if (!renderer.getSelection()) {
			transcriptSelectionCache.clear();
			return false;
		}
		const text = transcriptSelectionCache.getCopyText();
		if (!text) return false;
		const copied = renderer.copyToClipboardOSC52(text);
		renderer.clearSelection();
		transcriptSelectionCache.clear();
		toast(
			copied ? "Copied selection" : "Terminal does not support OSC52 clipboard",
			copied ? "success" : "warning",
		);
		return true;
	};

	const focusMainPrompt = () => {
		if (
			startupPhase().kind !== "ready" ||
			dialog() ||
			backgroundSelection() ||
			notificationDetailId() ||
			todoDetailId() ||
			modelSelectorOpen() ||
			sessionSelectorOpen() ||
			promptMapOpen() ||
			memoryBrowserOpen() ||
			subagentSelectorOpen() ||
			forkPickerOpen() ||
			skillSelectorOpen() ||
			inspectSubagent() ||
			settingsRoute() !== "closed"
		)
			return;
		queueMicrotask(() => {
			if (
				!dialog() &&
				!backgroundSelection() &&
				!modelSelectorOpen() &&
				!sessionSelectorOpen() &&
				!forkPickerOpen() &&
				!promptMapOpen() &&
				!memoryBrowserOpen() &&
				!subagentSelectorOpen() &&
				!skillSelectorOpen() &&
				!inspectSubagent()
			)
				prompt?.focus();
		});
	};

	const closeSettings = () => {
		setSettingsRoute("closed");
		const origin = settingsOrigin;
		settingsOrigin = null;
		queueMicrotask(() => {
			if (origin && !origin.isDestroyed) origin.focus();
			else focusMainPrompt();
		});
	};
	const openNotification = (recordId: string) => {
		setNotificationHistory((current) =>
			current.map((record) =>
				record.id === recordId ? { ...record, read: true } : record,
			),
		);
		setNotificationDetailId(recordId);
	};
	const {
		backgroundTasks,
		selectedBackgroundTask,
		showBackgroundOutputPage,
		openBackgroundTask,
		closeBackgroundTask,
		analyzeBackgroundTask,
	} = createBackgroundActions({
		activeRuntime,
		activeTabId,
		revision,
		backgroundSelection,
		setBackgroundSelection,
		backgroundOutput,
		setBackgroundOutput,
		setBackgroundOutputError,
		setBackgroundOutputBusy,
		backgroundOutputBusy,
		clockNow,
		focusMainPrompt,
		sendText: (text) => sendText(text),
		toast,
	});
	const closeNotification = () => {
		setNotificationDetailId(undefined);
		queueMicrotask(focusMainPrompt);
	};
	const openTodo = (id: string) => {
		setTodoDetailId(id);
	};
	const closeTodo = () => {
		setTodoDetailId(undefined);
		queueMicrotask(focusMainPrompt);
	};

	const openSettings = () => {
		if (settingsRoute() !== "closed") return;
		settingsOrigin = renderer.currentFocusedRenderable;
		setSettingsErrors({});
		setSettingsSelectedId("model");
		setSettingsRoute("root");
		void refreshCompactionModel();
		void refreshSubagentModels();
	};
	const { fetchAvailableModels, loadModels } = createModelCatalogActions({
		activeRuntime,
		toast,
		setModelOptions,
		setModelListNotice,
		setModelSelectorOpen,
		modelSelectorLoading,
		setSettingsBusy,
		setSettingsErrors,
		setModelSelectorLoading,
		setSettingsRoute,
	});
	const {
		refreshCompactionModel,
		refreshSubagentModels,
		openCompactionSettings,
		openSubagentModels,
		openSubagentSettings,
		applyCompactionModel,
		applySubagentModel,
		applyCompactionThinking,
		applySubagentThinking,
		selectedSubagentModelEntry,
		subagentListRows,
		subagentSettingsRows,
		compactionSettingsRows,
		openCompactionSetting,
		openSubagentSetting,
		compactionThinkingLevels,
		subagentThinkingLevels,
		compactionThinkingContext,
		subagentThinkingContext,
		compactionModelContext,
		subagentModelContext,
	} = createExtensionModelActions({
		cwd: props.cwd,
		activeRuntime,
		toast,
		modelSelectorLoading,
		setModelSelectorLoading,
		settingsBusy,
		setSettingsBusy,
		setSettingsErrors,
		setModelOptions,
		modelOptions,
		cachedModels: cachedAvailableModels,
		fetchAvailableModels,
		compactionModelState,
		setCompactionModelState,
		subagentModelEntries,
		setSubagentModelEntries,
		selectedSubagentModelId,
		setSelectedSubagentModelId,
		setSettingsSelectedId,
		setDetailSettingSelectedId,
		setSettingsRoute,
	});
	const {
		applySettingsModel,
		applySettingsThinking,
		applyThemePreset,
		applyThemeToken,
		resetTheme,
		applySettingsRename,
	} = createSettingsMutations({
		activeRuntime,
		settingsBusy,
		setSettingsBusy,
		setSettingsErrors,
		setSettingsRoute,
		setSettingsSelectedId,
		rememberThinkingLevel,
		applyRememberedThinkingLevel,
		refreshState,
		themeConfig,
		setThemeConfig,
		themeController,
		captureThemeViewport,
		restoreThemeViewport,
	});
	const {
		openMcpSettings,
		activateMcp,
		enableBuiltinMcpInSettings,
		installMcpAdapter,
		prepareMcpMutation,
		deleteMcpServer,
		confirmMcpMutation,
	} = createMcpActions({
		cwd: props.cwd,
		piExecutable: props.piExecutable,
		activeRuntime,
		streaming,
		commandCatalog,
		loadCurrentSession,
		refreshCommandChoices,
		mcpScope,
		mcpBackend,
		mcpSnapshot,
		mcpPreview,
		setMcpView,
		setMcpPreview,
		setMcpSnapshot,
		setMcpConfigState,
		setMcpError,
		setSettingsRoute,
		setMcpInstallState,
		setNativeMcpSummary,
		setMcpActivationPending,
	});
	const settingsDescriptors = () =>
		buildSettingsDescriptors({
			sessionState,
			rpcAvailable,
			settingsBusy,
			settingsErrors,
			loadModels,
			setRoute: setSettingsRoute,
			compactionModelState,
			openCompactionSettings,
			subagentModelEntries,
			openSubagentModels,
			cswapSnapshot,
			claudeEffectiveSlot,
			themeConfig,
			mcpInstallState,
			mcpError,
			openMcpSettings,
			memoryInstalled: () => props.integrations.memory.installed,
			openMemoryBrowser,
		});

	const {
		discoverCurrentSessions,
		openSessionSelector,
		closeSessionSelector,
		switchToSession,
	} = createSessionPickerActions({
		cwd: props.cwd,
		sessionLoadTimeoutMs: SESSION_LOAD_REQUEST_TIMEOUT_MS,
		sessionState,
		setSessionDiscovery,
		sessionSwitching,
		setSessionSwitching,
		pendingSession,
		setPendingSession,
		pendingSessionReason,
		setPendingSessionReason,
		setSessionSelectorOpen,
		settingsRoute,
		setSettingsRoute,
		focusMainPrompt,
		activeRuntime,
		touch,
		sessionController,
		afterSessionLoaded,
		toast,
	});

	const closeModelSelector = () => {
		setModelSelectorOpen(false);
		focusMainPrompt();
	};

	const openModelSelector = async () => {
		await loadModels(false);
	};

	const selectModel = async (model: ModelChoice) => {
		const runtime = activeRuntime();
		rememberThinkingLevel(runtime);
		setModelSelectorOpen(false);
		setStatus(`switching to ${model.provider}/${model.id}…`);
		try {
			await runtime.client.setModel(model.provider, model.id);
			await applyRememberedThinkingLevel(runtime, model.provider, model.id);
			await refreshState(runtime);
			toast(`Model set to ${model.provider}/${model.id}`, "success");
		} catch (error) {
			toast(
				`Failed to set model: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		} finally {
			setStatus(streaming() ? "working" : "ready");
			focusMainPrompt();
		}
	};

	const {
		closePromptMap,
		openPromptMap,
		jumpToPrompt,
		closeMemoryBrowser,
		openMemoryBrowser,
		removeMemory,
		completeDialog,
	} = createModalNavigation({
		cwd: props.cwd,
		memoryInstalled: props.integrations.memory.installed,
		setPromptMapOpen,
		promptMapEntries,
		toast,
		setModelSelectorOpen,
		items,
		messageWindowStart,
		setMessageWindowStart,
		getPrompt: () => prompt,
		getScroll: () => scroll,
		updateScrollPosition,
		setMemoryBrowserOpen,
		settingsRoute,
		setSettingsRoute,
		memorySnapshot,
		setMemorySnapshot,
		dialog,
		dialogOwnerRuntimeId,
		runtimeMap,
		logger: props.logger,
		setDialog,
		setDialogOwnerRuntimeId,
		extensionRouter,
		tabRuntimeIsActive,
		handleExtensionRequest,
	});

	onMount(() => {
		startInitialSession({
			runtime: bootRuntime,
			logger: props.logger,
			cwd: props.cwd,
			sidebar: props.sidebar,
			themeWarning: props.themeWarning,
			integrations: props.integrations,
			openSessionSelectorOnStartup: props.openSessionSelector === true,
			startupPhase,
			setStartupPhase,
			setStatus,
			setExtensionStatus,
			setRpcAvailable,
			isRuntimeActive: tabRuntimeIsActive,
			commandCatalog,
			setCommandChoices,
			resetMessageWindow,
			rememberThinkingLevel,
			fetchAvailableModels,
			touch,
			conversationTouch: () => conversationTouch(),
			scrollToLatest: () =>
				scroll?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER }),
			openSessionSelector,
			focusPrompt: () => prompt?.focus(),
			discoverCurrentSessions,
			refreshState,
			toast,
			sessionLoadTimeoutMs: SESSION_LOAD_REQUEST_TIMEOUT_MS,
			startupDeadlineMs: STARTUP_DEADLINE_MS,
			updateEnvironment: process.env,
		});
		const stopUsagePolling = startUsagePolling({
			logger: props.logger,
			doppelclaudeInstalled: props.integrations.doppelclaude.installed,
			setCodexUsage,
			setCodexUsageStats,
			setOpencodeUsage,
			setOpencodeUsageStats,
			setCswapSnapshot,
			setClaudeUsage,
			setClaudeHint,
			applyCswapUsage,
			claudeEffectiveSlot,
		});
		const stopUiMonitoring = startUiMonitoring({
			logger: props.logger,
			subagentsInstalled: props.integrations.subagents.installed,
			refreshState,
			refreshSubagentRuns,
			sessionState,
			setSpinnerIndex,
			setClockNow,
			status,
			streaming,
			activeRuntime,
			runs,
			availableSubagentTargets,
		});
		onCleanup(() => {
			for (const runtime of provisionalRuntimes) {
				runtime.messageUpdates.dispose();
				runtime.coalescer.flush();
				void runtime.client.stop();
			}
			provisionalRuntimes.clear();
			for (const runtime of runtimeMap().values()) {
				runtime.messageUpdates.dispose();
				runtime.coalescer.flush();
				void runtime.client.stop();
			}
			stopUiMonitoring();
			stopUsagePolling();
			props.logger.info("ui.cleanup");
		});
	});

	const closeSubagentInspector = () => {
		setSubagentSelectorOpen(false);
		setInspectSubagent(false);
		queueMicrotask(() => prompt?.focus());
	};

	const selectSubagentTarget = (target: SubagentTarget) => {
		setSelectedTargetKey(target.key);
		setSubagentSelectorOpen(false);
		setInspectSubagent(true);
		queueMicrotask(() =>
			subagentScroll?.scrollTo(inspectedTargetScrollY(target)),
		);
	};

	const cycleSubagent = (direction: 1 | -1) => {
		const all = displaySubagentTargets();
		if (!all.length) return;
		const index = Math.max(
			0,
			all.findIndex((target) => target.key === selectedTargetKey()),
		);
		const nextIndex = (index + direction + all.length) % all.length;
		const next = all[nextIndex];
		setSelectedTargetKey(next?.key);
		if (inspectSubagent())
			queueMicrotask(() =>
				subagentScroll?.scrollTo(inspectedTargetScrollY(next)),
			);
	};

	const {
		sendSubagentSteer,
		requestPauseSubagent,
		requestResumeSubagent,
		requestStopSubagent,
	} = createSubagentControlActions({
		selectedTarget: selectedSubagentTarget,
		inspectorOpen: inspectSubagent,
		runtimeAvailable: subagentsAvailable,
		setPendingSteers,
		clearDraft: (key) => clearTargetDraft(currentDrafts(), key),
		touch,
		logger: props.logger,
		toast,
	});

	registerAppKeyboard({
		abortActiveWork,
		activateTab,
		activeRuntime,
		availableSubagentTargets,
		backgroundSelection,
		clearMainDraft,
		closeBackgroundTask,
		closeMemoryBrowser,
		closeNotification,
		closePromptMap,
		closeSessionSelector,
		closeSettings,
		closeSubagentInspector,
		closeTodo,
		commandSuggestionIndex,
		commandSuggestions,
		compactionExpanded,
		completeDialog,
		copySelection,
		cycleSubagent,
		cycleThinkingEffort,
		dialog,
		dimensions,
		displaySubagentTargets,
		expandedPromptText,
		expandedTools,
		focusMainPrompt,
		forkPickerOpen,
		insertSuggestedCommand,
		inspectSubagent,
		mcpView,
		memoryBrowserOpen,
		modelSelectorOpen,
		notificationDetailId,
		openMemoryBrowser,
		openModelSelector,
		openPromptMap,
		openSettings,
		promptMapOpen,
		queueFollowUp,
		renderer,
		requestPauseSubagent,
		requestStopSubagent,
		restoreQueuedFollowUp,
		sessionSelectorOpen,
		setAllThinkingExpanded,
		setCommandSuggestionIndex,
		setCompactionExpanded,
		setExpandedToolIds,
		setExpandedTools,
		setInspectSubagent,
		setMcpView,
		setModelSelectorOpen,
		setPromptCursorOffset,
		setSelectedTargetKey,
		setSettingsRoute,
		setSidebarEnabled,
		setSubagentSelectorOpen,
		settingsRoute,
		skillSelectorOpen,
		streaming,
		subagentSelectorOpen,
		subagentsAvailable,
		syncMainDraft,
		tabManager,
		thinkingExpanded,
		toast,
		todoDetailId,
		updateScrollPosition,
		getPrompt: () => prompt,
		getScroll: () => scroll,
		getSubagentScroll: () => subagentScroll,
		logger: props.logger,
	});

	// The transcript selection snapshot is captured via attachTranscriptSelectionCache
	// above. The live selection is intentionally retained until Ctrl+C or Escape.

	const onPromptEditor = (value: TextareaRenderable) => {
		prompt = value;
		const valueText = currentDrafts().main;
		if (value.plainText !== valueText) value.setText(valueText);
		syncPromptPlaceholder(valueText);
	};
	const onPromptMouseDown = (event: MouseEvent) => {
		const blocks = currentDrafts().mainPastes;
		if (!blocks.length || !prompt) return;
		const localX = Math.floor(event.x - prompt.x);
		const localY = Math.floor(event.y - prompt.y);
		const viewport = prompt.editorView.getViewport();
		if (
			localX < 0 ||
			localY < 0 ||
			localX >= prompt.width ||
			localY >= prompt.height
		)
			return;
		// Mouse events report visual rows; getTextRangeByCoords expects logical
		// rows. Map through the editor view's per-visual-line source line and
		// wrap-start columns so clicks on wrapped lines resolve to the text
		// actually under the cursor (or fail closed).
		const visualRow = localY + Math.floor(viewport.offsetY);
		const lineInfo = prompt.editorView.getLineInfo();
		const logicalRow = lineInfo.lineSources[visualRow];
		if (logicalRow === undefined || logicalRow < 0) return;
		const column =
			localX +
			Math.floor(viewport.offsetX) +
			Math.floor(lineInfo.lineStartCols[visualRow] ?? 0);
		const line = prompt.getTextRangeByCoords(logicalRow, 0, logicalRow, 8192);
		if (!line) return;
		const block = blocks.find((entry) => {
			const start = line.indexOf(entry.token);
			return (
				start >= 0 && column >= start && column < start + entry.token.length
			);
		});
		if (!block) return;
		event.preventDefault();
		event.stopPropagation();
		expandCollapsedPromptPaste(block.id);
	};
	const onPromptContentChange = () => {
		if (draftSwitchGuard) return;
		const drafts = currentDrafts();
		const rawText = prompt?.plainText ?? "";
		const text = stripCollapsedPromptPasteFragments(rawText, drafts.mainPastes);
		if (prompt && text !== rawText) prompt.replaceText(text);
		drafts.main = text;
		syncPromptPlaceholder(text);
		drafts.mainPastes = prunePromptPasteBlocks(text, drafts.mainPastes);
		activeRuntime().promptHistory.noteEditorChange(text);
		setPromptText(text);
		setPromptCursorOffset(prompt?.cursorOffset ?? text.length);
		setCommandSuggestionIndex(0);
	};
	const onPromptCursorChange = () => {
		setPromptCursorOffset(prompt?.cursorOffset ?? 0);
	};

	const MainContents = () => (
		<AppMainContents
			{...{
				tabState,
				activateTab,
				closeTab,
				createTab,
				openForkPicker,
				inspectSubagent,
				selectedSubagentTarget,
				inspectedTarget,
				inspectedTranscript,
				clockNow,
				spinnerIndex,
				closeSubagentInspector,
				requestPauseSubagent,
				requestResumeSubagent,
				requestStopSubagent,
				setSubagentSelectorOpen,
				displaySubagentTargets,
				availableSubagentTargets,
				inspectSubagentTarget,
				currentDrafts,
				touch,
				sendSubagentSteer,
				pendingSteers,
				thinkingIsExpanded,
				toggleThinkingItem,
				toolExpanded,
				toggleTool,
				diffExpanded,
				toggleDiff,
				updateScrollPosition,
				focusMainPrompt,
				startupPhase,
				startupStartedAt,
				items,
				sessionDiscovery,
				dimensions,
				activeRuntime,
				setSessionSelectorOpen,
				switchToSession,
				hiddenMessageCount,
				loadOlderMessages,
				visibleMessageIds,
				spawnGroupMemberIds,
				spawnGroupByFirstId,
				visibleItems,
				renderItemEntry,
				compactionView,
				compactionExpanded,
				setCompactionExpanded,
				backgroundTasks,
				openBackgroundTask,
				showWorkingIndicator,
				showJumpLatest,
				scrollToBottom,
				queuedFollowUps,
				steeringQueue,
				followUpQueue,
				editQueuedFollowUp,
				commandSuggestions,
				commandSuggestionIndex,
				insertSuggestedCommand,
				streaming,
				dialog,
				backgroundSelection,
				modelSelectorOpen,
				sessionSelectorOpen,
				forkPickerOpen,
				promptMapOpen,
				subagentSelectorOpen,
				notificationDetailId,
				todoDetailId,
				promptValue,
				onPromptEditor,
				handlePromptPaste,
				handlePromptKeyDown,
				onPromptMouseDown,
				onPromptContentChange,
				onPromptCursorChange,
				submit,
				visibleSidebar,
				sessionState,
				sessionStats,
				lastRequestPerformance,
				requestTimingHistory,
				runs,
				subagentTools,
				contextWindowForModel,
				selectedTargetKey,
				setSelectedTargetKey,
				todos,
				openTodo,
				subagentsAvailable,
				todosAvailable,
				mcpStatus,
				mcpCounts,
				mcpConfiguredSummary,
				notificationHistory,
				openNotification,
				setInspectSubagent,
				footerStatusText,
				footerUsageSegments,
				footerHintText,
				toasts,
				setSubagentScroll: (value: ScrollBoxRenderable) => {
					subagentScroll = value;
				},
				getSubagentScroll: () => subagentScroll,
				setScroll: (value: ScrollBoxRenderable) => {
					scroll = value;
				},
			}}
		/>
	);

	const EvenTheme = () => <MainContents />;
	const OddTheme = () => <MainContents />;

	return (
		<>
			{createDynamic(
				() => (themeController.revision() % 2 === 0 ? EvenTheme : OddTheme),
				{},
			)}
			<AppDialogs
				core={{
					settingsRoute,
					setSettingsRoute,
					settingsDescriptors,
					settingsSelectedId,
					setSettingsSelectedId,
					closeSettings,
					mcpInstallState,
					mcpConfigState,
					mcpScope,
					mcpSnapshot,
					mcpPreview,
					mcpError,
					mcpView,
					setMcpView,
					installMcpAdapter,
					setMcpScope,
					openMcpSettings,
					prepareMcpMutation,
					deleteMcpServer,
					confirmMcpMutation,
					setMcpPreview,
					activateMcp,
					mcpBackend,
					enableBuiltinMcpInSettings,
					modelOptions,
					sessionState,
					readModelPerformanceHistory,
					requestTimingHistory,
					applySettingsModel,
					cswapSnapshot,
					claudeAccountChoice,
					claudeEffectiveSlot,
					chooseClaudeAccount,
					settingsBusy,
					settingsErrors,
					applySettingsThinking,
					themeConfig,
					applyThemePreset,
					applyThemeToken,
					resetTheme,
					streaming,
					openSessionSelector,
					applySettingsRename,
				}}
				extension={{
					settingsRoute,
					setSettingsRoute,
					settingsBusy,
					settingsErrors,
					setSettingsSelectedId,
					detailSettingSelectedId,
					setDetailSettingSelectedId,
					compactionSettingsRows,
					subagentListRows,
					selectedSubagentModelId,
					setSelectedSubagentModelId,
					subagentSettingsRows,
					modelOptions,
					compactionModelState,
					selectedSubagentModelEntry,
					requestTimingHistory,
					readModelPerformanceHistory,
					compactionModelContext,
					subagentModelContext,
					compactionThinkingLevels,
					subagentThinkingLevels,
					compactionThinkingContext,
					subagentThinkingContext,
					openCompactionSetting,
					openSubagentSettings,
					openSubagentSetting,
					subagentModelEntries,
					applyCompactionModel,
					applySubagentModel,
					applyCompactionThinking,
					applySubagentThinking,
				}}
				session={{
					sessionSelectorOpen,
					sessionDiscovery,
					sessionSwitching,
					streaming,
					pendingSessionReason,
					queuedCount: () => queuedFollowUps().length,
					pendingSession,
					switchToSession,
					setPendingSession,
					setPendingSessionReason,
					closeSessionSelector,
					discoverCurrentSessions,
					forkPickerOpen,
					forkPickerOptionsSignal,
					setForkPickerOpen,
					forkAt,
					modelSelectorOpen,
					modelOptions,
					sessionState,
					readModelPerformanceHistory,
					requestTimingHistory,
					modelListNotice,
					selectModel,
					closeModelSelector,
				}}
				utility={{
					backgroundSelection,
					selectedBackgroundTask,
					clockNow,
					backgroundOutput,
					backgroundOutputBusy,
					backgroundOutputError,
					showBackgroundOutputPage,
					analyzeBackgroundTask,
					closeBackgroundTask,
					notificationDetailId,
					notificationHistory,
					closeNotification,
					todoDetailId,
					todos,
					closeTodo,
					promptMapOpen,
					promptMapEntries,
					jumpToPrompt,
					closePromptMap,
					memoryBrowserOpen,
					memorySnapshot,
					removeMemory,
					closeMemoryBrowser,
					subagentSelectorOpen,
					availableSubagentTargets,
					selectedTargetKey,
					selectSubagentTarget,
					setSubagentSelectorOpen,
					skillSelectorOpen,
					commandChoices,
					setSkillSelectorOpen,
					syncMainDraft,
					focusMainPrompt,
					submit,
					dialog,
					completeDialog,
				}}
			/>
		</>
	);
}
