/** Single owner for PiTTy UI signals, live tab registry, and settings state. */
import { createSignal, type Signal, type Setter } from "solid-js";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import type { OptionalIntegrationStatus } from "../integrations/detect.ts";
import type { ThemeConfigDocument } from "../config/theme-config.ts";
import { createThemeController, type ThemeController } from "../ui/theme.ts";
import { mcpInstallStateFor } from "../tabs/mcp-controller.ts";
import {
	loadNativeMcpSummary,
	type McpConfigBackend,
	type McpConfigSnapshot,
	type McpConfiguredSummary,
	type McpPreview,
	type McpScope,
} from "../config/mcp-config.ts";
import type {
	McpConfigState,
	McpInstallState,
	McpSettingsView,
} from "../ui/mcp-settings.tsx";
import type { SettingsRoute } from "../ui/app-navigation.ts";
import type { SettingsAction } from "../ui/settings-descriptors.ts";
import type { SettingsErrorMap } from "../tabs/extension-model-actions.ts";
import type {
	CompactionModelState,
	SubagentModelEntry,
} from "../config/extension-models.ts";
import type { PendingSteerEntry } from "../state/input-continuity.ts";
import type { CodexUsage } from "../integrations/codex-usage.ts";
import type { OpencodeUsage } from "../integrations/opencode-usage.ts";
import type { ClaudeUsage } from "../integrations/doppelclaude-usage.ts";
import { readClaudeAccountPreference } from "../config/claude-account.ts";
import type {
	CswapSnapshot,
	ClaudeAccountChoice,
} from "../integrations/claude-swap.ts";
import type { UsageStats } from "../integrations/codex-usage-history.ts";
import type { RpcExtensionUIRequest, Toast } from "../types.ts";
import type { SessionChoice, SessionDiscoveryState } from "../sessions.ts";
import type { MemorySnapshot } from "../integrations/memory-store.ts";
import {
	CommandCatalogService,
	localCommandChoices,
} from "../tabs/command-catalog.ts";
import type { CommandChoice } from "../ui/command-suggestions.tsx";
import type { ModelChoice } from "../ui/model-selector.tsx";
import type { ForkPickerOption } from "../tabs/entry-index.ts";
import {
	TabManager,
	type ConversationTab,
	type TabManagerState,
} from "../tabs/manager.ts";
import { ExtensionRequestRouter } from "../tabs/extension-router.ts";
import type { ConversationTabRuntime } from "../tabs/runtime.ts";

export interface AppSignalsOptions {
	sidebar: boolean;
	cwd: string;
	logger: DiagnosticLogger;
	integrations: OptionalIntegrationStatus;
	themeConfig: ThemeConfigDocument | undefined;
	themeController: ThemeController | undefined;
}

