import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { DiagnosticLogger } from "../src/diagnostics/logger.ts";
import type { OptionalIntegrationStatus } from "../src/integrations/detect.ts";
import {
	createAppSignals,
	type AppSignalsOptions,
} from "../src/state/app-signals.ts";
import {
	createFooterModel,
	type FooterModelPorts,
} from "../src/tabs/footer-model.ts";
import { createTabRuntime } from "../src/tabs/runtime.ts";

const absent = { packageName: "fixture", installed: false, detectedBy: [] };
const integrations: OptionalIntegrationStatus = {
	subagents: absent,
	todos: absent,
	mcpAdapter: absent,
	mcpBuiltin: { supported: false, disabledBySettings: false, disabledBy: [] },
	memory: absent,
	doppelclaude: absent,
};

describe("extracted App state owner", () => {
	test("initializes exact signal defaults without starting a Pi process", () => {
		const options: AppSignalsOptions = {
			sidebar: false,
			cwd: process.cwd(),
			logger: new DiagnosticLogger({ enabled: false }),
			integrations,
			themeConfig: undefined,
			themeController: undefined,
		};
		const state = createAppSignals(options);
		expect(state.sidebarEnabled[0]()).toBe(false);
		expect(state.settingsRoute[0]()).toBe("closed");
		expect(state.tabManager.snapshot.activeId).toBe("main");
		expect(state.activeTabId[0]()).toBe("main");
		expect(state.runtimeMap[0]().size).toBe(0);
		expect(state.mcpInstallState[0]()).toBe("missing");
		expect(state.themeConfig[0]().theme.preset).toBe("PiTTy Midnight");
		expect(
			state.commandChoices[0]().some((command) => command.name === "help"),
		).toBe(true);
		state.sidebarEnabled[1](true);
		state.settingsRoute[1]("theme");
		expect(state.sidebarEnabled[0]()).toBe(true);
		expect(state.settingsRoute[0]()).toBe("theme");
	});

	test("does not let a missing adapter imply that native MCP is active", () => {
		const state = createAppSignals({
			sidebar: true,
			cwd: process.cwd(),
			logger: new DiagnosticLogger({ enabled: false }),
			integrations,
			themeConfig: undefined,
			themeController: undefined,
		});
		expect(state.mcpBackend()).toBe("adapter");
		expect(state.mcpConfiguredSummary()).toBeUndefined();
	});
});

describe("extracted footer model", () => {
	test("bounds untrusted extension status to one visible terminal row", () => {
		const runtime = createTabRuntime({ id: "main", cwd: process.cwd() });
		const [status, setStatus] = createSignal("ready");
		const ports: FooterModelPorts = {
			forkingConversation: () => false,
			status,
			setStatus,
			streaming: () => false,
			activeRuntime: () => runtime,
			inspectSubagent: () => false,
			availableSubagentTargets: () => [],
			dimensions: () => ({ width: 160, height: 45 }),
			claudeUsage: () => undefined,
			cswapSnapshot: () => undefined,
			claudeEffectiveSlot: () => undefined,
			claudeHint: () => undefined,
			codexUsage: () => undefined,
			codexUsageStats: () => ({}),
			opencodeUsage: () => undefined,
			opencodeUsageStats: () => ({}),
			clockNow: () => 1000,
		};
		const footer = createFooterModel(ports);
		expect(footer.footerStatusText()).toBe("● ready");
		expect(footer.footerHintText().length).toBeGreaterThan(0);
		footer.setExtensionStatus("\u001b[31mworking\nother line\u001b[0m");
		expect(status()).not.toContain("\u001b");
		expect(status()).not.toContain("\n");
		expect(status().length).toBeLessThanOrEqual(80);
	});
});
