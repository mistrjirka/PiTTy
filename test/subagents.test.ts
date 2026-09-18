import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	pauseSubagent,
	resumeSubagent,
	steerSubagent,
	stopSubagent,
} from "../src/subagents/control.ts";
import {
	applyDerivedChildTranscript,
	asyncRunsRoot,
	childRunIdFromSessionFile,
	listSubagentRuns,
	matchesSubagentSession,
	readSubagentRun,
	resolveLiveChildTranscriptPath,
	subagentTempRoot,
} from "../src/subagents/artifacts.ts";
import {
	listMissionRuns,
	mergeMissionRuns,
} from "../src/subagents/missions.ts";
import {
	readSubagentConversation,
	readSubagentTranscript,
	subagentActivityAt,
	substantiveSubagentActivityAt,
} from "../src/subagents/transcript.ts";
import { createSubagentTranscriptCache } from "../src/subagents/transcript-cache.ts";
import { safeProfiledControlDir } from "../src/subagents/profiled-paths.ts";
import { isSubagentFamilyToolName, PROFILED_HEARTBEAT_MAX_AGE_MS, profiledRunIsLive, profiledSubagentRunsFromTools } from "../src/subagents/profiled.ts";
import {
	ownedSubagentTargetsForItems,
	reconcileSubagentSelection,
	subagentRunIdFromTool,
	subagentTargetAncestors,
	subagentTargetDescendants,
	subagentTargetParent,
	subagentTargets,
	subagentTreeRows,
	targetsForTool,
	targetContextUsage,
	type SubagentTarget,
} from "../src/subagents/targets.ts";
import { initialItems } from "../src/state/conversation.ts";
import type { AssistantItem, ConversationItem, SubagentRun, SubagentStep, ToolItem } from "../src/types.ts";
import { isSpawnToolItem, spawnGroupRowText } from "../src/ui/spawn-group.tsx";
import { clip, stateIcon } from "../src/ui/model-context.tsx";

const roots: string[] = [];
// Isolate profiled discovery per test: fixtures live under this base (see
// profiledFixture) so host /tmp leftovers and sibling fixtures never leak
// into exact-count assertions. Uses the literal env name (not the src export)
// so these tests still import cleanly when src is stashed for the
// failing-before proof.
const ORIGINAL_PROFILED_ROOT = process.env.PI_PITTY_PROFILED_ROOT;
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

