import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import { PROFILED_HEARTBEAT_MAX_AGE_MS, profiledSubagentRunsFromTools } from "../src/subagents/profiled.ts";
import { subagentTargets } from "../src/subagents/targets.ts";
import { type ToolItem } from "../src/types.ts";
import { useIsolatedSubagentRoots, profiledFixture } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

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
		const runs = profiledSubagentRunsFromTools([], { includeHistoricalFallback: true });
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
		const streamless = profiledSubagentRunsFromTools([], { includeHistoricalFallback: true }).find((run) => run.agentId === streamlessId);
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
