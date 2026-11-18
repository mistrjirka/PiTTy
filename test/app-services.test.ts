import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import type { PendingSteerEntry } from "../src/state/input-continuity.ts";
import {
	buildSettingsDescriptors,
	type SettingsDescriptorPorts,
} from "../src/ui/settings-descriptors.ts";
import { createSubagentControlActions } from "../src/subagents/action-controller.ts";

function settingsFixture() {
	const routes: string[] = [];
	let rpc = false;
	let mcp: "native-disabled" | "native" = "native-disabled";
	let memory = false;
	const ports: SettingsDescriptorPorts = {
		sessionState: () => undefined,
		rpcAvailable: () => rpc,
		settingsBusy: () => undefined,
		settingsErrors: () => ({}),
		loadModels: async () => true,
		setRoute: (route) => {
			routes.push(route);
		},
		compactionModelState: () => undefined,
		openCompactionSettings: () => {},
		subagentModelEntries: () => [],
		openSubagentModels: () => {},
		cswapSnapshot: () => undefined,
		claudeEffectiveSlot: () => undefined,
		themeConfig: () => ({
			version: 1,
			theme: { preset: "PiTTy Midnight", overrides: {} },
		}),
		mcpInstallState: () => mcp,
		mcpError: () => undefined,
		openMcpSettings: () => {},
		memoryInstalled: () => memory,
		openMemoryBrowser: () => {},
	};
	return {
		ports,
		routes,
		setRpc(value: boolean) {
			rpc = value;
		},
		setMcp(value: "native-disabled" | "native") {
			mcp = value;
		},
		setMemory(value: boolean) {
			memory = value;
		},
	};
}

describe("extracted settings descriptors", () => {
	test("preserves model and session RPC guards", () => {
		const fixture = settingsFixture();
		const model = buildSettingsDescriptors(fixture.ports).find(
			(entry) => entry.id === "model",
		);
		const session = buildSettingsDescriptors(fixture.ports).find(
			(entry) => entry.id === "session",
		);
		expect(model?.disabledReason()).toBe("Pi RPC unavailable");
		model?.open();
		expect(fixture.routes).toEqual([]);
		expect(session?.disabledReason()).toBe("Pi RPC unavailable");
		fixture.setRpc(true);
		expect(
			buildSettingsDescriptors(fixture.ports)
				.find((entry) => entry.id === "session")
				?.disabledReason(),
		).toBeUndefined();
		session?.open();
		expect(fixture.routes).toEqual([]);
		buildSettingsDescriptors(fixture.ports)
			.find((entry) => entry.id === "session")
			?.open();
		expect(fixture.routes).toEqual(["session"]);
	});

	test("reports MCP mode and memory availability without raw technical IDs", () => {
		const fixture = settingsFixture();
		const read = (id: string) =>
			buildSettingsDescriptors(fixture.ports).find((entry) => entry.id === id);
		expect(read("mcp")?.summary()).toBe("Built-in MCP disabled");
		fixture.setMcp("native");
		expect(read("mcp")?.summary()).toBe("Built-in MCP");
		expect(read("memory")?.disabledReason()).toBe("Install pi-hermes-memory");
		fixture.setMemory(true);
		expect(read("memory")?.disabledReason()).toBeUndefined();
	});
});

describe("extracted subagent controls", () => {
	test("does not send steering without a selected steerable agent", () => {
		const messages: string[] = [];
		const [, setPendingSteers] = createSignal<PendingSteerEntry[]>([]);
		const ports: Parameters<typeof createSubagentControlActions>[0] = {
			selectedTarget: () => undefined,
			inspectorOpen: () => true,
			runtimeAvailable: () => true,
			setPendingSteers,
			clearDraft: () => {},
			touch: () => {},
			logger: { info: () => {}, error: () => {} },
			toast: (message) => {
				messages.push(message);
			},
		};
		const actions = createSubagentControlActions(ports);
		actions.sendSubagentSteer("Continue");
		actions.requestPauseSubagent();
		actions.requestResumeSubagent();
		actions.requestStopSubagent();
		expect(messages).toEqual([
			"This subagent is not currently steerable",
			"No steerable subagent selected",
			"No steerable subagent selected",
			"No steerable subagent selected",
		]);
	});
});
