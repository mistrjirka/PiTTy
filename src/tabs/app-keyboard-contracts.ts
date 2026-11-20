/** Type-checked actions passed to keyboard routing from the active PiTTy App. */
import type {
	CliRenderer,
	TextareaRenderable,
	ScrollBoxRenderable,
} from "@opentui/core";
import type { Accessor, Setter } from "solid-js";
import type { RpcExtensionUIRequest, Toast } from "../types.ts";
import type { ConversationTabRuntime } from "./runtime.ts";
import type { TabManager } from "./manager.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { CommandChoice } from "../ui/command-suggestions.tsx";
import type { McpSettingsView } from "../ui/mcp-settings.tsx";
import type { SettingsRoute } from "../ui/app-navigation.ts";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";

export type KeyboardPorts = {
	abortActiveWork: () => void;
	cancelPendingEdit: () => void;
	activateTab: (id: string) => void;
	activeRuntime: () => ConversationTabRuntime;
	availableSubagentTargets: Accessor<SubagentTarget[]>;
	backgroundSelection: Accessor<
		{ runtimeId: string; sessionId: string; id: string } | undefined
	>;
	clearMainDraft: () => void;
	closeBackgroundTask: () => void;
	closeMemoryBrowser: () => void;
	closeNotification: () => void;
	closePromptMap: () => void;
	closeSessionSelector: () => void;
	closeSettings: () => void;
	closeSubagentInspector: () => void;
	closeTodo: () => void;
	commandSuggestionIndex: Accessor<number>;
	commandSuggestions: Accessor<CommandChoice[]>;
	compactionExpanded: Accessor<boolean>;
	completeDialog: (response: {
		value?: string;
		confirmed?: boolean;
		cancelled?: true;
	}) => Promise<void>;
	copySelection: () => boolean;
	cycleSubagent: (direction: 1 | -1) => void;
	cycleThinkingEffort: () => Promise<void>;
	dialog: Accessor<RpcExtensionUIRequest | undefined>;
	dimensions: Accessor<{ width: number; height: number }>;
	displaySubagentTargets: Accessor<SubagentTarget[]>;
	expandedPromptText: () => string;
	expandedTools: Accessor<boolean>;
	focusMainPrompt: () => void;
	forkPickerOpen: Accessor<boolean>;
	getPrompt: () => TextareaRenderable | undefined;
	getScroll: () => ScrollBoxRenderable | undefined;
	getSubagentScroll: () => ScrollBoxRenderable | undefined;
	insertSuggestedCommand: (command: CommandChoice) => void;
	inspectSubagent: () => boolean;
	logger: DiagnosticLogger;
	mcpView: Accessor<McpSettingsView>;
	memoryBrowserOpen: Accessor<boolean>;
	modelSelectorOpen: Accessor<boolean>;
	notificationDetailId: Accessor<string | undefined>;
	openMemoryBrowser: (fromSettings?: boolean) => void;
	openModelSelector: () => Promise<void>;
	openPromptMap: () => void;
	openSettings: () => void;
	promptMapOpen: Accessor<boolean>;
	renderer: CliRenderer;
	requestPauseSubagent: () => void;
	requestStopSubagent: () => void;
	restoreQueuedFollowUp: () => void;
	sessionSelectorOpen: Accessor<boolean>;
	setAllThinkingExpanded: (expanded: boolean) => void;
	setCommandSuggestionIndex: Setter<number>;
	setCompactionExpanded: Setter<boolean>;
	setExpandedToolIds: (value: Set<string>) => void;
	setExpandedTools: Setter<boolean>;
	setInspectSubagent: (value: boolean) => void;
	setMcpView: Setter<McpSettingsView>;
	setModelSelectorOpen: Setter<boolean>;
	setPromptCursorOffset: Setter<number>;
	setSelectedTargetKey: (key: string | undefined) => void;
	setSettingsRoute: Setter<SettingsRoute>;
	setSidebarEnabled: Setter<boolean>;
	setSubagentSelectorOpen: Setter<boolean>;
	settingsRoute: Accessor<SettingsRoute>;
	skillSelectorOpen: Accessor<boolean>;
	streaming: Accessor<boolean>;
	subagentSelectorOpen: Accessor<boolean>;
	subagentsAvailable: Accessor<boolean>;
	syncMainDraft: (text: string, preservePastes?: boolean) => void;
	tabManager: TabManager;
	thinkingExpanded: Accessor<boolean>;
	toast: (text: string, tone?: Toast["tone"], duration?: number) => void;
	todoDetailId: Accessor<string | undefined>;
	updateScrollPosition: () => void;
};