function run(): SubagentRun {
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

function profiledFixture() {
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

function capturedMission(
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

function writeMissionFixture(root: string, name: string, value: unknown): void {
	fs.writeFileSync(path.join(root, `${name}.json`), JSON.stringify(value));
}

describe("profiled subagent control paths", () => {
	test("accepts a control directory when only the temp root is reached through an OS-style symlink alias", () => {
		const realTmp = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-profiled-real-tmp-"));
		const aliasTmp = path.join(os.tmpdir(), `pitty-profiled-alias-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		fs.symlinkSync(realTmp, aliasTmp, "dir");
		roots.push(aliasTmp, realTmp);

		const runtimeRoot = path.join(realTmp, "pi-profiled-subagents-test");
		const controlDir = path.join(runtimeRoot, "agent-1");
		fs.mkdirSync(controlDir, { recursive: true });
		const aliasedControlDir = path.join(aliasTmp, "pi-profiled-subagents-test", "agent-1");

		expect(safeProfiledControlDir(aliasedControlDir, aliasTmp)).toBe(path.resolve(aliasedControlDir));
	});

	test("rejects a symlinked profiled runtime root even when its target stays inside the temp tree", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-profiled-root-link-"));
		roots.push(tmp);
		const realRuntime = path.join(tmp, "real-runtime");
		const controlDir = path.join(realRuntime, "agent-1");
		fs.mkdirSync(controlDir, { recursive: true });
		const linkedRuntime = path.join(tmp, "pi-profiled-subagents-linked");
		fs.symlinkSync(realRuntime, linkedRuntime, "dir");

		expect(safeProfiledControlDir(path.join(linkedRuntime, "agent-1"), tmp)).toBeUndefined();
	});

	test("rejects a symlinked profiled control directory", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-profiled-control-link-"));
		roots.push(tmp);
		const runtimeRoot = path.join(tmp, "pi-profiled-subagents-test");
		const realControl = path.join(tmp, "real-control");
		fs.mkdirSync(runtimeRoot, { recursive: true });
		fs.mkdirSync(realControl, { recursive: true });
		const linkedControl = path.join(runtimeRoot, "agent-1");
		fs.symlinkSync(realControl, linkedControl, "dir");

		expect(safeProfiledControlDir(linkedControl, tmp)).toBeUndefined();
	});
});


describe("profiled liveness and usage", () => {
	test("uses fresh heartbeats, rejects heartbeat-dead or terminal runs, and reads session usage", () => {
		const fixture = profiledFixture();
		const now = Date.now();
		const statusPath = path.join(fixture.runtimeRoot, "status.json");
		fs.writeFileSync(statusPath, "{}");
		const base: SubagentRun = { runId: "profiled:test", mode: "profiled", state: "running", steps: [], statusPath };
		expect(profiledRunIsLive({ ...base, state: "completed" }, now)).toBe(false);
		expect(profiledRunIsLive({ ...base, lastUpdate: now - 1_000 }, now)).toBe(true);
		expect(profiledRunIsLive({ ...base, lastUpdate: now - PROFILED_HEARTBEAT_MAX_AGE_MS - 1 }, now)).toBe(false);
		expect(profiledRunIsLive({ ...base, statusPath: undefined, profiledToolInFlight: false }, now)).toBe(false);

		const sessionPath = path.join(fixture.runtimeRoot, "child.jsonl");
		fs.writeFileSync(sessionPath, JSON.stringify({ timestamp: new Date(now).toISOString(), type: "message", message: {
			role: "assistant", usage: { input: 100, cacheRead: 20, cacheWrite: 5 },
		} }) + "\n");
		const agent = fixture.writeAgent("usage-agent", {
			agentId: "jett", profile: "explore", parentAgentId: "root", label: "bounded usage", state: "running",
			startedAt: now, sessionPath, model: "provider/model",
		});
		const tool: ToolItem = {
			kind: "tool", id: "profiled-usage", toolCallId: "profiled-usage-call", name: "agent_spawn",
			args: { agent: "explore" }, output: "", details: {
				runtime: "profiled-subagents", treeId: fixture.treeId, parentAgentId: "root", agentId: "jett", profile: "explore",
				label: "bounded usage", controlDir: agent.controlDir, statusPath: agent.statusPath,
			}, timestamp: now, status: "done", isError: false,
		};
		const target = subagentTargets([], [tool], { contextWindowForModel: () => 1_000 }).find((entry) => entry.run.agentId === "jett");
		expect(target).toBeDefined();
		expect(targetContextUsage(target!)).toBe("125 / 1K");
		expect(target!.lastUpdate).toBeDefined();
	});
});

	test("fresh-heartbeat runs owned by a dead Pi read unresponsive, not resident", () => {
		const fixture = profiledFixture();
		const now = Date.now();
		// A spawned-and-exited helper owns a pid that is certainly dead (barring
		// reuse, which the heartbeat still bounds), while the current process's
		// own pid is certainly alive.
		const helper = spawnSync(process.execPath, ["-e", ""]);
		if (typeof helper.pid !== "number") throw new Error("expected a helper pid");
		const deadPid = helper.pid;
		const writePidAgent = (pid: number, name: string, state: string) => {
			// Control directories are `<owning-pid>-<agent>-<random>`; mkdtemp
			// appends the random suffix while keeping the pid segment.
			const controlDir = fs.mkdtempSync(path.join(fixture.runtimeRoot, `${pid}-${name}-`));
			const statusPath = path.join(controlDir, "status.json");
			fs.writeFileSync(statusPath, JSON.stringify({
				version: 1, runtime: "profiled-subagents", treeId: fixture.treeId,
				agentId: name, profile: "explore", parentAgentId: "root", label: name,
				state, startedAt: now, updatedAt: now,
			}));
			return { controlDir, statusPath };
		};
		const writeTool = (agent: { controlDir: string; statusPath: string }, agentId: string): ToolItem => ({
			kind: "tool", id: `spawn-${agentId}`, toolCallId: `spawn-${agentId}-call`, name: "agent_spawn",
			args: { agent: "explore" }, output: "", details: {
				runtime: "profiled-subagents", treeId: fixture.treeId, parentAgentId: "root", agentId, profile: "explore",
				label: agentId, state: "idle", controlDir: agent.controlDir, statusPath: agent.statusPath,
			}, timestamp: now, status: "done", isError: false,
		});
		const deadAgent = writePidAgent(deadPid, "dead-orphan", "idle");
		const liveAgent = writePidAgent(process.pid, "live-child", "idle");
		const deadRun: SubagentRun = {
			runId: "profiled:dead", mode: "profiled", state: "idle", steps: [],
			profiledStatusBacked: true, lastUpdate: now,
			controlDir: deadAgent.controlDir, statusPath: deadAgent.statusPath,
		};
		expect(profiledRunIsLive(deadRun, now)).toBe(false);
		expect(profiledRunIsLive({
			...deadRun, runId: "profiled:live",
			controlDir: liveAgent.controlDir, statusPath: liveAgent.statusPath,
		}, now)).toBe(true);
		const deadTarget = subagentTargets([], [writeTool(deadAgent, "dead-orphan")]).find((target) => target.run.agentId === "dead-orphan");
		expect(deadTarget?.state).toBe("unresponsive");
		expect(deadTarget?.run.activityState).toBe("unresponsive");
		expect(deadTarget?.active).toBe(false);
		const liveTarget = subagentTargets([], [writeTool(liveAgent, "live-child")]).find((target) => target.run.agentId === "live-child");
		expect(liveTarget?.state).toBe("idle");
		expect(liveTarget?.active).toBe(true);
	});

	test("keeps deleted-control history inactive and fresh status-backed runs active", () => {
		const fixture = profiledFixture();
		const now = Date.now();
		const writeTool = (agent: { controlDir: string; statusPath: string }, agentId: string): ToolItem => ({
			kind: "tool", id: `spawn-${agentId}`, toolCallId: `spawn-${agentId}-call`, name: "agent_spawn",
			args: { agent: "explore" }, output: "", details: {
				runtime: "profiled-subagents", treeId: fixture.treeId, parentAgentId: "root", agentId, profile: "explore",
				label: agentId, state: "running", controlDir: agent.controlDir, statusPath: agent.statusPath,
			}, timestamp: now, status: "done", isError: false,
		});

		const historyAgent = fixture.writeAgent("history-agent", {
			agentId: "history", profile: "explore", parentAgentId: "root", label: "history", state: "running", startedAt: now,
		});
		fs.rmSync(historyAgent.statusPath);
		const historyTarget = subagentTargets([], [writeTool(historyAgent, "history")]).find((target) => target.run.agentId === "history");
		expect(historyTarget).toBeDefined();
		expect(historyTarget?.active).toBe(false);

		const freshAgent = fixture.writeAgent("fresh-agent", {
			agentId: "fresh", profile: "explore", parentAgentId: "root", label: "fresh", state: "running", startedAt: now, updatedAt: now,
		});
		const freshTarget = subagentTargets([], [writeTool(freshAgent, "fresh")]).find((target) => target.run.agentId === "fresh");
		expect(freshTarget?.active).toBe(true);
		expect(freshTarget?.state).toBe("running");

		const unresponsiveAgent = fixture.writeAgent("unresponsive-agent", {
			agentId: "unresponsive", profile: "explore", parentAgentId: "root", label: "unresponsive", state: "running", startedAt: now,
			updatedAt: now - PROFILED_HEARTBEAT_MAX_AGE_MS - 1,
		});
		const unresponsiveTarget = subagentTargets([], [writeTool(unresponsiveAgent, "unresponsive")]).find((target) => target.run.agentId === "unresponsive");
		expect(unresponsiveTarget?.active).toBe(false);
		expect(unresponsiveTarget?.state).toBe("unresponsive");
		expect(unresponsiveTarget?.run.activityState).toBe("unresponsive");
	});

	test("projects terminal profiled states truthfully across restart scenarios", () => {
		const fixture = profiledFixture();
		const now = Date.now();
		const old = now - PROFILED_HEARTBEAT_MAX_AGE_MS - 1;
		const writeTool = (
			agent: { controlDir: string; statusPath: string },
			agentId: string,
			overrides: { status?: ToolItem["status"]; timestamp?: number } = {},
		): ToolItem => ({
			kind: "tool", id: `spawn-${agentId}`, toolCallId: `spawn-${agentId}-call`, name: "agent_spawn",
			args: { agent: "explore" }, output: "", details: {
				runtime: "profiled-subagents", treeId: fixture.treeId, parentAgentId: "root", agentId, profile: "explore",
				label: agentId, state: "running", controlDir: agent.controlDir, statusPath: agent.statusPath,
			}, timestamp: overrides.timestamp ?? now, status: overrides.status ?? "done", isError: false,
		});
		const find = (agentId: string, tools: ToolItem[]) =>
			subagentTargets([], tools).find((target) => target.run.agentId === agentId);

		// Scenario 1: status file present, state=completed, spawn tool done.
		// A finished child must stay `completed` even with a dead heartbeat.
		const completedAgent = fixture.writeAgent("completed-agent", {
			agentId: "completed", profile: "explore", parentAgentId: "root", label: "completed",
			state: "completed", startedAt: old, updatedAt: old,
		});
		const completed = find("completed", [writeTool(completedAgent, "completed")]);
		expect(completed?.state).toBe("completed");
		expect(completed?.run.activityState).toBe("completed");
		expect(completed?.active).toBe(false);

		// Terminal failure passes through untouched too (never `unresponsive`).
		const failedAgent = fixture.writeAgent("failed-agent", {
			agentId: "failed", profile: "explore", parentAgentId: "root", label: "failed",
			state: "failed", startedAt: old, updatedAt: old,
		});
		const failed = find("failed", [writeTool(failedAgent, "failed")]);
		expect(failed?.state).toBe("failed");
		expect(failed?.run.activityState).toBe("failed");
		expect(failed?.active).toBe(false);

		// Scenario 2: control dir deleted (extension removes it at Pi
		// shutdown), spawn tool done.
		const goneAgent = fixture.writeAgent("gone-agent", {
			agentId: "gone", profile: "explore", parentAgentId: "root", label: "gone",
			state: "running", startedAt: old,
		});
		fs.rmSync(goneAgent.controlDir, { recursive: true, force: true });
		const gone = find("gone", [writeTool(goneAgent, "gone")]);
		expect(gone?.state).toBe("completed");
		expect(gone?.active).toBe(false);

		// Scenario 3: control dir deleted, spawn tool still pending — the
		// frozen spawn-time state must not read live.
		const frozenAgent = fixture.writeAgent("frozen-agent", {
			agentId: "frozen", profile: "explore", parentAgentId: "root", label: "frozen",
			state: "running", startedAt: old,
		});
		fs.rmSync(frozenAgent.controlDir, { recursive: true, force: true });
		const frozen = find("frozen", [writeTool(frozenAgent, "frozen", { status: "pending", timestamp: old })]);
		expect(frozen?.active).toBe(false);
		expect(frozen?.state).toBe("unresponsive");
		expect(frozen?.run.activityState).toBe("unresponsive");

		// Scenario 4: status file present with an expired heartbeat, tool pending.
		const unresponsiveAgent = fixture.writeAgent("unresponsive-pending-agent", {
			agentId: "unresponsive-pending", profile: "explore", parentAgentId: "root", label: "unresponsive-pending",
			state: "running", startedAt: old, updatedAt: old,
		});
		const unresponsivePending = find("unresponsive-pending", [writeTool(unresponsiveAgent, "unresponsive-pending", { status: "pending", timestamp: old })]);
		expect(unresponsivePending?.state).toBe("unresponsive");
		expect(unresponsivePending?.run.activityState).toBe("unresponsive");
		expect(unresponsivePending?.active).toBe(false);

		// Freshness bound on the status-less branch: an in-flight spawn is
		// live only while its own timestamp is fresh (foreground children).
		const live: SubagentRun = {
			runId: "profiled:fresh-foreground", mode: "profiled", state: "running", steps: [],
			profiledToolInFlight: true, lastUpdate: now - 1_000,
		};
		expect(profiledRunIsLive(live, now)).toBe(true);
		expect(profiledRunIsLive({ ...live, lastUpdate: old }, now)).toBe(false);
		expect(profiledRunIsLive({ ...live, lastUpdate: undefined }, now)).toBe(false);
		expect(profiledRunIsLive({ ...live, profiledToolInFlight: false }, now)).toBe(false);
	});

describe("subagent controls", () => {
	test("discovers profiled root and nested agents from one tree without duplicating the spawn", () => {
		const fixture = profiledFixture();
		const startedAt = Date.now();
		const rootAgent = fixture.writeAgent("root-agent", {
			agentId: "max", profile: "implementer", parentAgentId: "root", label: "backend", state: "running", startedAt,
			model: "provider/model", thinking: "medium", sessionPath: path.join(fixture.runtimeRoot, "max.jsonl"),
		});
		fixture.writeAgent("nested-agent", {
			agentId: "zoe", profile: "explore", parentAgentId: "max", label: "explore", state: "waiting", startedAt: startedAt + 1,
			sessionPath: path.join(fixture.runtimeRoot, "zoe.jsonl"), waitingForParent: true,
		});
		const tool: ToolItem = {
			kind: "tool", id: "spawn-tool", toolCallId: "call-spawn", name: "agent_spawn",
			args: { agent: "implementer", prompt: "implement it" }, output: "Started background agent @max.",
			details: {
				runtime: "profiled-subagents", treeId: fixture.treeId, parentAgentId: "root", agentId: "max", profile: "implementer",
				label: "backend", controlDir: rootAgent.controlDir, statusPath: rootAgent.statusPath, state: "running", startedAt,
			},
			timestamp: startedAt, status: "done", isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(targets).toHaveLength(2);
		expect(targets.map((target) => [target.run.profile, target.run.parentAgentId, target.state]).sort()).toEqual([
			["explore", "max", "waiting"],
			["implementer", "root", "running"],
		]);
		expect(targets.every((target) => target.run.control === "profiled" && target.canSteer)).toBe(true);
	});

	test("profiled controls support steer/stop but deliberately reject pause/resume", () => {
		const fixture = profiledFixture();
		const agent = fixture.writeAgent("agent", {
			agentId: "max", profile: "implementer", parentAgentId: "root", label: "implementer", state: "running", startedAt: Date.now(),
		});
		const target: SubagentRun = {
			runId: "profiled:test", control: "profiled", runtime: "profiled-subagents", controlDir: agent.controlDir, statusPath: agent.statusPath,
			mode: "profiled", state: "running", agent: "implementer", profile: "implementer", agentId: "max", treeId: fixture.treeId, parentAgentId: "root", steps: [],
		};
		const steer = steerSubagent(target, "focus on the compiler error");
		const steerDir = path.join(agent.controlDir, "control", "steer-requests");
		const requestFiles = fs.readdirSync(steerDir);
		expect(requestFiles).toHaveLength(1);
		expect(JSON.parse(fs.readFileSync(path.join(steerDir, requestFiles[0]!), "utf8")).message).toBe("focus on the compiler error");
		expect(steer.requestId.length).toBeGreaterThan(0);
		stopSubagent(target);
		expect(JSON.parse(fs.readFileSync(path.join(agent.controlDir, "control", "stop.json"), "utf8")).type).toBe("stop");
		expect(() => pauseSubagent(target)).toThrow("Pause/resume is not supported by profiled subagents");
		expect(() => resumeSubagent(target)).toThrow("Pause/resume is not supported by profiled subagents");
	});

	test("projects the captured mission shape into six scoped read-only children", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mission-test-"));
		roots.push(root);
		const workflowRunId = "workflow-captured";
		const owner = path.join(root, "sessions", "current.jsonl");
		const mission = capturedMission(owner, workflowRunId);
		writeMissionFixture(root, "mission", mission);

		const runs = listMissionRuns({ sessionFile: owner }, process.cwd(), root);
		const targets = subagentTargets(runs);
		expect(targets).toHaveLength(6);
		expect(targets.map((target) => target.key).sort()).toEqual(
			mission.workflowChildren
				.map((child) => `${workflowRunId}:${child.key}`)
				.sort(),
		);
		expect(
			targets.every(
				(target) =>
					target.active &&
					!target.canSteer &&
					Boolean(target.sessionFile) &&
					target.parentWorkflowRunId === workflowRunId,
			),
		).toBe(true);
		expect(runs[0]?.startedAt).toBe(Date.parse("2026-08-15T14:22:59.000Z"));
		expect(runs[0]?.lastUpdate).toBe(Date.parse("2026-08-15T14:23:01.000Z"));
		expect(listMissionRuns({}, process.cwd(), root)).toEqual([]);
		expect(
			listMissionRuns(
				{ sessionFile: path.join(root, "other.jsonl") },
				process.cwd(),
				root,
			),
		).toEqual([]);

		const terminalTool: ToolItem = {
			kind: "tool",
			id: "captured-workflow",
			toolCallId: workflowRunId,
			name: "subagent",
			args: {},
			output: "stopped",
			details: {
				mode: "workflow",
				runId: workflowRunId,
				workflow: {
					trace: mission.workflowChildren.map((child) => ({
						operation: "run",
						key: child.key,
						agent: child.agent,
						state: "stopped",
					})),
				},
			},
			timestamp: Date.parse("2026-08-15T14:23:02.000Z"),
			status: "error",
			isError: true,
		};
		const terminalTargets = subagentTargets(runs, [terminalTool]);
		expect(terminalTargets).toHaveLength(6);
		expect(terminalTargets.every((target) => target.state === "stopped")).toBe(
			true,
		);
		expect(terminalTargets.every((target) => Boolean(target.sessionFile))).toBe(
			true,
		);
		expect(terminalTargets.map((target) => target.key).sort()).toEqual(
			targets.map((target) => target.key).sort(),
		);

		const persisted: SubagentRun = {
			runId: workflowRunId,
			mode: "workflow",
			state: "completed",
			steps: [],
		};
		expect(
			mergeMissionRuns(
				[persisted],
				{ sessionFile: owner },
				process.cwd(),
				root,
			),
		).toEqual([persisted]);
	});

	test("projects paused and stopped children without dropping running siblings", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mission-status-"));
		roots.push(root);
		const workflowRunId = "workflow-statuses";
		const owner = path.join(root, "sessions", "current.jsonl");
		const mission = capturedMission(owner, workflowRunId);
		mission.workflowChildren[0]!.status = "paused";
		mission.workflowChildren[0]!.heartbeat.status = "paused";
		mission.workflowChildren[1]!.status = "stopped";
		mission.workflowChildren[1]!.heartbeat.status = "stopped";
		writeMissionFixture(root, "mission", mission);

		const runs = listMissionRuns({ sessionFile: owner }, process.cwd(), root);
		const targets = subagentTargets(runs);
		expect(targets).toHaveLength(6);
		expect(targets.map((target) => [target.key, target.state]).sort()).toEqual(
			mission.workflowChildren
				.map((child) => [
					`${workflowRunId}:${child.key}`,
					child.heartbeat.status,
				])
				.sort(),
		);
		expect(targets.slice(2).every((target) => target.active)).toBe(true);
		expect(targets.slice(2).every((target) => target.canSteer === false)).toBe(
			true,
		);
		expect(targets[0]?.active).toBe(false);
		expect(targets[0]?.canSteer).toBe(false);
		expect(targets[1]?.active).toBe(false);
		expect(targets[1]?.canSteer).toBe(false);
	});

	test("derives the upstream project mission directory from the session path", () => {
		const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-root-"));
		roots.push(agentRoot);
		const projectRoot = path.join(agentRoot, "project");
		const owner = path.join(agentRoot, "sessions", "current.jsonl");
		const workflowRunId = "workflow-derived-root";
		const digest = createHash("sha256")
			.update(path.resolve(projectRoot))
			.digest("hex");
		const missionRoot = path.join(agentRoot, "missions", "projects", digest);
		fs.mkdirSync(missionRoot, { recursive: true });
		writeMissionFixture(
			missionRoot,
			"mission",
			capturedMission(owner, workflowRunId),
		);
		expect(
			listMissionRuns({ sessionFile: owner }, projectRoot).map(
				(run) => run.runId,
			),
		).toEqual([workflowRunId]);
	});

	test("fails closed for terminal, malformed, or ambiguous mission children", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mission-invalid-"));
		roots.push(root);
		const owner = path.join(root, "sessions", "current.jsonl");
		const workflowRunId = "workflow-ambiguous";
		const mission = capturedMission(owner, workflowRunId);
		writeMissionFixture(root, "first", mission);
		writeMissionFixture(root, "second", {
			...mission,
			id: "duplicate-mission",
		});
		expect(
			listMissionRuns({ sessionFile: owner }, process.cwd(), root),
		).toEqual([]);

		fs.rmSync(path.join(root, "second.json"));
		writeMissionFixture(root, "first", { ...mission, status: "failed" });
		expect(
			listMissionRuns({ sessionFile: owner }, process.cwd(), root),
		).toEqual([]);

		const malformedHeartbeat = capturedMission(owner, workflowRunId);
		malformedHeartbeat.workflowChildren[0]!.heartbeat.updatedAt = "not-a-date";
		writeMissionFixture(root, "first", malformedHeartbeat);
		expect(
			listMissionRuns({ sessionFile: owner }, process.cwd(), root),
		).toEqual([]);

		const duplicateKey = capturedMission(owner, workflowRunId);
		duplicateKey.workflowChildren[1]!.key =
			duplicateKey.workflowChildren[0]!.key;
		writeMissionFixture(root, "first", duplicateKey);
		expect(
			listMissionRuns({ sessionFile: owner }, process.cwd(), root),
		).toEqual([]);
	});
	test("uses the same uid-scoped temp root as pi-subagents", () => {
		if (process.getuid)
			expect(subagentTempRoot()).toBe(
				path.join(os.tmpdir(), `pi-subagents-uid-${process.getuid()}`),
			);
	});

	test("parses pi-subagents v1 progress and cost fields", () => {
		const target = run();
		fs.writeFileSync(
			path.join(target.asyncDir!, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "run-1",
				sessionId: "session-1",
				mode: "parallel",
				state: "running",
				workflowKey: "workflow-root-key",
				parentWorkflowRunId: "workflow-parent-run",
				startedAt: 1000,
				lastUpdate: 2000,
				currentStep: 1,
				chainStepCount: 2,
				currentTool: "bash",
				currentPath: "src/app.ts",
				turnCount: 4,
				toolCount: 7,
				totalTokens: { input: 100, output: 50, total: 150 },
				totalCost: { inputTokens: 100, outputTokens: 50, costUsd: 0.0123 },
				steps: [
					{
						agent: "worker",
						status: "running",
						workflowKey: "workflow-step",
						parentWorkflowRunId: "parent-workflow-run",
						runId: "workflow-child-run",
						model: "provider/child",
						thinking: "high",
						contextWindow: 8192,
						currentTool: "edit",
						turnCount: 2,
						toolCount: 3,
						tokens: { input: 40, output: 20, total: 60 },
					},
				],
			}),
		);
		const parsed = readSubagentRun(target.asyncDir!);
		expect(parsed?.totalTokens).toBe(150);
		expect(parsed?.totalCost).toBe(0.0123);
		expect(parsed?.workflowKey).toBe("workflow-root-key");
		expect(parsed?.parentWorkflowRunId).toBe("workflow-parent-run");
		expect(parsed?.steps[0]?.currentTool).toBe("edit");
		expect(parsed?.steps[0]?.model).toBe("provider/child");
		expect(parsed?.steps[0]?.thinking).toBe("high");
		expect(parsed?.steps[0]?.contextWindow).toBe(8192);
		expect(parsed?.steps[0]?.tokens?.total).toBe(60);
		expect(parsed?.steps[0]?.workflowKey).toBe("workflow-step");
		expect(parsed?.steps[0]?.parentWorkflowRunId).toBe("parent-workflow-run");
		expect(parsed?.steps[0]?.runId).toBe("workflow-child-run");
	});

	test("parses live context window fields for subagent context-usage display", () => {
		// The sidebar/inspector show `used / limit` from the live context window,
		// so readSubagentRun must ingest window/windowPeak and per-step contextWindow.
		const target = run();
		fs.writeFileSync(
			path.join(target.asyncDir!, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "run-1",
				sessionId: "session-1",
				mode: "single",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				currentTool: "bash",
				// Run-level window is ingested from the totalTokens breakdown object.
				totalTokens: { input: 100, output: 50, total: 150, window: 168187, windowPeak: 168187 },
				steps: [
					{
						agent: "worker",
						status: "running",
						runId: "step-run",
						model: "provider/child",
						contextWindow: 1048576,
						currentTool: "edit",
						tokens: { input: 40, output: 20, total: 60, window: 168187, windowPeak: 168187 },
					},
				],
			}),
		);
		const parsed = readSubagentRun(target.asyncDir!);
		expect(parsed?.tokens?.window).toBe(168187);
		expect(parsed?.tokens?.windowPeak).toBe(168187);
		expect(parsed?.steps[0]?.contextWindow).toBe(1048576);
		expect(parsed?.steps[0]?.tokens?.window).toBe(168187);
	});

	test("extracts child run ids only from child session file layouts", () => {
		expect(childRunIdFromSessionFile("/a/b/c/run-0/session.jsonl")).toBe("c");
		expect(childRunIdFromSessionFile("/a/b/c/run-2/session.jsonl")).toBe("c");
		expect(childRunIdFromSessionFile("/a/b/c/session.jsonl")).toBeUndefined();
		expect(
			childRunIdFromSessionFile("/a/b/c/run-x/session.jsonl"),
		).toBeUndefined();
		expect(childRunIdFromSessionFile(undefined)).toBeUndefined();
		expect(childRunIdFromSessionFile("")).toBeUndefined();
	});

	test("derives transcript paths for workflow steps that lack them", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-wf-transcript-"));
		roots.push(root);
		const sessionDir = path.join(root, "sessions");
		const childDir = path.join(
			sessionDir,
			"2026-08-16T00-00-00-000Z_session",
			"child-run-1",
			"run-0",
		);
		fs.mkdirSync(childDir, { recursive: true });
		const sessionFile = path.join(childDir, "session.jsonl");
		fs.writeFileSync(sessionFile, "{}\n");
		const artifactsDir = path.join(sessionDir, "subagent-artifacts");
		fs.mkdirSync(artifactsDir, { recursive: true });
		const transcriptPath = path.join(
			artifactsDir,
			"child-run-1_scout_0_transcript.jsonl",
		);
		fs.writeFileSync(transcriptPath, "{}\n");

		const asyncDir = path.join(root, "run");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "workflow-run-1",
				sessionId: "session-1",
				mode: "workflow",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				steps: [
					{
						agent: "scout",
						status: "running",
						workflowKey: "alpha",
						parentWorkflowRunId: "workflow-run-1",
						sessionFile,
					},
				],
			}),
		);
		const parsed = readSubagentRun(asyncDir);
		expect(parsed?.steps[0]?.transcriptPath).toBe(transcriptPath);
		expect(parsed?.steps[0]?.runId).toBe("child-run-1");
	});

	test("derives the transcript from the parent session file when child sessions live in a custom dir", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-wf-transcript-custom-"));
		roots.push(root);
		const customSessions = path.join(root, "custom-sessions");
		const childDir = path.join(customSessions, "child-run-2", "run-0");
		fs.mkdirSync(childDir, { recursive: true });
		const sessionFile = path.join(childDir, "session.jsonl");
		fs.writeFileSync(sessionFile, "{}\n");
		// The parent session file (and session-mode artifacts) live elsewhere
		// than the custom child session dir, so only the parent-derived
		// candidate can find the transcript.
		const parentSessionDir = path.join(root, "parent-sessions");
		const parentSessionFile = path.join(parentSessionDir, "parent.jsonl");
		const artifactsDir = path.join(parentSessionDir, "subagent-artifacts");
		fs.mkdirSync(artifactsDir, { recursive: true });
		const transcriptPath = path.join(artifactsDir, "child-run-2_scout_0_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "{}\n");

		const asyncDir = path.join(root, "run");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "workflow-run-3",
				sessionId: parentSessionFile,
				mode: "workflow",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				steps: [
					{
						agent: "scout",
						status: "running",
						workflowKey: "alpha",
						parentWorkflowRunId: "workflow-run-3",
						sessionFile,
					},
				],
			}),
		);
		const parsed = readSubagentRun(asyncDir);
		expect(parsed?.steps[0]?.transcriptPath).toBe(transcriptPath);
		expect(parsed?.steps[0]?.runId).toBe("child-run-2");
	});

	test("leaves steps without a child session layout untouched", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-wf-transcript-none-"));
		roots.push(root);
		const asyncDir = path.join(root, "run");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "workflow-run-2",
				sessionId: "session-1",
				mode: "workflow",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				steps: [
					{
						agent: "scout",
						status: "running",
						sessionFile: path.join(root, "flat-session.jsonl"),
					},
				],
			}),
		);
		const parsed = readSubagentRun(asyncDir);
		expect(parsed?.steps[0]?.transcriptPath).toBeUndefined();
		expect(parsed?.steps[0]?.runId).toBeUndefined();
	});

	test("derives the child run id even when the transcript is not written yet", () => {
		const root = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-wf-transcript-pending-"),
		);
		roots.push(root);
		const sessionDir = path.join(root, "sessions");
		const childDir = path.join(
			sessionDir,
			"2026-08-16T00-00-00-000Z_session",
			"child-run-7",
			"run-0",
		);
		fs.mkdirSync(childDir, { recursive: true });
		fs.writeFileSync(path.join(childDir, "session.jsonl"), "{}\n");
		fs.mkdirSync(path.join(sessionDir, "subagent-artifacts"), {
			recursive: true,
		});

		const asyncDir = path.join(root, "run");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "workflow-run-7",
				sessionId: "session-1",
				mode: "workflow",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				steps: [
					{
						agent: "scout",
						status: "running",
						sessionFile: path.join(childDir, "session.jsonl"),
					},
				],
			}),
		);
		const parsed = readSubagentRun(asyncDir);
		expect(parsed?.steps[0]?.runId).toBe("child-run-7");
		expect(parsed?.steps[0]?.transcriptPath).toBeUndefined();
	});

	test("resolves project-scoped transcripts from the run cwd", () => {
		const root = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-wf-transcript-project-"),
		);
		roots.push(root);
		const sessionDir = path.join(root, "sessions");
		const childDir = path.join(
			sessionDir,
			"2026-08-16T00-00-00-000Z_session",
			"child-run-8",
			"run-0",
		);
		fs.mkdirSync(childDir, { recursive: true });
		fs.writeFileSync(path.join(childDir, "session.jsonl"), "{}\n");
		const projectCwd = path.join(root, "project");
		const projectArtifacts = path.join(
			projectCwd,
			".pi",
			"subagents",
			"artifacts",
		);
		fs.mkdirSync(projectArtifacts, { recursive: true });
		const transcriptPath = path.join(
			projectArtifacts,
			"child-run-8_scout_0_transcript.jsonl",
		);
		fs.writeFileSync(transcriptPath, "{}\n");

		const asyncDir = path.join(root, "run");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "workflow-run-8",
				sessionId: "session-1",
				mode: "workflow",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				cwd: projectCwd,
				steps: [
					{
						agent: "scout",
						status: "running",
						sessionFile: path.join(childDir, "session.jsonl"),
					},
				],
			}),
		);
		const parsed = readSubagentRun(asyncDir);
		expect(parsed?.steps[0]?.transcriptPath).toBe(transcriptPath);
	});

	test("derives transcript paths for mission workflow children", () => {
		const root = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-mission-transcript-"),
		);
		roots.push(root);
		const owner = path.join(root, "sessions", "current.jsonl");
		fs.mkdirSync(path.dirname(owner), { recursive: true });
		fs.writeFileSync(owner, "{}\n");
		const workflowRunId = "workflow-mission-transcript";
		const mission = capturedMission(owner, workflowRunId);
		const childDir = path.join(
			path.dirname(owner),
			"base",
			"child-run-9",
			"run-0",
		);
		fs.mkdirSync(childDir, { recursive: true });
		const sessionPath = path.join(childDir, "session.jsonl");
		fs.writeFileSync(sessionPath, "{}\n");
		const artifactsDir = path.join(path.dirname(owner), "subagent-artifacts");
		fs.mkdirSync(artifactsDir, { recursive: true });
		const transcriptPath = path.join(
			artifactsDir,
			"child-run-9_impl-check-logic_0_transcript.jsonl",
		);
		fs.writeFileSync(transcriptPath, "{}\n");
		const child = { ...mission.workflowChildren[0]! };
		Reflect.deleteProperty(child, "runId");
		child.sessionPath = sessionPath;
		mission.workflowChildren[0] = child;
		writeMissionFixture(root, "first", mission);
		const runs = listMissionRuns({ sessionFile: owner }, process.cwd(), root);
		expect(runs[0]?.steps[0]?.transcriptPath).toBe(transcriptPath);
		expect(runs[0]?.steps[0]?.runId).toBe("child-run-9");
	});

	test("matches restored runs whose artifact sessionId is the session file path", () => {
		const sessionFile = path.join(os.tmpdir(), "pi-session-test.jsonl");
		const restored: SubagentRun = {
			runId: "restored-1",
			asyncDir: path.join(os.tmpdir(), "restored-1"),
			sessionId: sessionFile,
			sessionFile,
			mode: "single",
			state: "running",
			steps: [],
		};
		expect(
			matchesSubagentSession(restored, {
				sessionId: "uuid-from-rpc",
				sessionFile,
			}),
		).toBe(true);
		expect(
			matchesSubagentSession(restored, {
				sessionId: "other",
				sessionFile: `${sessionFile}.other`,
			}),
		).toBe(false);
	});

	test("writes portable pause and stop requests", () => {
		const target = run();
		pauseSubagent(target);
		stopSubagent(target);
		try {
			expect(
				JSON.parse(
					fs.readFileSync(
						path.join(target.asyncDir!, "control", "interrupt.json"),
						"utf8",
					),
				).type,
			).toBe("interrupt");
		} catch (error) {
			throw new Error("interrupt control artifact is malformed", {
				cause: error,
			});
		}
		try {
			expect(
				JSON.parse(
					fs.readFileSync(
						path.join(target.asyncDir!, "control", "timeout.json"),
						"utf8",
					),
				).type,
			).toBe("timeout");
		} catch (error) {
			throw new Error("timeout control artifact is malformed", {
				cause: error,
			});
		}
	});

	test("resume removes the interrupt control", () => {
		const target = run();
		pauseSubagent(target);
		expect(
			JSON.parse(
				fs.readFileSync(
					path.join(target.asyncDir!, "control", "interrupt.json"),
					"utf8",
				),
			).type,
		).toBe("interrupt");
		resumeSubagent(target);
		let exists = true;
		try {
			fs.statSync(path.join(target.asyncDir!, "control", "interrupt.json"));
		} catch {
			exists = false;
		}
		expect(exists).toBe(false);
	});

	test("resume rejects foreground runs without touching disk", () => {
		const target: SubagentRun = {
			runId: "foreground",
			control: "foreground",
			mode: "single",
			state: "paused",
			steps: [],
		};
		expect(() => resumeSubagent(target)).toThrow(
			"read-only; file control is unsupported",
		);
	});

	test("rejects all file controls for foreground runs without writing", () => {
		const target: SubagentRun = {
			runId: "foreground",
			control: "foreground",
			mode: "single",
			state: "running",
			steps: [],
		};
		expect(() => pauseSubagent(target)).toThrow(
			"read-only; file control is unsupported",
		);
		expect(() => stopSubagent(target)).toThrow(
			"read-only; file control is unsupported",
		);
		expect(() => steerSubagent(target, "focus on tests")).toThrow(
			"read-only; file control is unsupported",
		);
	});

	test("reports a missing file-control directory separately", () => {
		const target: SubagentRun = {
			runId: "missing-dir",
			mode: "single",
			state: "running",
			steps: [],
		};
		expect(() => pauseSubagent(target)).toThrow(
			"File-control directory is missing",
		);
		expect(() => resumeSubagent(target)).toThrow(
			"File-control directory is missing",
		);
	});

	test("rejects symlinked file-control directories", () => {
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pi-oc-outside-"));
		const link = fs.mkdtempSync(path.join(asyncRunsRoot(), "pi-oc-link-"));
		fs.rmSync(link, { recursive: true, force: true });
		fs.symlinkSync(outside, link, "dir");
		roots.push(outside, link);
		const target = { ...run(), asyncDir: link };
		expect(() => pauseSubagent(target)).toThrow(
			"File-control directory is not a regular directory",
		);
		expect(fs.existsSync(path.join(outside, "control"))).toBe(false);
	});

	test("writes a steer request", () => {
		const target = run();
		steerSubagent(target, "focus on tests", 0);
		const dir = path.join(target.asyncDir!, "control", "steer-requests");
		const files = fs.readdirSync(dir);
		expect(files).toHaveLength(1);
		try {
			expect(
				JSON.parse(fs.readFileSync(path.join(dir, files[0]!), "utf8")).message,
			).toBe("focus on tests");
		} catch (error) {
			throw new Error("steer request artifact is malformed", { cause: error });
		}
	});

	test("keeps live transcript discovery in refreshed run listings", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-oc-refresh-"));
		roots.push(root);
		const cwd = path.join(root, "project");
		const asyncDir = path.join(root, "run");
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		fs.mkdirSync(asyncDir, { recursive: true });
		const transcriptPath = path.join(artifacts, "uuid_worker_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		fs.writeFileSync(
			transcriptPath.replace("_transcript.jsonl", "_meta.json"),
			JSON.stringify({ agent: "worker", runId: "child", timestamp: Date.now() }),
		);
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId: "run-refresh",
				mode: "single",
				state: "running",
				cwd,
				steps: [{ index: 0, agent: "worker", status: "running", startedAt: Date.now() }],
			}),
		);

		const listed = listSubagentRuns(undefined, root);
		expect(listed[0]?.steps[0]?.transcriptPath).toBe(transcriptPath);
	});

	test("sorts restored runs by launch order, not activity", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-oc-runs-"));
		roots.push(root);
		const completed = path.join(root, "completed");
		const running = path.join(root, "running");
		fs.mkdirSync(completed);
		fs.mkdirSync(running);
		fs.writeFileSync(
			path.join(completed, "status.json"),
			JSON.stringify({
				runId: "completed",
				mode: "single",
				state: "complete",
				startedAt: 1_000,
				lastUpdate: 9_000,
				steps: [],
			}),
		);
		fs.writeFileSync(
			path.join(running, "status.json"),
			JSON.stringify({
				runId: "running",
				mode: "single",
				state: "running",
				startedAt: 2_000,
				lastUpdate: 1_000,
				steps: [],
			}),
		);
		expect(listSubagentRuns(undefined, root).map((item) => item.runId)).toEqual(
			["completed", "running"],
		);
	});

	test("splits parallel runs into declared child index order", () => {
		const target = run();
		target.mode = "parallel";
		target.steps = [
			{
				index: 0,
				agent: "reviewer",
				status: "completed",
				transcriptPath: "/tmp/reviewer.jsonl",
			},
			{
				index: 1,
				agent: "implementer",
				status: "running",
				sessionFile: "/tmp/implementer-session.jsonl",
				transcriptPath: "/tmp/implementer.jsonl",
			},
		];
		const targets = subagentTargets([target]);
		expect(targets.map((item) => item.key)).toEqual(["run-1:0", "run-1:1"]);
		expect(targets[1]?.label).toBe("implementer #2");
		expect(targets[1]?.canSteer).toBe(true);
		expect(targets[0]?.canSteer).toBe(false);
	});

	test("keeps same-start parallel runs grouped and index ordered", () => {
		const first = run();
		first.runId = "run-a";
		first.startedAt = 1_000;
		first.steps = [
			{ index: 0, agent: "a0", status: "completed", lastActivityAt: 9_000 },
			{ index: 1, agent: "a1", status: "running", lastActivityAt: 1_000 },
		];
		const second = run();
		second.runId = "run-b";
		second.startedAt = 1_000;
		second.steps = [
			{ index: 0, agent: "b0", status: "running", lastActivityAt: 8_000 },
			{ index: 1, agent: "b1", status: "completed", lastActivityAt: 2_000 },
		];
		expect(
			subagentTargets([first, second]).map((target) => target.key),
		).toEqual(["run-a:0", "run-a:1", "run-b:0", "run-b:1"]);
	});

	test("groups active targets first and keeps stable launch order despite activity updates", () => {
		const first = run();
		first.runId = "run-a";
		first.startedAt = 1_000;
		first.steps = [
			{ index: 0, agent: "a0", status: "running", lastActivityAt: 9_000 },
			{ index: 1, agent: "a1", status: "running", lastActivityAt: 1_000 },
		];
		const second = run();
		second.runId = "run-b";
		second.startedAt = 2_000;
		second.steps = [
			{ index: 0, agent: "b0", status: "completed", lastActivityAt: 8_000 },
			{ index: 1, agent: "b1", status: "completed", lastActivityAt: 2_000 },
		];
		const before = subagentTargets([first, second]).map((target) => target.key);
		first.steps[0]!.lastActivityAt = 100;
		first.steps[1]!.lastActivityAt = 100_000;
		second.steps[0]!.lastActivityAt = 100;
		second.steps[1]!.lastActivityAt = 100_000;
		expect(
			subagentTargets([first, second]).map((target) => target.key),
		).toEqual(before);
	});

	test("keeps the most recently launched run at the top regardless of activity changes", () => {
		const first = run();
		first.runId = "run-a";
		first.startedAt = 1_000;
		first.steps = [
			{ index: 0, agent: "a0", status: "running" },
			{ index: 1, agent: "a1", status: "completed" },
		];
		const second = run();
		second.runId = "run-b";
		second.startedAt = 2_000;
		second.steps = [
			{ index: 0, agent: "b0", status: "running" },
			{ index: 1, agent: "b1", status: "completed" },
		];
		expect(
			subagentTargets([first, second]).map((target) => target.key),
		).toEqual(["run-b:0", "run-b:1", "run-a:0", "run-a:1"]);
		first.steps[1]!.status = "running";
		expect(
			subagentTargets([first, second]).map((target) => target.key),
		).toEqual(["run-b:0", "run-b:1", "run-a:0", "run-a:1"]);
	});

	test("reconciles a stale foreground selection to its unique active child", () => {
		const previous = subagentTargets(
			[],
			[
				{
					kind: "tool",
					id: "fg",
					toolCallId: "fg-call",
					name: "subagent",
					args: {},
					output: "",
					timestamp: 1,
					status: "done",
					isError: false,
					details: {
						progress: [{ sessionFile: "/tmp/child", status: "done" }],
					},
				},
			],
		);
		const activeRun = run();
		activeRun.runId = "async";
		activeRun.steps = [
			{
				index: 0,
				agent: "child",
				status: "running",
				sessionFile: "/tmp/child",
			},
		];
		const next = subagentTargets([activeRun]);
		expect(reconcileSubagentSelection(previous[0]?.key, previous, next)).toBe(
			"async:0",
		);
		expect(previous[0]?.canSteer).toBe(false);
	});

	test("does not reconcile unrelated or ambiguous child identities", () => {
		const previousTarget = subagentTargets(
			[],
			[
				{
					kind: "tool",
					id: "fg",
					toolCallId: "fg-call",
					name: "subagent",
					args: {},
					output: "",
					timestamp: 1,
					status: "done",
					isError: false,
					details: {
						progress: [{ sessionFile: "/tmp/child", status: "done" }],
					},
				},
			],
		)[0];
		const first = run();
		first.runId = "async-a";
		first.steps = [
			{ index: 0, agent: "a", status: "running", sessionFile: "/tmp/other" },
		];
		const second = run();
		second.runId = "async-b";
		second.steps = [
			{ index: 0, agent: "b", status: "running", sessionFile: "/tmp/child" },
		];
		const third = run();
		third.runId = "async-c";
		third.steps = [
			{ index: 0, agent: "c", status: "running", sessionFile: "/tmp/child" },
		];
		const next = subagentTargets([first, second, third]);
		const ambiguous = next[1]
			? [
					{ ...next[1], key: "ambiguous-a" },
					{ ...next[1], key: "ambiguous-b" },
				]
			: [];
		expect(
			reconcileSubagentSelection(
				previousTarget?.key,
				previousTarget ? [previousTarget] : [],
				ambiguous,
			),
		).toBe("ambiguous-a");
		expect(previousTarget?.canSteer).toBe(false);
	});

	test("dedupes resumed children by session file and keeps the active transcript", () => {
		const original = run();
		original.runId = "failed-run";
		original.state = "failed";
		original.steps = [
			{
				index: 0,
				agent: "old-label",
				status: "completed",
				sessionFile: "/tmp/shared-child.jsonl",
				transcriptPath: "/tmp/missing-old.jsonl",
			},
		];
		const resumed = run();
		resumed.runId = "resumed-run";
		resumed.steps = [
			{
				index: 0,
				agent: "new-label",
				status: "running",
				sessionFile: "/tmp/shared-child.jsonl",
				transcriptPath: "/tmp/live-child.jsonl",
			},
		];
		const targets = subagentTargets([original, resumed]);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.active).toBe(true);
		expect(targets[0]?.label).toBe("new-label");
		expect(targets[0]?.transcriptPath).toBe("/tmp/live-child.jsonl");
	});

	test("keeps distinct parallel child indexes sharing a session file", () => {
		const target = run();
		target.mode = "parallel";
		target.steps = [
			{
				index: 0,
				agent: "first",
				status: "running",
				sessionFile: "/tmp/shared-parallel.jsonl",
			},
			{
				index: 1,
				agent: "second",
				status: "running",
				sessionFile: "/tmp/shared-parallel.jsonl",
			},
		];
		expect(subagentTargets([target])).toHaveLength(2);
	});

	test("dedupes resumed children using the run session file fallback", () => {
		const original = run();
		original.runId = "original-run";
		original.sessionFile = "/tmp/shared-run-session.jsonl";
		original.steps = [{ index: 0, agent: "old", status: "completed" }];
		const resumed = run();
		resumed.runId = "resumed-run";
		resumed.sessionFile = original.sessionFile;
		resumed.steps = [{ index: 0, agent: "new", status: "running" }];
		const targets = subagentTargets([original, resumed]);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.label).toBe("new");
	});

	test("keeps distinct foreground entries sharing a session file", () => {
		const tool = {
			kind: "tool" as const,
			id: "foreground-indexed",
			toolCallId: "call-foreground-indexed",
			name: "subagent",
			args: {},
			output: "",
			details: {
				progress: [
					{
						agent: "first",
						status: "running",
						sessionFile: "/tmp/shared-foreground.jsonl",
					},
					{
						agent: "second",
						status: "running",
						sessionFile: "/tmp/shared-foreground.jsonl",
					},
				],
			},
			timestamp: Date.now(),
			status: "streaming" as const,
			isError: false,
		};
		expect(subagentTargets([], [tool])).toHaveLength(2);
	});

	test("reads a specifically selected parallel child transcript", () => {
		const target = run();
		target.mode = "parallel";
		const first = path.join(target.asyncDir!, "first.jsonl");
		const second = path.join(target.asyncDir!, "second.jsonl");
		fs.writeFileSync(
			first,
			JSON.stringify({
				recordType: "message",
				role: "assistant",
				text: "first child",
				ts: 1,
			}),
		);
		fs.writeFileSync(
			second,
			JSON.stringify({
				recordType: "message",
				role: "assistant",
				text: "second child",
				ts: 2,
			}),
		);
		target.steps = [
			{ index: 0, agent: "first", status: "running", transcriptPath: first },
			{ index: 1, agent: "second", status: "running", transcriptPath: second },
		];
		const items = readSubagentConversation(target, 160, 1);
		expect(items).toHaveLength(1);
		expect(items[0]?.kind === "assistant" ? items[0].text : "").toBe(
			"second child",
		);
	});

	test("maps a live foreground tool progress item and dedupes its async launch", () => {
		const target = run();
		const tool = {
			kind: "tool" as const,
			id: "foreground-tool",
			toolCallId: "call-foreground",
			name: "subagent",
			args: {},
			output: "working",
			details: {
				progress: [{ agent: "worker", status: "pending", currentTool: "bash" }],
			},
			timestamp: Date.now(),
			status: "streaming" as const,
			isError: false,
		};
		const asyncLaunch = {
			...tool,
			toolCallId: "call-async",
			details: { asyncDir: target.asyncDir! },
			status: "done" as const,
		};
		const targets = subagentTargets([target], [tool, asyncLaunch]);
		expect(
			targets.filter((item) => item.run.runId === target.runId),
		).toHaveLength(1);
		const foreground = targets.find(
			(item) => item.toolCallId === tool.toolCallId,
		);
		expect(foreground?.active).toBe(true);
		expect(foreground?.state).toBe("pending");
		expect(foreground?.canSteer).toBe(false);
		expect(
			targetsForTool(tool, targets).map((item) => item.toolCallId),
		).toEqual([tool.toolCallId]);
	});

	test("projects live workflow trace children with stable identities", () => {
		const liveTool = {
			kind: "tool" as const,
			id: "workflow-live",
			toolCallId: "workflow-call",
			name: "subagent",
			args: {},
			output: "working",
			details: {
				workflow: {
					trace: [
						{
							operation: "run",
							key: "child-a",
							agent: "worker-a",
							state: "started",
						},
						{
							operation: "run",
							key: "child-b",
							agent: "worker-b",
							state: "started",
						},
					],
				},
			},
			timestamp: 1,
			status: "streaming" as const,
			isError: false,
		};
		const first = subagentTargets([], [liveTool]);
		expect(first.map((target) => target.key)).toEqual([
			"workflow-call:child-a",
			"workflow-call:child-b",
		]);
		expect(first.every((target) => target.active)).toBe(true);

		const updated = subagentTargets(
			[],
			[
				{
					...liveTool,
					details: {
						workflow: {
							trace: [
								{
									operation: "run",
									key: "child-a",
									agent: "worker-a",
									state: "started",
								},
								{
									operation: "run",
									key: "child-a",
									agent: "worker-a",
									state: "completed",
								},
								{
									operation: "run",
									key: "child-b",
									agent: "worker-b",
									state: "started",
								},
							],
						},
					},
				},
			],
		);
		expect(updated.map((target) => target.key)).toEqual(
			first.map((target) => target.key),
		);
	});

	test("keeps live workflow children visible while persisted parent steps are empty", () => {
		const tool: ToolItem = {
			kind: "tool",
			id: "workflow-race",
			toolCallId: "workflow-race-call",
			name: "subagent",
			args: {},
			output: "working",
			details: {
				runId: "workflow-parent",
				workflow: {
					trace: [
						{
							operation: "run",
							key: "logic",
							agent: "worker",
							state: "started",
						},
					],
				},
			},
			timestamp: 100,
			status: "streaming",
			isError: false,
		};
		const run: SubagentRun = {
			runId: "workflow-parent",
			asyncDir: "/tmp/workflow-parent",
			control: "file",
			mode: "workflow",
			state: "running",
			steps: [],
		};

		const targets = subagentTargets([run], [tool]);
		expect(targets.map((target) => target.key)).toEqual([
			"workflow-race-call:logic",
		]);
		expect(targets[0]?.label).toBe("worker");

		run.steps = [
			{
				index: 0,
				agent: "persisted-worker",
				status: "running",
				workflowKey: "logic",
				parentWorkflowRunId: "workflow-parent",
				runId: "workflow-child",
				sessionFile: "/tmp/workflow-child.jsonl",
			},
		];
		const reconciled = subagentTargets([run], [tool]);
		expect(reconciled.map((target) => target.key)).toEqual([
			"workflow-parent:0",
		]);
		expect(reconciled[0]?.sessionFile).toBe("/tmp/workflow-child.jsonl");
	});

	test("uses the stable workflow key when live trace metadata omits a name", () => {
		const tool = {
			kind: "tool" as const,
			id: "workflow-key-only",
			toolCallId: "workflow-key-only-call",
			name: "subagent",
			args: {},
			output: "working",
			details: {
				workflow: {
					trace: [{ operation: "run", key: "logic", state: "started" }],
				},
			},
			timestamp: 1,
			status: "streaming" as const,
			isError: false,
		};
		const [target] = subagentTargets([], [tool]);
		expect(target?.label).toBe("logic");
		expect(target?.active).toBe(true);
		expect(target?.sessionFile).toBeUndefined();
		expect(target?.transcriptPath).toBeUndefined();
	});

	test("suppresses persisted child projections once the workflow parent owns steps", () => {
		const parent: SubagentRun = {
			runId: "parent",
			mode: "workflow",
			state: "running",
			steps: [0, 1, 2].map((index) => ({
				index,
				agent: `agent-${index}`,
				workflowKey: `k${index}`,
				runId: `child-${index}`,
				status: "running",
				sessionFile: `/tmp/c${index}`,
			})),
		};
		const children = [0, 1, 2].map(
			(index): SubagentRun => ({
				runId: `child-${index}`,
				mode: "single",
				state: "running",
				parentWorkflowRunId: "parent",
				workflowKey: `k${index}`,
				steps: [
					{
						index: 0,
						agent: `agent-${index}`,
						status: "running",
						sessionFile: `/tmp/c${index}`,
					},
				],
			}),
		);
		expect(subagentTargets([parent, ...children])).toHaveLength(3);
		expect(subagentTargets(children)).toHaveLength(3);
	});

	test("transfers suppressed child session metadata into the visible parent step", () => {
		const sessionFile = path.join(os.tmpdir(), "workflow-child-session.jsonl");
		fs.writeFileSync(
			sessionFile,
			JSON.stringify({
				message: {
					role: "assistant",
					content: [{ type: "text", text: "child transcript" }],
				},
			}),
		);
		const parent: SubagentRun = {
			runId: "workflow-parent",
			mode: "workflow",
			state: "completed",
			steps: [
				{
					index: 0,
					agent: "worker",
					workflowKey: "logic",
					runId: "workflow-child",
					status: "completed",
				},
			],
		};
		const child: SubagentRun = {
			runId: "workflow-child",
			mode: "single",
			state: "completed",
			parentWorkflowRunId: "workflow-parent",
			workflowKey: "logic",
			sessionFile,
			steps: [],
		};

		const targets = subagentTargets([parent, child]);
		expect(targets).toHaveLength(1);
		const target = targets[0];
		expect(target?.key).toBe("workflow-parent:0");
		expect(target?.sessionFile).toBe(sessionFile);
		expect(target?.run.steps[0]?.sessionFile).toBe(sessionFile);
		expect(
			readSubagentConversation(target!.run, 160, target!.stepIndex),
		).toEqual([
			expect.objectContaining({ kind: "assistant", text: "child transcript" }),
		]);
	});

	test("pairs unambiguous index-only workflow results by trace position", () => {
		const tool: ToolItem = {
			kind: "tool",
			id: "positional",
			toolCallId: "positional-call",
			name: "subagent",
			args: {},
			output: "done",
			timestamp: 1,
			status: "done",
			isError: false,
			details: {
				workflow: {
					trace: [
						{ operation: "run", key: "a", agent: "one", state: "started" },
						{ operation: "run", key: "b", agent: "two", state: "started" },
					],
				},
				results: [
					{ index: 0, agent: "one", sessionFile: "/tmp/one" },
					{ index: 0, agent: "two", sessionFile: "/tmp/two" },
				],
			},
		};
		const targets = subagentTargets([], [tool]);
		expect(
			targets.find((target) => target.workflowKey === "a")?.sessionFile,
		).toBe("/tmp/one");
		expect(
			targets.find((target) => target.workflowKey === "b")?.sessionFile,
		).toBe("/tmp/two");
	});

	test("merges terminal runId results into the stable workflow key row", () => {
		const tool = {
			kind: "tool" as const,
			id: "workflow-runid-terminal",
			toolCallId: "workflow-runid-call",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				workflow: {
					trace: [
						{
							operation: "run",
							key: "logic",
							agent: "impl-check-logic",
							state: "started",
						},
						{
							operation: "run",
							key: "logic",
							runId: "child-run",
							state: "completed",
						},
					],
				},
				results: [
					{
						runId: "child-run",
						agent: "impl-check-logic",
						exitCode: 0,
						sessionFile: "/tmp/child.jsonl",
						progress: { currentTool: "bash" },
					},
				],
			},
			timestamp: 1,
			status: "done" as const,
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.key).toBe("workflow-runid-call:logic");
		expect(targets[0]?.state).toBe("completed");
		expect(targets[0]?.sessionFile).toBe("/tmp/child.jsonl");
		expect(targets[0]?.run.currentTool).toBe("bash");
	});

	test("does not merge an unowned trace with a parent-scoped persisted child", () => {
		const makeRun = (
			runId: string,
			parentWorkflowRunId: string,
		): SubagentRun => ({
			runId,
			asyncDir: `/tmp/${runId}`,
			control: "file",
			mode: "single",
			state: "running",
			steps: [
				{
					index: 0,
					agent: runId,
					status: "running",
					workflowKey: "shared",
					parentWorkflowRunId,
					sessionFile: `/tmp/${runId}.jsonl`,
				},
			],
		});
		const tool: ToolItem = {
			kind: "tool",
			id: "unowned-trace",
			toolCallId: "unowned-trace-call",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				workflow: {
					trace: [{ operation: "run", key: "shared", state: "completed" }],
				},
			},
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const targets = subagentTargets(
			[makeRun("child-one", "parent-one"), makeRun("child-two", "parent-two")],
			[tool],
		);
		expect(
			targets.find((target) => target.key === "unowned-trace-call:shared")
				?.sessionFile,
		).toBeUndefined();
		expect(
			targets
				.filter((target) => target.sessionFile?.includes("child-"))
				.map((target) => target.sessionFile),
		).toEqual(["/tmp/child-one.jsonl", "/tmp/child-two.jsonl"]);
	});

	test("scopes workflow reconciliation and overlays terminal trace lifecycle", () => {
		const tool: ToolItem = {
			kind: "tool",
			id: "workflow-scoped",
			toolCallId: "workflow-scoped-call",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				runId: "parent-two",
				workflow: {
					trace: [{ operation: "run", key: "shared-key", state: "completed" }],
				},
			},
			timestamp: 1_000,
			status: "done",
			isError: false,
		};
		const makeRun = (
			runId: string,
			parentWorkflowRunId: string,
		): SubagentRun => ({
			runId,
			asyncDir: `/tmp/${runId}`,
			control: "file",
			mode: "single",
			state: "running",
			steps: [
				{
					index: 0,
					agent: runId,
					status: "running",
					workflowKey: "shared-key",
					parentWorkflowRunId,
					sessionFile: `/tmp/${runId}.jsonl`,
				},
			],
		});
		const targets = subagentTargets(
			[
				makeRun("persisted-one", "parent-one"),
				makeRun("persisted-two", "parent-two"),
			],
			[tool],
		);
		expect(targets).toHaveLength(2);
		const selected = targets.find(
			(target) => target.key === "workflow-scoped-call:shared-key",
		);
		expect(selected?.step?.agent).toBe("persisted-two");
		expect(selected?.sessionFile).toBe("/tmp/persisted-two.jsonl");
		expect(selected?.state).toBe("completed");
		expect(selected?.active).toBe(false);
		expect(selected?.canSteer).toBe(false);
		expect(selected?.run.state).toBe("completed");
	});

	test("reconciles six live workflow traces with aliased persisted steps", () => {
		const tool: ToolItem = {
			kind: "tool",
			id: "workflow-live",
			toolCallId: "workflow-live-call",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				workflow: {
					trace: Array.from({ length: 6 }, (_, index) => ({
						operation: "run",
						key: `step-${index}`,
						...(index === 5
							? { runId: `child-${index}`, state: "completed" }
							: { state: "started" }),
					})),
				},
				results: [{ runId: "child-5", exitCode: 0 }],
			},
			timestamp: 1_000,
			startedAt: 1_000,
			endedAt: 2_000,
			status: "done",
			isError: false,
		};
		const run: SubagentRun = {
			runId: "persisted-workflow",
			asyncDir: "/tmp/persisted-workflow",
			control: "file",
			mode: "parallel",
			state: "running",
			startedAt: 1_000,
			steps: Array.from({ length: 6 }, (_, index) => ({
				index,
				agent: `impl-check-${index}`,
				status: index === 5 ? "completed" : "running",
				workflowKey: `step-${index}`,
				runId: `child-${index}`,
				sessionFile: `/tmp/child-${index}.jsonl`,
			})),
		};
		const targets = subagentTargets([run], [tool]);
		const owned =
			ownedSubagentTargetsForItems([tool], targets).get(tool.id) ?? [];
		expect(owned).toHaveLength(6);
		expect(
			owned.every((target) =>
				target.label.startsWith(`impl-check-${target.stepIndex}`),
			),
		).toBe(true);
		expect(owned.map((target) => target.sessionFile)).toEqual(
			expect.arrayContaining(
				Array.from({ length: 6 }, (_, index) => `/tmp/child-${index}.jsonl`),
			),
		);
		expect(owned.some((target) => target.label === "foreground subagent")).toBe(
			false,
		);
		expect(owned.find((target) => target.childRunId === "child-5")?.state).toBe(
			"completed",
		);
	});

	test("does not cross-assign ambiguous index-only workflow results", () => {
		const tool = {
			kind: "tool" as const,
			id: "workflow-index-only",
			toolCallId: "workflow-index-only-call",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				workflow: {
					trace: [
						{
							operation: "run",
							key: "alpha",
							agent: "alpha",
							state: "completed",
						},
						{ operation: "run", key: "beta", agent: "beta", state: "failed" },
					],
				},
				results: [
					{
						index: 0,
						agent: "terminal-alpha",
						exitCode: 0,
						sessionFile: "/tmp/alpha.jsonl",
					},
					{
						index: 0,
						agent: "terminal-beta",
						exitCode: 1,
						sessionFile: "/tmp/beta.jsonl",
					},
				],
			},
			timestamp: 1,
			status: "done" as const,
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(
			targets.find((target) => target.key.endsWith(":alpha")),
		).toMatchObject({
			label: "alpha",
			state: "completed",
		});
		expect(
			targets.find((target) => target.key.endsWith(":beta")),
		).toMatchObject({
			label: "beta",
			state: "failed",
		});
		expect(targets).toHaveLength(2);
		expect(targets.every((target) => target.sessionFile === undefined)).toBe(
			true,
		);
	});

	test("merges workflow terminal results into trace children without duplicates", () => {
		const tool = {
			kind: "tool" as const,
			id: "workflow-terminal",
			toolCallId: "workflow-terminal-call",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				workflow: {
					trace: [
						{
							operation: "run",
							key: "child",
							agent: "worker",
							state: "started",
						},
						{
							operation: "note",
							key: "ignored",
							agent: "noise",
							state: "started",
						},
					],
				},
				results: [{ key: "child", agent: "worker", exitCode: 0 }],
			},
			timestamp: 1,
			status: "done" as const,
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.key).toBe("workflow-terminal-call:child");
		expect(targets[0]?.state).toBe("completed");
	});

	test("preserves legacy foreground results and progress parsing", () => {
		const results = subagentTargets(
			[],
			[
				{
					kind: "tool",
					id: "legacy-results",
					toolCallId: "legacy-results-call",
					name: "subagent",
					args: {},
					output: "done",
					details: {
						results: [
							{
								agent: "result-child",
								exitCode: 0,
								progress: { status: "running" },
							},
						],
					},
					timestamp: 1,
					status: "done",
					isError: false,
				},
			],
		);
		const progress = subagentTargets(
			[],
			[
				{
					kind: "tool",
					id: "legacy-progress",
					toolCallId: "legacy-progress-call",
					name: "subagent",
					args: {},
					output: "working",
					details: {
						progress: [{ agent: "progress-child", status: "running" }],
					},
					timestamp: 1,
					status: "streaming",
					isError: false,
				},
			],
		);
		expect(results[0]?.label).toBe("result-child");
		expect(results[0]?.key).toBe("legacy-results-call:0");
		expect(results[0]?.state).toBe("running");
		expect(progress[0]?.label).toBe("progress-child");
		expect(progress[0]?.key).toBe("legacy-progress-call:0");
	});

	test("preserves foreground transcript metadata from running result progress", () => {
		const tool = {
			kind: "tool" as const,
			id: "metadata",
			toolCallId: "call-metadata",
			name: "subagent",
			args: {},
			output: "",
			details: {
				results: [
					{
						agent: "worker",
						transcriptPath: "/tmp/foreground.jsonl",
						sessionFile: "/tmp/foreground-session.jsonl",
						progress: {
							agent: "worker",
							status: "running",
							currentTool: "bash",
							turnCount: 3,
							toolCount: 4,
							tokens: { total: 99 },
						},
					},
				],
			},
			timestamp: Date.now(),
			status: "streaming" as const,
			isError: false,
		};
		const target = subagentTargets([], [tool])[0];
		expect(target?.transcriptPath).toBe("/tmp/foreground.jsonl");
		expect(target?.sessionFile).toBe("/tmp/foreground-session.jsonl");
		expect(target?.run.totalTokens).toBe(99);
		expect(target?.run.currentTool).toBe("bash");
		expect(target?.run.turnCount).toBe(3);
		const numeric = subagentTargets(
			[],
			[
				{
					...tool,
					id: "numeric-tokens",
					toolCallId: "numeric-tokens-call",
					details: { progress: [{ agent: "numeric", tokens: 123 }] },
				},
			],
		);
		expect(numeric[0]?.run.totalTokens).toBe(123);
	});

	test("reconstructs persisted calls through targets without creating args-only children", () => {
		const items = initialItems([
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "persisted-call",
						name: "subagent",
						arguments: {
							tasks: [
								{
									label: "custom label",
									agent: "worker",
									model: "provider/model",
								},
							],
						},
					},
				],
			},
			{
				role: "toolResult",
				toolCallId: "persisted-call",
				toolName: "subagent",
				content: [],
				details: { results: [{ progress: [], exitCode: 0 }] },
			},
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "args-only",
						name: "subagent",
						arguments: { label: "never shown" },
					},
				],
			},
			{
				role: "toolResult",
				toolCallId: "unmatched",
				toolName: "subagent",
				content: [],
				details: { results: [] },
			},
		]);
		const tools = items.filter(
			(item): item is ToolItem => item.kind === "tool",
		);
		const targets = subagentTargets([], tools);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.label).toBe("custom label");
		expect(targets[0]?.model).toBe("provider/model");
		expect(targets[0]?.canSteer).toBe(false);
		expect(
			tools.find((tool) => tool.toolCallId === "args-only"),
		).toBeUndefined();
	});

	test("enriches exactly matched artifacts without overriding runtime fields", () => {
		const target = run();
		target.steps = [{ index: 0, agent: "artifact-agent", status: "running" }];
		const tool = {
			kind: "tool" as const,
			id: "artifact-match",
			toolCallId: "artifact-call",
			name: "subagent",
			args: {
				tasks: [
					{
						agent: "requested-agent",
						label: "requested label",
						model: "requested-model",
						thinking: "requested-thinking",
						contextWindow: 4096,
					},
				],
			},
			output: "",
			details: { runId: target.runId },
			timestamp: Date.now(),
			status: "done" as const,
			isError: false,
		};
		const matched = subagentTargets([target], [tool])[0];
		expect(matched?.run).toBe(target);
		expect(matched?.canSteer).toBe(true);
		expect(matched?.label).toBe("artifact-agent · requested label");
		expect(matched?.model).toBe("requested-model");
		expect(matched?.thinking).toBe("requested-thinking");
		expect(matched?.contextWindow).toBe(4096);

		target.steps[0] = {
			...target.steps[0]!,
			label: "artifact label",
			model: "artifact-model",
			thinking: "artifact-thinking",
			contextWindow: 8192,
		};
		const artifactWins = subagentTargets([target], [tool])[0];
		expect(artifactWins?.label).toBe("artifact-agent · artifact label");
		expect(artifactWins?.model).toBe("artifact-model");
		expect(artifactWins?.thinking).toBe("artifact-thinking");
		expect(artifactWins?.contextWindow).toBe(8192);

		const other = run();
		other.runId = "other-run";
		other.steps = [{ index: 0, agent: "other-agent", status: "running" }];
		const mismatched = subagentTargets(
			[other],
			[{ ...tool, details: { runId: "unrelated" } }],
		)[0];
		expect(mismatched?.label).toBe("other-agent");
		expect(mismatched?.model).toBeUndefined();
	});

	test("restores requested metadata from the exact persisted call", () => {
		const tool = {
			kind: "tool" as const,
			id: "requested",
			toolCallId: "requested-call",
			name: "subagent",
			args: {
				agent: "requested-worker",
				model: "provider/model",
				thinking: "high",
				contextWindow: 8192,
			},
			output: "done",
			details: { results: [{ progress: {}, exitCode: 0 }] },
			timestamp: Date.now(),
			status: "done" as const,
			isError: false,
		};
		const target = subagentTargets([], [tool])[0];
		expect(target?.label).toBe("requested-worker");
		expect(target?.model).toBe("provider/model");
		expect(target?.thinking).toBe("high");
		expect(target?.contextWindow).toBe(8192);
		expect(target?.canSteer).toBe(false);
	});

	test("falls back to a bounded child session file transcript", () => {
		const target = run();
		const sessionFile = path.join(target.asyncDir!, "child-session.jsonl");
		fs.writeFileSync(
			sessionFile,
			[
				JSON.stringify({
					message: {
						role: "assistant",
						content: [{ type: "text", text: "from session" }],
						timestamp: 1,
					},
				}),
				"not json",
			].join("\n"),
		);
		target.sessionFile = sessionFile;
		const items = readSubagentConversation(target);
		expect(items).toHaveLength(1);
		expect(items[0]?.kind === "assistant" ? items[0].text : "").toBe(
			"from session",
		);
	});

	test("parses progress objects nested in result details", () => {
		const tool = {
			kind: "tool" as const,
			id: "nested",
			toolCallId: "call-nested",
			name: "subagent",
			args: {},
			output: "",
			details: {
				results: [{ progress: { agent: "nested-worker", status: "running" } }],
			},
			timestamp: Date.now(),
			status: "done" as const,
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(targets[0]?.label).toBe("nested-worker");
		expect(targets[0]?.active).toBe(true);
	});

	test("keeps rich completed foreground results with empty progress", () => {
		const tool = {
			kind: "tool" as const,
			id: "completed-empty-progress",
			toolCallId: "call-completed-empty-progress",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				results: [
					{
						agent: "worker",
						progress: [],
						exitCode: 0,
						transcriptPath: "/tmp/rich.jsonl",
						sessionFile: "/tmp/rich-session.jsonl",
					},
				],
			},
			timestamp: Date.now(),
			status: "done" as const,
			isError: false,
		};
		const target = subagentTargets([], [tool])[0];
		expect(target?.label).toBe("worker");
		expect(target?.state).toBe("completed");
		expect(target?.transcriptPath).toBe("/tmp/rich.jsonl");
	});

	test("keeps completed foreground result metadata without progress", () => {
		const tool = {
			kind: "tool" as const,
			id: "completed",
			toolCallId: "call-completed",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				results: [
					{
						agent: "worker",
						exitCode: 0,
						transcriptPath: "/tmp/completed.jsonl",
						sessionFile: "/tmp/completed-session.jsonl",
					},
				],
			},
			timestamp: Date.now(),
			status: "done" as const,
			isError: false,
		};
		const target = subagentTargets([], [tool])[0];
		expect(target?.state).toBe("completed");
		expect(target?.active).toBe(false);
		expect(target?.transcriptPath).toBe("/tmp/completed.jsonl");
	});

	test("ignores metadata-free and empty foreground tool results", () => {
		const tools = [
			{
				kind: "tool" as const,
				id: "empty",
				toolCallId: "call-empty",
				name: "subagent",
				args: {},
				output: "",
				timestamp: 1,
				status: "done" as const,
				isError: false,
			},
			{
				kind: "tool" as const,
				id: "empty-results",
				toolCallId: "call-empty-results",
				name: "delegate",
				args: {},
				output: "",
				details: { results: [] },
				timestamp: 2,
				status: "done" as const,
				isError: false,
			},
			{
				kind: "tool" as const,
				id: "empty-progress",
				toolCallId: "call-empty-progress",
				name: "agent",
				args: {},
				output: "",
				details: { progress: [] },
				timestamp: 3,
				status: "done" as const,
				isError: false,
			},
		];
		expect(subagentTargets([], tools)).toEqual([]);
		const restored = initialItems(
			tools.map((tool) => ({
				role: "toolResult",
				toolCallId: tool.toolCallId,
				toolName: tool.name,
				content: [],
				details: tool.details,
				timestamp: tool.timestamp,
			})),
		);
		expect(
			subagentTargets(
				[],
				restored.filter((item): item is ToolItem => item.kind === "tool"),
			),
		).toEqual([]);
	});

	test("falls back safely for malformed foreground details", () => {
		const tool = {
			kind: "tool" as const,
			id: "malformed",
			toolCallId: "call-malformed",
			name: "subagent",
			args: {},
			output: "",
			details: { progress: [null, 42, "bad"] },
			timestamp: Date.now(),
			status: "pending" as const,
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(targets).toHaveLength(0);
	});

	test("maps a subagent tool result to each child in its run", () => {
		const target = run();
		target.mode = "parallel";
		target.steps = [
			{ index: 0, agent: "one", status: "running" },
			{ index: 1, agent: "two", status: "completed" },
		];
		const tool = {
			kind: "tool" as const,
			id: "tool-1",
			toolCallId: "call-1",
			name: "subagent",
			args: {},
			output: "started",
			details: { runId: "run-1" },
			timestamp: Date.now(),
			status: "done" as const,
			isError: false,
		};
		expect(
			targetsForTool(tool, subagentTargets([target]))
				.map((item) => item.label)
				.sort(),
		).toEqual(["one #1", "two #2"]);
	});

	test("uses persisted activity timestamps when projecting targets", () => {
		const stepRun = run();
		stepRun.steps = [
			{
				index: 0,
				agent: "one",
				status: "running",
				lastActivityAt: 123,
				currentToolStartedAt: 99,
			},
		];
		expect(subagentTargets([stepRun])[0]?.lastUpdate).toBe(123);

		const runOnly = run();
		runOnly.lastActivityAt = 456;
		runOnly.currentToolStartedAt = 400;
		expect(subagentTargets([runOnly])[0]?.lastUpdate).toBe(456);
	});

	test("uses persisted activity precedence before transcript fallback", () => {
		const stepRun = run();
		stepRun.endedAt = 400;
		const step: SubagentStep = {
			index: 0,
			agent: "one",
			status: "running",
			lastActivityAt: 100,
			currentToolStartedAt: 200,
			endedAt: 300,
		};
		stepRun.steps = [step];

		expect(subagentActivityAt(stepRun, 0)).toBe(100);
		delete step.lastActivityAt;
		expect(subagentActivityAt(stepRun, 0)).toBe(200);
		delete step.currentToolStartedAt;
		expect(subagentActivityAt(stepRun, 0)).toBe(300);
		delete step.endedAt;
		expect(subagentActivityAt(stepRun, 0)).toBe(400);

		const runOnly = run();
		runOnly.endedAt = 700;
		runOnly.currentToolStartedAt = 600;
		runOnly.lastActivityAt = 500;
		expect(subagentActivityAt(runOnly)).toBe(500);
		delete runOnly.lastActivityAt;
		expect(subagentActivityAt(runOnly)).toBe(600);
		delete runOnly.currentToolStartedAt;
		expect(subagentActivityAt(runOnly)).toBe(700);
	});

	test("ignores streaming-only transcript updates for last activity", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "transcript.jsonl");
		target.transcriptPath = transcriptPath;
		fs.writeFileSync(
			transcriptPath,
			[
				JSON.stringify({
					recordType: "message",
					role: "assistant",
					text: "streaming",
					ts: 100,
				}),
				JSON.stringify({
					recordType: "message",
					role: "assistant",
					text: "reformatted",
					ts: 200,
				}),
				JSON.stringify({ recordType: "tool_start", toolName: "bash", ts: 300 }),
				JSON.stringify({
					recordType: "message",
					role: "assistant",
					text: "more streaming",
					ts: 400,
				}),
				JSON.stringify({ recordType: "tool_end", toolName: "bash", ts: 350 }),
			].join("\n"),
		);
		expect(substantiveSubagentActivityAt(target)).toBe(350);
		expect(subagentActivityAt(target)).toBe(350);
		expect(subagentTargets([target])[0]?.lastUpdate).toBe(350);
	});

	test("reuses selected transcript items for sibling updates", () => {
		const first = run();
		first.steps = [
			{ index: 0, agent: "one", status: "running", lastActivityAt: 10 },
		];
		const second = run();
		second.runId = "run-2";
		second.steps = [
			{ index: 0, agent: "two", status: "running", lastActivityAt: 20 },
		];
		let reads = 0;
		const cache = createSubagentTranscriptCache(() => {
			reads += 1;
			return [];
		});
		const initial = subagentTargets([first, second]);
		const items = cache(initial[0], true);
		const siblingUpdate = subagentTargets([
			first,
			{ ...second, lastActivityAt: 30 },
		]);
		expect(cache(siblingUpdate[0], true)).toBe(items);
		expect(reads).toBe(1);

		const selectedUpdate = subagentTargets([
			{ ...first, steps: [{ ...first.steps[0]!, lastActivityAt: 40 }] },
			second,
		]);
		expect(cache(selectedUpdate[0], true)).not.toBe(items);
		expect(reads).toBe(2);
	});

	test("keeps transcript item references stable across fresh reads", () => {
		const targetRun = run();
		targetRun.steps = [{ index: 0, agent: "worker", status: "running", lastActivityAt: 1 }];
		let output: ConversationItem[] = [
			{ kind: "user", id: "user-1", text: "task", timestamp: 1, optimistic: false },
			{ kind: "tool", id: "tool-1", toolCallId: "call-1", name: "bash", args: "pwd", output: "", timestamp: 2, startedAt: 2, status: "streaming", isError: false },
		];
		const cache = createSubagentTranscriptCache(() => output.map((item) => ({ ...item })));
		const target = subagentTargets([targetRun])[0]!;
		const first = cache(target, true);
		targetRun.steps[0]!.lastActivityAt = 2;
		const unchanged = cache(subagentTargets([targetRun])[0], true);
		expect(unchanged).not.toBe(first);
		expect(unchanged[0]).toBe(first[0]);
		expect(unchanged[1]).toBe(first[1]);
		output = output.map((item) => item.kind === "tool" ? { ...item, output: "done", status: "done" } : item);
		targetRun.steps[0]!.lastActivityAt = 3;
		const changed = cache(subagentTargets([targetRun])[0], true);
		expect(changed[0]).toBe(first[0]);
		expect(changed[1]).not.toBe(first[1]);
		const callsBefore = changed;
		expect(cache(subagentTargets([targetRun])[0], true)).toBe(callsBefore);
	});

	test("refreshes inspected transcript when the file changes without an activity update", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-transcript-cache-"));
		roots.push(root);
		const transcriptPath = path.join(root, "transcript.jsonl");
		fs.writeFileSync(transcriptPath, "first\n");
		const targetRun = run();
		targetRun.transcriptPath = transcriptPath;
		targetRun.lastActivityAt = 1;
		let reads = 0;
		const cache = createSubagentTranscriptCache(() => {
			reads += 1;
			return [];
		});
		const target = subagentTargets([targetRun])[0]!;

		cache(target, true);
		fs.appendFileSync(transcriptPath, "second\n");
		cache(target, true);

		expect(reads).toBe(2);
	});

	test("discovers live transcripts using real metadata and verified names", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-artifacts-"));
		roots.push(cwd);
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const now = Date.now();
		const transcriptPath = path.join(artifacts, "uuid_worker_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		fs.writeFileSync(transcriptPath.replace("_transcript.jsonl", "_meta.json"), JSON.stringify({ agent: "worker", runId: "child", timestamp: now }));
		const targetRun = run();
		targetRun.cwd = cwd;
		targetRun.startedAt = now;
		const step: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-live", status: "running", startedAt: now };
		applyDerivedChildTranscript(step, cwd);
		expect(step.transcriptPath).toBe(transcriptPath);

		const indexedPath = path.join(artifacts, "uuid_worker_2_transcript.jsonl");
		fs.writeFileSync(indexedPath, "");
		fs.writeFileSync(indexedPath.replace("_transcript.jsonl", "_meta.json"), JSON.stringify({ agent: "worker", runId: "child-2", timestamp: now }));
		const indexedStep: SubagentStep = { index: 2, agent: "worker", workflowKey: "k-indexed", status: "running", startedAt: now };
		applyDerivedChildTranscript(indexedStep, cwd);
		expect(indexedStep.transcriptPath).toBe(indexedPath);
		const wrongIndexStep: SubagentStep = { index: 1, agent: "worker", workflowKey: "k-wrong", status: "running", startedAt: now };
		applyDerivedChildTranscript(wrongIndexStep, cwd);
		expect(wrongIndexStep.transcriptPath).toBeUndefined();
	});

	test("fails closed for stale, ambiguous, or mismatched live artifacts", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-artifacts-"));
		roots.push(cwd);
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const now = Date.now();
		const writeArtifact = (name: string, agent: string): string => {
			const transcriptPath = path.join(artifacts, name);
			fs.writeFileSync(transcriptPath, "");
			fs.writeFileSync(transcriptPath.replace("_transcript.jsonl", "_meta.json"), JSON.stringify({ agent, runId: name, timestamp: now }));
			return transcriptPath;
		};
		const oldPath = writeArtifact("old_worker_transcript.jsonl", "worker");
		fs.utimesSync(oldPath, new Date(now - 10_000), new Date(now - 10_000));
		const oldRun = run();
		oldRun.cwd = cwd;
		oldRun.startedAt = now;
		const oldStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-old", status: "running", startedAt: now };
		applyDerivedChildTranscript(oldStep, cwd);
		expect(oldStep.transcriptPath).toBeUndefined();

		writeArtifact("one_worker_transcript.jsonl", "worker");
		writeArtifact("two_worker_transcript.jsonl", "worker");
		const ambiguousStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-ambiguous", status: "running", startedAt: now };
		applyDerivedChildTranscript(ambiguousStep, cwd);
		expect(ambiguousStep.transcriptPath).toBeUndefined();
		const mismatchPath = writeArtifact("mismatch_worker_transcript.jsonl", "other");
		const mismatchStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-mismatch", status: "running", startedAt: now };
		applyDerivedChildTranscript(mismatchStep, cwd);
		expect(mismatchStep.transcriptPath).toBeUndefined();
		expect(fs.existsSync(mismatchPath)).toBe(true);
	});

	test("scopes live discovery to a real parent session path", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-parent-artifacts-"));
		roots.push(root);
		const parentSessionFile = path.join(root, "session.jsonl");
		const artifacts = path.join(root, "subagent-artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const transcriptPath = path.join(artifacts, "uuid_worker_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		fs.writeFileSync(transcriptPath.replace("_transcript.jsonl", "_meta.json"), JSON.stringify({ agent: "worker", runId: "child", timestamp: Date.now() }));
		const pathStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-parent", status: "running", startedAt: Date.now() };
		applyDerivedChildTranscript(pathStep, undefined, parentSessionFile);
		expect(pathStep.transcriptPath).toBe(transcriptPath);
		const idStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-id", status: "running", startedAt: Date.now() };
		applyDerivedChildTranscript(idStep, undefined, "session-id");
		expect(idStep.transcriptPath).toBeUndefined();
	});

	test("live discovery ignores non-running steps and never leaks across scopes", () => {
		const cwdA = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-scope-a-"));
		roots.push(cwdA);
		const artifactsA = path.join(cwdA, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifactsA, { recursive: true });
		const now = Date.now();
		const transcriptPath = path.join(artifactsA, "uuid_worker_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		fs.writeFileSync(
			transcriptPath.replace("_transcript.jsonl", "_meta.json"),
			JSON.stringify({ agent: "worker", runId: "child", timestamp: now }),
		);

		const completedStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-done", status: "completed" };
		applyDerivedChildTranscript(completedStep, cwdA);
		expect(completedStep.transcriptPath).toBeUndefined();

		const cwdB = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-scope-b-"));
		roots.push(cwdB);
		const scopedStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-scope", status: "running", startedAt: now };
		applyDerivedChildTranscript(scopedStep, cwdB);
		expect(scopedStep.transcriptPath).toBeUndefined();

		const runningStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-live", status: "running", startedAt: now };
		applyDerivedChildTranscript(runningStep, cwdA);
		expect(runningStep.transcriptPath).toBe(transcriptPath);
	});

	test("reads the active subagent transcript", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "transcript.jsonl");
		fs.writeFileSync(
			transcriptPath,
			[
				JSON.stringify({
					recordType: "message",
					role: "assistant",
					text: "visible result",
					ts: 1,
				}),
				JSON.stringify({
					recordType: "tool_start",
					toolName: "bash",
					argsPreview: "git status",
					ts: 2,
				}),
			].join("\n"),
		);
		target.transcriptPath = transcriptPath;
		const entries = readSubagentTranscript(target);
		expect(entries.map((entry) => entry.text)).toEqual([
			"visible result",
			"git status",
		]);
	});

	test("builds the same conversation model for subagent thinking and tools", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "conversation.jsonl");
		fs.writeFileSync(
			transcriptPath,
			[
				JSON.stringify({
					recordType: "message",
					role: "assistant",
					ts: 10,
					message: {
						role: "assistant",
						content: [
							{
								type: "thinking",
								thinking:
									"\u001b[38;2;34;211;238mThinking:\u001b[39m **Inspecting tests**",
							},
							{ type: "text", text: "Found **two** failures." },
						],
						stopReason: "toolUse",
					},
				}),
				JSON.stringify({
					recordType: "tool_start",
					toolName: "bash",
					toolCallId: "call-1",
					argsPreview: "bun test",
					ts: 20,
				}),
				JSON.stringify({ recordType: "tool_end", toolName: "bash", ts: 367 }),
				JSON.stringify({
					recordType: "message",
					role: "toolResult",
					text: "5 pass\n0 fail",
					ts: 368,
					message: {
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "bash",
						content: [{ type: "text", text: "5 pass\n0 fail" }],
						isError: false,
					},
				}),
			].join("\n"),
		);
		target.transcriptPath = transcriptPath;

		const items = readSubagentConversation(target);
		expect(items).toHaveLength(2);
		expect(items[0]?.kind).toBe("assistant");
		expect(items[0]?.kind === "assistant" ? items[0].thinking : "").toContain(
			"Inspecting tests",
		);
		expect(items[1]?.kind).toBe("tool");
		if (items[1]?.kind === "tool") {
			expect(items[1].name).toBe("bash");
			expect(items[1].args).toBe("bun test");
			expect(items[1].output).toBe("5 pass\n0 fail");
			expect(items[1].startedAt).toBe(20);
			expect(items[1].endedAt).toBe(367);
			expect(items[1].status).toBe("done");
		}
	});

	test("assigns one owner to repeated logical targets across tool items", () => {
		const firstTool: ToolItem = {
			kind: "tool",
			id: "first-item",
			toolCallId: "first-call",
			name: "subagent",
			args: {},
			output: "",
			details: {
				progress: [
					{
						agent: "worker",
						status: "running",
						sessionFile: "/tmp/repeated.jsonl",
					},
				],
			},
			timestamp: 1,
			status: "streaming",
			isError: false,
		};
		const secondTool: ToolItem = {
			...firstTool,
			id: "second-item",
			toolCallId: "second-call",
			details: {
				progress: [
					{
						agent: "worker",
						status: "completed",
						sessionFile: "/tmp/repeated.jsonl",
					},
				],
			},
			status: "done",
		};
		const firstTarget = subagentTargets([], [firstTool])[0]!;
		const secondTarget = subagentTargets([], [secondTool])[0]!;
		const owned = ownedSubagentTargetsForItems(
			[firstTool, secondTool],
			[firstTarget, secondTarget],
		);
		expect(owned.get("first-item")).toHaveLength(1);
		expect(owned.get("second-item") ?? []).toHaveLength(0);
		expect(owned.get("first-item")?.[0]?.state).toBe("completed");
	});

	test("owns every foreground workflow child when result run ids are composite", () => {
		const toolCallId = "wf-foreground-call";
		const tool: ToolItem = {
			kind: "tool",
			id: "wf-foreground-item",
			toolCallId,
			name: "subagent",
			args: { workflowScript: "return runs.run('alpha', {agent:'scout', task:'a'})" },
			output: "done",
			details: {
				mode: "workflow",
				runId: toolCallId,
				results: [
					{
						index: 0,
						agent: "scout",
						exitCode: 0,
						sessionFile: "/sessions/base/child-a/run-0/session.jsonl",
						transcriptPath: "/artifacts/child-a_scout_0_transcript.jsonl",
					},
					{
						index: 1,
						agent: "scout",
						exitCode: 0,
						sessionFile: "/sessions/base/child-b/run-0/session.jsonl",
						transcriptPath: "/artifacts/child-b_scout_0_transcript.jsonl",
					},
				],
				workflow: {
					trace: [
						{ operation: "run", key: "alpha", agent: "scout", state: "started" },
						{ operation: "run", key: "beta", agent: "scout", state: "started" },
						{ operation: "run", key: "alpha", agent: "scout", state: "completed", runId: "child-a", durationMs: 1000 },
						{ operation: "run", key: "beta", agent: "scout", state: "completed", runId: "child-b", durationMs: 2000 },
					],
				},
			},
			timestamp: 1000,
			status: "done",
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(targets.map((target) => target.key).sort()).toEqual([
			`${toolCallId}:alpha`,
			`${toolCallId}:beta`,
		]);
		const owned = ownedSubagentTargetsForItems([tool], targets).get(tool.id) ?? [];
		expect(owned.map((target) => target.key).sort()).toEqual([
			`${toolCallId}:alpha`,
			`${toolCallId}:beta`,
		]);
		expect(owned.every((target) => Boolean(target.transcriptPath))).toBe(true);
		expect(owned.every((target) => Boolean(target.sessionFile))).toBe(true);
	});

	test("keeps result data on workflow children when trace and result counts differ", () => {
		const toolCallId = "wf-partial-call";
		const tool: ToolItem = {
			kind: "tool",
			id: "wf-partial-item",
			toolCallId,
			name: "subagent",
			args: { workflowScript: "partial" },
			output: "done",
			details: {
				mode: "workflow",
				runId: toolCallId,
				results: [
					{
						index: 0,
						agent: "scout",
						exitCode: 0,
						sessionFile: "/sessions/base/child-a/run-0/session.jsonl",
						transcriptPath: "/artifacts/child-a_scout_0_transcript.jsonl",
					},
				],
				workflow: {
					trace: [
						{ operation: "run", key: "alpha", agent: "scout", state: "started" },
						{ operation: "run", key: "beta", agent: "scout", state: "started" },
						{ operation: "run", key: "alpha", agent: "scout", state: "completed", runId: "child-a", durationMs: 1000 },
					],
				},
			},
			timestamp: 1000,
			status: "done",
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		const byKey = new Map(targets.map((target) => [target.key, target]));
		expect(byKey.get(`${toolCallId}:alpha`)?.transcriptPath).toBe(
			"/artifacts/child-a_scout_0_transcript.jsonl",
		);
		expect(byKey.get(`${toolCallId}:alpha`)?.sessionFile).toBe(
			"/sessions/base/child-a/run-0/session.jsonl",
		);
		expect(byKey.get(`${toolCallId}:beta`)?.transcriptPath).toBeUndefined();
	});

	test("targetsForTool falls back to toolCallId for composite workflow run ids", () => {
		const toolCallId = "wf-direct-call";
		const item: ToolItem = {
			kind: "tool",
			id: "wf-direct-item",
			toolCallId,
			name: "subagent",
			args: {},
			output: "done",
			details: { mode: "workflow", runId: toolCallId },
			timestamp: 1000,
			status: "done",
			isError: false,
		};
		const makeTarget = (key: string): SubagentTarget =>
			subagentTargets([], [
				{
					...item,
					details: {
						mode: "workflow",
						runId: toolCallId,
						workflow: {
							trace: [
								{
									operation: "run",
									key,
									agent: "scout",
									state: "completed",
									runId: `child-${key}`,
								},
							],
						},
					},
				},
			])[0]!;
		const targets = [makeTarget("alpha"), makeTarget("beta")];
		expect(targetsForTool(item, targets).map((t) => t.key).sort()).toEqual([
			`${toolCallId}:alpha`,
			`${toolCallId}:beta`,
		]);
	});

	test("keeps distinct parallel step indexes as separate targets", () => {
		const target = run();
		target.mode = "parallel";
		target.steps = [
			{
				index: 0,
				agent: "first",
				status: "running",
				sessionFile: "/tmp/shared.jsonl",
			},
			{
				index: 1,
				agent: "second",
				status: "running",
				sessionFile: "/tmp/shared.jsonl",
			},
		];
		const tool: ToolItem = {
			kind: "tool",
			id: "parallel-item",
			toolCallId: "parallel-call",
			name: "subagent",
			args: {},
			output: "",
			details: { runId: target.runId },
			timestamp: 1,
			status: "streaming",
			isError: false,
		};
		const owned = ownedSubagentTargetsForItems(
			[tool],
			subagentTargets([target]),
		);
		expect(owned.get("parallel-item")).toHaveLength(2);
	});

	test("nearest-match fallback attaches a run to the spawning tool call, not an earlier unrelated one", () => {
		const earlierTool: ToolItem = {
			kind: "tool",
			id: "earlier-item",
			toolCallId: "earlier-call",
			name: "subagent",
			args: {},
			output: "",
			details: {},
			timestamp: 1_000,
			status: "done",
			isError: false,
		};
		const laterTool: ToolItem = {
			kind: "tool",
			id: "later-item",
			toolCallId: "later-call",
			name: "subagent",
			args: {},
			output: "",
			details: {},
			timestamp: 5_000,
			status: "streaming",
			isError: false,
		};
		const earlierRun = run();
		earlierRun.runId = "run-earlier";
		earlierRun.startedAt = 1_050;
		earlierRun.steps = [
			{ index: 0, agent: "earlier-child", status: "running" },
		];
		const laterRun = run();
		laterRun.runId = "run-later";
		laterRun.startedAt = 5_050;
		laterRun.mode = "parallel";
		laterRun.steps = [
			{ index: 0, agent: "later-child-a", status: "running" },
			{ index: 1, agent: "later-child-b", status: "running" },
		];
		const owned = ownedSubagentTargetsForItems(
			[earlierTool, laterTool],
			subagentTargets([earlierRun, laterRun]),
		);
		// The earlier (legacy, runId-less) tool call keeps its own nearby run, and
		// the later parallel run attaches to the later tool call instead of
		// leaking onto the earlier one.
		expect(owned.get("earlier-item") ?? []).toHaveLength(1);
		expect(owned.get("earlier-item")?.[0]?.run.runId).toBe("run-earlier");
		expect(owned.get("later-item") ?? []).toHaveLength(2);
		expect(owned.get("later-item")?.map((target) => target.run.runId)).toEqual([
			"run-later",
			"run-later",
		]);
	});

	test("nearest-match fallback drops a run that is outside the window", () => {
		const tool: ToolItem = {
			kind: "tool",
			id: "far-item",
			toolCallId: "far-call",
			name: "subagent",
			args: {},
			output: "",
			details: {},
			timestamp: 100_000,
			status: "streaming",
			isError: false,
		};
		const farRun = run();
		farRun.runId = "run-far";
		farRun.startedAt = 10_000; // >30s from tool.timestamp
		farRun.steps = [{ index: 0, agent: "far-child", status: "running" }];
		const owned = ownedSubagentTargetsForItems(
			[tool],
			subagentTargets([farRun]),
		);
		expect(owned.get("far-item") ?? []).toHaveLength(0);
	});

	test("filters only the synthetic prompt marker and preserves error-only assistant records", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "transcript.jsonl");
		fs.writeFileSync(transcriptPath, [
			JSON.stringify({ recordType: "message", role: "user", text: "[prompt redacted]; live Prompt Audit only. extra", ts: 1 }),
			JSON.stringify({ recordType: "message", role: "user", text: "[prompt redacted]; live Prompt Audit only.", ts: 2 }),
			JSON.stringify({ recordType: "message", role: "assistant", message: { role: "assistant", stopReason: "error", errorMessage: "Provider finish_reason: network_error" }, ts: 3 }),
		].join("\n"));
		target.transcriptPath = transcriptPath;
		const items = readSubagentConversation(target);
		expect(items).toEqual([
			expect.objectContaining({ kind: "user", text: "[prompt redacted]; live Prompt Audit only. extra" }),
			expect.objectContaining({ kind: "system", tone: "error", text: "Provider finish_reason: network_error" }),
		]);
	});

	test("enriches workflow steps from exactly matched child metadata and fails closed", () => {
		const target = run();
		target.mode = "workflow";
		const sessionFile = path.join(target.asyncDir!, "sessions", "base", "child-0", "run-0", "session.jsonl");
		fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
		target.steps = [{ index: 0, agent: "worker", workflowKey: "alpha", runId: "child-0", status: "failed", sessionFile }];
		const artifacts = path.join(target.asyncDir!, "sessions", "subagent-artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		fs.writeFileSync(path.join(artifacts, "child-0_worker_0_meta.json"), JSON.stringify({ workflowKey: "alpha", agent: "worker", index: 0, model: "provider/model", thinking: "high", contextWindow: 8192, error: "network_error" }));
		const enriched = subagentTargets([target])[0];
		expect(enriched).toMatchObject({ model: "provider/model", thinking: "high", contextWindow: 8192, error: "network_error" });
		fs.writeFileSync(path.join(artifacts, "child-0_worker_0_meta.json"), JSON.stringify({ workflowKey: "other", agent: "worker", index: 0, model: "wrong" }));
		expect(subagentTargets([target])[0]?.model).toBeUndefined();
	});

	test("nearest-match fallback does not attach a run to a non-subagent tool call", () => {
		const tool: ToolItem = {
			kind: "tool",
			id: "other-item",
			toolCallId: "other-call",
			name: "bash",
			args: {},
			output: "",
			details: {},
			timestamp: 5_000,
			status: "streaming",
			isError: false,
		};
		const nearbyRun = run();
		nearbyRun.runId = "run-near";
		nearbyRun.startedAt = 5_050;
		nearbyRun.steps = [{ index: 0, agent: "near-child", status: "running" }];
		const owned = ownedSubagentTargetsForItems(
			[tool],
			subagentTargets([nearbyRun]),
		);
		expect(owned.get("other-item") ?? []).toHaveLength(0);
	});

	test("matches same-name concurrent tool results by call id in completion order", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "call-ids.jsonl");
		fs.writeFileSync(transcriptPath, [
			JSON.stringify({ recordType: "tool_start", toolName: "bash", toolCallId: "call-a", argsPreview: "first", ts: 1 }),
			JSON.stringify({ recordType: "tool_start", toolName: "bash", toolCallId: "call-b", argsPreview: "second", ts: 2 }),
			JSON.stringify({ recordType: "message", role: "toolResult", toolCallId: "call-b", text: "second result", ts: 3 }),
			JSON.stringify({ recordType: "message", role: "toolResult", toolCallId: "call-a", text: "first result", ts: 4 }),
		].join("\n"));
		target.transcriptPath = transcriptPath;
		const tools = readSubagentConversation(target).filter((item): item is ToolItem => item.kind === "tool");
		expect(tools).toHaveLength(2);
		expect(tools.map((tool) => [tool.toolCallId, tool.output])).toEqual([
			["call-a", "first result"],
			["call-b", "second result"],
		]);
	});

	test("does not attach ID-bearing unknown tool records by same-name fallback", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "unknown-call-id.jsonl");
		fs.writeFileSync(transcriptPath, [
			JSON.stringify({ recordType: "tool_start", toolName: "bash", toolCallId: "call-known", argsPreview: "known", ts: 1 }),
			JSON.stringify({ recordType: "tool_start", toolName: "bash", argsPreview: "legacy", ts: 2 }),
			JSON.stringify({ recordType: "message", role: "toolResult", toolName: "bash", toolCallId: "call-unknown", text: "unknown result", ts: 3 }),
			JSON.stringify({ recordType: "tool_end", toolName: "bash", toolCallId: "call-unknown", ts: 4 }),
		].join("\n"));
		target.transcriptPath = transcriptPath;

		const tools = readSubagentConversation(target).filter((item): item is ToolItem => item.kind === "tool");
		expect(tools).toHaveLength(3);
		expect(tools[0]).toEqual(expect.objectContaining({ toolCallId: "call-known", output: "" }));
		expect(tools[1]).toEqual(expect.objectContaining({ args: "legacy", output: "" }));
		expect(tools[0]?.endedAt).toBeUndefined();
		expect(tools[1]?.endedAt).toBeUndefined();
		expect(tools[2]).toEqual(expect.objectContaining({ toolCallId: "call-unknown", output: "unknown result" }));
	});

	test("preserves repeated user prompts unless records identify a known duplicate", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "users.jsonl");
		fs.writeFileSync(transcriptPath, [
			JSON.stringify({ recordType: "message", role: "user", text: "repeat", ts: 1 }),
			JSON.stringify({ recordType: "message", role: "user", text: "repeat", ts: 2 }),
			JSON.stringify({ recordType: "message", role: "user", subtype: "initial_prompt", text: "duplicate", ts: 3 }),
			JSON.stringify({ recordType: "message", role: "user", subtype: "message_end", text: "duplicate", ts: 4 }),
		].join("\n"));
		target.transcriptPath = transcriptPath;
		expect(readSubagentConversation(target).filter((item) => item.kind === "user").map((item) => item.text)).toEqual([
			"repeat",
			"repeat",
			"duplicate",
		]);
	});

	test("projects workflowChildren live activity over sparse workflow trace rows", () => {
		const tool: ToolItem = {
			kind: "tool", id: "workflow-live-projection", toolCallId: "workflow-call", name: "subagent", args: {}, output: "working",
			details: {
				mode: "workflow", runId: "workflow-parent",
				workflow: { trace: [{ operation: "run", key: "child", state: "started", agent: "general" }] },
				workflowChildren: { version: 1, children: [{ childId: "child", state: "running", agent: "general", model: "provider/live", activity: { currentTool: "bash", currentToolStartedAt: 250, lastActivityAt: 300, toolCount: 2, turnCount: 1, tokens: 30 } }] },
			}, timestamp: 100, status: "streaming", isError: false,
		};
		const target = subagentTargets([], [tool])[0];
		expect(target).toMatchObject({ model: "provider/live", lastUpdate: 300 });
		expect(target?.run).toMatchObject({ currentTool: "bash", currentToolStartedAt: 250, lastUpdate: 300 });
	});

	test("dedupes workflow child rows by richness", () => {
		const mission: SubagentRun = { runId: "mission-run", control: "mission", mode: "workflow", state: "running", steps: [
			{ index: 0, agent: "worker", status: "running", workflowKey: "child", sessionFile: "/tmp/shared-child.jsonl" },
		] };
		const artifact: SubagentRun = { runId: "artifact-run", control: "file", mode: "workflow", state: "running", steps: [
			{ index: 0, agent: "worker", status: "running", workflowKey: "child", sessionFile: "/tmp/shared-child.jsonl", model: "provider/live", transcriptPath: "/tmp/live-transcript.jsonl" },
		] };
		const targets = subagentTargets([mission, artifact]);
		expect(targets).toHaveLength(1);
		expect(targets[0]).toMatchObject({ model: "provider/live", transcriptPath: "/tmp/live-transcript.jsonl" });
	});

	test("resolves only a unique in-window live transcript", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-query-"));
		roots.push(cwd);
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const now = Date.now();
		const transcriptPath = path.join(artifacts, "child_worker_0_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, startedAt: now, cwd })).toBe(transcriptPath);
		const second = path.join(artifacts, "other_worker_0_transcript.jsonl");
		fs.writeFileSync(second, "");
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, startedAt: now, cwd })).toBeUndefined();
		fs.rmSync(second);
		fs.utimesSync(transcriptPath, new Date(now - 20_000), new Date(now - 20_000));
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, startedAt: now, cwd })).toBeUndefined();
	});

	test("does not resolve a bare parent session id from a relative artifact directory", () => {
		const relativeDir = path.join(process.cwd(), "subagent-artifacts");
		fs.mkdirSync(relativeDir, { recursive: true });
		const transcriptPath = path.join(relativeDir, "bare_worker_0_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		try {
			expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, startedAt: Date.now(), parentSessionFile: "session-id" })).toBeUndefined();
		} finally {
			fs.rmSync(relativeDir, { recursive: true, force: true });
		}
	});

	test("uses the child-local index zero for workflow transcript artifacts", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflow-query-"));
		roots.push(cwd);
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const first = path.join(artifacts, "child-a_worker_0_transcript.jsonl");
		fs.writeFileSync(first, "");
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, childRunId: "child-a", startedAt: Date.now(), cwd })).toBe(first);
		const second = path.join(artifacts, "child-b_worker_0_transcript.jsonl");
		fs.writeFileSync(second, "");
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, startedAt: Date.now(), cwd })).toBeUndefined();
	});

	test("enriches a workflow parent step from its matching live child", () => {
		const parent: SubagentRun = {
			runId: "parent-live",
			asyncDir: "/tmp/parent-live",
			control: "file",
			mode: "workflow",
			state: "running",
			steps: [{ index: 0, agent: "worker", workflowKey: "alpha", runId: "child-live", status: "running" }],
		};
		const child: SubagentRun = {
			runId: "child-live",
			parentWorkflowRunId: "parent-live",
			control: "file",
			mode: "single",
			state: "running",
			steps: [{ index: 0, agent: "worker", workflowKey: "alpha", runId: "child-live", status: "running", model: "provider/live", currentTool: "bash", currentToolStartedAt: 200, lastActivityAt: 300, turnCount: 2, toolCount: 4, sessionFile: "/tmp/child-live.jsonl" }],
		};
		const targets = subagentTargets([parent, child]);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.step).toMatchObject({ model: "provider/live", currentTool: "bash", currentToolStartedAt: 200, lastActivityAt: 300, turnCount: 2, toolCount: 4 });
		expect(targets[0]?.sessionFile).toBe("/tmp/child-live.jsonl");
	});

	test("keeps parent workflow metadata authoritative during child enrichment", () => {
		const parent: SubagentRun = { runId: "parent-authority", mode: "workflow", state: "running", steps: [{ index: 0, agent: "worker", workflowKey: "alpha", runId: "child-authority", status: "running", model: "provider/parent", currentTool: "parent-tool" }] };
		const child: SubagentRun = { runId: "child-authority", parentWorkflowRunId: "parent-authority", mode: "single", state: "running", steps: [{ index: 0, agent: "worker", workflowKey: "alpha", runId: "child-authority", status: "running", model: "provider/child", currentTool: "child-tool" }] };
		const target = subagentTargets([parent, child])[0];
		expect(target?.step).toMatchObject({ model: "provider/parent", currentTool: "parent-tool" });
	});

	test("isolates live metadata between workflow children", () => {
		const parent: SubagentRun = { runId: "parent-isolated", mode: "workflow", state: "running", steps: [
			{ index: 0, agent: "worker-a", workflowKey: "alpha", runId: "child-a", status: "running" },
			{ index: 1, agent: "worker-b", workflowKey: "beta", runId: "child-b", status: "running" },
		] };
		const childA: SubagentRun = { runId: "child-a", parentWorkflowRunId: "parent-isolated", mode: "single", state: "running", steps: [{ index: 0, agent: "worker-a", workflowKey: "alpha", runId: "child-a", status: "running", model: "provider/a", currentTool: "tool-a" }] };
		const childB: SubagentRun = { runId: "child-b", parentWorkflowRunId: "parent-isolated", mode: "single", state: "running", steps: [{ index: 0, agent: "worker-b", workflowKey: "beta", runId: "child-b", status: "running", model: "provider/b", currentTool: "tool-b" }] };
		const targets = subagentTargets([parent, childA, childB]);
		expect(targets).toHaveLength(2);
		expect(targets.find((target) => target.workflowKey === "alpha")?.step).toMatchObject({ model: "provider/a", currentTool: "tool-a" });
		expect(targets.find((target) => target.workflowKey === "beta")?.step).toMatchObject({ model: "provider/b", currentTool: "tool-b" });
	});

	test("rejects same-agent matches split between cwd and temp roots", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-ambiguous-"));
		roots.push(cwd);
		const cwdArtifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		const tempArtifacts = path.join(subagentTempRoot(), "artifacts");
		fs.mkdirSync(cwdArtifacts, { recursive: true });
		fs.mkdirSync(tempArtifacts, { recursive: true });
		roots.push(tempArtifacts);
		const cwdPath = path.join(cwdArtifacts, "cwd_worker_0_transcript.jsonl");
		const tempPath = path.join(tempArtifacts, "temp_worker_0_transcript.jsonl");
		fs.writeFileSync(cwdPath, "");
		fs.writeFileSync(tempPath, "");
		const startedAt = Date.now();
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, startedAt, cwd })).toBeUndefined();
	});

	test("resolves an indexed target through its exact flat child run artifact", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-flat-run-"));
		roots.push(cwd);
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const transcriptPath = path.join(artifacts, "child-run-flat_worker_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 1, childRunId: "child-run-flat", cwd })).toBe(transcriptPath);
	});

	test("rejects unsafe child run ids without probing outside the artifact root", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-unsafe-"));
		roots.push(cwd);
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const outside = path.join(cwd, "outside_worker_transcript.jsonl");
		fs.writeFileSync(outside, "");
		for (const childRunId of ["../outside", "child/run", "child\u0000run"]) {
			expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, childRunId, cwd, parentSessionFile: "session-id" })).toBeUndefined();
		}
	});

	test("uses live progress precedence through every foreground entry path", () => {
		const live = {
			version: 1,
			children: [{ childId: "child", agent: "worker", activity: { currentTool: "live-tool", toolCount: 2 } }],
		};
		const makeTool = (callId: string, details: Record<string, unknown>): ToolItem => ({
			kind: "tool",
			id: callId,
			toolCallId: callId,
			name: "subagent",
			args: {},
			output: "working",
			details: { ...details, workflowChildren: live },
			timestamp: 1,
			status: "streaming",
			isError: false,
		});
		const resultsOnly = makeTool("results-only", {
			results: [{ key: "child", progress: { agent: "worker", currentTool: "stored-tool", toolCount: 1 } }],
		});
		const traceTerminal = makeTool("trace-terminal", {
			workflow: { trace: [{ operation: "run", key: "child", agent: "worker", state: "started" }] },
			results: [{ key: "child", progress: { agent: "worker", currentTool: "stored-tool", toolCount: 1 } }],
		});
		const traceOnly = makeTool("trace-only", {
			workflow: { trace: [{ operation: "run", key: "child", agent: "worker", state: "started" }] },
		});
		const targets = subagentTargets([], [resultsOnly, traceTerminal, traceOnly]);
		expect(targets.map((target) => [target.toolCallId, target.run.currentTool, target.run.toolCount])).toEqual([
			["results-only", "live-tool", 2],
			["trace-only", "live-tool", 2],
			["trace-terminal", "live-tool", 2],
		]);
	});

	test("maps contextLimit to contextWindow without overriding explicit contextWindow", () => {
		const target = run();
		fs.writeFileSync(path.join(target.asyncDir!, "status.json"), JSON.stringify({ runId: "context-limit", mode: "single", state: "running", contextLimit: 1048576, steps: [
			{ index: 0, agent: "explicit", status: "running", contextWindow: 8192, contextLimit: 1048576 },
			{ index: 1, agent: "fallback", status: "running", contextLimit: 65536 },
		]}));
		const parsed = readSubagentRun(target.asyncDir!);
		expect(parsed?.contextWindow).toBe(1048576);
		expect(parsed?.steps[0]?.contextWindow).toBe(8192);
		expect(parsed?.steps[1]?.contextWindow).toBe(65536);
	});
});

describe("profiled live event stream", () => {
	function streamHarness() {
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

	function streamAgent(fixture: ReturnType<typeof profiledFixture>, name: string, agentId: string, extra: Record<string, unknown> = {}) {
		return fixture.writeAgent(name, {
			agentId, profile: "explore", parentAgentId: "root", label: agentId, state: "running", startedAt: Date.now(), ...extra,
		});
	}

	test("accumulates consecutive same-block chunks into one streaming item", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "stream-agent", "streamer");
		writeEvents(agent.controlDir, [
			{ kind: "thinking", blockId: "think-1", text: "conside" },
			{ kind: "thinking", blockId: "think-1", text: "ring it" },
			{ kind: "text", blockId: "text-1", text: "draft" },
			{ kind: "text", blockId: "text-1", text: " reply" },
		]);
		const target = liveTarget("streamer", [spawnTool(agent, "streamer")]);
		expect(target?.active).toBe(true);
		expect(target?.run.eventsPath).toBeDefined();
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(2);
		const [thinkingItem, textItem] = items;
		if (thinkingItem?.kind !== "assistant") throw new Error("expected a streaming thinking item");
		expect(thinkingItem.status).toBe("streaming");
		expect(thinkingItem.thinking).toBe("considering it");
		expect(thinkingItem.text).toBe("");
		if (textItem?.kind !== "assistant") throw new Error("expected a streaming text item");
		expect(textItem.status).toBe("streaming");
		expect(textItem.text).toBe("draft reply");
		expect(now).toBeLessThanOrEqual(Date.now());
	});

	test("starts a new item when the block id changes", () => {
		const { fixture, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "blocks-agent", "blocks");
		writeEvents(agent.controlDir, [
			{ kind: "text", blockId: "text-1", text: "one" },
			{ kind: "text", blockId: "text-2", text: "two" },
		]);
		const target = liveTarget("blocks", [spawnTool(agent, "blocks")]);
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(2);
		expect(items.map((item) => item.kind === "assistant" ? item.text : undefined)).toEqual(["one", "two"]);
		expect(items.every((item) => item.kind === "assistant" && item.status === "streaming")).toBe(true);
	});

	test("live stream owns a persisted final answer so it renders once in wire order", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "answer-agent", "answer-child");
		const sessionPath = path.join(agent.controlDir, "session.jsonl");
		fs.writeFileSync(sessionPath, JSON.stringify({
			message: {
				role: "assistant",
				content: [{ type: "text", text: "No concrete findings." }],
				timestamp: now - 500,
			},
		}) + "\n");
		fs.writeFileSync(agent.statusPath, JSON.stringify({
			version: 1,
			runtime: "profiled-subagents",
			treeId: fixture.treeId,
			updatedAt: now,
			agentId: "answer-child",
			profile: "explore",
			parentAgentId: "root",
			label: "answer-child",
			state: "running",
			startedAt: now - 1_000,
			sessionPath,
		}));
		writeEvents(agent.controlDir, [
			{ kind: "tool_start", toolName: "bash", toolCallId: "call-1" },
			{ kind: "tool_end", toolName: "bash", toolCallId: "call-1" },
			{ kind: "text", blockId: "final-answer", text: "No concrete findings." },
		]);
		const target = liveTarget("answer-child", [spawnTool(agent, "answer-child")]);
		const items = readSubagentConversation(target!.run);
		expect(items.map((item) => item.kind)).toEqual(["tool", "assistant"]);
		const answers = items.filter(
			(item): item is AssistantItem => item.kind === "assistant" && item.text === "No concrete findings.",
		);
		expect(answers).toHaveLength(1);
		expect(answers[0]?.status).toBe("streaming");
		expect(answers[0]?.id).toContain("final-answer");
	});

	test("keeps live thinking between persisted tool rows in wire order", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "chronology-agent", "chronology-child");
		const sessionPath = path.join(agent.controlDir, "session.jsonl");
		const sessionLines = [
			{ message: { role: "user", content: [{ type: "text", text: "Review this." }], timestamp: now - 1_000 } },
			{ message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "one" } }], timestamp: now - 900 } },
			{ message: { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "one" }], timestamp: now - 700 } },
			{ message: { role: "assistant", content: [{ type: "toolCall", id: "call-2", name: "read", arguments: { path: "two" } }], timestamp: now - 600 } },
			{ message: { role: "toolResult", toolCallId: "call-2", toolName: "read", content: [{ type: "text", text: "two" }], timestamp: now - 300 } },
		];
		fs.writeFileSync(sessionPath, sessionLines.map((line) => JSON.stringify(line)).join("\n") + "\n");
		fs.writeFileSync(agent.statusPath, JSON.stringify({
			version: 1,
			runtime: "profiled-subagents",
			treeId: fixture.treeId,
			updatedAt: now,
			agentId: "chronology-child",
			profile: "explore",
			parentAgentId: "root",
			label: "chronology-child",
			state: "running",
			startedAt: now - 1_100,
			sessionPath,
		}));
		writeEvents(agent.controlDir, [
			{ ts: now - 950, kind: "thinking", blockId: "think-1", text: "first thought" },
			{ ts: now - 900, kind: "tool_start", toolName: "bash", toolCallId: "call-1" },
			{ ts: now - 700, kind: "tool_end", toolName: "bash", toolCallId: "call-1" },
			{ ts: now - 650, kind: "thinking", blockId: "think-2", text: "middle thought" },
			{ ts: now - 600, kind: "tool_start", toolName: "read", toolCallId: "call-2" },
			{ ts: now - 300, kind: "tool_end", toolName: "read", toolCallId: "call-2" },
			{ ts: now - 200, kind: "thinking", blockId: "think-3", text: "last thought" },
		]);
		const target = liveTarget("chronology-child", [spawnTool(agent, "chronology-child")]);
		const items = readSubagentConversation(target!.run);
		expect(items.map((item) => item.kind)).toEqual([
			"user",
			"assistant",
			"tool",
			"assistant",
			"tool",
			"assistant",
		]);
		expect(items.map((item) => item.kind === "assistant" ? item.thinking : item.kind === "tool" ? item.name : item.kind === "user" ? item.text : "")).toEqual([
			"Review this.",
			"first thought",
			"bash",
			"middle thought",
			"read",
			"last thought",
		]);
	});

	test("keeps the beginning of a long live thinking block beyond 400 stream events", () => {
		const { fixture, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "long-thinking-agent", "long-thinking");
		writeEvents(agent.controlDir, Array.from({ length: 450 }, (_, index) => ({
			kind: "thinking",
			blockId: "think-long",
			text: index === 0 ? "FIRST " : "x",
		})));
		const target = liveTarget("long-thinking", [spawnTool(agent, "long-thinking")]);
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(1);
		if (items[0]?.kind !== "assistant") throw new Error("expected one accumulated thinking item");
		expect(items[0].thinking.startsWith("FIRST ")).toBe(true);
		expect(items[0].thinking.length).toBe("FIRST ".length + 449);
	});

	test("matches tool_end by call id and keeps a dangling start streaming", () => {
		const { fixture, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "tools-agent", "tools");
		writeEvents(agent.controlDir, [
			{ kind: "tool_start", toolName: "bash", toolCallId: "call-1" },
			{ kind: "tool_start", toolName: "grep", toolCallId: "call-2" },
			{ kind: "tool_end", toolName: "bash", toolCallId: "call-1" },
			{ kind: "tool_end", toolName: "nope", toolCallId: "call-9" },
		]);
		const target = liveTarget("tools", [spawnTool(agent, "tools")]);
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(2);
		const [bash, grep] = items;
		if (bash?.kind !== "tool" || grep?.kind !== "tool") throw new Error("expected two tool items");
		expect(bash.name).toBe("bash");
		expect(bash.status).toBe("done");
		expect(bash.endedAt).toBeDefined();
		expect(grep.name).toBe("grep");
		expect(grep.status).toBe("streaming");
		expect(grep.endedAt).toBeUndefined();
	});

	test("ignores a torn trailing line, unknown kinds and unknown versions", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "torn-agent", "torn");
		writeEvents(agent.controlDir, [
			{ kind: "text", blockId: "text-1", text: "ok" },
			{ kind: "mystery", blockId: "m-1", text: "?", futureField: [1, 2, 3] },
			{ v: 2, kind: "text", blockId: "v2", text: "new" },
			`{"v":1,"seq":99,"ts":${now},"runId":"stream-child","kind":"text","blockId":"torn","text":"oops`,
		]);
		const target = liveTarget("torn", [spawnTool(agent, "torn")]);
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(1);
		if (items[0]?.kind !== "assistant") throw new Error("expected one assistant item");
		expect(items[0].text).toBe("ok");
		expect(items[0].status).toBe("streaming");
	});

	test("ignores the stream once the run is not live so content is not duplicated", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const old = now - PROFILED_HEARTBEAT_MAX_AGE_MS - 1;
		const sessionPath = path.join(fixture.runtimeRoot, "child.jsonl");
		fs.writeFileSync(sessionPath, JSON.stringify({
			timestamp: new Date(now).toISOString(), type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
		}) + "\n");
		const agent = streamAgent(fixture, "done-agent", "done-child", { state: "completed", startedAt: old, updatedAt: old, sessionPath });
		writeEvents(agent.controlDir, [
			{ kind: "text", blockId: "text-1", text: "Hello " },
			{ kind: "text", blockId: "text-1", text: "world" },
		]);
		const target = liveTarget("done-child", [spawnTool(agent, "done-child")]);
		expect(target?.state).toBe("completed");
		expect(target?.active).toBe(false);
		// The stream file is present — suppression comes from the liveness
		// rule, not from a missing path.
		expect(target?.run.eventsPath).toBeDefined();
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(1);
		if (items[0]?.kind !== "assistant") throw new Error("expected the completed assistant message");
		expect(items[0].status).toBe("done");
		expect(items[0].text).toBe("Hello world");
	});

	test("exposes the stream on status-less runs and leaves it undefined when absent", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "bare-agent", "bare");
		fs.rmSync(agent.statusPath);
		writeEvents(agent.controlDir, [{ kind: "text", blockId: "text-1", text: "hi" }]);
		const pending: ToolItem = { ...spawnTool(agent, "bare", "pending"), timestamp: now };
		const target = liveTarget("bare", [pending]);
		expect(target?.run.eventsPath).toBe(path.join(agent.controlDir, "events.jsonl"));
		expect(target?.active).toBe(true);
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(1);
		if (items[0]?.kind !== "assistant") throw new Error("expected a streaming item");
		expect(items[0].text).toBe("hi");
		expect(items[0].status).toBe("streaming");

		const noStream = streamAgent(fixture, "nostream-agent", "nostream");
		const plain = liveTarget("nostream", [spawnTool(noStream, "nostream")]);
		expect(plain?.run.eventsPath).toBeUndefined();
	});

	test("invalidates the inspected transcript when the stream appends", () => {
		const { fixture, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "cache-agent", "cached");
		writeEvents(agent.controlDir, [{ kind: "text", blockId: "text-1", text: "one" }]);
		const target = liveTarget("cached", [spawnTool(agent, "cached")]);
		if (!target) throw new Error("expected a cached target");
		const cache = createSubagentTranscriptCache();
		expect(cache(undefined, true)).toEqual([]);
		expect(cache(target, false)).toEqual([]);
		const first = cache(target, true);
		if (first[0]?.kind !== "assistant") throw new Error("expected a streaming item");
		expect(first[0].text).toBe("one");
		writeEvents(agent.controlDir, [
			{ kind: "text", blockId: "text-1", text: "one" },
			{ kind: "text", blockId: "text-1", text: " two" },
		]);
		const second = cache(target, true);
		if (second[0]?.kind !== "assistant") throw new Error("expected an updated streaming item");
		expect(second[0].text).toBe("one two");
		expect(second).not.toBe(first);
	});

	test("keeps interleaved thinking and tools in wire order", () => {
		const { fixture, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "interleave-agent", "interleaved");
		writeEvents(agent.controlDir, [
			{ kind: "thinking", blockId: "think-1", text: "first thought" },
			{ kind: "tool_start", toolName: "bash", toolCallId: "call-1" },
			{ kind: "thinking", blockId: "think-2", text: "second thought" },
			{ kind: "tool_end", toolName: "bash", toolCallId: "call-1" },
		]);
		const target = liveTarget("interleaved", [spawnTool(agent, "interleaved")]);
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(3);
		expect(items.map((item) => item.kind)).toEqual(["assistant", "tool", "assistant"]);
		const [first, tool, second] = items;
		if (first?.kind !== "assistant" || second?.kind !== "assistant" || tool?.kind !== "tool") {
			throw new Error("expected assistant, tool, assistant in wire order");
		}
		expect(first.thinking).toBe("first thought");
		expect(tool.name).toBe("bash");
		expect(tool.status).toBe("done");
		expect(second.thinking).toBe("second thought");
	});

	test("live tools render one row per call when the session already holds the result", () => {
		// Session call+result AND stream start+end for one callId: the stream
		// twin must not double the session row (once at start, once at finish).
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stream-dupe-"));
		roots.push(dir);
		const now = Date.now();
		const sessionFile = path.join(dir, "session.jsonl");
		fs.writeFileSync(sessionFile, [
			JSON.stringify({
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "x" } }],
					timestamp: now - 500,
				},
			}),
			JSON.stringify({
				message: {
					role: "toolResult", toolCallId: "call-1", toolName: "read",
					content: "file contents", timestamp: now - 400,
				},
			}),
		].join("\n") + "\n");
		const eventsPath = path.join(dir, "events.jsonl");
		let seq = 0;
		fs.writeFileSync(eventsPath, [
			{ kind: "tool_start", toolName: "read", toolCallId: "call-1" },
			{ kind: "tool_end", toolName: "read", toolCallId: "call-1" },
		].map((line) => JSON.stringify({ v: 1, seq: seq++, ts: now, runId: "dupe-child", ...line })).join("\n") + "\n");
		const run: SubagentRun = {
			runId: "dupe-live", mode: "profiled", control: "profiled", state: "running",
			steps: [], sessionFile, eventsPath, startedAt: now - 1000,
			lastUpdate: now, profiledStatusBacked: true,
		};
		const tools = readSubagentConversation(run).filter(
			(item): item is ToolItem => item.kind === "tool" && item.toolCallId === "call-1",
		);
		expect(tools).toHaveLength(1);
		expect(tools[0]?.status).toBe("done");
		expect(tools[0]?.output).toBe("file contents");
	});

	test("live in-flight tools keep the single streaming stream row", () => {
		// Session holds the call but no result yet: no session row exists, so
		// the stream row below is still created and reads streaming.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stream-inflight-"));
		roots.push(dir);
		const now = Date.now();
		const sessionFile = path.join(dir, "session.jsonl");
		fs.writeFileSync(sessionFile, JSON.stringify({
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "x" } }],
				timestamp: now - 500,
			},
		}) + "\n");
		const eventsPath = path.join(dir, "events.jsonl");
		fs.writeFileSync(eventsPath, JSON.stringify({ v: 1, seq: 0, ts: now, runId: "dupe-child", kind: "tool_start", toolName: "read", toolCallId: "call-1" }) + "\n");
		const run: SubagentRun = {
			runId: "dupe-inflight", mode: "profiled", control: "profiled", state: "running",
			steps: [], sessionFile, eventsPath, startedAt: now - 1000,
			lastUpdate: now, profiledStatusBacked: true,
		};
		const tools = readSubagentConversation(run).filter(
			(item): item is ToolItem => item.kind === "tool" && item.toolCallId === "call-1",
		);
		expect(tools).toHaveLength(1);
		expect(tools[0]?.status).toBe("streaming");
		expect(tools[0]?.id.startsWith("subagent-stream-")).toBe(true);
	});
});

