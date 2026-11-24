import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergePerformanceHistories, parseRequestPerformance, readSubagentModelPerformanceHistory } from "../src/tabs/subagent-performance-history.ts";
import { modelPerformanceStats, recordModelPerformanceSample, readCombinedModelPerformanceHistory, saveModelPerformanceHistory, readModelPerformanceHistory } from "../src/tabs/model-performance-history.ts";
import { sidebarScopeForTarget } from "../src/ui/sidebar-scope.ts";
import { latestModelSpeed } from "../src/ui/model-speed.ts";
import type { SubagentTarget } from "../src/subagents/targets.ts";

const sample = { provider: "test", modelId: "child", ttftMs: 800, generationMs: 1200, outputTokens: 48 };

test("child history merges actual samples without rewriting main history or replaying reads", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-child-speed-"));
	const previous = process.env.XDG_STATE_HOME;
	process.env.XDG_STATE_HOME = root;
	try {
		const now = Date.now();
		const day = new Date(now).toISOString().slice(0, 10);
		const journal = path.join(root, "pi-subagent", "model-performance");
		fs.mkdirSync(journal, { recursive: true });
		const file = path.join(journal, day + ".jsonl");
		const line = (performance: typeof sample, timestamp = now) => JSON.stringify({ version: 3, timestamp, ...performance }) + "\n";
		fs.writeFileSync(file, line(sample) + line({ ...sample, generationMs: 0 }) + "malformed\n" + '{"partial":');
		const children = readSubagentModelPerformanceHistory(journal, now);
		expect(children["test\u0000child"]?.length).toBe(1);
		expect(readSubagentModelPerformanceHistory(journal, now)).toBe(children);
		const main = recordModelPerformanceSample({}, "test", "child", { ttftMs: 200, generationMs: 1200, outputTokens: 72 }, now);
		saveModelPerformanceHistory(main);
		const combined = readCombinedModelPerformanceHistory();
		expect(combined["test\u0000child"]?.length).toBe(2);
		expect(modelPerformanceStats(combined, "test", "child")?.medianOutputTokensPerSecond).toBe(50);
		expect(readCombinedModelPerformanceHistory()).toBe(combined);
		expect(readModelPerformanceHistory()["test\u0000child"]?.length).toBe(1);
		fs.appendFileSync(file, "true}\n" + line({ ...sample, outputTokens: 96 }));
		expect(readCombinedModelPerformanceHistory()["test\u0000child"]?.length).toBe(3);
		expect(readModelPerformanceHistory()["test\u0000child"]?.length).toBe(1);
	} finally {
		if (previous === undefined) delete process.env.XDG_STATE_HOME;
		else process.env.XDG_STATE_HOME = previous;
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("invalid measurements cannot masquerade as real speed", () => {
	expect(parseRequestPerformance(sample)).toEqual(sample);
	expect(parseRequestPerformance({ ...sample, outputTokens: 0 })).toBeUndefined();
	expect(parseRequestPerformance({ ...sample, generationMs: 50 })).toBeUndefined();
	expect(parseRequestPerformance({ ...sample, ttftMs: -1 })).toBeUndefined();
	expect(parseRequestPerformance({ ...sample, provider: "" })).toBeUndefined();
	expect(mergePerformanceHistories([{ "test\u0000child": [{ timestamp: 0, ttftMs: 1, outputTokensPerSecond: 3, version: 3 }] }], 32 * 86400000)).toEqual({});
});

test("selected subagent uses its own provider and latest request, not the main agent", () => {
	const target: SubagentTarget = {
		key: "child", label: "child", state: "running", active: true, canSteer: true,
		model: "test/child", run: { runId: "child", mode: "profiled", state: "running", steps: [], lastRequestPerformance: sample },
	};
	const scope = sidebarScopeForTarget(target);
	expect(scope.modelIdentity).toEqual({ provider: "test", id: "child" });
	expect(latestModelSpeed(scope.modelIdentity, scope.lastRequestPerformance, () => ({}))?.current).toEqual({ tokensPerSecond: 40, ttftMs: 800 });
	const other = sidebarScopeForTarget({ ...target, model: "test/other" });
	expect(latestModelSpeed(other.modelIdentity, other.lastRequestPerformance, () => ({}))).toBeUndefined();
});