export interface AppSignals {
	revision: Signal<number>;
	conversationRevision: Signal<number>;
	conversationStructureRevision: Signal<number>;
	compactionRevision: Signal<number>;
	messageWindowStart: Signal<number>;
	sidebarEnabled: Signal<boolean>;
	expandedTools: Signal<boolean>;
	showJumpLatest: Signal<boolean>;
	pendingSteers: Signal<PendingSteerEntry[]>;
	autoRetryEnabled: Signal<boolean>;
	spinnerIndex: Signal<number>;
	clockNow: Signal<number>;
	codexUsage: Signal<CodexUsage | undefined>;
	codexUsageStats: Signal<Record<number, UsageStats>>;
	claudeUsage: Signal<ClaudeUsage | undefined>;
	cswapSnapshot: Signal<CswapSnapshot | undefined>;
	claudeAccountChoice: Signal<ClaudeAccountChoice>;
	claudeHint: Signal<string | undefined>;
	opencodeUsage: Signal<OpencodeUsage | undefined>;
	opencodeUsageStats: Signal<Record<number, UsageStats>>;
	subagentSelectorOpen: Signal<boolean>;
	dialog: Signal<RpcExtensionUIRequest | undefined>;
	dialogOwnerRuntimeId: Signal<string | undefined>;
	modelSelectorOpen: Signal<boolean>;
	modelOptions: Signal<ModelChoice[]>;
	modelListNotice: Signal<string | undefined>;
	modelSelectorLoading: Signal<boolean>;
	sessionSelectorOpen: Signal<boolean>;
	skillSelectorOpen: Signal<boolean>;
	forkPickerOpen: Signal<boolean>;
	forkPickerOptionsSignal: Signal<ForkPickerOption[]>;
	compactionSummaryExpanded: Signal<boolean>;
	settingsRoute: Signal<SettingsRoute>;
	mcpScope: Signal<McpScope>;
	mcpView: Signal<McpSettingsView>;
	mcpSnapshot: Signal<McpConfigSnapshot | undefined>;
	mcpPreview: Signal<McpPreview | undefined>;
	mcpError: Signal<string | undefined>;
	mcpInstallState: Signal<McpInstallState>;
	nativeMcpSummary: Signal<McpConfiguredSummary | undefined>;
	mcpBackend: () => McpConfigBackend;
	mcpConfiguredSummary: () => McpConfiguredSummary | undefined;
	mcpConfigState: Signal<McpConfigState>;
	settingsSelectedId: Signal<string>;
	rpcAvailable: Signal<boolean>;
	settingsBusy: Signal<SettingsAction | undefined>;
	settingsErrors: Signal<SettingsErrorMap>;
	compactionModelState: Signal<CompactionModelState | undefined>;
	subagentModelEntries: Signal<SubagentModelEntry[]>;
	selectedSubagentModelId: Signal<string>;
	detailSettingSelectedId: Signal<string>;
	themeConfig: Signal<ThemeConfigDocument>;
	themeController: ThemeController;
	sessionDiscovery: Signal<SessionDiscoveryState>;
	sessionSwitching: Signal<boolean>;
	pendingSession: Signal<SessionChoice | undefined>;
	pendingSessionReason: Signal<"streaming" | "queued" | undefined>;
	promptMapOpen: Signal<boolean>;
	memoryBrowserOpen: Signal<boolean>;
	memorySnapshot: Signal<MemorySnapshot | undefined>;
	thinkingExpanded: Signal<boolean>;
	compactionExpanded: Signal<boolean>;
	promptText: Signal<string>;
	promptCursorOffset: Signal<number>;
	commandCatalog: CommandCatalogService;
	commandChoices: Signal<CommandChoice[]>;
	commandSuggestionIndex: Signal<number>;
	toasts: Signal<Toast[]>;
	tabManager: TabManager;
	tabState: Signal<TabManagerState>;
	activeTabId: Signal<string>;
	runtimeMap: Signal<Map<string, ConversationTabRuntime>>;
	extensionRouter: ExtensionRequestRouter;
	provisionalRuntimes: Set<ConversationTabRuntime>;
	setMcpActivationPending: Setter<boolean>;
}

