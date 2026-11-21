import { afterEach, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExtensionModelActions, type ExtensionModelPorts } from "../src/tabs/extension-model-actions.ts";
import type { SettingsRoute } from "../src/ui/app-navigation.ts";
import type { SettingsAction } from "../src/ui/settings-descriptors.ts";
import type { CompactionModelState } from "../src/config/extension-models.ts";
import type { RpcSessionState } from "../src/types.ts";
import type { ConversationTabRuntime } from "../src/tabs/runtime.ts";

const roots: string[] = [];
afterEach(() => { for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

test("Compaction settings exposes and saves the selected two-model soft target", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-target-action-"));
	roots.push(root);
	const project = path.join(root, "project");
	const agentDir = path.join(root, "agent");
	fs.mkdirSync(project, { recursive: true });
	fs.mkdirSync(agentDir, { recursive: true });
	const global = path.join(agentDir, "one-round-compaction.json");
	fs.writeFileSync(global, JSON.stringify({ targetPostCompactTokens: 20_000, model: "provider/model", lanes: { audit: { thinkingLevel: "high" } } }));
	const previousDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const [route, setRoute] = createSignal<SettingsRoute>("compaction");
		const [busy, setBusy] = createSignal<SettingsAction | undefined>();
		const [compactionState, setCompactionState] = createSignal<CompactionModelState>();
		const [error, setError] = createSignal<Record<string, string>>({});
		const [models, setModels] = createSignal<import("../src/ui/model-selector.tsx").ModelChoice[]>([]);
		const [subagents, setSubagents] = createSignal<import("../src/config/extension-models.ts").SubagentModelEntry[]>([]);
		const [selectedSubagent, setSelectedSubagent] = createSignal("defaults");
		const [selectedSetting, setSelectedSetting] = createSignal("");
		const [selectedDetail, setSelectedDetail] = createSignal("");
		const [loading, setLoading] = createSignal(false);
		const ports: ExtensionModelPorts = {
			cwd: project,
			activeRuntime: () => ({ startupResolved: true }) as ConversationTabRuntime,
			sessionState: () => ({ compactionMethod: "extension", cacheMaintenance: "compact" }) as RpcSessionState,
			refreshState: async () => true,
			settingsRoute: route, setSettingsRoute: setRoute,
			toast: () => {},
			modelSelectorLoading: loading, setModelSelectorLoading: setLoading,
			settingsBusy: busy, setSettingsBusy: setBusy,
			setSettingsErrors: setError,
			setModelOptions: setModels, modelOptions: models, cachedModels: () => undefined,
			fetchAvailableModels: async () => [],
			compactionModelState: compactionState, setCompactionModelState: setCompactionState,
			subagentModelEntries: subagents, setSubagentModelEntries: setSubagents,
			selectedSubagentModelId: selectedSubagent, setSelectedSubagentModelId: setSelectedSubagent,
			setSettingsSelectedId: setSelectedSetting,
			setDetailSettingSelectedId: setSelectedDetail,
		};
		const actions = createExtensionModelActions(ports);
		expect(await actions.refreshCompactionModel()).toBe(true);
		expect(actions.compactionSettingsRows().find((row) => row.id === "target")).toMatchObject({
			label: "Target after compaction", summary: expect.stringContaining("20,000 tokens"),
		});
		actions.openCompactionSetting("target");
		expect(route()).toBe("compaction-target");
		expect(actions.compactionSettingsRows().some((row) => row.id === "target:50000")).toBe(true);
		actions.openCompactionSetting("target:50000");
		for (let i = 0; i < 200 && busy(); i++) await new Promise<void>((resolve) => setTimeout(resolve, 5));
		expect(error().compaction).toBeUndefined();
		expect(compactionState()?.targetPostCompactTokens).toBe(50_000);
		expect(selectedDetail()).toBe("target");
		expect(JSON.parse(fs.readFileSync(global, "utf8"))).toMatchObject({
			targetPostCompactTokens: 50_000, model: "provider/model", lanes: { audit: { thinkingLevel: "high" } },
		});
	} finally {
		if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousDir;
	}
});
