import { describe, expect, test } from "bun:test";
import { subagentTargets } from "../src/subagents/targets.ts";
import { type SubagentRun } from "../src/types.ts";
import { spawnGroupRowText } from "../src/ui/spawn-group.tsx";
import { clip, stateIcon } from "../src/ui/model-context.tsx";
import { useIsolatedSubagentRoots } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

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
