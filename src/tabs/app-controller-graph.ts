import type { CliRenderer } from "@opentui/core";
import type { Accessor } from "solid-js";
import type { AppOptions } from "../app.tsx";
import type { PiRpcClient } from "../rpc/pi-rpc-client.ts";
import type { AppSignals } from "../state/app-signals.ts";
import type { ConversationModel } from "../state/conversation.ts";
import { registerScreenKeyboard } from "../tabs/app-keyboard-wiring.ts";
import { registerAppLifecycleBoot } from "../tabs/app-lifecycle-boot.ts";
import { createAppSettingsCoordinator } from "../tabs/app-settings-coordinator.ts";
import { createAppTranscriptControls } from "../tabs/app-transcript-controls.ts";
import { createAppTranscriptScroll } from "../tabs/app-transcript-scroll.ts";
import { createAppUiActions } from "../tabs/app-ui-actions.ts";
import { createBackgroundActions } from "../tabs/background-actions.ts";
import { createInputActions } from "../tabs/input-actions.ts";
import { createModalNavigation } from "../tabs/modal-navigation.ts";
import { createRuntimeRefresh } from "../tabs/runtime-refresh.ts";
import type { AppScreenContext } from "../ui/app-screen-context.ts";
import {
	contextWindowForModel,
	createAppControllerRoot,
} from "./app-controller-root.ts";

