import { describe, expect, test } from "bun:test";
import {
	RequestTimingTracker,
	requestTimingStats,
} from "../src/tabs/request-timing.ts";

describe("request timing", () => {
	test("includes model-to-tool time and counts parallel tools by wall time", () => {
		const tracker = new RequestTimingTracker();
		tracker.handle({ type: "agent_start" }, 100);
		tracker.handle({ type: "turn_start" }, 150);
		tracker.handle(
			{
				type: "message_start",
				message: {
					role: "assistant",
					provider: "openai",
					model: "gpt-5",
				},
			},
			200,
		);
		tracker.handle(
			{
				type: "message_update",
				assistantMessageEvent: { type: "toolcall_start" },
			},
			500,
		);
		tracker.handle(
			{ type: "tool_execution_start", toolCallId: "one" },
			600,
		);
		tracker.handle(
			{ type: "tool_execution_start", toolCallId: "two" },
			650,
		);
		tracker.handle(
			{ type: "tool_execution_end", toolCallId: "one" },
			1_600,
		);
		tracker.handle(
			{ type: "tool_execution_end", toolCallId: "two" },
			1_650,
		);
		tracker.handle({ type: "turn_end" }, 1_700);
		const timing = tracker.handle({ type: "agent_settled" }, 2_000);

		expect(timing).toEqual({
			provider: "openai",
			modelId: "gpt-5",
			requestMs: 1_900,
			modelToToolMs: 350,
			toolCallDurationsMs: [1_000, 1_000],
			toolCallCount: 2,
			toolWallMs: 1_050,
		});
		expect(tracker.value).toEqual(timing);
	});

	test("keeps separate turns and measures sequential tool wall time once each", () => {
		const tracker = new RequestTimingTracker();
		tracker.handle({ type: "agent_start" }, 100);
		tracker.handle({ type: "turn_start" }, 200);
		tracker.handle(
			{
				type: "message_start",
				message: { role: "assistant", provider: "openai", model: "gpt-5" },
			},
			210,
		);
		tracker.handle(
			{ type: "tool_execution_start", toolCallId: "one" },
			400,
		);
		tracker.handle({ type: "tool_execution_end", toolCallId: "one" }, 700);
		tracker.handle({ type: "turn_end" }, 750);
		tracker.handle({ type: "turn_start" }, 800);
		tracker.handle(
			{
				type: "message_start",
				message: { role: "assistant" },
			},
			810,
			{ provider: "openai", id: "gpt-5" },
		);
		tracker.handle(
			{ type: "tool_execution_start", toolCallId: "two" },
			900,
		);
		tracker.handle({ type: "tool_execution_end", toolCallId: "two" }, 1_100);
		tracker.handle({ type: "turn_end" }, 1_150);
		const timing = tracker.handle({ type: "agent_settled" }, 1_200);

		expect(timing?.modelToToolMs).toBe(300);
		expect(timing?.toolCallDurationsMs).toEqual([300, 200]);
		expect(timing?.toolWallMs).toBe(500);
	});

	test("does not publish incomplete tool measurements", () => {
		const tracker = new RequestTimingTracker();
		tracker.handle({ type: "agent_start" }, 100);
		tracker.handle({ type: "tool_execution_start", toolCallId: "unfinished" }, 200);
		expect(tracker.handle({ type: "agent_settled" }, 300)).toBeUndefined();
		expect(tracker.value).toBeUndefined();

		const overlapping = new RequestTimingTracker();
		overlapping.handle({ type: "agent_start" }, 100);
		overlapping.handle({ type: "agent_start" }, 200);
		expect(overlapping.handle({ type: "agent_settled" }, 300)).toBeUndefined();
	});

	test("turn time spans TTFT (prompt processing) without double-counting it", () => {
		const tracker = new RequestTimingTracker();
		tracker.handle({ type: "agent_start" }, 100);
		tracker.handle(
			{
				type: "message_start",
				message: { role: "assistant", provider: "openai", model: "gpt-5" },
			},
			300,
		);
		// Slow first token: prompt processing takes until 2_500.
		tracker.handle(
			{
				type: "message_update",
				assistantMessageEvent: { type: "text_delta" },
			},
			2_500,
		);
		tracker.handle({ type: "turn_end" }, 2_600);
		const timing = tracker.handle({ type: "agent_settled" }, 3_000);
		// requestMs covers agent_start -> settled; the 2_400ms prompt processing
		// (TTFT) is inside that span, not added on top of it.
		expect(timing?.requestMs).toBe(2_900);
		expect(timing?.toolWallMs).toBeUndefined();
	});

	test("counts tool calls even when per-call timing is incomplete", () => {
		const tracker = new RequestTimingTracker();
		tracker.handle({ type: "agent_start" }, 100);
		tracker.handle({ type: "tool_execution_start", toolCallId: "one" }, 200);
		tracker.handle({ type: "tool_execution_start", toolCallId: "two" }, 300);
		tracker.handle({ type: "tool_execution_start", toolCallId: "three" }, 400);
		tracker.handle({ type: "tool_execution_end", toolCallId: "two" }, 500);
		// "one" never ends, so per-call durations are dropped as incomplete…
		const timing = tracker.handle({ type: "agent_settled" }, 600);
		expect(timing).toBeUndefined();
		// …but when the agent does settle cleanly, the count still reflects all starts.
		const clean = new RequestTimingTracker();
		clean.handle({ type: "agent_start" }, 100);
		clean.handle({ type: "tool_execution_start", toolCallId: "one" }, 200);
		clean.handle({ type: "tool_execution_start", toolCallId: "two" }, 300);
		clean.handle({ type: "tool_execution_end", toolCallId: "one" }, 400);
		clean.handle({ type: "tool_execution_end", toolCallId: "two" }, 500);
		const cleanTiming = clean.handle({ type: "agent_settled" }, 900);
		expect(cleanTiming?.toolCallCount).toBe(2);
	});

	test("calculates model-specific median summaries from per-turn tool shares", () => {
		const history = [
			{
				provider: "openai",
				modelId: "gpt-5",
				requestMs: 8_000,
				modelToToolMs: 1_000,
				toolCallDurationsMs: [400, 600],
				toolCallCount: 2,
				toolWallMs: 700,
			},
			{
				provider: "openai",
				modelId: "gpt-5",
				requestMs: 10_000,
				modelToToolMs: 2_000,
				toolCallDurationsMs: [800],
				toolCallCount: 1,
				toolWallMs: 900,
			},
			{
				provider: "other",
				modelId: "gpt-5",
				requestMs: 100,
				toolCallDurationsMs: [],
			},
		];

		// Tool metric = median of (turn time ÷ tool calls in that turn):
		// 8 000 / 2 = 4 000, 10 000 / 1 = 10 000 → median 7 000.
		expect(requestTimingStats(history, "openai", "gpt-5")).toEqual({
			medianRequestMs: 9_000,
			medianModelToToolMs: 1_500,
			medianToolCallMs: 7_000,
		});
		expect(requestTimingStats(history, "missing", "gpt-5")).toBeUndefined();
	});

	test("falls back to duration counts for hand-built samples", () => {
		const history = [
			{
				provider: "openai",
				modelId: "gpt-5",
				requestMs: 6_000,
				toolCallDurationsMs: [100, 200],
			},
		];
		expect(requestTimingStats(history, "openai", "gpt-5")?.medianToolCallMs).toBe(3_000);
		expect(
			requestTimingStats(
				[{ provider: "openai", modelId: "gpt-5", requestMs: 5_000, toolCallDurationsMs: [] }],
				"openai",
				"gpt-5",
			)?.medianToolCallMs,
		).toBeUndefined();
	});
});