describe("profiled subagent identity", () => {
	function profiledRun(overrides: Partial<SubagentRun> = {}): SubagentRun {
		return {
			runId: "profiled:identity",
			mode: "profiled",
			control: "profiled",
			state: "running",
			steps: [],
			agentId: "ron",
			profile: "implementer",
			...overrides,
		};
	}

	test("keeps the profile alongside a custom label", () => {
		const [target] = subagentTargets([profiledRun({ label: "pitty-install-plugins" })]);
		expect(target?.label).toBe("@ron · implementer — pitty-install-plugins");
	});

	test("collapses a label that equals the profile", () => {
		const [target] = subagentTargets([profiledRun({ label: "implementer" })]);
		expect(target?.label).toBe("@ron · implementer");
	});

	test("keeps the profile visible inside the sidebar 31-character clip", () => {
		const [target] = subagentTargets([profiledRun({ label: "pitty-install-plugins-and-much-more-work" })]);
		if (!target) throw new Error("expected a profiled target");
		// Mirrors the sidebar row: clip(`${stateIcon(state)} ${label}`, 31).
		expect(clip(`${stateIcon(target.state)} ${target.label}`, 31)).toContain("implementer");
	});

	test("spawn group rows carry the profile", () => {
		const [target] = subagentTargets([profiledRun({ label: "pitty-install-plugins" })]);
		if (!target) throw new Error("expected a profiled target");
		expect(spawnGroupRowText(target, Date.now())).toContain("@ron · implementer");
	});
});

