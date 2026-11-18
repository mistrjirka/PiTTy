/** Owns MCP config, preview, install and activation actions for one PiTTy UI. */
import type { Accessor, Setter } from "solid-js";
import {
	commitMcpMutation,
	enableBuiltinMcp,
	loadMcpConfig,
	loadNativeMcpSummary,
	type McpConfigBackend,
	type McpConfigSnapshot,
	type McpConfiguredSummary,
	type McpPreview,
	type McpScope,
	type McpServerForm,
	previewMcpMutation,
} from "../config/mcp-config.ts";
import {
	detectOptionalIntegrations,
	installOptionalIntegrationAsync,
	type OptionalIntegrationStatus,
} from "../integrations/detect.ts";
import type { SettingsRoute } from "../ui/app-navigation.ts";
import type { CommandChoice } from "../ui/command-suggestions.tsx";
import type {
	McpConfigState,
	McpFormConfirmations,
	McpInstallState,
	McpSettingsView,
} from "../ui/mcp-settings.tsx";
import type { CommandCatalogService } from "./command-catalog.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

export function mcpInstallStateFor(
	integrations: OptionalIntegrationStatus,
): McpInstallState {
	if (integrations.mcpAdapter.installed) return "ready";
	if (integrations.mcpBuiltin.supported) {
		return integrations.mcpBuiltin.disabledBySettings
			? "native-disabled"
			: "native";
	}
	return "missing";
}

export interface McpControllerPorts {
	readonly cwd: string;
	readonly piExecutable: string | undefined;
	readonly activeRuntime: () => ConversationTabRuntime;
	readonly streaming: Accessor<boolean>;
	readonly commandCatalog: Pick<CommandCatalogService, "invalidate">;
	readonly loadCurrentSession: (
		runtime: ConversationTabRuntime,
	) => Promise<void>;
	readonly refreshCommandChoices: (
		runtime: ConversationTabRuntime,
		force: boolean,
	) => Promise<CommandChoice[]>;
	readonly mcpScope: Accessor<McpScope>;
	readonly mcpBackend: () => McpConfigBackend;
	readonly mcpSnapshot: Accessor<McpConfigSnapshot | undefined>;
	readonly mcpPreview: Accessor<McpPreview | undefined>;
	readonly setMcpView: Setter<McpSettingsView>;
	readonly setMcpPreview: Setter<McpPreview | undefined>;
	readonly setMcpSnapshot: Setter<McpConfigSnapshot | undefined>;
	readonly setMcpConfigState: Setter<McpConfigState>;
	readonly setMcpError: Setter<string | undefined>;
	readonly setSettingsRoute: Setter<SettingsRoute>;
	readonly setMcpInstallState: Setter<McpInstallState>;
	readonly setNativeMcpSummary: Setter<McpConfiguredSummary | undefined>;
	readonly setMcpActivationPending: Setter<boolean>;
}

export interface McpActions {
	openMcpSettings: () => void;
	activateMcp: () => Promise<boolean>;
	enableBuiltinMcpInSettings: () => void;
	installMcpAdapter: () => void;
	prepareMcpMutation: (
		form: McpServerForm,
		confirmations?: McpFormConfirmations,
	) => void;
	deleteMcpServer: (name: string) => void;
	confirmMcpMutation: () => void;
}

