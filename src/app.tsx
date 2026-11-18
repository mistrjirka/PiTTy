import { createSettingsMutations, type ThemeViewportSnapshot } from "./tabs/settings-mutations.ts";
import { createExtensionModelActions } from "./tabs/extension-model-actions.ts";
import { createSessionPickerActions } from "./tabs/session-picker-actions.ts";
import { createMcpActions, mcpInstallStateFor } from "./tabs/mcp-controller.ts";
import { startInitialSession } from "./tabs/initial-session.ts";
import { startUiMonitoring } from "./tabs/ui-monitoring.ts";
import { startUsagePolling } from "./tabs/usage-polling.ts";
export { streamingCtrlCDecision } from "./ui/app-navigation.ts";
import { registerAppKeyboard } from "./tabs/app-keyboard.ts";
import { TranscriptPane } from "./ui/transcript-pane.tsx";
import { PromptComposer } from "./ui/prompt-composer.tsx";
import { AppFooter, ToastOverlay } from "./ui/app-footer.tsx";
import { buildSettingsDescriptors } from "./ui/settings-descriptors.ts";
import { type SettingsRoute, settingsBackRoute } from "./ui/app-navigation.ts";
export {
  settingsBackRoute,
  subagentNavigationAction,
  subagentInspectDecision,
  nextDetailToggle,
  isUnmodifiedEnterKey,
} from "./ui/app-navigation.ts";
export type {
  SettingsRoute, DetailToggleState, SubagentInspectDecision,
  SubagentNavigationAction, SubagentKeyModifiers,
} from "./ui/app-navigation.ts";
import { footerHintTiers, selectFooterHint } from "./ui/footer-hints.ts";
export { footerHintTiers, globalFooterHint, selectFooterHint } from "./ui/footer-hints.ts";
import { subagentLogSummary } from "./subagents/log-summary.ts";
import { appendNotificationHistory } from "./state/notification-history.ts";
export { appendNotificationHistory } from "./state/notification-history.ts";
import { attachTranscriptSelectionCache } from "./ui/transcript-selection-cache.ts";
export { attachTranscriptSelectionCache } from "./ui/transcript-selection-cache.ts";
export type { TranscriptSelectionCache } from "./ui/transcript-selection-cache.ts";

