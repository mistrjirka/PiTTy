import { describe, expect, test } from "bun:test";
import { profiledSubagentRunsFromTools } from "../src/subagents/profiled.ts";
import { subagentTargets } from "../src/subagents/targets.ts";
import { useIsolatedSubagentRoots, profiledFixture } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("live subagent discovery without spawn-tool history", () => {
	test("shows the current Pi process children even when compaction removed agent_spawn", () => {
		const fixture = profiledFixture();
		const owned = fixture.writeAgent(`${process.pid}-sora`, {
			agentId: "sora", profile: "implementer", parentAgentId: "root",
			label: "torch checkpoint implementer", state: "running", startedAt: Date.now(),
		});
		const anotherOwner = fixture.writeAgent(`${process.pid + 100_000}-other`, {
			agentId: "other", profile: "explore", parentAgentId: "root",
			label: "different Pi session", state: "running", startedAt: Date.now(),
		});
		const nested = fixture.writeAgent("nested-not-direct", {
			agentId: "kid", profile: "explore", parentAgentId: "sora",
			label: "nested child", state: "running", startedAt: Date.now(),
		});
		const targets = subagentTargets([], [], { ownerPid: process.pid });
		expect(targets.map((target) => target.run.agentId).sort()).toEqual(["kid", "sora"]);
		expect(targets.every((target) => target.active)).toBe(true);
		expect(targets.find((target) => target.run.agentId === "sora")?.run.controlDir).toBe(owned.controlDir);
		expect(targets.some((target) => target.run.controlDir === anotherOwner.controlDir)).toBe(false);
		expect(targets.find((target) => target.run.agentId === "kid")?.run.controlDir).toBe(nested.controlDir);
	});

	test("does not discover live agents without a verified owner Pi PID", () => {
		const fixture = profiledFixture();
		fixture.writeAgent(`${process.pid}-sora`, {
			agentId: "sora", profile: "implementer", parentAgentId: "root",
			label: "torch", state: "running", startedAt: Date.now(),
		});
		expect(subagentTargets([], [], {}).length).toBe(0);
		expect(subagentTargets([], [], { ownerPid: -1 }).length).toBe(0);
	});
});

describe("profiled default discovery scope", () => {
	test("does not import unrelated historical profiled runs without conversation evidence", () => {
		const fixture = profiledFixture();
		const now = Date.now();
		fixture.writeAgent("unrelated-history", {
			agentId: "unrelated-history",
			profile: "explore",
			parentAgentId: "root",
			label: "unrelated-history",
			state: "completed",
			startedAt: now - 1000,
			updatedAt: now - 1000,
		});
		expect(profiledSubagentRunsFromTools([])).toHaveLength(0);
		expect(subagentTargets([], [])).toHaveLength(0);
	});
});
