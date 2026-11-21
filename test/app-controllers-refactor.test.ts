import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSignal } from "solid-js";
import type {
	CompactionModelState,
	SubagentModelEntry,
} from "../src/config/extension-models.ts";
import type {
	McpConfigSnapshot,
	McpConfiguredSummary,
	McpPreview,
	McpScope,
} from "../src/config/mcp-config.ts";
import type { OptionalIntegrationStatus } from "../src/integrations/detect.ts";
import type { SessionChoice, SessionDiscoveryState } from "../src/sessions.ts";
import { CommandCatalogService } from "../src/tabs/command-catalog.ts";
import {
	createExtensionModelActions,
	type ExtensionModelPorts,
	type SettingsErrorMap,
} from "../src/tabs/extension-model-actions.ts";
import {
	createMcpActions,
	type McpControllerPorts,
	mcpInstallStateFor,
} from "../src/tabs/mcp-controller.ts";
import { createTabRuntime } from "../src/tabs/runtime.ts";
import {
	createSessionPickerActions,
	type SessionPickerPorts,
} from "../src/tabs/session-picker-actions.ts";
import type { SettingsRoute } from "../src/ui/app-navigation.ts";
import type {
	McpConfigState,
	McpInstallState,
	McpSettingsView,
} from "../src/ui/mcp-settings.tsx";
import type { ModelChoice } from "../src/ui/model-selector.tsx";
import type { SettingsAction } from "../src/ui/settings-descriptors.ts";

function integrations(
	adapter: boolean,
	builtin: boolean,
	disabled = false,
): OptionalIntegrationStatus {
	const optional = { packageName: "fixture", installed: false, detectedBy: [] };
	return {
		subagents: optional,
		todos: optional,
		mcpAdapter: { ...optional, installed: adapter },
		mcpBuiltin: {
			supported: builtin,
			disabledBySettings: disabled,
			disabledBy: [],
		},
		memory: optional,
		doppelclaude: optional,
	};
}

describe("MCP controller type-safe extraction", () => {
	test("selects native, disabled, adapter and missing installation states", () => {
		expect(mcpInstallStateFor(integrations(false, false))).toBe("missing");
		expect(mcpInstallStateFor(integrations(false, true))).toBe("native");
		expect(mcpInstallStateFor(integrations(false, true, true))).toBe(
			"native-disabled",
		);
		expect(mcpInstallStateFor(integrations(true, true, true))).toBe("ready");
	});

	test("opens scoped settings and rejects an invalid mutation without writing", async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), "pitty-mcp-actions-"));
		try {
			const runtime = createTabRuntime({ id: "test", cwd });
			const [scope] = createSignal<McpScope>("project");
			const [snapshot, setMcpSnapshot] = createSignal<McpConfigSnapshot>();
			const [preview, setMcpPreview] = createSignal<McpPreview>();
			const [configState, setMcpConfigState] =
				createSignal<McpConfigState>("empty");
			const [error, setMcpError] = createSignal<string>();
			const [view, setMcpView] = createSignal<McpSettingsView>("list");
			const [installState, setMcpInstallState] =
				createSignal<McpInstallState>("missing");
			const [, setNativeMcpSummary] = createSignal<McpConfiguredSummary>();
			const [route, setSettingsRoute] = createSignal<SettingsRoute>("closed");
			const [, setMcpActivationPending] = createSignal(false);
			const ports: McpControllerPorts = {
				cwd,
				piExecutable: undefined,
				activeRuntime: () => runtime,
				streaming: () => false,
				commandCatalog: new CommandCatalogService(),
				loadCurrentSession: async () => {},
				refreshCommandChoices: async () => [],
				mcpScope: scope,
				mcpBackend: () => "adapter",
				mcpSnapshot: snapshot,
				mcpPreview: preview,
				setMcpView,
				setMcpPreview,
				setMcpSnapshot,
				setMcpConfigState,
				setMcpError,
				setSettingsRoute,
				setMcpInstallState,
				setNativeMcpSummary,
				setMcpActivationPending,
			};
			const actions = createMcpActions(ports);
			actions.openMcpSettings();
			expect(view()).toBe("list");
			expect(route()).toBe("mcp");
			expect(configState()).toBe("empty");
			expect(snapshot()?.scope).toBe("project");
			expect(installState()).toBe("missing");
			actions.prepareMcpMutation({
				name: "bad",
				transport: "stdio",
				command: "",
			});
			expect(preview()).toBeUndefined();
			expect(error()).toContain("Command");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});

