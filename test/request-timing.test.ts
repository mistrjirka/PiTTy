import { describe, expect, test } from "bun:test";
import {
	REQUEST_TIMING_VERSION,
	RequestTimingTracker,
	requestTimingStats,
	retainCurrentRequestTimings,
} from "../src/tabs/request-timing.ts";

function assistantMessage(provider = "openai", model = "gpt-5", timestamp?: unknown) {
	return {
		role: "assistant",
		provider,
		model,
		...(timestamp !== undefined ? { timestamp } : {}),
	};
}

describe("request timing", () => {
	test("records one Turn for a tool-calling response and excludes tool execution", () => {
		const tracker = new RequestTimingTracker();
		tracker.handle({ type: "agent_start" }, 100);
		tracker.handle({ type: "turn_start" }, 150);
		tracker.handle(
			{ type: "message_start", message: assistantMessage("openai", "gpt-5", 200) },
			200,
		);
		tracker.handle(
			{ type: "message_update", assistantMessageEvent: { type: "toolcall_start" } },
			500,
		);
		tracker.handle({ type: "tool_execution_start", toolCallId: "one" }, 600);
		tracker.handle({ type: "tool_execution_start", toolCallId: "two" }, 650);
		tracker.handle({ type: "message_end", message: assistantMessage("openai", "gpt-5", 200) }, 1_200);
		tracker.handle({ type: "tool_execution_end", toolCallId: "one" }, 1_600);
		tracker.handle({ type: "tool_execution_end", toolCallId: "two" }, 1_650);
		const timing = tracker.handle({ type: "turn_end" }, 1_700);

		expect(timing).toEqual({
			timingVersion: REQUEST_TIMING_VERSION,
			provider: "openai",
			modelId: "gpt-5",
			turnMs: 1_000,
			modelToToolMs: 300,
			toolCallDurationsMs: [1_000, 1_000],
			toolCallCount: 2,
			toolWallMs: 1_050,
		});
		expect(tracker.value).toEqual(timing);
	});

	test("records separate model calls around tool results", () => {
		const tracker = new RequestTimingTracker();
		tracker.handle({ type: "agent_start" }, 100);
		tracker.handle({ type: "turn_start" }, 200);
		tracker.handle(
			{ type: "message_start", message: assistantMessage("openai", "first", 210) },
			210,
		);
		tracker.handle({ type: "message_end", message: { role: "assistant" } }, 500, { provider: "other", id: "other" });
		tracker.handle({ type: "tool_execution_start", toolCallId: "one" }, 600);
		tracker.handle({ type: "tool_execution_end", toolCallId: "one" }, 900);
		const first = tracker.handle({ type: "turn_end" }, 950);

		tracker.handle({ type: "turn_start" }, 1_000);
		tracker.handle(
			{ type: "message_start", message: assistantMessage("openai", "second", 1_050) },
			1_050,
		);
		tracker.handle({ type: "message_end", message: assistantMessage("openai", "second", 1_050) }, 1_400);
		const second = tracker.handle({ type: "turn_end" }, 1_450);
		tracker.handle({ type: "agent_settled" }, 1_500);

		expect(first?.turnMs).toBe(290);
		expect(first).toMatchObject({ provider: "openai", modelId: "first" });
		expect(first?.toolCallDurationsMs).toEqual([300]);
		expect(second).toMatchObject({
			timingVersion: REQUEST_TIMING_VERSION,
			provider: "openai",
			modelId: "second",
			turnMs: 350,
			toolCallDurationsMs: [],
			toolCallCount: 0,
		});
	});

	test("uses a valid assistant timestamp and safely falls back for malformed metadata", () => {
		const timestamped = new RequestTimingTracker();
		timestamped.handle({ type: "agent_start" }, 100);
		timestamped.handle({ type: "turn_start" }, 150);
		timestamped.handle(
			{ type: "message_start", message: assistantMessage("openai", "gpt-5", 200) },
			300,
		);
		timestamped.handle({ type: "message_end", message: assistantMessage("openai", "gpt-5", 200) }, 700);
		expect(timestamped.handle({ type: "turn_end" }, 800)?.turnMs).toBe(500);

		const fallback = new RequestTimingTracker();
		fallback.handle({ type: "agent_start" }, 100);
		fallback.handle({ type: "turn_start" }, 150);
		fallback.handle(
			{ type: "message_start", message: assistantMessage("openai", "gpt-5", Number.NaN) },
			300,
		);
		fallback.handle({ type: "message_end", message: assistantMessage("openai", "gpt-5", Number.POSITIVE_INFINITY) }, 700);
		expect(fallback.handle({ type: "turn_end" }, 800)?.turnMs).toBe(400);
	});

	test("does not publish turns without a completed assistant message", () => {
		const missingEnd = new RequestTimingTracker();
		missingEnd.handle({ type: "agent_start" }, 100);
		missingEnd.handle({ type: "turn_start" }, 200);
		missingEnd.handle({ type: "message_start", message: assistantMessage() }, 210);
		missingEnd.handle({ type: "turn_end" }, 500);
		expect(missingEnd.value).toBeUndefined();

		const aborted = new RequestTimingTracker();
		aborted.handle({ type: "agent_start" }, 100);
		aborted.handle({ type: "turn_start" }, 200);
		aborted.handle({ type: "message_start", message: assistantMessage() }, 210);
		aborted.handle(
			{ type: "message_end", message: { ...assistantMessage(), stopReason: "aborted" } },
			500,
		);
		expect(aborted.handle({ type: "agent_settled" }, 600)).toBeUndefined();
	});

	test("keeps parallel tool durations separate from their union wall time", () => {
		const tracker = new RequestTimingTracker();
		tracker.handle({ type: "agent_start" }, 100);
		tracker.handle({ type: "turn_start" }, 100);
		tracker.handle({ type: "message_start", message: assistantMessage(undefined, undefined, 100) }, 100);
		tracker.handle({ type: "message_end", message: assistantMessage(undefined, undefined, 100) }, 200);
		tracker.handle({ type: "tool_execution_start", toolCallId: "one" }, 250);
		tracker.handle({ type: "tool_execution_start", toolCallId: "two" }, 300);
		tracker.handle({ type: "tool_execution_end", toolCallId: "one" }, 500);
		tracker.handle({ type: "tool_execution_end", toolCallId: "two" }, 700);
		const timing = tracker.handle({ type: "turn_end" }, 800);
		expect(timing?.toolCallDurationsMs).toEqual([250, 400]);
		expect(timing?.toolWallMs).toBe(450);
	});

	test("calculates model-specific medians from per-call and per-tool samples", () => {
		const history = [
			{
				timingVersion: REQUEST_TIMING_VERSION,
				provider: "openai",
				modelId: "gpt-5",
				turnMs: 1_000,
				modelToToolMs: 100,
				toolCallDurationsMs: [400, 600],
				toolCallCount: 2,
			},
			{
				timingVersion: REQUEST_TIMING_VERSION,
				provider: "openai",
				modelId: "gpt-5",
				turnMs: 3_000,
				modelToToolMs: 300,
				toolCallDurationsMs: [800],
				toolCallCount: 3,
			},
			{
				timingVersion: REQUEST_TIMING_VERSION,
				provider: "other",
				modelId: "gpt-5",
				turnMs: 100,
				toolCallDurationsMs: [],
			},
		];
		expect(requestTimingStats(history, "openai", "gpt-5")).toEqual({
			medianTurnMs: 2_000,
			medianModelToToolMs: 200,
			medianTurnPerToolMs: 750,
		});
	});

	test("ignores samples without a positive tool call count", () => {
		const base = {
			timingVersion: REQUEST_TIMING_VERSION as 2,
			provider: "openai",
			modelId: "gpt-5",
			toolCallDurationsMs: [900],
		};
		expect(
			requestTimingStats([
				{ ...base, turnMs: 1_000, toolCallCount: 0 },
				{ ...base, turnMs: 2_000 },
				{ ...base, turnMs: 3_000, toolCallCount: -1 },
				{ ...base, turnMs: 4_000, toolCallCount: 1.5 },
			], "openai", "gpt-5"),
		).toEqual({ medianTurnMs: 2_500 });
	});

	test("discards incompatible request-level samples", () => {
		const valid = {
			timingVersion: REQUEST_TIMING_VERSION,
			provider: "openai",
			modelId: "gpt-5",
			turnMs: 500,
			toolCallDurationsMs: [],
		};
		const retained = retainCurrentRequestTimings([
			{ provider: "openai", modelId: "gpt-5", requestMs: 9_000, toolCallDurationsMs: [] },
			valid,
		]);
		expect(retained).toEqual([valid]);
	});
});
