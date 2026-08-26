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