describe("batch A data truth", () => {
	function transcriptRun(lines: string[]): { run: SubagentRun; file: string } {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-batch-a-"));
		roots.push(dir);
		const file = path.join(dir, "transcript.jsonl");
		fs.writeFileSync(file, lines.length ? `${lines.join("\n")}\n` : "");
		const run: SubagentRun = {
			runId: "batch-a",
			mode: "single",
			state: "done",
			steps: [{ index: 0, agent: "worker", status: "done", transcriptPath: file }],
		};
		return { run, file };
	}

	function profiledFiles(sessionLines: unknown[], eventLines: Array<Record<string, unknown>>): {
		sessionFile: string;
		eventsPath: string;
	} {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-batch-a-profiled-"));
		roots.push(dir);
		const sessionFile = path.join(dir, "session.jsonl");
		fs.writeFileSync(
			sessionFile,
			sessionLines.map((line) => JSON.stringify(line)).join("\n") + "\n",
		);
		const eventsPath = path.join(dir, "events.jsonl");
		let seq = 0;
		fs.writeFileSync(
			eventsPath,
			eventLines.map((line) => JSON.stringify({ v: 1, seq: seq++, ts: 1_000, runId: "batch-a-child", ...line })).join("\n") + "\n",
		);
		return { sessionFile, eventsPath };
	}

	function stoppedProfiledRun(sessionLines: unknown[], eventLines: Array<Record<string, unknown>>): SubagentRun {
		const { sessionFile, eventsPath } = profiledFiles(sessionLines, eventLines);
		return {
			runId: "batch-a-stopped",
			mode: "profiled",
			control: "profiled",
			state: "completed",
			steps: [],
			sessionFile,
			eventsPath,
			startedAt: 500,
			lastUpdate: 900,
		};
	}

	function liveProfiledRun(sessionLines: unknown[], eventLines: Array<Record<string, unknown>>): SubagentRun {
		const { sessionFile, eventsPath } = profiledFiles(sessionLines, eventLines);
		return {
			runId: "batch-a-live",
			mode: "profiled",
			control: "profiled",
			state: "running",
			steps: [],
			sessionFile,
			eventsPath,
			startedAt: 500,
			lastUpdate: Date.now(),
			profiledStatusBacked: true,
		};
	}

	test("transcript ids are stable across re-reads and appends without timestamps", () => {
		// No record carries `ts`: the old Date.now() fallback minted fresh ids
		// on every poll. The clock is forced forward between reads so any
		// remaining wall-clock dependence fails this test deterministically.
		const realNow = Date.now;
		let tick = 1_000_000;
		Date.now = () => (tick += 1_000);
		try {
			const { run, file } = transcriptRun([
				JSON.stringify({ recordType: "message", role: "user", text: "do the thing", id: "msg-1", runId: "batch-a" }),
				JSON.stringify({ recordType: "tool_start", toolName: "read", toolCallId: "call-1", runId: "batch-a" }),
				JSON.stringify({ recordType: "message", role: "toolResult", toolCallId: "call-1", toolName: "read", text: "contents", runId: "batch-a" }),
			]);
			const first = readSubagentConversation(run).map((item) => item.id);
			expect(first.length).toBeGreaterThan(0);
			expect(new Set(first).size).toBe(first.length);
			const second = readSubagentConversation(run).map((item) => item.id);
			expect(second).toEqual(first);
			fs.appendFileSync(
				file,
				`${JSON.stringify({ recordType: "message", role: "user", text: "more", id: "msg-2", runId: "batch-a" })}\n`,
			);
			const third = readSubagentConversation(run).map((item) => item.id);
			expect(third.slice(0, first.length)).toEqual(first);
			expect(third.length).toBe(first.length + 1);
		} finally {
			Date.now = realNow;
		}
	});

	test("session-backed transcript ids are stable across re-reads", () => {
		const run = liveProfiledRun(
			[
				{ message: { role: "user", content: [{ type: "text", text: "go" }], timestamp: 100 } },
				{ message: { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 200 } },
			],
			[],
		);
		const first = readSubagentConversation(run).map((item) => item.id);
		expect(first.length).toBe(2);
		expect(readSubagentConversation(run).map((item) => item.id)).toEqual(first);
	});

	test("stream item ids derive from block identity, not read order", () => {
		const run = liveProfiledRun([], [
			{ kind: "thinking", blockId: "think-1", text: "consider " },
			{ kind: "thinking", blockId: "think-1", text: "this" },
			{ kind: "tool_start", toolName: "read", toolCallId: "call-9" },
		]);
		const first = readSubagentConversation(run);
		expect(first).toHaveLength(2);
		expect(first[0]?.id).toContain("think-1");
		expect(first[1]?.id).toContain("call-9");
		expect(readSubagentConversation(run).map((item) => item.id)).toEqual(first.map((item) => item.id));
	});

	test("a stopped run keeps the thinking it streamed when the session copy is empty", () => {
		const run = stoppedProfiledRun(
			[
				{
					message: {
						role: "assistant",
						content: [{ type: "thinking", thinking: "" }],
						timestamp: 50,
					},
				},
			],
			[{ kind: "thinking", blockId: "b1", text: "streamed thought" }],
		);
		const items = readSubagentConversation(run);
		expect(items).toHaveLength(1);
		const item = items[0];
		if (item?.kind !== "assistant") throw new Error("expected an assistant item");
		expect(item.thinking).toBe("streamed thought");
		expect(item.status).toBe("done");
	});

	test("a stopped run does not render thinking the session already has twice", () => {
		const run = stoppedProfiledRun(
			[
				{
					message: {
						role: "assistant",
						content: [{ type: "thinking", thinking: "same thought" }],
						timestamp: 50,
					},
				},
			],
			[{ kind: "thinking", blockId: "b1", text: "same thought" }],
		);
		const items = readSubagentConversation(run);
		expect(items).toHaveLength(1);
		const item = items[0];
		if (item?.kind !== "assistant") throw new Error("expected an assistant item");
		expect(item.thinking).toBe("same thought");
	});

	test("a stopped run never replaces persisted thinking with a shorter stream value", () => {
		const run = stoppedProfiledRun(
			[
				{
					message: {
						role: "assistant",
						content: [{ type: "thinking", thinking: "Hello brave new world" }],
						timestamp: 50,
					},
				},
			],
			[{ kind: "thinking", blockId: "b1", text: "brave new" }],
		);
		const items = readSubagentConversation(run);
		expect(items).toHaveLength(1);
		const item = items[0];
		if (item?.kind !== "assistant") throw new Error("expected an assistant item");
		expect(item.thinking).toBe("Hello brave new world");
	});

	test("a stopped run grows an empty persisted field from a longer stream value", () => {
		const run = stoppedProfiledRun(
			[
				{
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Hello " }],
						timestamp: 50,
					},
				},
			],
			[{ kind: "text", blockId: "t1", text: "Hello world" }],
		);
		const items = readSubagentConversation(run);
		expect(items).toHaveLength(1);
		const item = items[0];
		if (item?.kind !== "assistant") throw new Error("expected an assistant item");
		expect(item.text).toBe("Hello world");
	});

	test("stream tools backfill args and output from the session file", () => {
		// In-flight: the session holds the call but no result yet, so no
		// session row exists and the single stream row backfills args from
		// the session file. (Once the result lands the session row takes over
		// and no stream twin is created — one row per call.)
		const run = liveProfiledRun(
			[
				{
					message: {
						role: "assistant",
						content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "x" } }],
						timestamp: 100,
					},
				},
			],
			[
				{ kind: "tool_start", toolName: "read", toolCallId: "call-1" },
				{ kind: "tool_end", toolName: "read", toolCallId: "call-1" },
			],
		);
		const tools = readSubagentConversation(run).filter((item): item is ToolItem => item.kind === "tool");
		expect(tools).toHaveLength(1);
		const stream = tools.find((tool) => tool.id.startsWith("subagent-stream-"));
		if (!stream) throw new Error("expected a stream tool item");
		expect(stream.args).toEqual({ path: "x" });
		expect(stream.output).toBe("");
		expect(stream.status).toBe("done");
	});

	test("stream tools stay bare when no args exist anywhere", () => {
		const run = liveProfiledRun([], [{ kind: "tool_start", toolName: "read", toolCallId: "call-missing" }]);
		const tools = readSubagentConversation(run).filter((item): item is ToolItem => item.kind === "tool");
		expect(tools).toHaveLength(1);
		expect(tools[0]?.args).toBeUndefined();
	});

	test("a same-size rewrite with a frozen mtime is observed", () => {
		const line = (text: string): string =>
			JSON.stringify({ recordType: "message", role: "user", text, id: "m1" });
		const { run, file } = transcriptRun([line("aaa")]);
		// Pin the clock: an explicit whole-millisecond mtime before the first
		// read and the identical value after the rewrite, so (mtimeMs, size)
		// alone cannot tell the two parses apart.
		const frozenAt = new Date(1_700_000_000_000);
		fs.utimesSync(file, frozenAt, frozenAt);
		const first = readSubagentConversation(run);
		expect(first.map((item) => (item.kind === "user" ? item.text : ""))).toEqual(["aaa"]);
		const replacement = line("bbb");
		expect(replacement.length).toBe(line("aaa").length);
		fs.writeFileSync(file, `${replacement}\n`);
		fs.utimesSync(file, frozenAt, frozenAt);
		const frozen = fs.statSync(file);
		expect(frozen.mtimeMs).toBe(1_700_000_000_000);
		const second = readSubagentConversation(run);
		expect(second.map((item) => (item.kind === "user" ? item.text : ""))).toEqual(["bbb"]);
	});

	test("the transcript cache invalidates on a same-size same-mtime rewrite", () => {
		const line = (text: string): string =>
			JSON.stringify({ recordType: "message", role: "user", text, id: "m1" });
		const { run, file } = transcriptRun([line("aaa")]);
		const target: SubagentTarget = {
			key: "batch-a-cache",
			run,
			label: "batch-a",
			state: "done",
			active: false,
			canSteer: false,
			transcriptPath: file,
		};
		const frozenAt = new Date(1_700_000_000_000);
		fs.utimesSync(file, frozenAt, frozenAt);
		const cache = createSubagentTranscriptCache();
		const first = cache(target, true);
		expect(first.map((item) => (item.kind === "user" ? item.text : ""))).toEqual(["aaa"]);
		fs.writeFileSync(file, `${line("bbb")}\n`);
		fs.utimesSync(file, frozenAt, frozenAt);
		expect(fs.statSync(file).mtimeMs).toBe(1_700_000_000_000);
		const second = cache(target, true);
		expect(second).not.toBe(first);
		expect(second.map((item) => (item.kind === "user" ? item.text : ""))).toEqual(["bbb"]);
	});

	test("profiled session snapshots observe same-size rewrites with a frozen mtime", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-batch-a-session-"));
		roots.push(dir);
		const sessionFile = path.join(dir, "session.jsonl");
		const usageLine = (input: number): string =>
			JSON.stringify({ message: { role: "assistant", usage: { input, cacheRead: 0, cacheWrite: 0 } } });
		expect(usageLine(20).length).toBe(usageLine(10).length);
		const frozenAt = new Date(1_700_000_000_000);
		const spawnTool: ToolItem = {
			kind: "tool",
			id: "spawn-batch-a",
			toolCallId: "spawn-batch-a-call",
			name: "agent_spawn",
			args: { agent: "explore" },
			output: "",
			details: {
				runtime: "profiled-subagents",
				treeId: "batch-a-tree",
				parentAgentId: "root",
				agentId: "snapshotted",
				sessionPath: sessionFile,
			},
			timestamp: 1,
			status: "done",
			isError: false,
		};
		fs.writeFileSync(sessionFile, `${usageLine(10)}\n`);
		fs.utimesSync(sessionFile, frozenAt, frozenAt);
		expect(profiledSubagentRunsFromTools([spawnTool])[0]?.tokens?.window).toBe(10);
		fs.writeFileSync(sessionFile, `${usageLine(20)}\n`);
		fs.utimesSync(sessionFile, frozenAt, frozenAt);
		expect(fs.statSync(sessionFile).mtimeMs).toBe(1_700_000_000_000);
		expect(profiledSubagentRunsFromTools([spawnTool])[0]?.tokens?.window).toBe(20);
	});

	test("task and workflow tools agree on family, grouping and ownership", () => {
		expect(isSubagentFamilyToolName("task_run")).toBe(true);
		expect(isSubagentFamilyToolName("workflow_run")).toBe(true);
		expect(isSubagentFamilyToolName("subagent")).toBe(true);
		expect(isSubagentFamilyToolName("delegate_task")).toBe(true);
		expect(isSubagentFamilyToolName("subagent_supervisor")).toBe(false);
		expect(isSubagentFamilyToolName("bash")).toBe(false);
		const spawn = (name: string, extra: Partial<ToolItem> = {}): ToolItem => ({
			kind: "tool",
			id: `spawn-${name}`,
			toolCallId: `spawn-${name}-call`,
			name,
			args: {},
			output: "",
			timestamp: 1,
			status: "streaming",
			isError: false,
			...extra,
		});
		// Grouping agrees with the family rule.
		expect(isSpawnToolItem(spawn("task_run"))).toBe(true);
		expect(isSpawnToolItem(spawn("workflow_run"))).toBe(true);
		expect(isSpawnToolItem(spawn("subagent_supervisor"))).toBe(false);
		expect(isSpawnToolItem(spawn("bash"))).toBe(false);
		// Ownership agrees with the family rule: a task_* tool owns its target.
		expect(subagentRunIdFromTool(spawn("task_run", { details: { runId: "run-task" } }))).toBe("run-task");
		expect(subagentRunIdFromTool(spawn("workflow_run", { details: { asyncId: "async-wf" } }))).toBe("async-wf");
		expect(subagentRunIdFromTool(spawn("subagent_supervisor", { details: { runId: "run-sv" } }))).toBeUndefined();
		for (const name of ["task_run", "workflow_run"]) {
			const tool = spawn(name, {
				details: {
					results: [{ key: "child", agent: "worker", progress: { agent: "worker", state: "running" } }],
				},
			});
			const targets = subagentTargets([], [tool]);
			expect(targets.map((target) => target.toolCallId)).toContain(tool.toolCallId);
		}
		const supervisor = spawn("subagent_supervisor", {
			details: {
				results: [{ key: "child", agent: "worker", progress: { agent: "worker", state: "running" } }],
			},
		});
		expect(subagentTargets([], [supervisor])).toHaveLength(0);
	});
});

