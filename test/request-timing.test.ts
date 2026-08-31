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

	test("calculates model-specific median summaries", () => {
		const history = [
			{
				provider: "openai",
				modelId: "gpt-5",
				requestMs: 8_000,
				modelToToolMs: 1_000,
				toolCallDurationsMs: [400, 600],
				toolWallMs: 700,
			},
			{
				provider: "openai",
				modelId: "gpt-5",
				requestMs: 10_000,
				modelToToolMs: 2_000,
				toolCallDurationsMs: [800],
				toolWallMs: 900,
			},
			{
				provider: "other",
				modelId: "gpt-5",
				requestMs: 100,
				toolCallDurationsMs: [],
			},
		];

		expect(requestTimingStats(history, "openai", "gpt-5")).toEqual({
			medianRequestMs: 9_000,
			medianModelToToolMs: 1_500,
			medianToolCallMs: 600,
		});
		expect(requestTimingStats(history, "missing", "gpt-5")).toBeUndefined();
	});
});
