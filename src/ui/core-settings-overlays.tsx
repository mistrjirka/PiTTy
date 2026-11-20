/** Core settings, MCP, theme and session settings dialogs. */
import { type Accessor, type Setter, Show } from "solid-js";
import type {
	McpConfigBackend,
	McpConfigSnapshot,
	McpPreview,
	McpScope,
	McpServerForm,
} from "../config/mcp-config.ts";
import type { ThemeConfigDocument } from "../config/theme-config.ts";
import type {
	ClaudeAccountChoice,
	CswapSnapshot,
} from "../integrations/claude-swap.ts";
import type { ThinkingLevel } from "../rpc/pi-rpc-client.ts";
import type { SettingsErrorMap } from "../tabs/extension-model-actions.ts";
import type { ModelPerformanceHistory } from "../tabs/model-performance-history.ts";
import type { RequestTiming } from "../tabs/request-timing.ts";
import type { RpcSessionState } from "../types.ts";
import { type SettingsRoute, settingsBackRoute } from "./app-navigation.ts";
import { ClaudeAccountSelector } from "./claude-account-selector.tsx";
import {
	type McpConfigState,
	type McpFormConfirmations,
	type McpInstallState,
	McpSettings,
	type McpSettingsView,
} from "./mcp-settings.tsx";
import { type ModelChoice, ModelSelectorDialog } from "./model-selector.tsx";
import { ProviderConnections } from "./provider-connections.tsx";
import { RecommendedPlugins } from "./recommended-plugins.tsx";
import { SessionRename, SessionSettings } from "./session-settings.tsx";
import type { SettingsAction } from "./settings-descriptors.ts";
import {
	SettingsHub,
	type SettingsSectionDescriptor,
} from "./settings-hub.tsx";
import type { ThemePalette } from "./theme.ts";
import type { ThemePresetName } from "./theme-presets.ts";
import { ThemePresetBrowser, ThemeTokenEditor } from "./theme-settings.tsx";
import {
	THINKING_LEVELS,
	type ThinkingLevelMap,
	ThinkingSelector,
	visibleThinkingLevels,
} from "./thinking-selector.tsx";

export interface CoreSettingsOverlaysProps {
	settingsRoute: Accessor<SettingsRoute>;
	setSettingsRoute: Setter<SettingsRoute>;
	settingsDescriptors: () => SettingsSectionDescriptor[];
	settingsSelectedId: Accessor<string>;
	setSettingsSelectedId: Setter<string>;
	closeSettings: () => void;
	mcpInstallState: Accessor<McpInstallState>;
	mcpConfigState: Accessor<McpConfigState>;
	mcpScope: Accessor<McpScope>;
	mcpSnapshot: Accessor<McpConfigSnapshot | undefined>;
	mcpPreview: Accessor<McpPreview | undefined>;
	mcpError: Accessor<string | undefined>;
	mcpView: Accessor<McpSettingsView>;
	setMcpView: Setter<McpSettingsView>;
	installMcpAdapter: () => void;
	setMcpScope: Setter<McpScope>;
	openMcpSettings: () => void;
	prepareMcpMutation: (
		form: McpServerForm,
		confirmations?: McpFormConfirmations,
	) => void;
	deleteMcpServer: (name: string) => void;
	confirmMcpMutation: () => void;
	setMcpPreview: Setter<McpPreview | undefined>;
	activateMcp: () => Promise<boolean>;
	mcpBackend: () => McpConfigBackend;
	enableBuiltinMcpInSettings: () => void;
	onProvidersUpdated: (id: string) => Promise<void>;
	modelOptions: Accessor<ModelChoice[]>;
	sessionState: () => RpcSessionState | undefined;
	readModelPerformanceHistory: () => ModelPerformanceHistory;
	requestTimingHistory: () => readonly RequestTiming[];
	applySettingsModel: (model: ModelChoice) => Promise<void>;
	cswapSnapshot: Accessor<CswapSnapshot | undefined>;
	claudeAccountChoice: Accessor<ClaudeAccountChoice>;
	claudeEffectiveSlot: () => number | undefined;
	chooseClaudeAccount: (choice: ClaudeAccountChoice) => void;
	settingsBusy: Accessor<SettingsAction | undefined>;
	settingsErrors: Accessor<SettingsErrorMap>;
	applySettingsThinking: (level: ThinkingLevel) => Promise<void>;
	themeConfig: Accessor<ThemeConfigDocument>;
	applyThemePreset: (preset: ThemePresetName) => void;
	applyThemeToken: (token: keyof ThemePalette, value: string) => void;
	resetTheme: () => void;
	streaming: Accessor<boolean>;
	openSessionSelector: () => void;
	applySettingsRename: (name: string) => Promise<void>;
}

