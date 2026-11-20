import { describe, expect, test } from "bun:test";
import { ownedSubagentTargetsForItems, type SubagentTarget } from "../src/subagents/targets.ts";
import { directSubagentChildren, parentSubagentTarget, subagentTreeRows } from "../src/subagents/tree.ts";
import { type SubagentRun, type ToolItem } from "../src/types.ts";
import { useIsolatedSubagentRoots } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("recursive profiled display follow-ups", () => {
	function target(
		key: string,
		agentId: string,
		parentAgentId: string,
		startedAt: number,
	): SubagentTarget {
		const run: SubagentRun = {
			runId: key,
			runtime: "profiled-subagents",
			control: "profiled",
			controlDir: `/tmp/${key}`,
			treeId: "tree-recursive-followup",
			agentId,
			parentAgentId,
			profile: "explore",
			label: key,
			mode: parentAgentId === "root" ? "profiled" : "nested",
			state: "running",
			startedAt,
			steps: [],
		};
		return {
			key,
			run,
			label: `@${agentId} · explore — ${key}`,
			state: "running",
			active: true,
			canSteer: true,
			startedAt,
		};
	}

	test("ambiguous old-runtime parent ids stay flat instead of attaching arbitrarily", () => {
		const parentA = target("parent-a", "dup", "root", 100);
		const parentB = target("parent-b", "dup", "root", 110);
		const child = target("child", "kid", "dup", 120);
		const targets = [child, parentB, parentA];
		expect(parentSubagentTarget(child, targets)).toBeUndefined();
		expect(directSubagentChildren(parentA, targets)).toEqual([]);
		expect(directSubagentChildren(parentB, targets)).toEqual([]);
		const rows = subagentTreeRows(targets);
		expect(rows.map((row) => [row.target.key, row.depth])).toEqual([
			["child", 0],
			["parent-b", 0],
			["parent-a", 0],
		]);
	});

	test("root spawn timestamp fallback never claims a nested profiled descendant", () => {
		const root = target("root-run", "root-agent", "root", 100);
		const child = target("child-run", "child-agent", "root-agent", 110);
		const rootSpawn: ToolItem = {
			kind: "tool",
			id: "root-spawn",
			toolCallId: "root-spawn-call",
			name: "agent_spawn",
			args: { agent: "implementer" },
			output: "",
			// Deliberately omit exact profiled identity so this exercises the
			// legacy nearest-time fallback rather than pass 1.
			details: {},
			timestamp: 105,
			status: "done",
			isError: false,
		};
		const owned = ownedSubagentTargetsForItems([rootSpawn], [child, root]).get(rootSpawn.id) ?? [];
		expect(owned.map((entry) => entry.key)).toEqual(["root-run"]);
	});
});
