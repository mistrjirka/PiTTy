/** Settings-row descriptions, independent of the main App and settings overlay. */
import type { RpcSessionState } from "../types.ts";
import type { CswapSnapshot } from "../integrations/claude-swap.ts";
import type { ThemeConfigDocument } from "../config/theme-config.ts";
import type {
	CompactionModelState,
	SubagentModelEntry,
} from "../config/extension-models.ts";
import type { McpInstallState } from "./mcp-settings.tsx";
import type { SettingsSectionDescriptor } from "./settings-hub.tsx";
import type { SettingsRoute } from "./app-navigation.ts";

export type SettingsAction =
	| "model"
	| "thinking"
	| "rename"
	| "theme"
	| "compaction"
	| "subagents";
export type SettingsDescriptorPorts = {
	sessionState: () => RpcSessionState | undefined;
	rpcAvailable: () => boolean;
	settingsBusy: () => SettingsAction | undefined;
	settingsErrors: () => Partial<Record<SettingsAction, string>>;
	loadModels: (fromSettings: boolean) => Promise<boolean>;
	setRoute: (route: SettingsRoute) => void;
	compactionModelState: () => CompactionModelState | undefined;
	openCompactionSettings: () => void | Promise<void>;
	subagentModelEntries: () => SubagentModelEntry[];
	openSubagentModels: () => void | Promise<void>;
	cswapSnapshot: () => CswapSnapshot | undefined;
	claudeEffectiveSlot: () => number | undefined;
	themeConfig: () => ThemeConfigDocument;
	mcpInstallState: () => McpInstallState;
	mcpError: () => string | undefined;
	openMcpSettings: () => void;
	openProviders?: () => void;
	memoryInstalled: () => boolean;
	openMemoryBrowser: (fromSettings?: boolean) => void | Promise<void>;
};

export function buildSettingsDescriptors(
	ports: SettingsDescriptorPorts,
): SettingsSectionDescriptor[] {
	const state = ports.sessionState();
	const unavailable = ports.rpcAvailable() ? undefined : "Pi RPC unavailable";
	return [
		{
			id: "providers", label: "Provider connections", summary: () => "Accounts and API keys",
			disabledReason: () => undefined, busy: () => false, inlineError: () => undefined,
			open: () => (ports.openProviders ? ports.openProviders() : ports.setRoute("providers")),
		},
		{
			id: "plugins", label: "Recommended plugins", summary: () => "Subagents, BTW, skills, tools",
			disabledReason: () => undefined, busy: () => false, inlineError: () => undefined,
			open: () => ports.setRoute("plugins"),
		},
		{
			id: "model",
			label: "Model",
			summary: () =>
				state?.model
					? `${state.model.provider}/${state.model.id}`
					: "Unavailable",
			disabledReason: () => unavailable,
			busy: () => ports.settingsBusy() === "model",
			inlineError: () => ports.settingsErrors().model,
			open: () => {
				if (!unavailable) {
					void ports.loadModels(true);
				}
			},
		},
		{
			id: "thinking",
			label: "Thinking effort",
			summary: () => state?.thinkingLevel ?? "Unavailable",
			disabledReason: () => unavailable,
			busy: () => ports.settingsBusy() === "thinking",
			inlineError: () => ports.settingsErrors().thinking,
			open: () => {
				if (!unavailable) ports.setRoute("thinking");
			},
		},
		{
			id: "compaction",
			label: "Compaction model",
			summary: () => {
				const compaction = ports.compactionModelState();
				if (!compaction)
					return ports.settingsErrors().compaction ? "Unavailable" : "Loading…";
				if (!compaction.model) return "Extension default";
				const lanes = compaction.effectiveThinking;
				const thinking =
					lanes.audit === lanes.execution
						? ` · ${lanes.audit}`
						: ` · lanes ${lanes.audit}/${lanes.execution}`;
				const laneOverride =
					compaction.laneModels.audit || compaction.laneModels.execution
						? " · model lane"
						: "";
				return `${compaction.model}${thinking}${laneOverride}`;
			},
			disabledReason: () => undefined,
			busy: () => ports.settingsBusy() === "compaction",
			inlineError: () => ports.settingsErrors().compaction,
			open: () => void ports.openCompactionSettings(),
		},
		{
			id: "subagents",
			label: "Subagent models",
			summary: () => {
				const entries = ports.subagentModelEntries();
				if (!entries.length)
					return ports.settingsErrors().subagents ? "Unavailable" : "Loading…";
				const agents = entries.filter((entry) => entry.kind === "agent");
				return agents.length
					? `Defaults + ${agents.length} agent${agents.length === 1 ? "" : "s"}`
					: "Defaults only";
			},
			disabledReason: () => undefined,
			busy: () => ports.settingsBusy() === "subagents",
			inlineError: () => ports.settingsErrors().subagents,
			open: () => void ports.openSubagentModels(),
		},
		...(ports.cswapSnapshot()?.accounts.length
			? [
					{
						id: "claude-account",
						label: "Claude usage account (cswap)",
						summary: () =>
							ports
								.cswapSnapshot()
								?.accounts.find((a) => a.number === ports.claudeEffectiveSlot())
								?.label ?? "Automatic",
						disabledReason: () => undefined,
						busy: () => false,
						inlineError: () => undefined,
						open: () => ports.setRoute("claude-account"),
					},
				]
			: []),
		{
			id: "session",
			label: "Session",
			summary: () => state?.sessionName || "Unnamed",
			disabledReason: () => unavailable,
			busy: () => false,
			inlineError: () => ports.settingsErrors().rename,
			open: () => {
				if (!unavailable) ports.setRoute("session");
			},
		},
		{
			id: "theme",
			label: "Theme",
			summary: () => ports.themeConfig().theme.preset,
			disabledReason: () => undefined,
			busy: () => ports.settingsBusy() === "theme",
			inlineError: () => ports.settingsErrors().theme,
			open: () => ports.setRoute("theme"),
		},
		{
			id: "mcp",
			label: "MCP servers",
			summary: () =>
				ports.mcpInstallState() === "ready"
					? "Adapter ready"
					: ports.mcpInstallState() === "native"
						? "Built-in MCP"
						: ports.mcpInstallState() === "native-disabled"
							? "Built-in MCP disabled"
							: "Adapter optional",
			disabledReason: () => undefined,
			busy: () => ports.mcpInstallState() === "installing",
			inlineError: () => ports.mcpError(),
			open: ports.openMcpSettings,
		},
		{
			id: "memory",
			label: "Memory",
			summary: () =>
				ports.memoryInstalled()
					? "Browse, search, remove"
					: "Requires pi-hermes-memory",
			disabledReason: () =>
				ports.memoryInstalled() ? undefined : "Install pi-hermes-memory",
			busy: () => false,
			inlineError: () => undefined,
			open: () => ports.openMemoryBrowser(true),
		},
	];
}
