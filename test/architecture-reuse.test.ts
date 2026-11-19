import { describe, expect, test } from "bun:test";
import { subagentControlAvailability } from "../src/subagents/control-availability.ts";
import type { SubagentTarget } from "../src/subagents/targets.ts";
import type { SubagentRun } from "../src/types.ts";
import { selectIndexAtY } from "../src/ui/select-mouse.ts";

function target(
	control: SubagentRun["control"],
	state: string,
	canSteer: boolean,
): SubagentTarget {
	const run: SubagentRun = {
		runId: "test-run",
		mode: "single",
		state,
		steps: [],
		...(control ? { control } : {}),
		...(control === "profiled"
			? { controlDir: "/tmp/profiled-test" }
			: { asyncDir: "/tmp/legacy-test" }),
	};
	return {
		key: "test-run",
		run,
		label: "Test",
		state,
		active: state !== "completed",
		canSteer,
	};
}

describe("Shared subagent control eligibility", () => {
	test("does not expose controls when there is no selected target", () => {
		expect(subagentControlAvailability(undefined).canControl).toBe(false);
	});
	test("legacy running children can pause and stop", () => {
		expect(
			subagentControlAvailability(target("file", "running", true)),
		).toEqual({
			profiled: false,
			canControl: true,
			canPause: true,
			canResume: false,
			canStop: true,
		});
	});
	test("legacy paused children can resume even when steering is unavailable", () => {
		expect(
			subagentControlAvailability(target("file", "paused", false)),
		).toEqual({
			profiled: false,
			canControl: true,
			canPause: false,
			canResume: true,
			canStop: true,
		});
	});
	test("profiled waiting children can stop, but cannot pause or resume", () => {
		expect(
			subagentControlAvailability(target("profiled", "waiting", true)),
		).toEqual({
			profiled: true,
			canControl: true,
			canPause: false,
			canResume: false,
			canStop: true,
		});
	});
	test("foreground children cannot be controlled", () => {
		expect(
			subagentControlAvailability(target("foreground", "running", true))
				.canControl,
		).toBe(false);
	});
	test("completed children cannot be controlled", () => {
		expect(
			subagentControlAvailability(target("file", "completed", false))
				.canControl,
		).toBe(false);
	});
	test("missing control path hides actions", () => {
		const source = target("profiled", "running", true);
		delete source.run.controlDir;
		expect(subagentControlAvailability(source).canControl).toBe(false);
	});
});

describe("Select mouse row indexing using public layout fields", () => {
	test("maps visible two-line options at the start", () => {
		const layout = {
			screenY: 10,
			height: 6,
			selectedIndex: 0,
			optionCount: 8,
			linesPerItem: 2,
		};
		expect(selectIndexAtY(layout, 10)).toBe(0);
		expect(selectIndexAtY(layout, 11)).toBe(0);
		expect(selectIndexAtY(layout, 12)).toBe(1);
		expect(selectIndexAtY(layout, 14)).toBe(2);
	});
	test("matches centered scrolling near the end", () => {
		const layout = {
			screenY: 10,
			height: 6,
			selectedIndex: 6,
			optionCount: 8,
			linesPerItem: 2,
		};
		expect(selectIndexAtY(layout, 10)).toBe(5);
		expect(selectIndexAtY(layout, 12)).toBe(6);
		expect(selectIndexAtY(layout, 15)).toBe(7);
	});
	test("does not select out-of-bounds rows", () => {
		const layout = {
			screenY: 10,
			height: 6,
			selectedIndex: 0,
			optionCount: 2,
			linesPerItem: 2,
		};
		expect(selectIndexAtY(layout, 9)).toBeUndefined();
		expect(selectIndexAtY(layout, 14)).toBeUndefined();
		expect(selectIndexAtY(layout, 16)).toBeUndefined();
	});
	test("single-line options remain supported", () => {
		expect(
			selectIndexAtY(
				{
					screenY: 3,
					height: 4,
					selectedIndex: 2,
					optionCount: 6,
					linesPerItem: 1,
				},
				4,
			),
		).toBe(1);
	});
});
