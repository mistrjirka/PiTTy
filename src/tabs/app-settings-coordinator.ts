/** Settings flows, model switching and session navigation. */
import type { CliRenderer, Renderable } from "@opentui/core";
import type { AppOptions } from "../state/app-options.ts";
import type { AppSignals } from "../state/app-signals.ts";
import type { RpcSessionState, Toast } from "../types.ts";
import type { CommandChoice } from "../ui/command-suggestions.tsx";
import type { ModelChoice } from "../ui/model-selector.tsx";
import { buildSettingsDescriptors } from "../ui/settings-descriptors.ts";
import type { SettingsSectionDescriptor } from "../ui/settings-hub.tsx";
import {
	createExtensionModelActions,
	type ExtensionModelActions,
} from "./extension-model-actions.ts";
import { createMcpActions, type McpActions } from "./mcp-controller.ts";
import {
	cachedAvailableModels,
	createModelCatalogActions,
	type ModelCatalogActions,
} from "./model-catalog-actions.ts";
import type { ConversationTabRuntime } from "./runtime.ts";
import type { SessionController } from "./session-controller.ts";
import {
	createSessionPickerActions,
	type SessionPickerActions,
} from "./session-picker-actions.ts";
import type { ThemeViewportSnapshot } from "./settings-mutations.ts";
import {
	createSettingsMutations,
	type SettingsMutations,
} from "./settings-mutations.ts";

export interface AppSettingsCoordinatorPorts {
	props: AppOptions;
	signals: AppSignals;
	renderer: CliRenderer;
	activeRuntime: () => ConversationTabRuntime;
	toast: (text: string, tone: Toast["tone"], durationMs?: number) => void;
	streaming: () => boolean;
	loadCurrentSession: (runtime?: ConversationTabRuntime) => Promise<void>;
	refreshCommandChoices: (
		runtime: ConversationTabRuntime,
		force?: boolean,
	) => Promise<CommandChoice[]>;
	rememberThinkingLevel: (runtime: ConversationTabRuntime) => void;
	applyRememberedThinkingLevel: (
		runtime: ConversationTabRuntime,
		provider: string,
		modelId: string,
	) => Promise<void>;
	refreshState: (runtime: ConversationTabRuntime) => Promise<boolean>;
	sessionState: () => RpcSessionState | undefined;
	captureThemeViewport: () => ThemeViewportSnapshot;
	restoreThemeViewport: (viewport: ThemeViewportSnapshot) => void;
	claudeEffectiveSlot: () => number | undefined;
	openMemoryBrowser: (fromSettings?: boolean) => void;
	focusMainPrompt: () => void;
	sessionController: SessionController;
	afterSessionLoaded: (
		runtime: ConversationTabRuntime,
		historyLength: number,
	) => Promise<void>;
	touch: () => void;
	setStatus: (text: string) => void;
}
export interface AppSettingsCoordinatorActions
	extends ModelCatalogActions,
		ExtensionModelActions,
		SettingsMutations,
		McpActions,
		SessionPickerActions {
	closeSettings: () => void;
	openSettings: () => void;
	settingsDescriptors: () => SettingsSectionDescriptor[];
	closeModelSelector: () => void;
	openModelSelector: () => Promise<void>;
	selectModel: (model: ModelChoice) => Promise<void>;
}
export function createAppSettingsCoordinator(
	ports: AppSettingsCoordinatorPorts,
): AppSettingsCoordinatorActions {
	let settingsOrigin: Renderable | null = null;
	const SESSION_LOAD_REQUEST_TIMEOUT_MS = 120_000;
	const {
		renderer,
		activeRuntime,
		toast,
		loadCurrentSession,
		refreshCommandChoices,
		rememberThinkingLevel,
		applyRememberedThinkingLevel,
		refreshState,
		sessionState,
		captureThemeViewport,
		restoreThemeViewport,
		claudeEffectiveSlot,
		focusMainPrompt,
		sessionController,
		afterSessionLoaded,
		touch,
		setStatus,
	} = ports;
	const streaming = ports.streaming;
	const openMemoryBrowser = ports.openMemoryBrowser;
	const {
		modelSelectorOpen: [, setModelSelectorOpen],
		modelOptions: [modelOptions, setModelOptions],
		modelListNotice: [, setModelListNotice],
		modelSelectorLoading: [modelSelectorLoading, setModelSelectorLoading],
		settingsRoute: [settingsRoute, setSettingsRoute],
		settingsBusy: [settingsBusy, setSettingsBusy],
		settingsErrors: [settingsErrors, setSettingsErrors],
		settingsSelectedId: [, setSettingsSelectedId],
		detailSettingSelectedId: [, setDetailSettingSelectedId],
		compactionModelState: [compactionModelState, setCompactionModelState],
		subagentModelEntries: [subagentModelEntries, setSubagentModelEntries],
		selectedSubagentModelId: [
			selectedSubagentModelId,
			setSelectedSubagentModelId,
		],
		themeConfig: [themeConfig, setThemeConfig],
		themeController,
		mcpBackend,
		mcpInstallState: [mcpInstallState, setMcpInstallState],
		mcpScope: [mcpScope],
		mcpView: [, setMcpView],
		mcpSnapshot: [mcpSnapshot, setMcpSnapshot],
		mcpPreview: [mcpPreview, setMcpPreview],
		mcpError: [mcpError, setMcpError],
		mcpConfigState: [, setMcpConfigState],
		nativeMcpSummary: [, setNativeMcpSummary],
		setMcpActivationPending,
		sessionDiscovery: [, setSessionDiscovery],
		sessionSwitching: [sessionSwitching, setSessionSwitching],
		pendingSession: [pendingSession, setPendingSession],
		pendingSessionReason: [pendingSessionReason, setPendingSessionReason],
		sessionSelectorOpen: [, setSessionSelectorOpen],
		rpcAvailable: [rpcAvailable],
		commandCatalog,
		cswapSnapshot: [cswapSnapshot],
	} = ports.signals;

	const closeSettings = () => {
		setSettingsRoute("closed");
		const origin = settingsOrigin;
		settingsOrigin = null;
		queueMicrotask(() => {
			if (origin && !origin.isDestroyed) origin.focus();
			else focusMainPrompt();
		});
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
		cwd: ports.props.cwd,
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
		cwd: ports.props.cwd,
		piExecutable: ports.props.piExecutable,
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
			memoryInstalled: () => ports.props.integrations.memory.installed,
			openMemoryBrowser,
		});

	const {
		discoverCurrentSessions,
		openSessionSelector,
		closeSessionSelector,
		switchToSession,
	} = createSessionPickerActions({
		cwd: ports.props.cwd,
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

	return {
		closeSettings,
		openSettings,
		settingsDescriptors,
		fetchAvailableModels,
		loadModels,
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
		applySettingsModel,
		applySettingsThinking,
		applyThemePreset,
		applyThemeToken,
		resetTheme,
		applySettingsRename,
		openMcpSettings,
		activateMcp,
		enableBuiltinMcpInSettings,
		installMcpAdapter,
		prepareMcpMutation,
		deleteMcpServer,
		confirmMcpMutation,
		discoverCurrentSessions,
		openSessionSelector,
		closeSessionSelector,
		switchToSession,
		closeModelSelector,
		openModelSelector,
		selectModel,
	};
}