import { type KeyEvent, type MouseEvent, type PasteEvent, type ScrollBoxRenderable, type TextareaRenderable, type Renderable } from "@opentui/core";
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { createDynamic, useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { RpcExtensionUIRequest, PiEvent, RpcSessionState, SubagentRun, ToolItem, Toast, NotificationRecord, ConversationItem } from "./types.ts";
import type { DiagnosticLogger } from "./diagnostics/logger.ts";

import { PiRpcClient, PiRpcTimeoutError } from "./rpc/pi-rpc-client.ts";
import { ConversationModel } from "./state/conversation.ts";
import { compactionCompletionForItem } from "./state/compaction-telemetry.ts";


import { createPromptPasteBlock, expandPromptPasteTokens, insertPromptPasteBlock, promptPasteDeletionRange, promptPasteRange, prunePromptPasteBlocks, shouldCollapsePromptPaste, stripCollapsedPromptPasteFragments } from "./state/paste-blocks.ts";
import { clearTargetDraft, queuedPromptMatchesDraft, reconcilePendingSteers, sessionDrafts, type PendingSteerEntry } from "./state/input-continuity.ts";
import { createSingleFlight, type StartupPhase, type SingleFlight } from "./state/startup.ts";
import { listSubagentRuns } from "./subagents/artifacts.ts";
import { mergeMissionRuns } from "./subagents/missions.ts";

import { createSubagentControlActions } from "./subagents/action-controller.ts";
import { createSubagentTranscriptCache } from "./subagents/transcript-cache.ts";

import { ExtensionDialog } from "./ui/dialog.tsx";
import { MessageView } from "./ui/message.tsx";
import { CompactionController } from "./tabs/compaction-controller.ts";
import { SessionController } from "./tabs/session-controller.ts";
import { InputController } from "./tabs/input-controller.ts";
import { SlashCommandController, isThinkingLevel } from "./tabs/slash-commands.ts";
import { CommandCatalogService, localCommandChoices } from "./tabs/command-catalog.ts";
import { ExtensionStatusController } from "./tabs/extension-status-controller.ts";
import { CompactedSummary } from "./ui/compaction-panel.tsx";
import { TabManager, type ConversationTab } from "./tabs/manager.ts";
import { blankTabPiArgs, createTabRuntime, planForkTab, prepareForkedTabRuntime, provisionalExtensionUiResponse, resolveTabDraftSwitch, startTabRuntime, type ConversationTabRuntime } from "./tabs/runtime.ts";
import { readModelPerformanceHistory } from "./tabs/model-performance-history.ts";
import { ExtensionRequestRouter, type ExtensionRequestEnvelope } from "./tabs/extension-router.ts";
import { TabStrip } from "./ui/tab-strip.tsx";
import { ForkPicker } from "./ui/fork-picker.tsx";
import { alignLatestUserEntryIds, forkPickerOptions, type ForkPickerOption } from "./tabs/entry-index.ts";
import { PendingInputPanel } from "./ui/pending-input-panel.tsx";
import { ModelSelectorDialog, normalizeModelChoices, type ModelChoice } from "./ui/model-selector.tsx";
import { SessionSelector } from "./ui/session-selector.tsx";
import { SkillSelector } from "./ui/skill-selector.tsx";

let availableModelsCache: ModelChoice[] | undefined;
let availableModelsFetch: Promise<ModelChoice[]> | undefined;

import { SettingsHub } from "./ui/settings-hub.tsx";
import { ThemePresetBrowser, ThemeTokenEditor } from "./ui/theme-settings.tsx";
import { type ThemeConfigDocument } from "./config/theme-config.ts";
import { loadNativeMcpSummary, type McpConfigBackend, type McpConfigSnapshot, type McpConfiguredSummary, type McpPreview, type McpScope } from "./config/mcp-config.ts";
import { McpSettings, type McpConfigState, type McpInstallState, type McpSettingsView } from "./ui/mcp-settings.tsx";
import { createThemeController, type ThemeController } from "./ui/theme.ts";


import { ThinkingSelector, THINKING_LEVELS, visibleThinkingLevels, type ThinkingLevelMap } from "./ui/thinking-selector.tsx";
import { SessionSettings, SessionRename } from "./ui/session-settings.tsx";
import { parseModelRef, type CompactionModelState, type SubagentModelEntry } from "./config/extension-models.ts";
import { ExtensionSettingsList } from "./ui/extension-settings.tsx";



import { type SessionChoice, type SessionDiscoveryState } from "./sessions.ts";
import { PromptMapDialog, type PromptMapEntry } from "./ui/prompt-map.tsx";
import { MemoryBrowserDialog } from "./ui/memory-browser.tsx";
import { loadMemorySnapshot, removeMemoryEntry, type MemoryEntry, type MemorySnapshot } from "./integrations/memory-store.ts";
import { Sidebar } from "./ui/sidebar.tsx";
import { BackgroundTaskDialog } from "./ui/background-task-dialog.tsx";
import { readBackgroundOutput, type BackgroundOutputPage } from "./state/background-tasks.ts";
import { cleanInline, clip } from "./ui/model-context.tsx";
import { NotificationDialog } from "./ui/notification-dialog.tsx";
import { SubagentInspector, inspectedTargetScrollY } from "./ui/subagent-inspector.tsx";
import { spinnerFrames } from "./ui/spinner.ts";
import { resolveLiveChildTranscriptPath } from "./subagents/artifacts.ts";
import { SubagentSelectorDialog } from "./ui/subagent-selector.tsx";
import { ownedSubagentTargetsForItems, reconcileSubagentSelection, subagentTargets, type SubagentTarget } from "./subagents/targets.ts";
import { subagentTreeRows } from "./subagents/tree.ts";
import { colors } from "./ui/theme.ts";
import { computeSpawnGroups, type SpawnGroup } from "./ui/spawn-group.tsx";
import { CommandSuggestions, filterCommandChoices, type CommandChoice } from "./ui/command-suggestions.tsx";
import { deriveTodos, type TodoViewItem } from "./ui/todos.tsx";
import { TodoDialog } from "./ui/todo-dialog.tsx";
import { preserveEquivalentTodos, preserveReferencedList } from "./ui/list-stability.ts";
import { type OptionalIntegrationStatus } from "./integrations/detect.ts";
import { type CodexUsage } from "./integrations/codex-usage.ts";
import { type OpencodeUsage } from "./integrations/opencode-usage.ts";
import { type ClaudeUsage } from "./integrations/doppelclaude-usage.ts";
import { USAGE_FOOTER_SEPARATOR, usageFooterSegments, usageFooterWidth } from "./ui/usage-footer.ts";
import { type UsageStats } from "./integrations/codex-usage-history.ts";
import os from "node:os";
import { resolveCswapSlot, type CswapSnapshot, type ClaudeAccountChoice } from "./integrations/claude-swap.ts";
import { readClaudeAccountPreference, resolveClaudeLaunchConfig, saveClaudeAccountPreference } from "./config/claude-account.ts";
import { ClaudeAccountSelector } from "./ui/claude-account-selector.tsx";


import { INITIAL_MESSAGE_WINDOW, MAX_LIVE_MESSAGE_WINDOW, MESSAGE_LOAD_BATCH, clampMessageWindowStart, initialMessageWindowStart, loadOlderMessageWindowStart, trimMessageWindowStart } from "./ui/message-window.ts";


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


function contextWindowForModel(modelName: string | undefined): number | undefined {
	if (!modelName || !availableModelsCache) return undefined;
	const exact = availableModelsCache.find((model) => `${model.provider}/${model.id}` === modelName);
	if (exact) return exact.contextWindow;
	return availableModelsCache.find((model) => model.id === modelName)?.contextWindow;
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
	if (initialClaudeLaunch.error) throw new Error(`Cannot start Pi with selected cswap account: ${initialClaudeLaunch.error}`);
	const claudeLaunchEnv = initialClaudeLaunch.configDir ? { CLAUDE_CONFIG_DIR: initialClaudeLaunch.configDir } : undefined;
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
	const [revision, setRevision] = createSignal(0);
	const [conversationRevision, setConversationRevision] = createSignal(0);
	const [conversationStructureRevision, setConversationStructureRevision] = createSignal(0);
	const [compactionRevision, setCompactionRevision] = createSignal(0);
	const [messageWindowStart, setMessageWindowStart] = createSignal(0);

	const [sidebarEnabled, setSidebarEnabled] = createSignal(props.sidebar);
	const [expandedTools, setExpandedTools] = createSignal(false);
	const [showJumpLatest, setShowJumpLatest] = createSignal(false);
	const queuedFollowUps = () => {
		revision();
		return activeRuntime().queuedFollowUps;
	};
	const [pendingSteers, setPendingSteers] = createSignal<PendingSteerEntry[]>(
		[],
	);
	const [autoRetryEnabled, setAutoRetryEnabled] = createSignal(true);
	const [spinnerIndex, setSpinnerIndex] = createSignal(0);
	const [clockNow, setClockNow] = createSignal(Date.now());
	const [codexUsage, setCodexUsage] = createSignal<CodexUsage>();
	const [codexUsageStats, setCodexUsageStats] = createSignal<
		Record<number, UsageStats>
	>({});
	const [claudeUsage, setClaudeUsage] = createSignal<ClaudeUsage>();
	const [cswapSnapshot, setCswapSnapshot] = createSignal<CswapSnapshot>();
	const [claudeAccountChoice, setClaudeAccountChoice] = createSignal<ClaudeAccountChoice>(readClaudeAccountPreference());
	const [claudeHint, setClaudeHint] = createSignal<string>();
	const [opencodeUsage, setOpencodeUsage] = createSignal<OpencodeUsage>();
	const [opencodeUsageStats, setOpencodeUsageStats] = createSignal<
		Record<number, UsageStats>
	>({});

	const [subagentSelectorOpen, setSubagentSelectorOpen] = createSignal(false);
	const [dialog, setDialog] = createSignal<RpcExtensionUIRequest>();
	const [dialogOwnerRuntimeId, setDialogOwnerRuntimeId] = createSignal<string>();
	const [modelSelectorOpen, setModelSelectorOpen] = createSignal(false);
	const [modelOptions, setModelOptions] = createSignal<ModelChoice[]>([]);
	const [modelListNotice, setModelListNotice] = createSignal<string>();
	const [modelSelectorLoading, setModelSelectorLoading] = createSignal(false);
	const [sessionSelectorOpen, setSessionSelectorOpen] = createSignal(false);
	const [skillSelectorOpen, setSkillSelectorOpen] = createSignal(false);
	const [forkPickerOpen, setForkPickerOpen] = createSignal(false);
	const [forkPickerOptionsSignal, setForkPickerOptions] = createSignal<ForkPickerOption[]>([]);
	let draftSwitchGuard = false;
	const [compactionSummaryExpanded, setCompactionSummaryExpanded] = createSignal(false);
	const [settingsRoute, setSettingsRoute] =
		createSignal<SettingsRoute>("closed");
	const [mcpScope, setMcpScope] = createSignal<McpScope>("global");
	const [mcpView, setMcpView] = createSignal<McpSettingsView>("list");
	const [mcpSnapshot, setMcpSnapshot] = createSignal<McpConfigSnapshot>();
	const [mcpPreview, setMcpPreview] = createSignal<McpPreview>();
	const [mcpError, setMcpError] = createSignal<string>();
	const [mcpInstallState, setMcpInstallState] = createSignal<McpInstallState>(
		mcpInstallStateFor(props.integrations),
	);
	const [nativeMcpSummary, setNativeMcpSummary] = createSignal<
		McpConfiguredSummary | undefined
	>(
		props.integrations.mcpBuiltin.supported &&
			!props.integrations.mcpAdapter.installed
			? loadNativeMcpSummary(props.cwd)
			: undefined,
	);
	const mcpBackend = (): McpConfigBackend =>
		mcpInstallState() === "native" || mcpInstallState() === "native-disabled"
			? "native"
			: "adapter";
	const mcpConfiguredSummary = () =>
		mcpInstallState() === "native" ? nativeMcpSummary() : undefined;
	const [mcpConfigState, setMcpConfigState] =
		createSignal<McpConfigState>("empty");
	const [_mcpActivationPending, setMcpActivationPending] = createSignal(false);
	const [settingsSelectedId, setSettingsSelectedId] = createSignal("model");
	const [rpcAvailable, setRpcAvailable] = createSignal(false);
	const [settingsBusy, setSettingsBusy] = createSignal<
		"model" | "thinking" | "rename" | "theme" | "compaction" | "subagents"
	>();
	const [settingsErrors, setSettingsErrors] = createSignal<
		Partial<
			Record<
				"model" | "thinking" | "rename" | "theme" | "compaction" | "subagents",
				string
			>
		>
	>({});
	const [compactionModelState, setCompactionModelState] =
		createSignal<CompactionModelState>();
	const [subagentModelEntries, setSubagentModelEntries] = createSignal<
		SubagentModelEntry[]
	>([]);
	const [selectedSubagentModelId, setSelectedSubagentModelId] =
		createSignal("defaults");
	const [detailSettingSelectedId, setDetailSettingSelectedId] =
		createSignal("model");
	const [themeConfig, setThemeConfig] = createSignal<ThemeConfigDocument>(
		props.themeConfig ?? {
			version: 1,
			theme: { preset: "PiTTy Midnight", overrides: {} },
		},
	);
	const themeController = props.themeController ?? createThemeController();
	let settingsOrigin: Renderable | null = null;
	const [sessionDiscovery, setSessionDiscovery] =
		createSignal<SessionDiscoveryState>({ kind: "loading" });
	const [sessionSwitching, setSessionSwitching] = createSignal(false);
	const [pendingSession, setPendingSession] = createSignal<SessionChoice>();
	const [pendingSessionReason, setPendingSessionReason] = createSignal<
		"streaming" | "queued"
	>();
	const [promptMapOpen, setPromptMapOpen] = createSignal(false);
	const [memoryBrowserOpen, setMemoryBrowserOpen] = createSignal(false);
	const [memorySnapshot, setMemorySnapshot] = createSignal<MemorySnapshot>();
	const [thinkingExpanded, setThinkingExpanded] = createSignal(true);
	const [compactionExpanded, setCompactionExpanded] = createSignal(false);
	const [promptText, setPromptText] = createSignal("");
	const [promptCursorOffset, setPromptCursorOffset] = createSignal(0);
	const commandCatalog = new CommandCatalogService(30_000, (error) => props.logger.warn("ui.commands_sync_failed", error));
	const [commandChoices, setCommandChoices] =
		createSignal<CommandChoice[]>(localCommandChoices);
	const [commandSuggestionIndex, setCommandSuggestionIndex] = createSignal(0);
	const [toasts, setToasts] = createSignal<Toast[]>([]);
	const initialTab: ConversationTab = { id: "main", badges: 0 };
	const tabManager = new TabManager(initialTab);
	const [tabState, setTabState] = createSignal(tabManager.snapshot);
	const [activeTabId, setActiveTabId] = createSignal(tabManager.snapshot.activeId);
	const [runtimeMap, setRuntimeMap] = createSignal<Map<string, ConversationTabRuntime>>(new Map());
	const extensionRouter = new ExtensionRequestRouter();
	const provisionalRuntimes = new Set<ConversationTabRuntime>();
	const activeRuntime = () => runtimeMap().get(activeTabId()) ?? bootRuntime;
	const refreshCommandChoices = async (
		runtime: ConversationTabRuntime,
		force = false,
		now = Date.now(),
	): Promise<CommandChoice[]> => {
		const choices = await commandCatalog.refresh(runtime.client, { force, now });
		// In-flight tab switches must not replace the active tab's command list.
		if (activeRuntime().client === runtime.client) setCommandChoices(choices);
		return choices;
	};
	const claudeEffectiveSlot = () => {
		const snapshot = cswapSnapshot();
		return snapshot ? resolveCswapSlot(claudeAccountChoice(), snapshot, activeRuntime().client.getClaudeConfigDir(), os.homedir()) : undefined;
	};
	const applyCswapUsage = (snapshot: CswapSnapshot): void => {
		const slot = claudeEffectiveSlot();
		const account = snapshot.accounts.find((item) => item.number === slot);
		if (account?.usage) {
			setClaudeUsage(account.usage);
			setClaudeHint(undefined);
		} else if (account?.lastGood) {
			// cswap keeps the last fetched usage when the account needs a
			// relogin; show it marked stale instead of claiming expiry. The
			// model itself can still work through Pi's own credentials.
			setClaudeUsage({ ...account.lastGood.usage, staleAgeSeconds: account.lastGood.ageSeconds });
			setClaudeHint(undefined);
		} else {
			setClaudeUsage(undefined);
			setClaudeHint(account ? "usage unavailable" : undefined);
		}
	};
	const chooseClaudeAccount = (choice: ClaudeAccountChoice) => {
		try {
			const resolved = resolveClaudeLaunchConfig(choice);
			if (resolved.error) {
				toast(resolved.error, "warning", 8000);
				return;
			}
			saveClaudeAccountPreference(choice);
			setClaudeAccountChoice(choice);
			const snapshot = cswapSnapshot();
			if (snapshot) applyCswapUsage(snapshot);
			setSettingsRoute("root");
			toast("Claude account selected. New Pi tabs use it; restart PiTTY to change the current session.", "info", 7000);
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), "error");
		}
	};
	const selectedTargetKey = () => { revision(); return activeRuntime().selectedTargetKey; };
	const inspectSubagent = () => { revision(); return activeRuntime().inspectSubagent; };
	const forkingConversation = () => { revision(); return activeRuntime().forkInProgress; };
	const displayStatus = () => {
		if (forkingConversation()) return "forking conversation…";
		const current = status();
		if (current !== "forking conversation…") return current;
		return streaming() ? "working" : "ready";
	};
	// Extension and stderr status text is untrusted: adapters style it with
	// ANSI colors and some extensions send multi-line payloads. The footer is
	// a single row, so clean it before display (and before width math).
	const sanitizeStatusText = (value: string): string =>
		clip(cleanInline(value), 80);
	const setExtensionStatus = (value: string): void => {
		const clean = sanitizeStatusText(value);
		if (clean) setStatus(clean);
	};
	// Re-select the monitored account immediately when the active Pi tab changes.
	createEffect(() => {
		activeTabId();
		claudeAccountChoice();
		const snapshot = cswapSnapshot();
		if (snapshot) applyCswapUsage(snapshot);
	});
	const footerStatusText = () =>
		`● ${displayStatus()}${activeRuntime().smartCompactProgress ? ` · ${activeRuntime().smartCompactProgress}` : ""}`;
	const footerMinHintLength = () =>
		footerHintTiers(inspectSubagent(), availableSubagentTargets().length)[0]!
			.length;
	const footerHintText = () =>
		selectFooterHint(
			dimensions().width,
			footerStatusText().length,
			usageFooterWidth(footerUsageSegments()),
			inspectSubagent(),
			availableSubagentTargets().length,
		);
	const footerUsageSegments = () =>
		usageFooterSegments({
			claudeUsage: claudeUsage(),
			claudeAccountLabel: cswapSnapshot()?.accounts.find((a) => a.number === claudeEffectiveSlot())?.label,
			claudeHint: claudeHint(),
			codexUsage: codexUsage(),
			codexUsageStats: codexUsageStats(),
			opencodeUsage: opencodeUsage(),
			opencodeUsageStats: opencodeUsageStats(),
			now: clockNow(),
			// row padding (2) + leading separator (3) + two-column gap before the hint.
			// Budget against the shortest hints so usage wins over verbosity;
			// the hint picker then upgrades verbosity with whatever is left.
			width: Math.max(
				0,
				dimensions().width -
					2 -
					footerStatusText().length -
					footerMinHintLength() -
					USAGE_FOOTER_SEPARATOR.length -
					2,
			),
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
	const refreshTabs = () => setTabState(tabManager.snapshot);
	const finishExtensionRequest = (envelope: ExtensionRequestEnvelope): void => {
		const next = extensionRouter.complete(envelope.runtimeId, envelope.request.id);
		if (next && tabRuntimeIsActive(envelope.runtimeId)) handleExtensionRequest(next);
	};

	const handleExtensionRequest = (envelope: ExtensionRequestEnvelope): void => {
		const runtime = runtimeMap().get(envelope.runtimeId);
		if (!runtime || activeTabId() !== envelope.runtimeId) return;
		const event = envelope.request;
		if (event.method === "notify") {
			toast(event.message, event.notifyType === "error" ? "error" : event.notifyType === "warning" ? "warning" : "info");
			finishExtensionRequest(envelope);
			return;
		}
		if (event.method === "setStatus") {
			if (event.statusText) setExtensionStatus(event.statusText);
			finishExtensionRequest(envelope);
			return;
		}
		if (event.method === "setTitle") {
			renderer.setTerminalTitle(event.title);
			finishExtensionRequest(envelope);
			return;
		}
		if (event.method === "set_editor_text") {
			syncMainDraft(event.text);
			finishExtensionRequest(envelope);
			return;
		}
		if (event.method === "setWidget") {
			finishExtensionRequest(envelope);
			return;
		}
		setModelSelectorOpen(false);
		setPromptMapOpen(false);
		setDialogOwnerRuntimeId(envelope.runtimeId);
		setDialog(event);
	};
	const notifyCompactionChange = (tabRuntime: ConversationTabRuntime): void => {
		if (tabRuntime.id === activeTabId()) setCompactionRevision((value) => value + 1);
		tabRuntime.onConversationChange();
	};
	const compactionController = new CompactionController(notifyCompactionChange, props.logger);
	const extensionStatusController = new ExtensionStatusController((runtime) => {
		if (runtime.id === activeTabId()) touch();
	});
	const routeRuntimeEvent = (event: PiEvent, tabRuntime: ConversationTabRuntime): void => {
		compactionController.handleStart(event, tabRuntime);
		if (isExtensionUiRequest(event)) {
			if (compactionController.handleStatus(event, tabRuntime)) return;
			if (extensionStatusController.handle(event, tabRuntime)) return;
			const envelope = extensionRouter.enqueue(tabRuntime.id, event);
			if (tabRuntime.id !== activeTabId()) {
				tabManager.incrementBadge(tabRuntime.id, "extension");
				refreshTabs();
			} else if (envelope) handleExtensionRequest(envelope);
			return;
		}
		compactionController.handleEnd(event, tabRuntime);
		if (
			tabRuntime.id === activeTabId() &&
			(event.type === "message_end" || event.type === "agent_settled")
		)
			touch();
		if (tabRuntime.id === activeTabId() && event.type === "agent_start")
			setStatus("working");
		if (tabRuntime.id === activeTabId() && event.type === "agent_settled")
			setStatus("ready");
		if (event.type === "agent_settled" || event.type === "compaction_end")
			void flushQueuedFollowUp(tabRuntime);
	};

	const activateTab = (id: string) => {
		const targetRuntime = runtimeMap().get(id);
		if (!targetRuntime) return;
		const targetText = sessionDrafts(targetRuntime.drafts, targetRuntime.sessionState?.sessionId ?? props.cwd).main;
		if (backgroundSelection()?.runtimeId !== id) closeBackgroundTask();
		if (dialogOwnerRuntimeId() && dialogOwnerRuntimeId() !== id) {
			setDialog(undefined);
			setDialogOwnerRuntimeId(undefined);
		}
		tabManager.activate(id);
		setActiveTabId(id);
		setCommandChoices(commandCatalog.snapshot(targetRuntime.client));
		if (targetRuntime.startupResolved) void refreshCommandChoices(targetRuntime);
		tabManager.clearBadges(id);
		refreshTabs();
		const nextExtension = extensionRouter.setActive(id);
		if (nextExtension) handleExtensionRequest(nextExtension);
		resetMessageWindow(targetRuntime.conversation.items.length);
		queueMicrotask(() => queueMicrotask(() => {
			if (targetRuntime.inspectSubagent) subagentScroll?.scrollTo(inspectedTargetScrollY(selectedSubagentTarget()));
			else scrollToBottom();
		}));
		draftSwitchGuard = true;
		const draft = resolveTabDraftSwitch(prompt?.plainText ?? "", targetText);
		if (prompt) {
			prompt.setText(draft.editorText);
			prompt.cursorOffset = draft.editorText.length;
		}
		syncMainDraft(draft.editorText);
		queueMicrotask(() => { draftSwitchGuard = false; });
		if (targetRuntime.startupResolved) {
			if (targetRuntime.conversation.items.length === 0) void loadRuntimeHistory(targetRuntime);
			void refreshState(targetRuntime).then(() => {
				void flushQueuedFollowUp(targetRuntime);
			});
		}
	};
	const closeTab = (id: string) => {
		const runtime = runtimeMap().get(id);
		if (!runtime || !tabManager.canClose(id)) return;
		const wasActive = activeTabId() === id;
		if (dialogOwnerRuntimeId() === id) {
			setDialog(undefined);
			setDialogOwnerRuntimeId(undefined);
		}
		extensionRouter.remove(id);
		refreshCoordinators.delete(id);
		runtime.messageUpdates.dispose();
		runtime.coalescer.flush();
		void runtime.client.stop();
		setRuntimeMap((current) => { const next = new Map(current); next.delete(id); return next; });
		tabManager.close(id);
		if (wasActive) activateTab(tabManager.snapshot.activeId);
		else refreshTabs();
	};
	const createTab = (sessionFile?: string): string | undefined => {
		const id = `tab-${++tabCounter}`;
		if (!tabManager.create({ id, badges: 0 })) { toast("Maximum of 8 conversation tabs.", "warning"); return undefined; }
		const runtime = createTabRuntime({ id, cwd: props.cwd, args: sessionFile ? props.piArgs : blankTabPiArgs(props.piArgs), ...(props.piExecutable ? { executable: props.piExecutable } : {}), ...(sessionFile ? { sessionFile } : {}), logger: props.logger, ...(claudeLaunchEnv ? { env: claudeLaunchEnv } : {}),
			onCacheWarning: notifyCacheWarning,
			onEvent: routeRuntimeEvent,
			onConversationChange: (tabRuntime, reason) => { if (tabRuntime.id === activeTabId()) conversationTouch(reason); },
		});
		setRuntimeMap((current) => new Map(current).set(id, runtime));
		activateTab(id);
		void startTabRuntime(runtime).then(async () => {
			runtime.startupResolved = false;
			await loadRuntimeHistory(runtime);
			runtime.startupResolved = true;
			void refreshCommandChoices(runtime);
			if (tabRuntimeIsActive(id)) {
				touch();
				await refreshState(runtime);
			}
		}).catch((error) => toast(error instanceof Error ? error.message : String(error), "error", 5000));
		return id;
	};
	const forkAt = async (entryId: string, userItem?: ConversationItem | undefined) => {
		const sourceRuntime = activeRuntime();
		const originalSessionFile = sourceRuntime.sessionState?.sessionFile;
		if (!originalSessionFile) { toast("The current session file is not available yet.", "warning"); return; }
		// The row button's entry id is text-aligned and can drift after compaction
		// or with duplicated prompts. Re-resolve the clicked visible message
		// against Pi's current forkable list, newest-first, before forking.
		let forkEntryId = entryId;
		if (userItem?.kind === "user") {
			try {
				const messages = await sourceRuntime.client.getForkMessages();
				const userItems = sourceRuntime.conversation.items.filter((item) => item.kind === "user");
				const userIndex = userItems.findIndex((item) => item.id === userItem.id);
				if (userIndex >= 0)
					forkEntryId = alignLatestUserEntryIds(userItems, messages)[userIndex] ?? entryId;
			} catch (error) {
				props.logger?.warn("tabs.fork_resolution_failed", error);
			}
		}
		if (!originalSessionFile) { toast("The current session file is not available yet.", "warning"); return; }
		const plan = planForkTab(originalSessionFile, "", tabState().tabs.length);
		if (!plan.canCreate || sourceRuntime.forkInProgress) {
			toast(plan.canCreate ? "A fork is already being prepared." : "Maximum of 8 conversation tabs.", "warning");
			return;
		}
		sourceRuntime.forkInProgress = true;
		touch();
		setStatus("forking conversation…");
		const provisionalId = `fork-${++tabCounter}`;
		const provisional = createTabRuntime({ id: provisionalId, cwd: props.cwd, args: props.piArgs, ...(props.piExecutable ? { executable: props.piExecutable } : {}), sessionFile: originalSessionFile, logger: props.logger, ...(claudeLaunchEnv ? { env: claudeLaunchEnv } : {}),
			onCacheWarning: (warning, runtime) => {
				props.logger.warn("cache.large_rewrite", { runtimeId: runtime.id, ...warning });
				if (runtime.id === activeTabId())
					toast(`Possible Claude cache rebuild: ${Math.round(warning.currentWrite / 1000)}k tokens rewritten (was ${Math.round(warning.previousRead / 1000)}k cached)`, "warning", 8500);
			},
			onEvent: (event, runtime) => {
				if (runtimeMap().has(runtime.id)) {
					routeRuntimeEvent(event, runtime);
					return;
				}
				if (isExtensionUiRequest(event))
					void runtime.client.sendExtensionUiResponse(provisionalExtensionUiResponse(event)).catch((cancelError) => props.logger.warn("tabs.provisional_extension_response_failed", cancelError));
			},
			onConversationChange: (tabRuntime, reason) => { if (tabRuntime.id === activeTabId()) conversationTouch(reason); },
		});
		provisionalRuntimes.add(provisional);
		try {
			const branchedState = await prepareForkedTabRuntime(
				provisional,
				forkEntryId,
				240_000,
			);
			const finalPlan = planForkTab(
				originalSessionFile,
				branchedState.sessionFile,
				tabState().tabs.length,
			);
			if (!finalPlan.canCreate) throw new Error("Maximum of 8 conversation tabs.");
			if (!tabManager.create({ id: provisionalId, badges: 0 })) throw new Error("Maximum of 8 conversation tabs.");
			provisionalRuntimes.delete(provisional);
			setRuntimeMap((current) => new Map(current).set(provisionalId, provisional));
			refreshTabs();
			activateTab(provisionalId);
			setStatus(branchedState.isStreaming ? "working" : "ready");
			toast("Fork created.", "success");
		} catch (error) {
			provisionalRuntimes.delete(provisional);
			extensionRouter.remove(provisionalId);
			provisional.messageUpdates.dispose();
			provisional.coalescer.flush();
			try {
				await provisional.client.stop();
			} catch (stopError) {
				props.logger.warn("tabs.provisional_stop_failed", stopError);
			}
			toast(error instanceof Error ? error.message : String(error), "error", 5000);
		} finally {
			sourceRuntime.forkInProgress = false;
			if (tabRuntimeIsActive(sourceRuntime.id)) touch();
			setStatus(activeRuntime().conversation.isStreaming ? "working" : "ready");
		}
	};
	const openForkPicker = async () => {
		const runtime = activeRuntime();
		if (!runtime.startupResolved) { toast("This tab is still starting…", "info"); return; }
		try {
			const messages = await runtime.client.getForkMessages();
			setForkPickerOptions(forkPickerOptions(messages));
			setForkPickerOpen(true);
		} catch (error) {
			toast(`Failed to load fork points: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	};
	const tabRuntimeIsActive = (id: string) => activeTabId() === id;
	const sessionController = new SessionController(props.logger);
	const loadRuntimeHistory = async (runtime: ConversationTabRuntime) => {
		const loaded = await sessionController.loadHistory(runtime, SESSION_LOAD_REQUEST_TIMEOUT_MS);
		if (loaded && tabRuntimeIsActive(runtime.id)) {
			resetMessageWindow(runtime.conversation.items.length);
			conversationTouch();
		}
	};
	const notifyCacheWarning = (warning: import("./tabs/cache-miss-watch.ts").CacheWarning, runtime: ConversationTabRuntime) => {
		props.logger.warn("cache.large_rewrite", { runtimeId: runtime.id, ...warning });
		if (runtime.id === activeTabId())
			toast(`Possible Claude cache rebuild: ${Math.round(warning.currentWrite / 1000)}k tokens rewritten (previous cache hit: ${Math.round(warning.previousRead / 1000)}k)`, "warning", 8500);
	};
	const bootRuntime = createTabRuntime({ id: "main", cwd: props.cwd, client, conversation,
		onCacheWarning: notifyCacheWarning,
		onEvent: routeRuntimeEvent,
		onConversationChange: (tabRuntime, reason) => { if (tabRuntime.id === activeTabId()) conversationTouch(reason); },
	});
	extensionRouter.setActive("main");
	setRuntimeMap(new Map([["main", bootRuntime]]));
	type SetUpdater<T> = T | ((current: T) => T);
	const setExpandedToolIds = (update: SetUpdater<Set<string>>) => {
		const current = activeRuntime().expandedToolIds;
		activeRuntime().expandedToolIds = typeof update === "function" ? update(current) : update;
		touch();
	};
	const setExpandedDiffIds = (update: SetUpdater<Set<string>>) => {
		const current = activeRuntime().expandedDiffIds;
		activeRuntime().expandedDiffIds = typeof update === "function" ? update(current) : update;
		touch();
	};
	const setThinkingExpansionOverrides = (update: SetUpdater<Map<string, boolean>>) => {
		const current = activeRuntime().thinkingExpansionOverrides;
		activeRuntime().thinkingExpansionOverrides = typeof update === "function" ? update(current) : update;
		touch();
	};
	const [notificationHistory, setNotificationHistory] = createSignal<
		NotificationRecord[]
	>([]);
	const [notificationDetailId, setNotificationDetailId] =
		createSignal<string>();
	const [backgroundSelection, setBackgroundSelection] = createSignal<
		{ runtimeId: string; sessionId: string; id: string } | undefined
	>();
	const [backgroundOutput, setBackgroundOutput] = createSignal<BackgroundOutputPage>();
	const [backgroundOutputError, setBackgroundOutputError] = createSignal<string>();
	const [backgroundOutputBusy, setBackgroundOutputBusy] = createSignal(false);
	let backgroundOutputRequest = 0;
	let lastBackgroundPoll = 0;
	const [todoDetailId, setTodoDetailId] = createSignal<string>();
	const [status, setStatus] = createSignal("starting Pi…");
	const startupStartedAt = Date.now();
	const [startupPhase, setStartupPhase] = createSignal<StartupPhase>({
		kind: "starting",
	});
	let prompt: TextareaRenderable | undefined;
	let scroll: ScrollBoxRenderable | undefined;
	let subagentScroll: ScrollBoxRenderable | undefined;
	let lastRunsDigest = "";
	let tabCounter = 0;
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
		const nextTargets = subagentTargets(nextRuns, subagentTools(), { contextWindowForModel, ownerPid: activeRuntime().client.getProcessPid() });
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

	const sessionState = () => { revision(); return activeRuntime().sessionState; };
	const sessionStats = () => { revision(); return activeRuntime().sessionStats; };
	const runs = () => { revision(); return activeRuntime().runs; };
	const mcpStatus = () => { revision(); return activeRuntime().mcpStatus; };
	const mcpCounts = () => { revision(); return activeRuntime().mcpCounts; };
	const lastRequestPerformance = () => { revision(); return activeRuntime().lastRequestPerformance; };
	const requestTimingHistory = () => { revision(); return activeRuntime().timingHistory; };
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
			runtime.effectiveThinkingLevels.set(modelThinkingKey(model.provider, model.id), level);
	};
	const applyRememberedThinkingLevel = async (runtime: ConversationTabRuntime, provider: string, modelId: string): Promise<void> => {
		const level = runtime.effectiveThinkingLevels.get(modelThinkingKey(provider, modelId));
		if (level) await runtime.client.setThinkingLevel(level);
	};
	const currentDrafts = () => {
		revision();
		return sessionDrafts(activeRuntime().drafts, currentSessionKey());
	};
	const mainPromptPlaceholder = () =>
		activeRuntime().conversation.isStreaming
			? "Enter queues steering for the next model step · Alt+Enter queues editable follow-up"
			: "Ask Pi anything… (/help for commands)";
	const syncPromptPlaceholder = (text: string) => {
		if (prompt)
			prompt.placeholder = text.length > 0 ? null : mainPromptPlaceholder();
	};
	const syncMainDraft = (text: string, preservePastes = false) => {
		const drafts = currentDrafts();
		drafts.main = text;
		drafts.mainPastes = preservePastes
			? prunePromptPasteBlocks(text, drafts.mainPastes)
			: [];
		if (prompt && prompt.plainText !== text) prompt.setText(text);
		syncPromptPlaceholder(text);
		setPromptText(text);
		setPromptCursorOffset(prompt?.cursorOffset ?? text.length);
	};
	const clearMainDraft = () => {
		const drafts = currentDrafts();
		drafts.main = "";
		drafts.mainPastes = [];
		prompt?.clear();
		syncPromptPlaceholder("");
		setPromptText("");
		setPromptCursorOffset(0);
	};
	const runtimeMainDraftText = (runtime: ConversationTabRuntime): string => {
		const drafts = sessionDrafts(
			runtime.drafts,
			runtime.sessionState?.sessionId ?? props.cwd,
		);
		return expandPromptPasteTokens(drafts.main, drafts.mainPastes);
	};
	const clearRuntimeMainDraft = (runtime: ConversationTabRuntime): void => {
		if (tabRuntimeIsActive(runtime.id)) {
			clearMainDraft();
			return;
		}
		const drafts = sessionDrafts(
			runtime.drafts,
			runtime.sessionState?.sessionId ?? props.cwd,
		);
		drafts.main = "";
		drafts.mainPastes = [];
	};
	const clearRuntimeMainDraftIfMatches = (
		runtime: ConversationTabRuntime,
		expected: string,
	): void => {
		if (queuedPromptMatchesDraft(runtimeMainDraftText(runtime), expected))
			clearRuntimeMainDraft(runtime);
	};
	const promptValue = () => prompt?.plainText ?? currentDrafts().main;
	const expandedPromptText = () =>
		expandPromptPasteTokens(promptValue(), currentDrafts().mainPastes);
	const expandCollapsedPromptPaste = (blockId: string) => {
		const drafts = currentDrafts();
		const block = drafts.mainPastes.find((entry) => entry.id === blockId);
		if (!block) return;
		const range = promptPasteRange(drafts.main, block);
		if (!range) return;
		const nextText = `${drafts.main.slice(0, range.start)}${block.text}${drafts.main.slice(range.end)}`;
		drafts.main = nextText;
		drafts.mainPastes = drafts.mainPastes.filter(
			(entry) => entry.id !== blockId,
		);
		if (prompt) {
			prompt.placeholder = null;
			prompt.replaceText(nextText);
			prompt.cursorOffset = range.start + block.text.length;
			prompt.focus();
		}
		setPromptText(nextText);
		setPromptCursorOffset(
			prompt?.cursorOffset ?? range.start + block.text.length,
		);
		setCommandSuggestionIndex(0);
	};
	const handlePromptKeyDown = (event: KeyEvent) => {
		if (!prompt || (event.name !== "backspace" && event.name !== "delete"))
			return;
		const direction = event.name === "backspace" ? "backward" : "forward";
		const range = promptPasteDeletionRange(
			prompt.plainText,
			currentDrafts().mainPastes,
			prompt.cursorOffset,
			direction,
			prompt.getSelection(),
		);
		if (!range) return;
		event.preventDefault();
		event.stopPropagation();
		const nextText = `${prompt.plainText.slice(0, range.start)}${prompt.plainText.slice(range.end)}`;
		const nextCursor = Math.min(range.start, nextText.length);
		prompt.replaceText(nextText);
		prompt.cursorOffset = nextCursor;
		const drafts = currentDrafts();
		drafts.main = nextText;
		drafts.mainPastes = prunePromptPasteBlocks(nextText, drafts.mainPastes);
		syncPromptPlaceholder(nextText);
		setPromptText(nextText);
		setPromptCursorOffset(nextCursor);
		setCommandSuggestionIndex(0);
	};
	const handlePromptPaste = (event: PasteEvent) => {
		const text = new TextDecoder().decode(event.bytes);
		if (!shouldCollapsePromptPaste(text)) return;
		event.preventDefault();
		event.stopPropagation();
		const drafts = currentDrafts();
		const existing = drafts.mainPastes.find(
			(block) => block.text === text && drafts.main.includes(block.token),
		);
		if (existing) {
			expandCollapsedPromptPaste(existing.id);
			toast("Pasted block expanded for editing.", "info");
			return;
		}
		const block = createPromptPasteBlock(text, drafts.mainPastes);
		const currentText = prompt?.plainText ?? drafts.main;
		const selection = prompt?.getSelection();
		const insertionStart =
			selection?.start ?? prompt?.cursorOffset ?? currentText.length;
		const insertionEnd = selection?.end ?? insertionStart;
		const insertion = insertPromptPasteBlock(currentText, block, insertionStart, insertionEnd);
		const nextText = insertion.text;
		const nextBlocks = prunePromptPasteBlocks(nextText, [
			...drafts.mainPastes,
			insertion.block,
		]);
		drafts.main = nextText;
		drafts.mainPastes = nextBlocks;
		if (prompt) {
			// OpenTUI stores placeholder rendering separately from editor text. Clear
			// it synchronously before replacing an untouched editor's contents.
			prompt.placeholder = null;
			prompt.replaceText(nextText);
			prompt.cursorOffset = insertion.end + insertion.block.trailingSeparator!.length;
		}
		setPromptText(nextText);
		setPromptCursorOffset(insertion.end + insertion.block.trailingSeparator!.length);
		setCommandSuggestionIndex(0);
		toast(
			`Pasted ${block.lineCount} line${block.lineCount === 1 ? "" : "s"}. Paste again or click to expand.`,
			"info",
		);
	};
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
		if (reason === "structure") setConversationStructureRevision((value) => value + 1);
	};
	const visibleSidebar = createMemo(
		() => sidebarEnabled() && dimensions().width >= 104,
	);
	// Accessing the live array is O(1). The window memo below makes a fresh
	// slice for Solid so updated rows still render. Copying the *entire*
	// conversation on every stream batch scaled with session length.
	const items = (): ConversationItem[] => {
		conversationRevision();
		return activeRuntime().conversation.items;
	};
	const structureItems = (): ConversationItem[] => {
		conversationStructureRevision();
		return activeRuntime().conversation.items;
	};
	const visibleItems = createMemo(() => {
		const all = items();
		const start = clampMessageWindowStart(all.length, messageWindowStart());
		return all.slice(start);
	});
	const hiddenMessageCount = createMemo(() =>
		clampMessageWindowStart(items().length, messageWindowStart()),
	);
	const visibleMessageIds = createMemo(() =>
		visibleItems().map((item) => item.id),
	);
	const promptMapEntries = createMemo<PromptMapEntry[]>(() =>
		structureItems().flatMap((item) =>
			item.kind === "user"
				? [{ id: item.id, text: item.text, timestamp: item.timestamp }]
				: [],
		),
	);
	const todos = createMemo<TodoViewItem[]>((previous) =>
		preserveEquivalentTodos(previous, deriveTodos(structureItems())),
	);
	const subagentsAvailable = createMemo(
		() => props.integrations.subagents.installed || runs().length > 0,
	);
	const todosAvailable = createMemo(
		() => props.integrations.todos.installed || todos().length > 0,
	);
	const commandSuggestions = createMemo(() =>
		filterCommandChoices(
			commandChoices(),
			promptText(),
			Number.POSITIVE_INFINITY,
			promptCursorOffset(),
		),
	);
	const slashQueryActive = createMemo(() => /^\/[^\s]*$/.test(promptText()));
	const commandSyncTick = createMemo(() => Math.floor(clockNow() / 30_000));
	createEffect(() => {
		if (!slashQueryActive()) return;
		commandSyncTick();
		const runtime = activeRuntime();
		if (startupPhase().kind !== "ready" || !runtime.startupResolved ||
			runtime.conversation.isStreaming || runtime.conversation.isCompacting) return;
		void refreshCommandChoices(runtime);
	});
	const thinkingIsExpanded = (itemId: string): boolean => {
		revision();
		return activeRuntime().thinkingExpansionOverrides.get(itemId) ?? thinkingExpanded();
	};
	const setAllThinkingExpanded = (expanded: boolean) => {
		setThinkingExpanded(expanded);
		setThinkingExpansionOverrides(new Map());
	};
	const toggleThinkingItem = (itemId: string) => {
		const next = !thinkingIsExpanded(itemId);
		setThinkingExpansionOverrides((current) => {
			const updated = new Map(current);
			updated.set(itemId, next);
			return updated;
		});
	};
	const streaming = createMemo(() => {
		conversationRevision();
		return activeRuntime().conversation.isStreaming;
	});
	const compactionView = createMemo(() => {
		compactionRevision();
		const runtime = activeRuntime();
		return {
			telemetry: runtime.compactionTelemetry,
			smartCompactProgress: runtime.smartCompactProgress,
			oneRoundProgress: runtime.oneRoundProgress,
			laneTexts: runtime.oneRoundLaneTexts,
		};
	});
	const lastCompactionCompletion = createMemo(() => {
		conversationRevision();
		return activeRuntime().lastCompactionCompletion;
	});
	// Show for the whole agent turn — including thinking streams and tool
	// calls. Hiding while the latest item is "active" made Working disappear
	// exactly when users expect it.
	const showWorkingIndicator = streaming;
	const subagentTools = createMemo<ToolItem[]>((previous) =>
		preserveReferencedList(
			previous,
			structureItems().filter((item): item is ToolItem => item.kind === "tool"),
		),
	);
	// A separate memo prevents expensive filesystem discovery every second.
	// The live status can change without any Pi RPC event.
	const profiledSubagentScanTick = createMemo(() => Math.floor(clockNow() / 3_000));
	const availableSubagentTargets = createMemo(() => {
		profiledSubagentScanTick();
		return subagentTargets(runs(), subagentTools(), {
			contextWindowForModel,
			ownerPid: activeRuntime().client.getProcessPid(),
		});
	});
	const displaySubagentTargets = createMemo(() =>
		subagentTreeRows(availableSubagentTargets()).map((row) => row.target),
	);
	const ownedVisibleSubagentTargets = createMemo(() =>
		ownedSubagentTargetsForItems(
			visibleItems().filter((item): item is ToolItem => item.kind === "tool"),
			availableSubagentTargets(),
		),
	);
	const selectedSubagentTarget = createMemo(
		() =>
			availableSubagentTargets().find(
				(target) => target.key === selectedTargetKey(),
			) ?? displaySubagentTargets()[0],
	);
	const inspectedTranscriptCache = createSubagentTranscriptCache();
	const inspectedTarget = createMemo(() => {
		const target = selectedSubagentTarget();
		if (target?.active && !target.transcriptPath && !target.sessionFile) {
			const parentSessionFile = activeRuntime().sessionState?.sessionFile;
			const transcriptPath = resolveLiveChildTranscriptPath({
				agent: target.step?.agent ?? target.run.agent ?? target.label,
				...(target.workflowKey !== undefined
					? { index: 0 }
					: target.stepIndex !== undefined
						? { index: target.stepIndex }
						: {}),
				...(target.childRunId !== undefined ? { childRunId: target.childRunId } : {}),
				...(target.startedAt !== undefined ? { startedAt: target.startedAt } : {}),
				cwd: props.cwd,
				...(parentSessionFile ? { parentSessionFile } : {}),
			});
			if (transcriptPath) {
				return {
					...target,
					transcriptPath,
					run: { ...target.run, transcriptPath },
				};
			}
		}
		return target;
	});
	const inspectedTranscript = createMemo(() =>
		inspectedTranscriptCache(inspectedTarget(), inspectSubagent()),
	);
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

	let lastRefreshTimeoutNotice = 0;
	const refreshSubagentRuns = (state: RpcSessionState): void => {
		const identity = {
			sessionId: state.sessionId,
			...(state.sessionFile ? { sessionFile: state.sessionFile } : {}),
		};
		const nextRuns = props.integrations.subagents.installed
			? mergeMissionRuns(
					listSubagentRuns(identity),
					identity,
					props.cwd,
				)
			: [];
		reconcileSteers(nextRuns);
		const summaries = nextRuns.map(subagentLogSummary);
		const digest = JSON.stringify(summaries);
		if (digest !== lastRunsDigest) {
			lastRunsDigest = digest;
			setRuns(nextRuns);
			const nextTargets = subagentTargets(nextRuns, subagentTools(), { contextWindowForModel, ownerPid: activeRuntime().client.getProcessPid() });
			const nextDisplayTargets = subagentTreeRows(nextTargets).map((row) => row.target);
			setSelectedTargetKey(
				reconcileSubagentSelection(
					selectedTargetKey(),
					availableSubagentTargets(),
					nextDisplayTargets,
				),
			);
			props.logger.info("subagents.changed", { runs: summaries });
		}
	};
	const refreshOperation = async (target: ConversationTabRuntime): Promise<boolean> => {
		const version = target.eventVersion;
		try {
			const [state, stats] = await Promise.all([
				target.client.getState(),
				target.client.getSessionStats(),
			]);
			if (target.eventVersion !== version) return true;
			const streamingChanged = target.conversation.isStreaming !== state.isStreaming;
			target.sessionState = state;
			rememberThinkingLevel(target);
			target.sessionStats = stats;
			target.conversation.isStreaming = state.isStreaming;
			if (streamingChanged) target.onConversationChange();
			delete target.lastError;
			if (tabRuntimeIsActive(target.id)) {
				setStatus(state.isStreaming ? "working" : "ready");
				refreshSubagentRuns(state);
				setRpcAvailable(true);
				touch();
			}
			return true;
		} catch (error) {
			if (target.eventVersion !== version) return true;
			const message = error instanceof Error ? error.message : String(error);
			target.lastError = error instanceof Error ? error : new Error(message);
			props.logger.error("ui.refresh_state_failed", { runtimeId: target.id, error });
			if (!tabRuntimeIsActive(target.id)) return false;
			if (error instanceof PiRpcTimeoutError) {
				setStatus("Pi busy; state refresh delayed");
				const now = Date.now();
				if (now - lastRefreshTimeoutNotice >= 60_000) {
					lastRefreshTimeoutNotice = now;
					toast("Pi is still running, but its state response is delayed.", "warning", 5000);
				}
				return false;
			}
			setStatus("Pi disconnected");
			setRpcAvailable(false);
			toast(message, "error", 5000);
			return false;
		}
	};
	const refreshCoordinators = new Map<string, SingleFlight<boolean>>();
	const refreshState = (target: ConversationTabRuntime = activeRuntime()): Promise<boolean> => {
		if (startupPhase().kind !== "ready" || !target.startupResolved) return Promise.resolve(false);
		let coordinator = refreshCoordinators.get(target.id);
		if (!coordinator) {
			coordinator = createSingleFlight(() => refreshOperation(target));
			refreshCoordinators.set(target.id, coordinator);
		}
		return coordinator.run();
	};

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

	const resetMessageWindow = (totalItems = activeRuntime().conversation.items.length) => {
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
				if (!tabRuntimeIsActive(capturedTabId) || activeRuntime() !== capturedRuntime) return;
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
		const target = availableSubagentTargets().find((entry) => entry.key === targetKey);
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
	const renderItemEntry = (itemId: string) => {
		const item = createMemo(() =>
			visibleItems().find((candidate) => candidate.id === itemId),
		);
		const compactionCompletion = createMemo(() =>
			compactionCompletionForItem(
				activeRuntime().conversation.items,
				itemId,
				lastCompactionCompletion(),
			),
		);
		const tool = createMemo(() => {
			const candidate = item();
			return candidate?.kind === "tool" ? candidate : undefined;
		});
		const subagentTargetsForItem = createMemo(
			() => ownedVisibleSubagentTargets().get(itemId) ?? [],
		);
		const initialItem = item();
		if (!initialItem) return null;
		const completion = compactionCompletion();
		if (completion) {
			return (
				<CompactedSummary
					completion={completion}
					expanded={compactionSummaryExpanded}
					onToggle={() => setCompactionSummaryExpanded((value) => !value)}
					viewportHeight={dimensions().height}
				/>
			);
		}
		const itemSource = () => item() ?? initialItem;
		return (
			<MessageView
				item={() => itemSource()}
				showThinking
				thinkingExpanded={() => thinkingIsExpanded(itemId)}
				onToggleThinking={() => toggleThinkingItem(itemId)}
				toolExpanded={() =>
					tool() !== undefined && toolExpanded(itemId)
				}
				onToggleTool={toggleTool}
				diffExpanded={() =>
				tool() !== undefined && diffExpanded(itemId)
				}
				onToggleDiff={toggleDiff}
				canFork={!streaming()}
				onFork={(entryId) => void forkAt(entryId, item())}
				subagentTargets={subagentTargetsForItem()}
				onInspectSubagentTarget={inspectSubagentTarget}
				now={
					tool()?.status === "streaming" ||
					tool()?.status === "pending" ||
					subagentTargetsForItem().some((target) => target.active)
						? clockNow()
						: (tool()?.endedAt ??
								tool()?.startedAt ??
								tool()?.timestamp ??
								0)
				}
			/>
		);
	};

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
			const level = result?.level ?? runtime.sessionState?.thinkingLevel ?? "unknown";
			rememberThinkingLevel(runtime, isThinkingLevel(level) ? level : undefined);
			toast(`Thinking effort: ${level}`, "success", 1600);
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), "error");
		}
	};

	const afterSessionLoaded = async (runtime: ConversationTabRuntime, historyLength: number) => {
		rememberThinkingLevel(runtime);
		if (tabRuntimeIsActive(runtime.id)) {
			resetMessageWindow(historyLength);
			conversationTouch();
			queueMicrotask(scrollToBottom);
		}
		await refreshState(runtime);
	};
	const loadCurrentSession = async (runtime: ConversationTabRuntime = activeRuntime()) => {
		const historyLength = await sessionController.loadCurrent(runtime, SESSION_LOAD_REQUEST_TIMEOUT_MS);
		await afterSessionLoaded(runtime, historyLength);
	};

	const slashCommandController = new SlashCommandController<ConversationTabRuntime>({
		addSystem: addSystemToRuntime,
		openSessionSelector: () => openSessionSelector(),
		openSettings: () => openSettings(),
		expandedTools, setExpandedTools,
		setExpandedToolIds: (ids) => setExpandedToolIds(ids),
		sidebarEnabled, setSidebarEnabled,
		refreshState, autoRetryEnabled, setAutoRetryEnabled,
		refreshCommands: (runtime) => refreshCommandChoices(runtime, true),
		rememberThinkingLevel, applyRememberedThinkingLevel,
		fetchAvailableModels: () => fetchAvailableModels(), loadCurrentSession,
		setSkillSelectorOpen, setAllThinkingExpanded, thinkingExpanded,
		promptMapCount: () => promptMapEntries().length,
		setPromptMapOpen,
		openMemoryBrowser: () => openMemoryBrowser(),
	});
	const handleSlashCommand = (
		text: string,
		runtime: ConversationTabRuntime = activeRuntime(),
	): Promise<boolean> => slashCommandController.handle(text, runtime);

	const inputController = new InputController<ConversationTabRuntime>(props.logger, {
		isActive: tabRuntimeIsActive,
		onChange: () => touch(),
		onOptimisticSubmit: () => {
			trimMessageWindowIfFollowingLatest();
			conversationTouch();
			scrollToBottom();
		},
		onQueuedPromptSent: (runtime, text) => clearRuntimeMainDraftIfMatches(runtime, text),
		notify: (message, tone) => toast(message, tone),
	});
	const sendText = (text: string, runtime: ConversationTabRuntime = activeRuntime()): Promise<"sent" | "queued"> =>
		inputController.sendText(text, runtime);

	const submit = async () => {
		const runtime = activeRuntime();
		if (startupPhase().kind !== "ready") {
			toast(
				startupPhase().kind === "failed"
					? "Pi is unavailable. Restart PiTTy to retry."
					: "Pi is still starting. Wait for the conversation to load.",
				"warning",
			);
			return;
		}
		if (!runtime.startupResolved) {
			toast("This tab is still loading its conversation.", "warning");
			return;
		}
		if (dialog()) return;
		const text = expandedPromptText().trim();
		if (!text) return;
		if (runtime.submitInFlight) {
			toast("The previous message is still awaiting Pi acknowledgment.", "info");
			return;
		}
		runtime.submitInFlight = true;
		runtime.promptHistory.recordSubmitted(text);
		try {
			if (await handleSlashCommand(text, runtime)) {
				clearRuntimeMainDraftIfMatches(runtime, text);
				return;
			}
			const result = await sendText(text, runtime);
			if (result === "sent") clearRuntimeMainDraftIfMatches(runtime, text);
		} catch (error) {
			props.logger.error("ui.submit_failed", error);
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
		if (dialog()) return;
		const text = expandedPromptText().trim();
		if (!text) return;
		if (!activeRuntime().conversation.isStreaming) {
			void submit();
			return;
		}
		if (text.startsWith("/")) {
			toast("Command-like input must be submitted with Enter.", "warning");
			return;
		}
		clearMainDraft();
		const runtime = activeRuntime();
		inputController.queueFollowUp(runtime, text);
		props.logger.info("ui.followup_queued", { chars: text.length });
		toast("Follow-up queued. Alt+Up restores it for editing.", "success");
	};

	const editQueuedFollowUp = (messageId: string) => {
		const runtime = activeRuntime();
		const current = runtime.queuedFollowUps;
		const selected = current.find((item) => item.id === messageId);
		if (!selected) return;
		runtime.queuedFollowUps = current.filter((item) => item.id !== messageId);
		touch();
		syncMainDraft(selected.text);
		prompt?.focus();
		toast("Queued follow-up restored to editor.", "info");
	};

	const restoreQueuedFollowUp = () => {
		const current = queuedFollowUps();
		const last = current.at(-1);
		if (!last) {
			const sentCount =
				activeRuntime().conversation.steering.length + activeRuntime().conversation.followUp.length;
			toast(
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

	const flushQueuedFollowUp = (runtime: ConversationTabRuntime = activeRuntime()): Promise<void> =>
		inputController.flushQueuedFollowUp(runtime);
	const abortActiveWork = (): void => inputController.abort(activeRuntime());

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
	const backgroundTasks = () => {
		revision();
		return activeRuntime().background?.tasks ?? [];
	};
	const selectedBackgroundTask = () => {
		const selection = backgroundSelection();
		if (!selection || selection.runtimeId !== activeTabId()) return undefined;
		return backgroundTasks().find((task) => task.id === selection.id);
	};
	const showBackgroundOutputPage = async (page: number) => {
		const selection = backgroundSelection();
		if (!selection) return;
		const request = ++backgroundOutputRequest;
		setBackgroundOutputBusy(true);
		setBackgroundOutputError(undefined);
		try {
			const output = await readBackgroundOutput(selection.sessionId, selection.id, page);
			if (request === backgroundOutputRequest && backgroundSelection() === selection) {
				setBackgroundOutput((previous) =>
					previous?.page === output.page && previous.totalBytes === output.totalBytes &&
					previous.text === output.text && previous.available === output.available
						? previous : output,
				);
			}
		} catch (error) {
			if (request === backgroundOutputRequest)
				setBackgroundOutputError(error instanceof Error ? error.message : String(error));
		} finally {
			if (request === backgroundOutputRequest) setBackgroundOutputBusy(false);
		}
	};
	const openBackgroundTask = (id: string) => {
		const snapshot = activeRuntime().background;
		if (!snapshot?.tasks.some((task) => task.id === id)) return;
		backgroundOutputRequest++;
		setBackgroundOutput(undefined);
		setBackgroundOutputError(undefined);
		setBackgroundSelection({ runtimeId: activeTabId(), sessionId: snapshot.sessionId, id });
		lastBackgroundPoll = Date.now();
		void showBackgroundOutputPage(0);
	};
	const closeBackgroundTask = () => {
		backgroundOutputRequest++;
		setBackgroundSelection(undefined);
		setBackgroundOutput(undefined);
		setBackgroundOutputError(undefined);
		queueMicrotask(focusMainPrompt);
	};
	const analyzeBackgroundTask = () => {
		const task = selectedBackgroundTask();
		const output = backgroundOutput();
		if (!task) return;
		const context = [
			"Analyze this background command and its observed output. Identify any problems and suggest fixes. Do not modify files or run commands unless requested.",
			`Working directory: ${task.cwd}`,
			`Command (${task.commandTruncated ? "observer excerpt, original longer" : "original"}):\n${task.command}`,
			`Status: ${task.state}${task.exitCode === undefined ? "" : ` (exit ${task.exitCode})`}`,
			`Output (${output ? `bytes ${output.startByte}-${output.endByte} of ${output.totalBytes}` : "not available"}):\n${output?.text.slice(-12000) ?? ""}`,
		].join("\n\n");
		closeBackgroundTask();
		void sendText(context).catch((error) =>
			toast(`Unable to submit analysis: ${error instanceof Error ? error.message : String(error)}`, "error"),
		);
	};
	// Refresh the opened log only. Never run filesystem reads on model/tool turns.
	createEffect(() => {
		const selection = backgroundSelection();
		const task = selectedBackgroundTask();
		const now = clockNow();
		if (!selection || task?.state !== "running" || backgroundOutput()?.page !== 0) return;
		if (now - lastBackgroundPoll < 1_800 || backgroundOutputBusy()) return;
		lastBackgroundPoll = now;
		void showBackgroundOutputPage(0);
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
	const fetchAvailableModels = (): Promise<ModelChoice[]> => {
		if (availableModelsFetch) return availableModelsFetch;
		availableModelsFetch = (async () => {
			const models = normalizeModelChoices(await activeRuntime().client.getAvailableModels());
			if (!models.length) throw new Error("Pi returned no available models");
			availableModelsCache = models;
			return models;
		})().finally(() => { availableModelsFetch = undefined; });
		return availableModelsFetch;
	};
	const loadModels = async (fromSettings: boolean): Promise<boolean> => {
		if (!activeRuntime().startupResolved) { toast("This tab is still starting…", "info"); return false; }
		if (!fromSettings) {
			// Open immediately so Ctrl+P never hangs on a slow Pi, then sync
			// visibly: the notice shows syncing/sync-failed instead of silently
			// serving a stale cached list.
			setModelOptions(availableModelsCache ?? []);
			setModelListNotice(availableModelsCache ? "syncing with Pi…" : "loading models from Pi…");
			setModelSelectorOpen(true);
			try {
				setModelOptions(await fetchAvailableModels());
				setModelListNotice(undefined);
			} catch (error) {
				if (!availableModelsCache) {
					setModelSelectorOpen(false);
					toast(
						`Failed to load models: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
					return false;
				}
				setModelListNotice("sync failed — showing cached list");
			}
			return true;
		}
		if (modelSelectorLoading()) return false;
		if (fromSettings) {
			setSettingsBusy("model");
			setSettingsErrors((errors) => {
				const next = { ...errors };
				delete next.model;
				return next;
			});
		}
		setModelSelectorLoading(true);
		try {
			const models = await fetchAvailableModels();
			setModelOptions(models);
			if (fromSettings) setSettingsRoute("model");
			else setModelSelectorOpen(true);
			return true;
		} catch (error) {
			if (fromSettings)
				setSettingsErrors((errors) => ({
					...errors,
					model: error instanceof Error ? error.message : String(error),
				}));
			else
				toast(
					`Failed to load models: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			return false;
		} finally {
			setModelSelectorLoading(false);
			if (fromSettings) setSettingsBusy(undefined);
		}
	};
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
        cachedModels: () => availableModelsCache,
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
	const settingsDescriptors = () => buildSettingsDescriptors({
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

	const closePromptMap = () => {
		setPromptMapOpen(false);
		queueMicrotask(() => prompt?.focus());
	};

	const openPromptMap = () => {
		if (!promptMapEntries().length) {
			toast("No user requests in this session yet", "warning");
			return;
		}
		setModelSelectorOpen(false);
		setPromptMapOpen(true);
	};

	const jumpToPrompt = (entry: PromptMapEntry) => {
		setPromptMapOpen(false);
		const targetIndex = items().findIndex((item) => item.id === entry.id);
		if (targetIndex >= 0 && targetIndex < messageWindowStart()) {
			setMessageWindowStart(targetIndex);
		}
		queueMicrotask(() =>
			queueMicrotask(() => {
				scroll?.scrollChildIntoView(entry.id);
				updateScrollPosition();
				prompt?.focus();
			}),
		);
	};

	const closeMemoryBrowser = () => {
		setMemoryBrowserOpen(false);
		if (settingsRoute() === "memory") {
			setSettingsRoute("root");
			return;
		}
		queueMicrotask(() => prompt?.focus());
	};

	const openMemoryBrowser = (fromSettings = false) => {
		if (!props.integrations.memory.installed) {
			toast(
				"Install pi-hermes-memory to browse persistent memory",
				"info",
				5000,
			);
			return;
		}
		try {
			const snapshot = loadMemorySnapshot(props.cwd);
			setMemorySnapshot(snapshot);
			setModelSelectorOpen(false);
			setMemoryBrowserOpen(true);
			if (fromSettings) setSettingsRoute("memory");
		} catch (error) {
			toast(
				`Unable to read memory files: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	};

	const removeMemory = (entry: MemoryEntry) => {
		const snapshot = memorySnapshot();
		const file = snapshot?.files.find(
			(candidate) => candidate.filePath === entry.filePath,
		);
		if (!file) return;
		const result = removeMemoryEntry(entry, file.fileContent);
		if (!result.success) {
			toast(result.error, "error", 6000);
			return;
		}
		toast("Memory entry removed", "success");
		setMemorySnapshot(loadMemorySnapshot(props.cwd));
	};

	const completeDialog = async (response: {
		value?: string;
		confirmed?: boolean;
		cancelled?: true;
	}) => {
		const request = dialog();
		const ownerRuntimeId = dialogOwnerRuntimeId();
		const ownerRuntime = ownerRuntimeId ? runtimeMap().get(ownerRuntimeId) : undefined;
		if (!request || !ownerRuntimeId || !ownerRuntime) return;
		props.logger.info("ui.extension_dialog_response", {
			method: request.method,
			cancelled: response.cancelled === true,
			confirmed: response.confirmed,
		});
		setDialog(undefined);
		setDialogOwnerRuntimeId(undefined);
		const next = extensionRouter.complete(ownerRuntimeId, request.id);
		if (response.cancelled)
			await ownerRuntime.client.sendExtensionUiResponse({
				type: "extension_ui_response",
				id: request.id,
				cancelled: true,
			});
		else if (typeof response.confirmed === "boolean")
			await ownerRuntime.client.sendExtensionUiResponse({
				type: "extension_ui_response",
				id: request.id,
				confirmed: response.confirmed,
			});
		else
				await ownerRuntime.client.sendExtensionUiResponse({
				type: "extension_ui_response",
				id: request.id,
				value: response.value ?? "",
			});
		if (next && tabRuntimeIsActive(ownerRuntimeId)) handleExtensionRequest(next);
		prompt?.focus();
	};

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
            scrollToLatest: () => scroll?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER }),
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
		queueMicrotask(() => subagentScroll?.scrollTo(inspectedTargetScrollY(target)));
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
			queueMicrotask(() => subagentScroll?.scrollTo(inspectedTargetScrollY(next)));
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
									const line = prompt.getTextRangeByCoords(
										logicalRow,
										0,
										logicalRow,
										8192,
									);
									if (!line) return;
									const block = blocks.find((entry) => {
										const start = line.indexOf(entry.token);
										return start >= 0 && column >= start && column < start + entry.token.length;
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
									const text = stripCollapsedPromptPasteFragments(
										rawText,
										drafts.mainPastes,
									);
									if (prompt && text !== rawText) prompt.replaceText(text);
									drafts.main = text;
									syncPromptPlaceholder(text);
									drafts.mainPastes = prunePromptPasteBlocks(
										text,
										drafts.mainPastes,
									);
									activeRuntime().promptHistory.noteEditorChange(text);
									setPromptText(text);
									setPromptCursorOffset(prompt?.cursorOffset ?? text.length);
									setCommandSuggestionIndex(0);
    };
    const onPromptCursorChange = () => {
setPromptCursorOffset(prompt?.cursorOffset ?? 0);
    };

	const MainContents = () => (
		<box
			width="100%"
			height="100%"
			flexDirection="column"
			backgroundColor={colors.background}
		>
			<TabStrip tabs={tabState().tabs} activeId={tabState().activeId} onActivate={activateTab} onClose={closeTab} onCreate={createTab} onOpenForkPicker={() => void openForkPicker()} />
			<box flexGrow={1} minHeight={1} flexDirection="row">
				<box flexGrow={1} minWidth={0} flexDirection="column">
					<Show
						when={inspectSubagent() ? selectedSubagentTarget() : undefined}
						fallback={null}
					>
						{(target) => (
							<SubagentInspector
								target={inspectedTarget()}
								items={inspectedTranscript()}
								now={clockNow()}
								spinner={spinnerFrames[spinnerIndex()] ?? "◐"}
								scrollRef={(value) => {
									subagentScroll = value;
								}}
								onClose={closeSubagentInspector}
								onPause={requestPauseSubagent}
								onResume={requestResumeSubagent}
								onStop={requestStopSubagent}
								onChooseTarget={() => setSubagentSelectorOpen(true)}
								targetCount={displaySubagentTargets().length}
								allTargets={availableSubagentTargets()}
								onInspectSubagentTarget={inspectSubagentTarget}
								draft={() => currentDrafts().subagents.get(inspectedTarget()!.key) ?? ""}
								onDraftChange={(text) => {
									currentDrafts().subagents.set(inspectedTarget()!.key, text);
									touch();
								}}
								onSteer={sendSubagentSteer}
								pendingSteers={pendingSteers().filter(
									(entry) => entry.targetKey === inspectedTarget()!.key,
								)}
								thinkingExpanded={thinkingIsExpanded}
								onToggleThinking={toggleThinkingItem}
								toolExpanded={toolExpanded}
								onToggleTool={toggleTool}
								diffExpanded={diffExpanded}
								onToggleDiff={toggleDiff}
							/>
						)}
					</Show>
					<Show when={!inspectSubagent()}>
						<TranscriptPane
                            scrollRef={(value) => { scroll = value; }}
                            onScroll={() => queueMicrotask(updateScrollPosition)}
                            onFocusPrompt={focusMainPrompt}
                            startupPhase={startupPhase}
                            startupStartedAt={startupStartedAt}
                            now={clockNow}
                            frame={spinnerIndex}
                            itemCount={() => items().length}
                            sessionDiscovery={sessionDiscovery}
                            width={() => dimensions().width}
                            height={() => dimensions().height}
                            onSelectSession={(choice) => {
                                if (activeRuntime().conversation.isStreaming) setSessionSelectorOpen(true);
                                void switchToSession(choice);
                            }}
                            hiddenCount={hiddenMessageCount}
                            loadOlder={loadOlderMessages}
                            visibleMessageIds={visibleMessageIds}
                            spawnGroupMemberIds={spawnGroupMemberIds}
                            spawnGroupByFirstId={spawnGroupByFirstId}
                            visibleItems={visibleItems}
                            toolExpanded={toolExpanded}
                            toggleTool={toggleTool}
                            inspectTarget={inspectSubagentTarget}
                            renderItem={renderItemEntry}
                            compactionView={compactionView}
                            compactionExpanded={compactionExpanded}
                            onToggleCompaction={() => setCompactionExpanded((value) => !value)}
                            backgroundTasks={backgroundTasks}
                            openBackgroundTask={openBackgroundTask}
                            showWorkingIndicator={showWorkingIndicator}
                        />
					</Show>
					{/* Keep a fixed one-row slot so showing/hiding the jump control does
              not resize the transcript and leave stale terminal cells. */}
					<box
						height={1}
						minHeight={1}
						flexDirection="row"
						justifyContent="flex-end"
						paddingRight={2}
					>
						<Show when={showJumpLatest() && !inspectSubagent()}>
							<text
								fg={colors.cyan}
								attributes={1}
								onMouseDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									scrollToBottom();
								}}
							>
								↓ Latest message
							</text>
						</Show>
					</box>
					<Show
						when={
							!inspectSubagent() &&
							(queuedFollowUps().length ||
								steeringQueue().length ||
								followUpQueue().length)
						}
					>
						<PendingInputPanel
							queuedFollowUps={queuedFollowUps()}
							steering={steeringQueue()}
							followUps={followUpQueue()}
							onEditQueuedFollowUp={editQueuedFollowUp}
						/>
					</Show>
					<Show when={commandSuggestions().length && !inspectSubagent()}>
						<CommandSuggestions
							commands={commandSuggestions}
							selectedIndex={() =>
								Math.min(
									commandSuggestionIndex(),
									Math.max(0, commandSuggestions().length - 1),
								)
							}
							onSelect={insertSuggestedCommand}
						/>
					</Show>
					<Show when={!inspectSubagent()}>
						<PromptComposer
                            streaming={streaming}
                            focused={() => startupPhase().kind === "ready" &&
                                !dialog() && !backgroundSelection() && !modelSelectorOpen() &&
                                !sessionSelectorOpen() && !forkPickerOpen() && !promptMapOpen() &&
                                !subagentSelectorOpen() && !notificationDetailId() && !todoDetailId()}
                            placeholder={() => promptValue().length > 0 ? null : streaming()
                                ? "Enter queues steering for the next model step · Alt+Enter queues editable follow-up"
                                : "Ask Pi anything… (/help for commands)"}
                            onEditor={onPromptEditor}
                            onPaste={handlePromptPaste}
                            onKeyDown={handlePromptKeyDown}
                            onMouseDown={onPromptMouseDown}
                            onContentChange={onPromptContentChange}
                            onCursorChange={onPromptCursorChange}
                            onSubmit={() => void submit()}
                        />
					</Show>
				</box>
				<Show when={visibleSidebar()}>
					<Sidebar
						state={sessionState()}
						stats={sessionStats()}
						lastRequestPerformance={lastRequestPerformance()}
						timingHistory={requestTimingHistory()}
						runs={runs}
						tools={subagentTools}
						targetSource={availableSubagentTargets}
						contextWindowForModel={contextWindowForModel}
						selectedTargetKey={selectedTargetKey()}
						now={clockNow()}
						onSelectTarget={setSelectedTargetKey}
						todos={todos}
						onOpenTodo={(todo) => openTodo(todo.id)}
						subagentsAvailable={subagentsAvailable()}
						todosAvailable={todosAvailable()}
						mcpStatus={mcpStatus}
						mcpCounts={mcpCounts}
						mcpConfigured={mcpConfiguredSummary}
						notifications={notificationHistory}
						backgroundTasks={backgroundTasks}
						onOpenBackgroundTask={openBackgroundTask}
						onOpenNotification={openNotification}
						height={() => dimensions().height - 1}
						onInspectTarget={(targetKey) => {
							setSelectedTargetKey(targetKey);
							setInspectSubagent(true);
							const target = availableSubagentTargets().find((entry) => entry.key === targetKey);
							queueMicrotask(() =>
								subagentScroll?.scrollTo(inspectedTargetScrollY(target)),
							);
						}}
					/>
				</Show>
			</box>
			<AppFooter
                streaming={streaming}
                statusText={footerStatusText}
                segments={footerUsageSegments}
                hintText={footerHintText}
            />
            <ToastOverlay entries={toasts} />

		</box>
	);
	const EvenTheme = () => <MainContents />;
	const OddTheme = () => <MainContents />;

	return (
		<>
			{createDynamic(
				() => (themeController.revision() % 2 === 0 ? EvenTheme : OddTheme),
				{},
			)}
			<Show when={settingsRoute() === "root"}>
				<SettingsHub
					descriptors={settingsDescriptors}
					selectedId={settingsSelectedId}
					onSelected={setSettingsSelectedId}
					onClose={closeSettings}
				/>
			</Show>
			<Show when={settingsRoute() === "mcp"}>
				<McpSettings
					adapterState={mcpInstallState}
					configState={mcpConfigState}
					scope={mcpScope}
					snapshot={mcpSnapshot}
					preview={mcpPreview}
					error={mcpError}
					view={mcpView}
					onViewChange={setMcpView}
					onInstall={installMcpAdapter}
					onScope={(scope) => {
						setMcpScope(scope);
						openMcpSettings();
					}}
					onAdd={prepareMcpMutation}
					onDelete={deleteMcpServer}
					onConfirmPreview={confirmMcpMutation}
					onCancelPreview={() => {
						setMcpPreview(undefined);
						openMcpSettings();
					}}
					onRetryActivation={() => void activateMcp()}
					onBack={() => setSettingsRoute(settingsBackRoute("mcp"))}
					backend={mcpBackend}
					onEnableBuiltin={enableBuiltinMcpInSettings}
				/>
			</Show>
			<Show when={settingsRoute() === "model"}>
				<ModelSelectorDialog
					models={modelOptions()}
					currentProvider={sessionState()?.model?.provider}
					currentModelId={sessionState()?.model?.id}
					performanceHistory={readModelPerformanceHistory()}
					timingHistory={requestTimingHistory()}
					onSelect={(model) => void applySettingsModel(model)}
					onCancel={() => setSettingsRoute("root")}
				/>
			</Show>
			<Show when={settingsRoute() === "claude-account" && cswapSnapshot()}>
				<ClaudeAccountSelector
					accounts={cswapSnapshot()!.accounts}
					selection={claudeAccountChoice()}
					effectiveSlot={claudeEffectiveSlot()}
					onSelect={chooseClaudeAccount}
					onCancel={() => setSettingsRoute("root")}
				/>
			</Show>
			<Show when={settingsRoute() === "thinking"}>
				<ThinkingSelector
					current={THINKING_LEVELS.find(
						(level) => level === sessionState()?.thinkingLevel,
					)}
					levels={visibleThinkingLevels(
						sessionState()?.model?.reasoning,
						sessionState()?.model?.thinkingLevelMap as
							| ThinkingLevelMap
							| undefined,
					)}
					busy={settingsBusy() === "thinking"}
					{...(settingsErrors().thinking
						? { error: settingsErrors().thinking }
						: {})}
					onSelect={(level) => {
						const next = THINKING_LEVELS.find(
							(candidate) => candidate === level,
						);
						if (next) void applySettingsThinking(next);
					}}
					onCancel={() => setSettingsRoute("root")}
				/>
			</Show>
			<Show when={settingsRoute() === "compaction"}>
				<ExtensionSettingsList
					title="Compaction settings"
					hint="Model and thinking level used by pi-one-round-compaction. Esc back."
					rows={compactionSettingsRows()}
					selectedId={detailSettingSelectedId()}
					busy={settingsBusy() === "compaction"}
					error={settingsErrors().compaction}
					onSelected={setDetailSettingSelectedId}
					onOpen={openCompactionSetting}
					onCancel={() => {
						setSettingsRoute("root");
						setSettingsSelectedId("compaction");
					}}
				/>
			</Show>
			<Show when={settingsRoute() === "compaction-model"}>
				<ModelSelectorDialog
					models={modelOptions()}
					currentProvider={parseModelRef(compactionModelState()?.model)?.provider}
					currentModelId={parseModelRef(compactionModelState()?.model)?.id}
					performanceHistory={readModelPerformanceHistory()}
					timingHistory={requestTimingHistory()}
					context={compactionModelContext()}
					onSelect={(model) => void applyCompactionModel(model)}
					onCancel={() => setSettingsRoute("compaction")}
				/>
			</Show>
			<Show when={settingsRoute() === "compaction-thinking"}>
				<ThinkingSelector
					current={compactionModelState()?.thinkingLevel}
					levels={compactionThinkingLevels()}
					context={compactionThinkingContext()}
					busy={settingsBusy() === "compaction"}
					{...(settingsErrors().compaction
						? { error: settingsErrors().compaction }
						: {})}
					onSelect={(level) => void applyCompactionThinking(level)}
					onCancel={() => setSettingsRoute("compaction")}
				/>
			</Show>
			<Show when={settingsRoute() === "subagents"}>
				<ExtensionSettingsList
					title="Subagent models"
					hint="Each @mistrjirka/pi-subagent profile. Enter opens model and thinking. Esc back."
					rows={subagentListRows()}
					selectedId={selectedSubagentModelId()}
					busy={settingsBusy() === "subagents"}
					error={settingsErrors().subagents}
					onSelected={setSelectedSubagentModelId}
					onOpen={(id) => {
						const entry = subagentModelEntries().find(
							(candidate) => candidate.id === id,
						);
						if (entry) openSubagentSettings(entry);
					}}
					onCancel={() => {
						setSettingsRoute("root");
						setSettingsSelectedId("subagents");
					}}
				/>
			</Show>
			<Show when={settingsRoute() === "subagent"}>
				<ExtensionSettingsList
					title={`Subagent: ${selectedSubagentModelId() === "defaults" ? "Defaults" : selectedSubagentModelId()}`}
					hint="Model and thinking level. Esc back to the profile list."
					rows={subagentSettingsRows()}
					selectedId={detailSettingSelectedId()}
					busy={settingsBusy() === "subagents"}
					error={settingsErrors().subagents}
					onSelected={setDetailSettingSelectedId}
					onOpen={openSubagentSetting}
					onCancel={() => setSettingsRoute("subagents")}
				/>
			</Show>
			<Show when={settingsRoute() === "subagent-model"}>
				<ModelSelectorDialog
					models={modelOptions()}
					currentProvider={parseModelRef(selectedSubagentModelEntry()?.model)
						?.provider}
					currentModelId={parseModelRef(selectedSubagentModelEntry()?.model)?.id}
					performanceHistory={readModelPerformanceHistory()}
					timingHistory={requestTimingHistory()}
					context={subagentModelContext()}
					onSelect={(model) => void applySubagentModel(model)}
					onCancel={() => setSettingsRoute("subagent")}
				/>
			</Show>
			<Show when={settingsRoute() === "subagent-thinking"}>
				<ThinkingSelector
					current={selectedSubagentModelEntry()?.thinking}
					levels={subagentThinkingLevels()}
					context={subagentThinkingContext()}
					busy={settingsBusy() === "subagents"}
					{...(settingsErrors().subagents
						? { error: settingsErrors().subagents }
						: {})}
					onSelect={(level) => void applySubagentThinking(level)}
					onCancel={() => setSettingsRoute("subagent")}
				/>
			</Show>
			<Show when={settingsRoute() === "theme"}>
				<ThemePresetBrowser
					preset={() => themeConfig().theme.preset}
					busy={() => settingsBusy() === "theme"}
					error={() => settingsErrors().theme}
					onPreset={applyThemePreset}
					onCustomize={() => setSettingsRoute("theme-editor")}
					onCancel={() => setSettingsRoute("root")}
				/>
			</Show>
			<Show when={settingsRoute() === "theme-editor"}>
				<ThemeTokenEditor
					preset={() => themeConfig().theme.preset}
					overrides={() => themeConfig().theme.overrides}
					busy={() => settingsBusy() === "theme"}
					error={() => settingsErrors().theme}
					onToken={applyThemeToken}
					onReset={resetTheme}
					onCancel={() => setSettingsRoute("theme")}
				/>
			</Show>
			<Show when={settingsRoute() === "session"}>
				<SessionSettings
					name={sessionState()?.sessionName ?? ""}
					{...(streaming()
						? { switchDisabledReason: "Unavailable while Pi is streaming" }
						: {})}
					onSwitch={() => {
						if (!streaming()) {
							setSettingsRoute("session-switch");
							openSessionSelector();
						}
					}}
					onRename={() => setSettingsRoute("session-rename")}
					onCancel={() => setSettingsRoute("root")}
				/>
			</Show>
			<Show when={settingsRoute() === "session-rename"}>
				<SessionRename
					initialName={sessionState()?.sessionName ?? ""}
					busy={() => settingsBusy() === "rename"}
					error={() => settingsErrors().rename}
					onConfirm={(name) => void applySettingsRename(name)}
					onCancel={() => setSettingsRoute("session")}
				/>
			</Show>
			<Show when={sessionSelectorOpen()}>
				<SessionSelector
					state={sessionDiscovery()}
					switching={sessionSwitching()}
					streaming={streaming()}
					confirmation={pendingSessionReason()}
					queuedCount={queuedFollowUps().length}
					pending={pendingSession()}
					onSelect={(choice) => void switchToSession(choice)}
					onConfirm={() => {
						const choice = pendingSession();
						if (choice) void switchToSession(choice);
					}}
					onDecline={() => {
						setPendingSession(undefined);
						setPendingSessionReason(undefined);
					}}
					onCancel={closeSessionSelector}
					onRetry={() => void discoverCurrentSessions()}
				/>
			</Show>
			<Show when={forkPickerOpen()}>
				<ForkPicker options={forkPickerOptionsSignal()} onCancel={() => setForkPickerOpen(false)} onSelect={(entryId) => { setForkPickerOpen(false); void forkAt(entryId); }} />
			</Show>
			<Show when={modelSelectorOpen()}>
				<ModelSelectorDialog
					models={modelOptions()}
					currentProvider={sessionState()?.model?.provider}
					currentModelId={sessionState()?.model?.id}
					performanceHistory={readModelPerformanceHistory()}
					timingHistory={requestTimingHistory()}
					notice={modelListNotice()}
					onSelect={(model) => void selectModel(model)}
					onCancel={closeModelSelector}
				/>
			</Show>
			<Show when={backgroundSelection() && selectedBackgroundTask()}>
				<BackgroundTaskDialog
					task={selectedBackgroundTask}
					now={clockNow()}
					output={backgroundOutput}
					busy={backgroundOutputBusy()}
					{...(backgroundOutputError() ? { error: backgroundOutputError() } : {})}
					onPage={(page) => void showBackgroundOutputPage(page)}
					onAnalyze={analyzeBackgroundTask}
					onClose={closeBackgroundTask}
				/>
			</Show>
			<Show when={notificationDetailId()}>
				<NotificationDialog
					record={() =>
						notificationHistory().find(
							(record) => record.id === notificationDetailId(),
						)
					}
					onClose={closeNotification}
				/>
			</Show>
			<Show when={todoDetailId()}>
				<TodoDialog
					todo={() => todos().find((todo) => todo.id === todoDetailId())}
					onClose={closeTodo}
				/>
			</Show>
			<Show when={promptMapOpen()}>
				<PromptMapDialog
					entries={promptMapEntries()}
					onSelect={jumpToPrompt}
					onCancel={closePromptMap}
				/>
			</Show>
			<Show when={memoryBrowserOpen() && memorySnapshot()}>
				<MemoryBrowserDialog
					snapshot={memorySnapshot()!}
					onRemove={removeMemory}
					onCancel={closeMemoryBrowser}
				/>
			</Show>
			<Show when={subagentSelectorOpen()}>
				<SubagentSelectorDialog
					targets={availableSubagentTargets()}
					selectedKey={selectedTargetKey()}
					onSelect={selectSubagentTarget}
					onCancel={() => setSubagentSelectorOpen(false)}
				/>
			</Show>
			<Show when={skillSelectorOpen()}>
				<SkillSelector
					commands={commandChoices}
					onSelect={(invocation) => {
						// Behave exactly as if the user typed the invocation:
						// close first, then run it through the normal submit path.
						setSkillSelectorOpen(false);
						syncMainDraft(invocation);
						focusMainPrompt();
						void submit();
					}}
					onCancel={() => {
						setSkillSelectorOpen(false);
						focusMainPrompt();
					}}
				/>
			</Show>
			<Show when={dialog()}>
				{(request) => (
					<ExtensionDialog
						request={request()}
						onValue={(value) => void completeDialog({ value })}
						onConfirm={(confirmed) => void completeDialog({ confirmed })}
						onCancel={() => void completeDialog({ cancelled: true })}
					/>
				)}
			</Show>
		</>
	);
}
