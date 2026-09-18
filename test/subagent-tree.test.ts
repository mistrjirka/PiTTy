import { describe, expect, test } from "bun:test";
import type { SubagentTarget } from "../src/subagents/targets.ts";
import {
	directSubagentChildren,
	parentSubagentTarget,
	subagentAncestors,
	subagentTreeRows,
} from "../src/subagents/tree.ts";

function target(
	id: string,
	parentAgentId: string,
	startedAt: number,
	treeId = "tree-1",
): SubagentTarget {
	return {
		key: `run-${id}`,
		run: {
			runId: `run-${id}`,
			runtime: "profiled-subagents",
			control: "profiled",
			treeId,
			agentId: id,
			parentAgentId,
			profile: id === "cai" ? "implementer" : "explore",
			mode: parentAgentId === "root" ? "profiled" : "nested",
			state: "running",
			startedAt,
			steps: [],
		},
		label: `@${id}`,
		state: "running",
		active: true,
		canSteer: true,
		startedAt,
	};
}

describe("recursive subagent tree projection", () => {
	test("keeps each subtree contiguous and children in launch order", () => {
		const cai = target("cai", "root", 100);
		const theo = target("theo", "cai", 110);
		const aki = target("aki", "cai", 120);
		const zoe = target("zoe", "aki", 130);
		const lux = target("lux", "root", 200);
		// Input order mirrors subagentTargets(): newest roots/descendants can be
		// globally interleaved. The tree projection must repair presentation.
		const rows = subagentTreeRows([zoe, lux, aki, theo, cai]);
		expect(rows.map((row) => row.target.run.agentId)).toEqual([
			"lux",
			"cai",
			"theo",
			"aki",
			"zoe",
		]);
		expect(rows.map((row) => row.depth)).toEqual([0, 0, 1, 1, 2]);
		expect(rows.map((row) => row.prefix)).toEqual([
			"",
			"",
			"├─ ",
			"└─ ",
			"   └─ ",
		]);
		expect(rows.find((row) => row.target === cai)?.descendantCount).toBe(3);
		expect(rows.find((row) => row.target === aki)?.descendantCount).toBe(1);
	});

	test("resolves parent, direct children, and breadcrumbs only inside one tree", () => {
		const cai = target("cai", "root", 100);
		const aki = target("aki", "cai", 120);
		const zoe = target("zoe", "aki", 130);
		const duplicateIdOtherTree = target("aki", "root", 500, "tree-2");
		const targets = [duplicateIdOtherTree, zoe, aki, cai];
		expect(parentSubagentTarget(zoe, targets)).toBe(aki);
		expect(directSubagentChildren(cai, targets)).toEqual([aki]);
		expect(subagentAncestors(zoe, targets)).toEqual([cai, aki]);
	});

	test("does not hide malformed cycles", () => {
		const a = target("a", "b", 1);
		const b = target("b", "a", 2);
		const rows = subagentTreeRows([a, b]);
		expect(new Set(rows.map((row) => row.target.key))).toEqual(
			new Set([a.key, b.key]),
		);
	});
});