export function CoreSettingsOverlays(props: CoreSettingsOverlaysProps) {
	return (
		<>
			<Show when={props.settingsRoute() === "root"}>
				<SettingsHub
					descriptors={props.settingsDescriptors}
					selectedId={props.settingsSelectedId}
					onSelected={props.setSettingsSelectedId}
					onClose={props.closeSettings}
				/>
			</Show>
			<Show when={props.settingsRoute() === "mcp"}>
				<McpSettings
					adapterState={props.mcpInstallState}
					configState={props.mcpConfigState}
					scope={props.mcpScope}
					snapshot={props.mcpSnapshot}
					preview={props.mcpPreview}
					error={props.mcpError}
					view={props.mcpView}
					onViewChange={props.setMcpView}
					onInstall={props.installMcpAdapter}
					onScope={(scope) => {
						props.setMcpScope(scope);
						props.openMcpSettings();
					}}
					onAdd={props.prepareMcpMutation}
					onDelete={props.deleteMcpServer}
					onConfirmPreview={props.confirmMcpMutation}
					onCancelPreview={() => {
						props.setMcpPreview(undefined);
						props.openMcpSettings();
					}}
					onRetryActivation={() => void props.activateMcp()}
					onBack={() => props.setSettingsRoute(settingsBackRoute("mcp"))}
					backend={props.mcpBackend}
					onEnableBuiltin={props.enableBuiltinMcpInSettings}
				/>
			</Show>
			<Show when={props.settingsRoute() === "plugins"}>
				<RecommendedPlugins onBack={() => props.setSettingsRoute("root")} />
			</Show>
			<Show when={props.settingsRoute() === "providers"}>
				<ProviderConnections onBack={() => props.setSettingsRoute("root")} onUpdated={props.onProvidersUpdated} />
			</Show>
			<Show when={props.settingsRoute() === "model"}>
				<ModelSelectorDialog
					models={props.modelOptions()}
					currentProvider={props.sessionState()?.model?.provider}
					currentModelId={props.sessionState()?.model?.id}
					performanceHistory={props.readModelPerformanceHistory}
					timingHistory={props.requestTimingHistory}
					onSelect={(model) => void props.applySettingsModel(model)}
					backLabel="esc ‹ settings"
					onCancel={() => props.setSettingsRoute("root")}
				/>
			</Show>
			<Show
				when={
					props.settingsRoute() === "claude-account" && props.cswapSnapshot()
				}
			>
				<ClaudeAccountSelector
					accounts={props.cswapSnapshot()!.accounts}
					selection={props.claudeAccountChoice()}
					effectiveSlot={props.claudeEffectiveSlot()}
					onSelect={props.chooseClaudeAccount}
					onCancel={() => props.setSettingsRoute("root")}
				/>
			</Show>
			<Show when={props.settingsRoute() === "thinking"}>
				<ThinkingSelector
					current={THINKING_LEVELS.find(
						(level) => level === props.sessionState()?.thinkingLevel,
					)}
					levels={visibleThinkingLevels(
						props.sessionState()?.model?.reasoning,
						props.sessionState()?.model?.thinkingLevelMap as
							| ThinkingLevelMap
							| undefined,
					)}
					busy={props.settingsBusy() === "thinking"}
					{...(props.settingsErrors().thinking
						? { error: props.settingsErrors().thinking }
						: {})}
					onSelect={(level) => {
						const next = THINKING_LEVELS.find(
							(candidate) => candidate === level,
						);
						if (next) void props.applySettingsThinking(next);
					}}
					onCancel={() => props.setSettingsRoute("root")}
				/>
			</Show>
			<Show when={props.settingsRoute() === "theme"}>
				<ThemePresetBrowser
					preset={() => props.themeConfig().theme.preset}
					busy={() => props.settingsBusy() === "theme"}
					error={() => props.settingsErrors().theme}
					onPreset={props.applyThemePreset}
					onCustomize={() => props.setSettingsRoute("theme-editor")}
					onCancel={() => props.setSettingsRoute("root")}
				/>
			</Show>
			<Show when={props.settingsRoute() === "theme-editor"}>
				<ThemeTokenEditor
					preset={() => props.themeConfig().theme.preset}
					overrides={() => props.themeConfig().theme.overrides}
					busy={() => props.settingsBusy() === "theme"}
					error={() => props.settingsErrors().theme}
					onToken={props.applyThemeToken}
					onReset={props.resetTheme}
					onCancel={() => props.setSettingsRoute("theme")}
				/>
			</Show>
			<Show when={props.settingsRoute() === "session"}>
				<SessionSettings
					name={props.sessionState()?.sessionName ?? ""}
					{...(props.streaming()
						? {
								switchDisabledReason: "Unavailable while Pi is props.streaming",
							}
						: {})}
					onSwitch={() => {
						if (!props.streaming()) {
							props.setSettingsRoute("session-switch");
							props.openSessionSelector();
						}
					}}
					onRename={() => props.setSettingsRoute("session-rename")}
					onCancel={() => props.setSettingsRoute("root")}
				/>
			</Show>
			<Show when={props.settingsRoute() === "session-rename"}>
				<SessionRename
					initialName={props.sessionState()?.sessionName ?? ""}
					busy={() => props.settingsBusy() === "rename"}
					error={() => props.settingsErrors().rename}
					onConfirm={(name) => void props.applySettingsRename(name)}
					onCancel={() => props.setSettingsRoute("session")}
				/>
			</Show>
		</>
	);
}