describe("profiled recursive tree projection", () => {
	function profiledTarget(
		agentId: string,
		parentAgentId: string,
		startedAt: number,
		profile = "explore",
	): SubagentTarget {
		const run: SubagentRun = {
			runId: `profiled:${agentId}`,
			control: "profiled",
			runtime: "profiled-subagents",
			treeId: "tree-recursive",
			parentAgentId,
			agentId,
			profile,
			label: agentId,
			mode: parentAgentId === "root" ? "profiled" : "nested",
			state: "running",
			startedAt,
			steps: [],
		};
		return {
			key: run.runId,
			run,
			label: `@${agentId} · ${profile}`,
			state: "running",
			active: true,
			canSteer: true,
			startedAt,
		};
	}

	test("keeps descendants contiguous under their actual parent at arbitrary depth", () => {
		const root = profiledTarget("cai", "root", 1, "implementer");
		const child = profiledTarget("theo", "cai", 2);
		const sibling = profiledTarget("aki", "cai", 3);
		const grandchild = profiledTarget("zoe", "theo", 4);
		const targets = [grandchild, sibling, child, root];

		expect(subagentTargetParent(grandchild, targets)?.key).toBe(child.key);
		expect(subagentTargetAncestors(grandchild, targets).map((target) => target.key)).toEqual([
			root.key,
			child.key,
		]);
		expect(subagentTargetDescendants(root, targets).map((target) => target.key).sort()).toEqual(
			[child.key, sibling.key, grandchild.key].sort(),
		);
		const rows = subagentTreeRows(targets);
		expect(rows.map((row) => [row.target.key, row.depth])).toEqual([
			[root.key, 0],
			[child.key, 1],
			[grandchild.key, 2],
			[sibling.key, 1],
		]);
		expect(rows[0]?.descendantCount).toBe(3);
		expect(rows[1]?.descendantCount).toBe(1);
	});

	test("a root agent_spawn owns only its direct child, never a closer-started grandchild", () => {
		const direct = profiledTarget("cai", "root", 900, "implementer");
		const grandchild = profiledTarget("theo", "cai", 1_001);
		const spawn: ToolItem = {
			kind: "tool",
			id: "spawn-cai",
			toolCallId: "spawn-cai-call",
			name: "agent_spawn",
			args: { agent: "implementer" },
			output: "",
			details: {
				runtime: "profiled-subagents",
				treeId: "tree-recursive",
				parentAgentId: "root",
				agentId: "cai",
				profile: "implementer",
			},
			timestamp: 1_000,
			status: "done",
			isError: false,
		};
		const owned = ownedSubagentTargetsForItems([spawn], [grandchild, direct]).get(spawn.id) ?? [];
		expect(owned.map((target) => target.key)).toEqual([direct.key]);
		expect(targetsForTool(spawn, [grandchild, direct]).map((target) => target.key)).toEqual([direct.key]);
	});
});

