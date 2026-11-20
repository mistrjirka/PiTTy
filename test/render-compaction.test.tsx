import { describe, expect, test } from "bun:test";
import { type TextRenderable } from "@opentui/core";
import { Show, createMemo, createSignal } from "solid-js";
import {
	CompactedSummary,
	CompactionPanel,
	compactionContextPercent,
	determinateContextBar,
	indeterminateCompactionBar,
	laneTailLines,
} from "../src/ui/compaction-panel.tsx";
import type { CompactionCompletion, CompactionTelemetry, OneRoundLaneTexts, OneRoundProgress } from "../src/state/compaction-telemetry.ts";

import { mount } from "./render-helpers/mount.tsx";

describe("OpenTUI components", () => {
	test("renders truthful compaction activity and context-size gauges", async () => {
		expect(
			compactionContextPercent({
				version: 1,
				phase: "preparing",
				tokensBefore: 150_000,
				contextWindow: 200_000,
			}),
		).toBe(75);
		expect(determinateContextBar(50, 8)).toBe("████░░░░");
		expect(indeterminateCompactionBar(2, 8)).toHaveLength(8);
		const setup = await mount(
			() => (
				<CompactionPanel
					telemetry={{
						version: 1,
						phase: "preparing",
						reason: "threshold",
						tokensBefore: 150_000,
						contextWindow: 200_000,
						summarizingContextMessages: 186,
						plannedRetainedContextMessages: 23,
						startedAt: 1_000,
					}}
					now={13_000}
					spinner="◐"
					frame={2}
					smartCompactProgress="Smart Compact 1/5 · Extract"
				/>
			),
			100,
			8,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Compacting · threshold · 12s elapsed");
		expect(frame).toContain("Activity [");
		expect(frame).toContain("indeterminate");
		expect(frame).toContain("Smart Compact 1/5 · Extract");
		expect(frame).toContain("Context size [");
		expect(frame).toContain("150K / 200K · 75% full");
		expect(frame).toContain("Plan: summarize 186 context messages");
		expect(frame).toContain("keep 23 recent context messages");
	});

	test("renders live one-round lane text as tail windows", async () => {
		expect(laneTailLines("")).toEqual([]);
		expect(laneTailLines("one\ntwo\nthree\n")).toEqual(["one", "two", "three"]);
		// The streamed window shows the newest 6 rows by default: an ellipsis row
		// plus the newest 5 lines, so live text stays readable without overflowing.
		expect(laneTailLines("l1\nl2\nl3\nl4\nl5")).toEqual([
			"l1",
			"l2",
			"l3",
			"l4",
			"l5",
		]);
		expect(laneTailLines("l1\nl2\nl3\nl4\nl5", 3)).toEqual(["…", "l4", "l5"]);
		expect(
			laneTailLines(
				Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join("\n"),
			),
		).toEqual(["…", ...Array.from({ length: 5 }, (_, i) => `line ${i + 10}`)]);
		expect(
			laneTailLines(
				Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join("\n"),
				12,
			),
		).toEqual(["…", ...Array.from({ length: 11 }, (_, i) => `line ${i + 4}`)]);
		const [expanded, setExpanded] = createSignal(false);
		const setup = await mount(
			() => (
				<CompactionPanel
					telemetry={{
						version: 1,
						phase: "preparing",
						reason: "manual",
						startedAt: 1_000,
					}}
					now={4_000}
					spinner="◐"
					frame={1}
					oneRoundProgress={{
						v: 2,
						runId: "run-1",
						seq: 3,
						phase: "streaming",
						reason: "manual",
						elapsedMs: 3000,
						retainedTurns: 2,
						estimatedRetainedTokens: 30_000,
						keepRecentTokens: 32_000,
						targetPostCompactTokens: 40_000,
						effectiveRecentTokenBudget: 30_250,
						boundaryMode: "whole-turn",
						lanes: {
							audit: {
								role: "audit",
								state: "streaming",
								chars: 900,
								elapsedMs: 2500,
							},
							execution: { role: "execution", state: "queued", chars: 0 },
						},
					}}
					laneTexts={{
						runId: "run-1",
						intent: "",
						audit:
							"line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten",
						execution: "",
					}}
					expanded={expanded}
					onToggle={() => setExpanded((value) => !value)}
				/>
			),
			100,
			30,
		);
		let frame = setup.captureCharFrame();
		expect(frame).toContain("◐ audit · streaming · 900 chars");
		expect(frame).toContain("line nine");
		expect(frame).toContain("line ten");
		expect(frame).not.toContain("line one");
		expect(frame).toContain("execution · queued · 0 chars");
		expect(frame).toContain("expand");
		const toggle = setup.renderer.root.findDescendantById(
			"compaction-panel-toggle",
		) as TextRenderable | undefined;
		expect(toggle).toBeDefined();
		if (!toggle) throw new Error("compaction panel toggle missing");
		await setup.mockMouse.click(toggle.x, toggle.y);
		await setup.flush();
		expect(expanded()).toBe(true);
		frame = setup.captureCharFrame();
		expect(frame).toContain("collapse");
		expect(frame).toContain("line one");
	});

	test("bounds live one-round lane text to fixed terminal rows at narrow width", async () => {
		// A long wrapping logical line must not monopolize the fixed 6-row lane
		// window: the tail (newest streamed lines) has to stay visible, and the
		// fixed rows below the lane must stay at their bounded locations.
		const audit = `${"x".repeat(200)}\nmid line\nCLOSING_MARKER_ZETA`;
		const setup = await mount(
			() => (
				<box flexDirection="column" width="100%" height="100%">
					<CompactionPanel
						telemetry={{
							version: 1,
							phase: "preparing",
							reason: "manual",
							startedAt: 1_000,
						}}
						now={4_000}
						spinner="◐"
						frame={1}
						oneRoundProgress={{
							v: 2,
							runId: "run-1",
							seq: 3,
							phase: "streaming",
							reason: "manual",
							elapsedMs: 3000,
							retainedTurns: 2,
							estimatedRetainedTokens: 30_000,
							keepRecentTokens: 32_000,
							targetPostCompactTokens: 40_000,
							effectiveRecentTokenBudget: 30_250,
							boundaryMode: "whole-turn",
							lanes: {
								audit: {
									role: "audit",
									state: "streaming",
									chars: 900,
									elapsedMs: 2500,
								},
								execution: { role: "execution", state: "queued", chars: 0 },
							},
						}}
						laneTexts={{ runId: "run-1", intent: "", audit, execution: "" }}
					/>
					<text>MARKER_AFTER_PANEL</text>
				</box>
			),
			40,
			30,
		);
		const frame = setup.captureCharFrame();
		const lines = frame.split("\n");
		const executionRow = lines.findIndex((line) =>
			line.includes("execution · queued"),
		);
		const markerRow = lines.findIndex((line) =>
			line.includes("MARKER_AFTER_PANEL"),
		);
		// Collapsed lane window: header(1) + audit lane(1) + 6 lane rows, so the
		// execution lane must stay on row 8 and never be pushed down by wrapping.
		expect(executionRow).toBe(8);
		expect(markerRow).toBeGreaterThanOrEqual(0);
		expect(markerRow).toBeLessThanOrEqual(13);
		expect(frame).toContain("MARKER_AFTER_PANEL");
		// The lane is a tail window: the newest streamed lines must win the fixed
		// terminal rows instead of being crowded out by one wrapping head line.
		expect(frame).toContain("CLOSING_MARKER_ZETA");
		expect(frame).toContain("mid line");
	});

	test("updates the mounted compaction panel when live progress arrives", async () => {
		const [revision, setRevision] = createSignal(0);
		const runtime: {
			telemetry: CompactionTelemetry | undefined;
			smartCompactProgress: string | undefined;
			oneRoundProgress: OneRoundProgress | undefined;
			laneTexts: OneRoundLaneTexts | undefined;
		} = {
			telemetry: {
				version: 1,
				phase: "preparing",
				reason: "manual",
				startedAt: 1_000,
			},
			smartCompactProgress: undefined,
			oneRoundProgress: undefined,
			laneTexts: undefined,
		};
		const compactionView = createMemo(() => {
			revision();
			return {
				telemetry: runtime.telemetry,
				smartCompactProgress: runtime.smartCompactProgress,
				oneRoundProgress: runtime.oneRoundProgress,
				laneTexts: runtime.laneTexts,
			};
		});
		const publish = () => setRevision((value) => value + 1);
		const progress: OneRoundProgress = {
			v: 2,
			runId: "run-1",
			seq: 1,
			phase: "streaming",
			reason: "manual",
			elapsedMs: 500,
			retainedTurns: 1,
			estimatedRetainedTokens: 10_000,
			keepRecentTokens: 12_000,
			targetPostCompactTokens: 40_000,
			effectiveRecentTokenBudget: 30_250,
			boundaryMode: "whole-turn",
			lanes: {
				audit: { role: "audit", state: "streaming", chars: 10 },
				execution: { role: "execution", state: "queued", chars: 0 },
			},
		};
		const setup = await mount(
			() => (
				<Show when={compactionView().telemetry?.phase === "preparing"}>
					<CompactionPanel
						telemetry={compactionView().telemetry!}
						now={2_000}
						spinner="◐"
						frame={1}
						smartCompactProgress={compactionView().smartCompactProgress}
						oneRoundProgress={compactionView().oneRoundProgress}
						laneTexts={compactionView().laneTexts}
					/>
				</Show>
			),
			100,
			10,
		);
		let frame = setup.captureCharFrame();
		expect(frame).toContain("Activity [");
		runtime.oneRoundProgress = progress;
		publish();
		await setup.flush();
		frame = setup.captureCharFrame();
		expect(frame).toContain("audit · streaming · 10 chars");
		expect(frame).not.toContain("Activity [");
		runtime.telemetry = undefined;
		runtime.oneRoundProgress = undefined;
		publish();
		await setup.flush();
		expect(setup.captureCharFrame()).not.toContain("Compacting");
	});

	test("renders the compacted summary collapsed and expanded with the markdown summary", async () => {
		const completion: CompactionCompletion = {
			tokensBefore: 152_000,
			estimatedTokensAfter: 32_000,
			reason: "threshold",
			durationMs: 2_300,
			retainedContextMessages: 41,
			summary:
				"The agent verified the release workflow and fixed one portability edge case.",
		};

		const collapsed = await mount(
			() => (
				<CompactedSummary
					completion={completion}
					expanded={createSignal(false)[0]}
					onToggle={() => {}}
				/>
			),
			100,
			10,
		);
		let frame = collapsed.captureCharFrame();
		expect(frame).toContain("── Compacted");
		expect(frame).toContain(
			"152K → ~32K · threshold · 2.3s · kept 41 messages",
		);
		expect(frame).toContain("▶ Show compaction summary");
		expect(frame).not.toContain("The agent verified");

		const expandedSetup = await mount(
			() => (
				<CompactedSummary
					completion={completion}
					expanded={createSignal(true)[0]}
					onToggle={() => {}}
				/>
			),
			100,
			10,
		);
		frame = expandedSetup.captureCharFrame();
		expect(frame).toContain("▼ Hide compaction summary");
		expect(frame).toContain("The agent verified the release workflow");

		// The toggle routes mouse-down to the parent's handler.
		const [expanded, setExpanded] = createSignal(false);
		const wired = await mount(
			() => (
				<CompactedSummary
					completion={completion}
					expanded={expanded}
					onToggle={() => setExpanded((value) => !value)}
				/>
			),
			100,
			10,
		);
		const toggle = wired.renderer.root.findDescendantById(
			"compacted-summary-toggle",
		) as TextRenderable | undefined;
		expect(toggle).toBeDefined();
		if (!toggle) throw new Error("compacted summary toggle missing");
		await wired.mockMouse.click(toggle.x, toggle.y);
		await wired.flush();
		expect(expanded()).toBe(true);
	});
});
