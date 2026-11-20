import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { subagentActivityAt } from "../src/subagents/transcript.ts";
import { PROFILED_HEARTBEAT_MAX_AGE_MS, profiledRunIsLive, profiledSubagentRunsFromTools } from "../src/subagents/profiled.ts";
import { subagentTargets, targetContextUsage } from "../src/subagents/targets.ts";
import { type SubagentRun, type ToolItem } from "../src/types.ts";
import { useIsolatedSubagentRoots, profiledFixture } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("profiled command telemetry", () => {
	test("keeps real execution times separate from heartbeats and agent deadlines", () => {
		const fixture = profiledFixture();
		const now = Date.now();
		const first = { toolCallId: "bash-a", toolName: "bash", startedAt: now - 60_000, timeoutSeconds: 2100 };
		const second = { toolCallId: "read-b", toolName: "read", startedAt: now - 30_000 };
		const status = {
			agentId: "joy", profile: "general", parentAgentId: "root", label: "command test",
			state: "running", startedAt: now - 100_000, updatedAt: now - 5_000,
			activeTools: [first, second, null, { toolCallId: "bad", toolName: "bash", startedAt: "yesterday" }],
		};
		const agent = fixture.writeAgent("joy", status);
		const tool: ToolItem = {
			kind: "tool", id: "spawn", toolCallId: "spawn", name: "agent_spawn", args: {}, output: "",
			details: { runtime: "profiled-subagents", treeId: fixture.treeId, agentId: "joy", controlDir: agent.controlDir },
			timestamp: now, status: "done", isError: false,
		};
		const read = () => profiledSubagentRunsFromTools([tool]).find((run) => run.agentId === "joy")!;
		const write = (patch: Record<string, unknown>) => fs.writeFileSync(agent.statusPath, JSON.stringify({
			version: 1, runtime: "profiled-subagents", treeId: fixture.treeId, ...status, ...patch,
		}));
		expect(read().activeTools).toEqual([first, second]);
		expect(read().lastActivityAt).toBe(second.startedAt);
		expect(read().timeoutMs).toBeUndefined();
		expect(read().deadlineAt).toBeUndefined();
		write({ updatedAt: now });
		expect(read().lastUpdate).toBe(now);
		expect(read().lastActivityAt).toBe(second.startedAt);
		write({ activeTools: [second] });
		expect(read().activeTools).toEqual([second]);
		write({ activeTools: undefined });
		expect(read().activeTools).toBeUndefined();
		expect(read().lastActivityAt).toBeUndefined();
		expect(subagentActivityAt(read())).toBeUndefined();
		write({ state: "idle" });
		expect(read().activeTools).toBeUndefined();
		write({ state: "completed" });
		expect(read().activeTools).toBeUndefined();
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
