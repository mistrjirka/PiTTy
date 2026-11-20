import { afterEach, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { asyncRunsRoot } from "../../src/subagents/artifacts.ts";
import { subagentTargets } from "../../src/subagents/targets.ts";
import type { SubagentRun, ToolItem } from "../../src/types.ts";

export const roots: string[] = [];
// Isolate profiled discovery per test: fixtures live under this base (see
// profiledFixture) so host /tmp leftovers and sibling fixtures never leak
// into exact-count assertions. Uses the literal env name (not the src export)
// so these tests still import cleanly when src is stashed for the
// failing-before proof.
const ORIGINAL_PROFILED_ROOT = process.env.PI_PITTY_PROFILED_ROOT;

export function useIsolatedSubagentRoots(): void {
	beforeEach(() => {
		const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-profiled-isolated-"));
		roots.push(isolated);
		process.env.PI_PITTY_PROFILED_ROOT = isolated;
	});
	afterEach(() => {
		for (const root of roots.splice(0))
			fs.rmSync(root, { recursive: true, force: true });
		if (ORIGINAL_PROFILED_ROOT === undefined) delete process.env.PI_PITTY_PROFILED_ROOT;
		else process.env.PI_PITTY_PROFILED_ROOT = ORIGINAL_PROFILED_ROOT;
	});
}

export function run(): SubagentRun {
	const root = asyncRunsRoot();
	fs.mkdirSync(root, { recursive: true });
	const asyncDir = fs.mkdtempSync(path.join(root, "pi-oc-test-"));
	roots.push(asyncDir);
	return {
		runId: "run-1",
		asyncDir,
		mode: "single",
		state: "running",
		steps: [],
	};
}

export function profiledFixture() {
	const base = process.env.PI_PITTY_PROFILED_ROOT?.trim() || os.tmpdir();
	const runtimeRoot = fs.mkdtempSync(path.join(base, "pi-profiled-subagents-test-"));
	roots.push(runtimeRoot);
	const treeId = `tree-${Date.now()}-${Math.random()}`;
	const writeAgent = (name: string, value: Record<string, unknown>) => {
		const controlDir = fs.mkdtempSync(path.join(runtimeRoot, `${name}-`));
		fs.mkdirSync(path.join(controlDir, "control", "steer-requests"), { recursive: true });
		fs.mkdirSync(path.join(controlDir, "control", "acks"), { recursive: true });
		const statusPath = path.join(controlDir, "status.json");
		fs.writeFileSync(statusPath, JSON.stringify({
			version: 1, runtime: "profiled-subagents", treeId, updatedAt: Date.now(), ...value,
		}));
		return { controlDir, statusPath };
	};
	return { runtimeRoot, treeId, writeAgent };
}

const MISSION_CHILD_KEYS = [
	"logic",
	"types",
	"smell",
	"architecture",
	"reuse",
	"security",
] as const;

export function capturedMission(
	ownerSessionId: string,
	workflowRunId: string,
	status = "active",
) {
	return {
		schemaVersion: 1,
		id: "captured-mission",
		title: "[prompt redacted]",
		objective: "[prompt redacted]",
		status,
		createdAt: "2026-08-15T14:22:59.000Z",
		updatedAt: "2026-08-15T14:23:00.000Z",
		ownerSessionId,
		runs: [],
		workflowChildren: MISSION_CHILD_KEYS.map((key, index) => ({
			workflowRunId,
			key: `impl-check-${key}`,
			status: "running",
			agent: `impl-check-${key}`,
			startedAt: "2026-08-15T14:22:59.000Z",
			updatedAt: "2026-08-15T14:23:00.000Z",
			runId: `child-${index}`,
			artifactPaths: [],
			sessionPath: `/tmp/child-${index}.jsonl`,
			heartbeat: {
				status: "running",
				updatedAt: "2026-08-15T14:23:01.000Z",
			},
		})),
		decisions: [],
		artifacts: [],
		receipts: [],
	};
}

export function writeMissionFixture(root: string, name: string, value: unknown): void {
	fs.writeFileSync(path.join(root, `${name}.json`), JSON.stringify(value));
}

export function streamHarness() {
	const fixture = profiledFixture();
	const now = Date.now();
	const writeEvents = (controlDir: string, lines: Array<Record<string, unknown> | string>) => {
		let seq = 0;
		const body = lines
			.map((line) => typeof line === "string" ? line : JSON.stringify({ v: 1, seq: seq++, ts: now, runId: "stream-child", ...line }))
			.join("\n") + "\n";
		fs.writeFileSync(path.join(controlDir, "events.jsonl"), body);
	};
	const spawnTool = (agent: { controlDir: string; statusPath: string }, agentId: string, status: ToolItem["status"] = "done"): ToolItem => ({
		kind: "tool", id: `spawn-${agentId}`, toolCallId: `spawn-${agentId}-call`, name: "agent_spawn",
		args: { agent: "explore" }, output: "", details: {
			runtime: "profiled-subagents", treeId: fixture.treeId, parentAgentId: "root", agentId, profile: "explore",
			label: agentId, state: "running", controlDir: agent.controlDir, statusPath: agent.statusPath,
		}, timestamp: now, status, isError: false,
	});
	const liveTarget = (agentId: string, tools: ToolItem[]) =>
		subagentTargets([], tools).find((target) => target.run.agentId === agentId);
	return { fixture, now, writeEvents, spawnTool, liveTarget };
}

export function streamAgent(fixture: ReturnType<typeof profiledFixture>, name: string, agentId: string, extra: Record<string, unknown> = {}) {
	return fixture.writeAgent(name, {
		agentId, profile: "explore", parentAgentId: "root", label: agentId, state: "running", startedAt: Date.now(), ...extra,
	});
}