describe("profiled previous-session fallback discovery", () => {
	function finishedOrphanFixture(agentId: string, state = "completed") {
		const fixture = profiledFixture();
		const now = Date.now();
		const old = now - PROFILED_HEARTBEAT_MAX_AGE_MS - 1;
		const sessionPath = path.join(fixture.runtimeRoot, `${agentId}.jsonl`);
		fs.writeFileSync(sessionPath, JSON.stringify({
			message: { role: "assistant", content: [{ type: "text", text: `finished work from ${agentId}` }] },
		}) + "\n");
		const agent = fixture.writeAgent(`${agentId}-dir`, {
			agentId, profile: "explore", parentAgentId: "root", label: agentId,
			state, startedAt: old, updatedAt: old, sessionPath,
		});
		return { fixture, agent, sessionPath, old };
	}

	test("tool-less discovery finds a finished run from /tmp status+session", () => {
		const agentId = `restart-orphan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const { sessionPath } = finishedOrphanFixture(agentId);
		// No spawn tools in the reloaded conversation: pure fallback scan.
		const runs = profiledSubagentRunsFromTools([]);
		const found = runs.find((run) => run.agentId === agentId);
		expect(found).toBeDefined();
		// Existing state words only — no new user-facing vocabulary.
		expect(found?.state).toBeDefined();
		expect(["completed", "failed", "stopped", "unresponsive"]).toContain(found!.state);
		expect(found?.sessionFile).toBe(sessionPath);
		// Same readSubagentConversation path: session-first transcript.
		const items = readSubagentConversation(found!);
		expect(items.some((item) => item.kind === "assistant" && item.text.includes(`finished work from ${agentId}`))).toBe(true);
	});

	test("no duplication when the same run is also tool-seeded", () => {
		const agentId = `restart-dupe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const { fixture, agent } = finishedOrphanFixture(agentId);
		const tool: ToolItem = {
			kind: "tool", id: `spawn-${agentId}`, toolCallId: `spawn-${agentId}-call`, name: "agent_spawn",
			args: { agent: "explore" }, output: "", details: {
				runtime: "profiled-subagents", treeId: fixture.treeId, parentAgentId: "root", agentId, profile: "explore",
				label: agentId, state: "completed", controlDir: agent.controlDir, statusPath: agent.statusPath,
			}, timestamp: Date.now(), status: "done", isError: false,
		};
		const runs = profiledSubagentRunsFromTools([tool]);
		expect(runs.filter((run) => run.agentId === agentId)).toHaveLength(1);
		const targets = subagentTargets([], [tool]);
		expect(targets.filter((target) => target.run.agentId === agentId)).toHaveLength(1);
	});

	test("terminal run with deleted control dir still reads session-only transcript", () => {
		// Reaped stream: status.json survives, events.jsonl never existed, so the
		// tool-less fallback must still surface the run with a session-only read.
		const streamlessId = `restart-streamless-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		finishedOrphanFixture(streamlessId);
		const streamless = profiledSubagentRunsFromTools([]).find((run) => run.agentId === streamlessId);
		expect(streamless).toBeDefined();
		expect(streamless?.eventsPath).toBeUndefined();
		expect(readSubagentConversation(streamless!).some(
			(item) => item.kind === "assistant" && item.text.includes(`finished work from ${streamlessId}`),
		)).toBe(true);
		// Fully reaped control dir (Pi-host reboot): the tool-seeded run keeps
		// its sessionFile and reads the session-only transcript.
		const goneId = `restart-gone-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const gone = finishedOrphanFixture(goneId);
		fs.rmSync(gone.agent.controlDir, { recursive: true, force: true });
		const tool: ToolItem = {
			kind: "tool", id: `spawn-${goneId}`, toolCallId: `spawn-${goneId}-call`, name: "agent_spawn",
			args: { agent: "explore" }, output: "", details: {
				runtime: "profiled-subagents", treeId: gone.fixture.treeId, parentAgentId: "root", agentId: goneId,
				profile: "explore", label: goneId, state: "running",
				controlDir: gone.agent.controlDir, statusPath: gone.agent.statusPath,
				sessionPath: gone.sessionPath,
			}, timestamp: Date.now(), status: "done", isError: false,
		};
		const [seeded] = profiledSubagentRunsFromTools([tool]).filter((run) => run.sessionFile === gone.sessionPath);
		expect(seeded).toBeDefined();
		expect(readSubagentConversation(seeded!).some(
			(item) => item.kind === "assistant" && item.text.includes(`finished work from ${goneId}`),
		)).toBe(true);
	});
});