describe("session picker type-safe extraction", () => {
	test("requires confirmation for a streaming session before changing runtime", async () => {
		const runtime = createTabRuntime({ id: "current", cwd: process.cwd() });
		runtime.conversation.isStreaming = true;
		const choice: SessionChoice = {
			id: "other",
			path: "/tmp/other.jsonl",
			name: "Other",
			modified: new Date(0),
			messageCount: 2,
			firstMessage: "Example",
		};
		const [, setSessionDiscovery] = createSignal<SessionDiscoveryState>({
			kind: "loading",
		});
		const [switching, setSessionSwitching] = createSignal(false);
		const [pending, setPendingSession] = createSignal<SessionChoice>();
		const [pendingReason, setPendingSessionReason] = createSignal<
			"streaming" | "queued"
		>();
		const [selectorOpen, setSessionSelectorOpen] = createSignal(true);
		const [route, setSettingsRoute] =
			createSignal<SettingsRoute>("session-switch");
		const logs: string[] = [];
		let switched = 0;
		let loaded = 0;
		const ports: SessionPickerPorts = {
			cwd: process.cwd(),
			sessionLoadTimeoutMs: 1500,
			sessionState: () => undefined,
			setSessionDiscovery,
			sessionSwitching: switching,
			setSessionSwitching,
			pendingSession: pending,
			setPendingSession,
			pendingSessionReason: pendingReason,
			setPendingSessionReason,
			setSessionSelectorOpen,
			settingsRoute: route,
			setSettingsRoute,
			focusMainPrompt: () => {},
			activeRuntime: () => runtime,
			touch: () => {},
			sessionController: {
				switchAndLoad: async (_runtime, path, timeout) => {
					expect(path).toBe(choice.path);
					expect(timeout).toBe(1500);
					switched++;
					return { cancelled: false, historyLength: 7 };
				},
			},
			afterSessionLoaded: async (_runtime, count) => {
				loaded = count;
			},
			toast: (message) => logs.push(message),
		};
		const actions = createSessionPickerActions(ports);
		await actions.switchToSession(choice);
		expect(switched).toBe(0);
		expect(pending()).toEqual(choice);
		expect(pendingReason()).toBe("streaming");
		await actions.switchToSession(choice);
		expect(switched).toBe(1);
		expect(loaded).toBe(7);
		expect(selectorOpen()).toBe(false);
		expect(route()).toBe("root");
		expect(pending()).toBeUndefined();
		expect(switching()).toBe(false);
		expect(logs).toContain("Resumed Other");
	});
});

describe("extension model settings type-safe extraction", () => {
	test("presents the selected profile with model and thinking scope", () => {
		const runtime = createTabRuntime({ id: "current", cwd: process.cwd() });
		const [, setSettingsBusy] = createSignal<SettingsAction>();
		const [, setSettingsErrors] = createSignal<SettingsErrorMap>({});
		const [modelOptions, setModelOptions] = createSignal<ModelChoice[]>([]);
		const [compactionModelState, setCompactionModelState] =
			createSignal<CompactionModelState>();
		const profile: SubagentModelEntry = {
			id: "implementer",
			kind: "agent",
			model: "openai-codex/gpt-6",
			thinking: "medium",
			scope: "project",
			thinkingScope: "project",
			source: "profile",
			thinkingSource: "project",
		};
		const [subagentModelEntries, setSubagentModelEntries] = createSignal([
			profile,
		]);
		const [selectedSubagentModelId, setSelectedSubagentModelId] = createSignal(
			profile.id,
		);
		const [, setSettingsSelectedId] = createSignal("model");
		const [, setDetailSettingSelectedId] = createSignal("model");
		const [settingsRoute, setSettingsRoute] = createSignal<SettingsRoute>("closed");
		const [modelSelectorLoading, setModelSelectorLoading] = createSignal(false);
		const ports: ExtensionModelPorts = {
			cwd: process.cwd(),
			activeRuntime: () => runtime,
			sessionState: () => runtime.sessionState,
			refreshState: async () => true,
			settingsRoute,
			toast: () => {},
			modelSelectorLoading,
			setModelSelectorLoading,
			settingsBusy: () => undefined,
			setSettingsBusy,
			setSettingsErrors,
			setModelOptions,
			modelOptions,
			cachedModels: () => undefined,
			fetchAvailableModels: async () => [],
			compactionModelState,
			setCompactionModelState,
			subagentModelEntries,
			setSubagentModelEntries,
			selectedSubagentModelId,
			setSelectedSubagentModelId,
			setSettingsSelectedId,
			setDetailSettingSelectedId,
			setSettingsRoute,
		};
		const actions = createExtensionModelActions(ports);
		expect(actions.selectedSubagentModelEntry()).toEqual(profile);
		expect(actions.subagentListRows()).toEqual([
			{
				id: profile.id,
				label: profile.id,
				summary: "openai-codex/gpt-6 · thinking medium · profile",
			},
		]);
		expect(actions.subagentSettingsRows()[1]?.summary).toBe("medium · project");
		expect(actions.subagentModelContext()).toContain(
			"implementer: openai-codex/gpt-6",
		);
	});
});
