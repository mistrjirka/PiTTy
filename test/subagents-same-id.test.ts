import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { steerSubagent } from "../src/subagents/control.ts";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import { createSubagentTranscriptCache } from "../src/subagents/transcript-cache.ts";
import { profiledSubagentRunsFromTools } from "../src/subagents/profiled.ts";
import { reconcileSubagentSelection, subagentTargets } from "../src/subagents/targets.ts";
import { type ToolItem } from "../src/types.ts";
import { useIsolatedSubagentRoots, profiledFixture } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

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
		const runs = profiledSubagentRunsFromTools([], { includeHistoricalFallback: true });
		expect(runs.filter((run) => run.agentId === "eva")).toHaveLength(2);
		const targets = subagentTargets([], [], { includeHistoricalFallback: true });
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
		const targets = subagentTargets([], [], { includeHistoricalFallback: true });
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
		const targets = subagentTargets([], [], { includeHistoricalFallback: true });
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