describe("profiled same-id run identity", () => {
	function sameIdFixture() {
		const fixture = profiledFixture();
		const now = Date.now();
		const ancestorSession = path.join(fixture.runtimeRoot, "ancestor-eva.jsonl");
		const nestedSession = path.join(fixture.runtimeRoot, "nested-eva.jsonl");
		fs.writeFileSync(ancestorSession, JSON.stringify({
			message: { role: "assistant", content: [{ type: "text", text: "ancestor eva transcript" }] },
		}) + "\n");
		fs.writeFileSync(nestedSession, JSON.stringify({
			message: { role: "assistant", content: [{ type: "text", text: "nested eva transcript" }] },
		}) + "\n");
		// Same agentId `eva` and shared treeId (the tree spans the whole
		// subtree), distinct control dirs/sessions/profiles: ancestor is a
		// debugging-duck child of root, the other a nested explore grandchild.
		const ancestor = fixture.writeAgent("ancestor-eva", {
			agentId: "eva", profile: "debugging-duck", parentAgentId: "root", label: "ancestor-label",
			state: "completed", startedAt: now - 2000, updatedAt: now - 2000, sessionPath: ancestorSession,
		});
		const nested = fixture.writeAgent("nested-eva", {
			agentId: "eva", profile: "explore", parentAgentId: "eva", label: "nested-label",
			state: "completed", startedAt: now - 1000, updatedAt: now - 1000, sessionPath: nestedSession,
		});
		return { fixture, ancestor, nested, ancestorSession, nestedSession };
	}

	test("same-id ancestor and nested grandchild render two rows with per-row profile and transcript", () => {
		sameIdFixture();
		const runs = profiledSubagentRunsFromTools([]);
		expect(runs.filter((run) => run.agentId === "eva")).toHaveLength(2);
		const targets = subagentTargets([], []);
		expect(targets.filter((target) => target.run.agentId === "eva")).toHaveLength(2);
		const ancestor = targets.find((target) => target.run.profile === "debugging-duck");
		const nested = targets.find((target) => target.run.profile === "explore");
		expect(ancestor?.label).toBe("@eva · debugging-duck — ancestor-label");
		expect(nested?.label).toBe("@eva · explore — nested-label");
		expect(ancestor?.key).not.toBe(nested?.key);
		expect(readSubagentConversation(ancestor!.run).some(
			(item) => item.kind === "assistant" && item.text.includes("ancestor eva transcript"),
		)).toBe(true);
		expect(readSubagentConversation(nested!.run).some(
			(item) => item.kind === "assistant" && item.text.includes("nested eva transcript"),
		)).toBe(true);
		// Selecting the nested row keeps its key and reads its transcript,
		// never the ancestor's.
		expect(reconcileSubagentSelection(nested!.key, targets, targets)).toBe(nested!.key);
		const cache = createSubagentTranscriptCache();
		expect(cache(nested, true).some(
			(item) => item.kind === "assistant" && item.text.includes("nested eva transcript"),
		)).toBe(true);
	});

	test("two runs sharing one session file do not collapse", () => {
		const fixture = profiledFixture();
		const now = Date.now();
		const sharedSession = path.join(fixture.runtimeRoot, "shared-eva.jsonl");
		fs.writeFileSync(sharedSession, JSON.stringify({
			message: { role: "assistant", content: [{ type: "text", text: "shared session work" }] },
		}) + "\n");
		fixture.writeAgent("share-one", {
			agentId: "share-one", profile: "explore", parentAgentId: "root", label: "share-one",
			state: "completed", startedAt: now - 2000, updatedAt: now - 2000, sessionPath: sharedSession,
		});
		fixture.writeAgent("share-two", {
			agentId: "share-two", profile: "implementer", parentAgentId: "root", label: "share-two",
			state: "completed", startedAt: now - 1000, updatedAt: now - 1000, sessionPath: sharedSession,
		});
		const targets = subagentTargets([], []);
		expect(targets.filter((target) => target.sessionFile === sharedSession)).toHaveLength(2);
	});

	test("same controlDir via tool seed and fallback still dedupes to one row", () => {
		const fixture = profiledFixture();
		const now = Date.now();
		const agent = fixture.writeAgent("dupe-eva", {
			agentId: "eva", profile: "explore", parentAgentId: "root", label: "dupe-label",
			state: "completed", startedAt: now - 1000, updatedAt: now - 1000,
		});
		const tool: ToolItem = {
			kind: "tool", id: "spawn-dupe-eva", toolCallId: "spawn-dupe-eva-call", name: "agent_spawn",
			args: { agent: "explore" }, output: "", details: {
				runtime: "profiled-subagents", treeId: fixture.treeId, parentAgentId: "root", agentId: "eva",
				profile: "explore", label: "dupe-label", state: "completed",
				controlDir: agent.controlDir, statusPath: agent.statusPath,
			}, timestamp: now, status: "done", isError: false,
		};
		expect(profiledSubagentRunsFromTools([tool]).filter((run) => run.agentId === "eva")).toHaveLength(1);
		const targets = subagentTargets([], [tool]);
		expect(targets.filter((target) => target.run.agentId === "eva")).toHaveLength(1);
		expect(targets.filter((target) => target.run.agentId === "eva")[0]?.label).toBe("@eva · explore — dupe-label");
	});

	test("routing still addresses the bare direct-child id in its own control dir", () => {
		const { ancestor, nested } = sameIdFixture();
		const targets = subagentTargets([], []);
		const nestedTarget = targets.find((target) => target.run.profile === "explore");
		// Display identity is per-run, but routing uses the bare agent id.
		expect(nestedTarget?.run.agentId).toBe("eva");
		steerSubagent(nestedTarget!.run, "dig deeper");
		const nestedRequests = fs.readdirSync(path.join(nested.controlDir, "control", "steer-requests"));
		expect(nestedRequests).toHaveLength(1);
		// The fixture pre-creates empty steer-requests dirs; routing must not
		// have delivered the nested steer into the ancestor's inbox.
		expect(fs.readdirSync(path.join(ancestor.controlDir, "control", "steer-requests"))).toHaveLength(0);
	});
});