export function createAppSignals(options: AppSignalsOptions): AppSignals {
	const [revision, setRevision] = createSignal(0);

	const [conversationRevision, setConversationRevision] = createSignal(0);

	const [conversationStructureRevision, setConversationStructureRevision] =
		createSignal(0);

	const [compactionRevision, setCompactionRevision] = createSignal(0);

	const [messageWindowStart, setMessageWindowStart] = createSignal(0);

	const [sidebarEnabled, setSidebarEnabled] = createSignal(options.sidebar);

	const [expandedTools, setExpandedTools] = createSignal(false);

	const [showJumpLatest, setShowJumpLatest] = createSignal(false);

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

	const [claudeAccountChoice, setClaudeAccountChoice] =
		createSignal<ClaudeAccountChoice>(readClaudeAccountPreference());

	const [claudeHint, setClaudeHint] = createSignal<string>();

	const [opencodeUsage, setOpencodeUsage] = createSignal<OpencodeUsage>();

	const [opencodeUsageStats, setOpencodeUsageStats] = createSignal<
		Record<number, UsageStats>
	>({});

	const [subagentSelectorOpen, setSubagentSelectorOpen] = createSignal(false);

	const [dialog, setDialog] = createSignal<RpcExtensionUIRequest>();

	const [dialogOwnerRuntimeId, setDialogOwnerRuntimeId] =
		createSignal<string>();

	const [modelSelectorOpen, setModelSelectorOpen] = createSignal(false);

	const [modelOptions, setModelOptions] = createSignal<ModelChoice[]>([]);

	const [modelListNotice, setModelListNotice] = createSignal<string>();

	const [modelSelectorLoading, setModelSelectorLoading] = createSignal(false);

	const [sessionSelectorOpen, setSessionSelectorOpen] = createSignal(false);

	const [skillSelectorOpen, setSkillSelectorOpen] = createSignal(false);

	const [forkPickerOpen, setForkPickerOpen] = createSignal(false);

	const [forkPickerOptionsSignal, setForkPickerOptions] = createSignal<
		ForkPickerOption[]
	>([]);

	const [compactionSummaryExpanded, setCompactionSummaryExpanded] =
		createSignal(false);

	const [settingsRoute, setSettingsRoute] =
		createSignal<SettingsRoute>("closed");

	const [mcpScope, setMcpScope] = createSignal<McpScope>("global");

	const [mcpView, setMcpView] = createSignal<McpSettingsView>("list");

	const [mcpSnapshot, setMcpSnapshot] = createSignal<McpConfigSnapshot>();

	const [mcpPreview, setMcpPreview] = createSignal<McpPreview>();

	const [mcpError, setMcpError] = createSignal<string>();

	const [mcpInstallState, setMcpInstallState] = createSignal<McpInstallState>(
		mcpInstallStateFor(options.integrations),
	);

	const [nativeMcpSummary, setNativeMcpSummary] = createSignal<
		McpConfiguredSummary | undefined
	>(
		options.integrations.mcpBuiltin.supported &&
			!options.integrations.mcpAdapter.installed
			? loadNativeMcpSummary(options.cwd)
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
		options.themeConfig ?? {
			version: 1,
			theme: { preset: "PiTTy Midnight", overrides: {} },
		},
	);

	const themeController = options.themeController ?? createThemeController();

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

	// Thoughts start collapsed to one muted heading each; the transcript reads
	// as answers and tool rows. The thinking slash command flips the default.
	const [thinkingExpanded, setThinkingExpanded] = createSignal(false);

	const [compactionExpanded, setCompactionExpanded] = createSignal(false);

	const [promptText, setPromptText] = createSignal("");

	const [promptCursorOffset, setPromptCursorOffset] = createSignal(0);

	const commandCatalog = new CommandCatalogService(30_000, (error) =>
		options.logger.warn("ui.commands_sync_failed", error),
	);

	const [commandChoices, setCommandChoices] =
		createSignal<CommandChoice[]>(localCommandChoices);

	const [commandSuggestionIndex, setCommandSuggestionIndex] = createSignal(0);

	const [toasts, setToasts] = createSignal<Toast[]>([]);

	const initialTab: ConversationTab = { id: "main", badges: 0 };

	const tabManager = new TabManager(initialTab);

	const [tabState, setTabState] = createSignal(tabManager.snapshot);

	const [activeTabId, setActiveTabId] = createSignal(
		tabManager.snapshot.activeId,
	);

	const [runtimeMap, setRuntimeMap] = createSignal<
		Map<string, ConversationTabRuntime>
	>(new Map());

	const extensionRouter = new ExtensionRequestRouter();

	const provisionalRuntimes = new Set<ConversationTabRuntime>();
	return {
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
		nativeMcpSummary: [nativeMcpSummary, setNativeMcpSummary],
		mcpBackend: mcpBackend,
		mcpConfiguredSummary: mcpConfiguredSummary,
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
		themeController: themeController,
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
		commandCatalog: commandCatalog,
		commandChoices: [commandChoices, setCommandChoices],
		commandSuggestionIndex: [commandSuggestionIndex, setCommandSuggestionIndex],
		toasts: [toasts, setToasts],
		tabManager: tabManager,
		tabState: [tabState, setTabState],
		activeTabId: [activeTabId, setActiveTabId],
		runtimeMap: [runtimeMap, setRuntimeMap],
		extensionRouter: extensionRouter,
		provisionalRuntimes: provisionalRuntimes,
		setMcpActivationPending,
	};
}