export function createMcpActions(ports: McpControllerPorts): McpActions {
	const openMcpSettings = () => {
		const snapshot = loadMcpConfig(
			ports.mcpScope(),
			ports.cwd,
			undefined,
			ports.mcpBackend(),
		);
		ports.setMcpView("list");
		ports.setMcpPreview(undefined);
		ports.setMcpSnapshot(snapshot);
		ports.setMcpConfigState(
			snapshot.readOnlyReason
				? "malformed-readonly"
				: Object.keys(snapshot.servers).length
					? "loaded"
					: "empty",
		);
		ports.setMcpError(undefined);
		ports.setSettingsRoute("mcp");
	};
	const activateMcp = async (): Promise<boolean> => {
		const runtime = ports.activeRuntime();
		try {
			const sessionFile = runtime.sessionState?.sessionFile;
			if (!sessionFile)
				throw new Error("Pi did not report a current session file.");
			await runtime.client.restart(sessionFile);
			const integrations = detectOptionalIntegrations({
				...(ports.piExecutable ? { piExecutable: ports.piExecutable } : {}),
				cwd: ports.cwd,
			});
			const nextState = mcpInstallStateFor(integrations);
			ports.setMcpInstallState(nextState);
			ports.setNativeMcpSummary(
				nextState === "ready" ? undefined : loadNativeMcpSummary(ports.cwd),
			);
			await ports.loadCurrentSession(runtime);
			ports.commandCatalog.invalidate(runtime.client);
			await ports.refreshCommandChoices(runtime, true);
			ports.setMcpConfigState("saved-active");
			ports.setMcpActivationPending(false);
			return true;
		} catch (error) {
			ports.setMcpConfigState("saved-inactive-retry");
			ports.setMcpError(error instanceof Error ? error.message : String(error));
			return false;
		}
	};
	const enableBuiltinMcpInSettings = () => {
		void enableBuiltinMcp(ports.cwd)
			.then(async (result) => {
				if (!result.changed.length) {
					ports.setMcpError(
						"No -builtin:mcp entry was found in settings.json.",
					);
					return;
				}
				ports.setMcpError(undefined);
				const integrations = detectOptionalIntegrations({
					...(ports.piExecutable ? { piExecutable: ports.piExecutable } : {}),
					cwd: ports.cwd,
				});
				const nextState = mcpInstallStateFor(integrations);
				ports.setMcpInstallState(nextState);
				ports.setNativeMcpSummary(
					nextState === "ready" ? undefined : loadNativeMcpSummary(ports.cwd),
				);
				if (ports.streaming()) {
					ports.setMcpActivationPending(true);
					ports.setMcpConfigState("saved-pending-busy");
				} else await activateMcp();
			})
			.catch((error: unknown) => {
				ports.setMcpError(
					error instanceof Error ? error.message : String(error),
				);
			});
	};
	const installMcpAdapter = () => {
		ports.setMcpInstallState("installing");
		void installOptionalIntegrationAsync("pi-mcp-adapter", {
			...(ports.piExecutable ? { piExecutable: ports.piExecutable } : {}),
			cwd: ports.cwd,
		})
			.then(async (result) => {
				if (!result.ok) {
					ports.setMcpInstallState("install-failed");
					ports.setMcpError(
						`Failed to install ${result.packageName}; command ${result.command.join(" ")}; exit ${result.exitCode ?? "unknown"}; log ${result.logPath}`,
					);
					return;
				}
				ports.setMcpInstallState("ready");
				if (ports.streaming()) {
					ports.setMcpActivationPending(true);
					ports.setMcpConfigState("saved-pending-busy");
				} else await activateMcp();
			})
			.catch((error: unknown) => {
				ports.setMcpInstallState("install-failed");
				ports.setMcpError(
					error instanceof Error ? error.message : String(error),
				);
			});
	};
	const prepareMcpMutation = (
		form: McpServerForm,
		confirmations: McpFormConfirmations = {},
	) => {
		const snapshot = ports.mcpSnapshot();
		if (!snapshot) return;
		try {
			ports.setMcpPreview(
				previewMcpMutation(
					snapshot,
					{ kind: "upsert", server: form },
					confirmations.confirmPlaintext === true,
					confirmations.confirmDuplicate === true,
				),
			);
			ports.setMcpConfigState("mutation-preview");
			ports.setMcpError(undefined);
		} catch (error) {
			ports.setMcpError(error instanceof Error ? error.message : String(error));
		}
	};
	const deleteMcpServer = (name: string) => {
		const snapshot = ports.mcpSnapshot();
		if (!snapshot) return;
		try {
			ports.setMcpPreview(
				previewMcpMutation(snapshot, { kind: "delete", name }),
			);
			ports.setMcpConfigState("mutation-preview");
		} catch (error) {
			ports.setMcpError(error instanceof Error ? error.message : String(error));
		}
	};
	const confirmMcpMutation = () => {
		const preview = ports.mcpPreview();
		if (!preview) return;
		void commitMcpMutation(preview)
			.then(async () => {
				ports.setMcpSnapshot(
					loadMcpConfig(
						ports.mcpScope(),
						ports.cwd,
						undefined,
						ports.mcpBackend(),
					),
				);
				if (ports.mcpBackend() === "native")
					ports.setNativeMcpSummary(loadNativeMcpSummary(ports.cwd));
				ports.setMcpPreview(undefined);
				if (ports.streaming()) {
					ports.setMcpActivationPending(true);
					ports.setMcpConfigState("saved-pending-busy");
				} else await activateMcp();
			})
			.catch((error: unknown) => {
				ports.setMcpConfigState("saved-inactive-retry");
				ports.setMcpError(
					error instanceof Error ? error.message : String(error),
				);
			});
	};

	return {
		openMcpSettings,
		activateMcp,
		enableBuiltinMcpInSettings,
		installMcpAdapter,
		prepareMcpMutation,
		deleteMcpServer,
		confirmMcpMutation,
	};
}
