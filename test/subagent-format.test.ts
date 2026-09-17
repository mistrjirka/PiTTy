import { describe, expect, test } from "bun:test";
import {
	summarizeSubagentArgs,
	taskGist,
	terminalBadge,
	workflowChildrenSummary,
} from "../src/ui/subagent-format.ts";

describe("subagent formatting", () => {
	test("summarizes launch fields and count", () => {
		expect(summarizeSubagentArgs({ agent: "reviewer", model: "gpt-5.6-luna", mode: "background", count: 2 }))
			.toBe("reviewer · gpt-5.6-luna · background ×2");
		expect(summarizeSubagentArgs("raw args")).toBeUndefined();
	});

	test("normalizes and bounds task gist", () => {
		expect(taskGist({ task: "  inspect\n   the   tabs  " })).toBe("inspect the tabs");
		expect(taskGist({ task: "x".repeat(100) })).toBe(`${"x".repeat(89)}…`);
		expect(taskGist({})).toBeUndefined();
	});

	test("formats terminal outcomes", () => {
		expect(terminalBadge("completed", false, "took 2s")).toBe("✓ completed · took 2s");
		expect(terminalBadge("done", false, "")).toBe("✓ completed");
		expect(terminalBadge("failed", true, "took 1s")).toBe("✗ failed");
		expect(terminalBadge("streaming", false, "1s")).toBeUndefined();
	});

	test("counts recognized workflow result shapes and fails closed", () => {
		expect(workflowChildrenSummary({}, { results: [1, 2, 3] })).toBe("×3 children");
		expect(workflowChildrenSummary({}, { details: { children: 6 } })).toBe("×6 children");
		expect(workflowChildrenSummary({}, { details: { children: "6" } })).toBeUndefined();
		expect(workflowChildrenSummary({}, "not json")).toBeUndefined();
	});
});

describe("batch A data truth", () => {
	test("a {task}-shaped tool has no arg summary but keeps its gist", () => {
		// summarizeSubagentArgs cannot describe this shape (no agent/model/mode
		// fields); the row must then fall back to the gist / generic preview
		// instead of showing neither.
		expect(summarizeSubagentArgs({ task: "do the thing" })).toBeUndefined();
		expect(taskGist({ task: "do the thing" })).toBe("do the thing");
	});

	test("prefers args over output for the children badge", () => {
		expect(workflowChildrenSummary({ results: [{ id: 1 }] }, { results: [1, 2, 3, 4] })).toBe("×1 children");
		expect(workflowChildrenSummary({ details: { children: 2 } }, { results: [1, 2, 3] })).toBe("×2 children");
		// Output is still consulted when args has no spawn shape.
		expect(workflowChildrenSummary({ agent: "worker" }, { results: [1, 2] })).toBe("×2 children");
		expect(workflowChildrenSummary({ agent: "worker" }, "not json")).toBeUndefined();
	});
});