const SESSION_LOAD_REQUEST_TIMEOUT_MS = 120_000;
export interface AppControllerGraphPorts {
	props: AppOptions;
	appSignals: AppSignals;
	renderer: CliRenderer;
	dimensions: Accessor<{ width: number; height: number }>;
	client: PiRpcClient;
	conversation: ConversationModel;
	claudeLaunchEnv: NodeJS.ProcessEnv | undefined;
}
export function createAppControllerGraph(
	ports: AppControllerGraphPorts,
): AppScreenContext {
	const { props, appSignals, renderer, dimensions } = ports;
	const root = createAppControllerRoot({
		...ports,
		closeBackgroundTask: () => closeBackgroundTask(),
		dropRefreshCoordinator: (id) => dropRefreshCoordinator(id),
		resetMessageWindow: (count) => resetMessageWindow(count),
		scrollToBottom: () => scrollToBottom(),
		syncMainDraft: (text) => syncMainDraft(text),
		refreshState: (runtime) => refreshState(runtime),
		flushQueuedFollowUp: (runtime) => flushQueuedFollowUp(runtime),
	});
	const {
		runtimeScope,
		sessionProjections,
		draftActions,
		conversationSelectors,
		inspectorProjection,
		state,
	} = root;
	const {
		activeRuntime,
		refreshCommandChoices,
		claudeEffectiveSlot,
		applyCswapUsage,
		selectedTargetKey,
		inspectSubagent,
		setExtensionStatus,
		setSelectedTargetKey,
		setInspectSubagent,
		handleExtensionRequest,
		forkAt,
		tabRuntimeIsActive,
		sessionController,
		bootRuntime,
		setExpandedToolIds,
		setExpandedDiffIds,
	} = runtimeScope;
	const {
		touch,
		conversationTouch,
		reconcileSteers,
		sessionState,
		runs,
		setRuns,
		rememberThinkingLevel,
		applyRememberedThinkingLevel,
	} = sessionProjections;
	const {
		currentDrafts,
		syncPromptPlaceholder,
		syncMainDraft,
		clearMainDraft,
		clearRuntimeMainDraftIfMatches,
		expandedPromptText,
		expandCollapsedPromptPaste,
	} = draftActions;
	const {
		items,
		visibleItems,
		promptMapEntries,
		subagentsAvailable,
		thinkingIsExpanded,
		setAllThinkingExpanded,
		toggleThinkingItem,
		streaming,
		lastCompactionCompletion,
	} = conversationSelectors;
	const {
		subagentTools,
		availableSubagentTargets,
		displaySubagentTargets,
		ownedVisibleSubagentTargets,
		selectedSubagentTarget,
	} = inspectorProjection;
	const {
		notificationHistory: [notificationHistory, setNotificationHistory],
		notificationDetailId: [notificationDetailId, setNotificationDetailId],
		backgroundSelection: [backgroundSelection, setBackgroundSelection],
		backgroundOutput: [backgroundOutput, setBackgroundOutput],
		backgroundOutputError: [backgroundOutputError, setBackgroundOutputError],
		backgroundOutputBusy: [backgroundOutputBusy, setBackgroundOutputBusy],
		todoDetailId: [todoDetailId, setTodoDetailId],
		status: [status, setStatus],
		startupPhase: [startupPhase, setStartupPhase],
		startupStartedAt,
		transcriptSelectionCache,
		queuedFollowUps,
		steeringQueue,
		followUpQueue,
		toasts: [toasts],
		toast,
	} = state;
	const clockNow = appSignals.clockNow[0],
		revision = appSignals.revision[0];
	const messageWindowStart = appSignals.messageWindowStart[0],
		setMessageWindowStart = appSignals.messageWindowStart[1];
	const setPromptMapOpen = appSignals.promptMapOpen[1],
		setModelSelectorOpen = appSignals.modelSelectorOpen[1];
	const dialog = appSignals.dialog[0],
		setDialog = appSignals.dialog[1];
	const dialogOwnerRuntimeId = appSignals.dialogOwnerRuntimeId[0],
		setDialogOwnerRuntimeId = appSignals.dialogOwnerRuntimeId[1];
	const settingsRoute = appSignals.settingsRoute[0],
		setSettingsRoute = appSignals.settingsRoute[1];
	const setMemoryBrowserOpen = appSignals.memoryBrowserOpen[1],
		memorySnapshot = appSignals.memorySnapshot[0],
		setMemorySnapshot = appSignals.memorySnapshot[1];
	const setRpcAvailable = appSignals.rpcAvailable[1];
	const extensionRouter = appSignals.extensionRouter,
		runtimeMap = appSignals.runtimeMap[0];
	const activeTabId = appSignals.activeTabId[0];
	const getPrompt = state.getPrompt,
		getScroll = state.getScroll,
		getSubagentScroll = state.getSubagentScroll;

	const refreshActions = createRuntimeRefresh({
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
	const { refreshSubagentRuns, refreshState, dropRefreshCoordinator } =
		refreshActions;
	const scrollActions = createAppTranscriptScroll({
		signals: appSignals,
		getScroll,
		getSubagentScroll,
		dimensions,
		inspectSubagent,
		activeRuntime,
		activeTabId,
		isRuntimeActive: tabRuntimeIsActive,
	});
	const {
		updateScrollPosition,
		captureThemeViewport,
		restoreThemeViewport,
		scrollToBottom,
		resetMessageWindow,
		trimMessageWindowIfFollowingLatest,
	} = scrollActions;
	const transcriptControls = createAppTranscriptControls({
		signals: appSignals,
		activeRuntime,
		revision,
		setExpandedToolIds,
		setExpandedDiffIds,
		setSelectedTargetKey,
		setInspectSubagent,
		availableSubagentTargets,
		getSubagentScroll,
		getPrompt,
		visibleItems,
		ownedVisibleSubagentTargets,
		lastCompactionCompletion,
		thinkingIsExpanded,
		toggleThinkingItem,
		streaming,
		forkAt,
		clockNow,
		viewportHeight: () => dimensions().height,
		isRuntimeActive: tabRuntimeIsActive,
		trimMessageWindowIfFollowingLatest,
		conversationTouch,
		scrollToBottom,
		syncMainDraft,
		refreshState,
		rememberThinkingLevel,
		toast,
		resetMessageWindow,
		sessionController,
		sessionLoadTimeoutMs: SESSION_LOAD_REQUEST_TIMEOUT_MS,
		openSessionSelector: () => openSessionSelector(),
		openSettings: () => openSettings(),
		openMemoryBrowser: () => openMemoryBrowser(),
		fetchAvailableModels: () => fetchAvailableModels(),
		refreshCommandChoices,
		applyRememberedThinkingLevel,
		setAllThinkingExpanded,
		promptMapEntries,
	});
	const { afterSessionLoaded, loadCurrentSession, handleSlashCommand } =
		transcriptControls;
	const inputActions = createInputActions({
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
		getPrompt,
		queuedFollowUps,
	});
	const { sendText, flushQueuedFollowUp } = inputActions;

	const backgroundActions = createBackgroundActions({
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
		focusMainPrompt: () => focusMainPrompt(),
		sendText: (text) => sendText(text),
		toast,
	});
	const { closeBackgroundTask } = backgroundActions;

	const settingsActions = createAppSettingsCoordinator({
		props,
		signals: appSignals,
		renderer,
		activeRuntime,
		toast,
		streaming: () => streaming(),
		loadCurrentSession,
		refreshCommandChoices,
		rememberThinkingLevel,
		applyRememberedThinkingLevel,
		refreshState,
		sessionState,
		captureThemeViewport,
		restoreThemeViewport,
		claudeEffectiveSlot,
		openMemoryBrowser: (fromSettings) => openMemoryBrowser(fromSettings),
		focusMainPrompt: () => focusMainPrompt(),
		sessionController,
		afterSessionLoaded,
		touch,
		setStatus: (text) => setStatus(text),
	});
	const {
		openSettings,
		fetchAvailableModels,
		discoverCurrentSessions,
		openSessionSelector,
	} = settingsActions;
	const modalActions = createModalNavigation({
		cwd: props.cwd,
		memoryInstalled: props.integrations.memory.installed,
		setPromptMapOpen,
		promptMapEntries,
		toast,
		setModelSelectorOpen,
		items,
		messageWindowStart,
		setMessageWindowStart,
		getPrompt,
		getScroll,
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
	const { openMemoryBrowser } = modalActions;

	registerAppLifecycleBoot({
		props,
		signals: appSignals,
		bootRuntime,
		startupPhase,
		setStartupPhase,
		setStatus,
		setExtensionStatus,
		isRuntimeActive: tabRuntimeIsActive,
		resetMessageWindow,
		rememberThinkingLevel,
		fetchAvailableModels,
		touch,
		conversationTouch: () => conversationTouch(),
		getScroll,
		getPrompt,
		openSessionSelector,
		discoverCurrentSessions,
		refreshState,
		toast,
		applyCswapUsage,
		claudeEffectiveSlot,
		refreshSubagentRuns,
		sessionState,
		status,
		streaming,
		activeRuntime,
		runs,
		availableSubagentTargets,
	});

	const uiActions = createAppUiActions({
		signals: appSignals,
		renderer,
		logger: props.logger,
		transcriptSelectionCache,
		getPrompt,
		setPrompt: state.setPrompt,
		getSubagentScroll,
		startupPhase,
		backgroundSelection,
		notificationDetailId,
		todoDetailId,
		setNotificationHistory,
		setNotificationDetailId,
		setTodoDetailId,
		inspectSubagent,
		selectedTargetKey,
		setSelectedTargetKey,
		setInspectSubagent,
		displaySubagentTargets,
		selectedSubagentTarget,
		subagentsAvailable,
		activeRuntime,
		currentDrafts,
		syncPromptPlaceholder,
		expandCollapsedPromptPaste,
		isDraftSwitchGuard: state.draftSwitchGuard,
		touch,
		toast,
	});
	const {
		focusMainPrompt,
		openNotification,
		closeNotification,
		openTodo,
		closeTodo,
		closeSubagentInspector,
		selectSubagentTarget,
		onPromptEditor,
		onPromptMouseDown,
		onPromptContentChange,
		onPromptCursorChange,
	} = uiActions;

	const screenPorts: AppScreenContext = {
		signals: appSignals,
		runtime: runtimeScope,
		session: sessionProjections,
		scroll: scrollActions,
		transcript: transcriptControls,
		selectors: conversationSelectors,
		inspector: inspectorProjection,
		draft: draftActions,
		input: inputActions,
		background: backgroundActions,
		settings: settingsActions,
		modal: modalActions,
		subagent: uiActions,
		extras: {
			dimensions,
			startupPhase,
			startupStartedAt,
			backgroundSelection,
			backgroundOutput,
			backgroundOutputBusy,
			backgroundOutputError,
			notificationHistory,
			notificationDetailId,
			todoDetailId,
			toasts,
			queuedFollowUps,
			steeringQueue,
			followUpQueue,
			contextWindowForModel,
			closeSubagentInspector,
			selectSubagentTarget,
			focusMainPrompt,
			openNotification,
			closeNotification,
			openTodo,
			closeTodo,
			onPromptEditor,
			onPromptMouseDown,
			onPromptContentChange,
			onPromptCursorChange,
			getPrompt,
			getScroll,
			toast,
			getSubagentScroll,
			setSubagentScroll: state.setSubagentScroll,
			setScroll: state.setScroll,
		},
	};
	registerScreenKeyboard(screenPorts, renderer, props.logger);

	// The transcript selection snapshot is captured via attachTranscriptSelectionCache
	// above. The live selection is intentionally retained until Ctrl+C or Escape.

	return screenPorts;
}
