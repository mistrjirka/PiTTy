import { describe, expect, test } from "bun:test";
import { RequestPerformanceTracker } from "../src/tabs/request-metrics.ts";

const assistantEnd = (output: number) => ({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { output } } });

/** Starts a request at `startedAt` and delivers `count` deltas from `firstAt`, `stepMs` apart. Returns the last delta time. */
function streamReply(tracker: RequestPerformanceTracker, startedAt: number, firstAt: number, count: number, stepMs: number, delta = "text_delta", extra: Record<string, unknown> = {}): number {
	tracker.handle({ type: "message_start", message: { role: "assistant", timestamp: startedAt, ...extra } }, startedAt + 1);
	let last = firstAt;
	for (let index = 0; index < count; index += 1) {
		last = firstAt + index * stepMs;
		tracker.handle({ type: "message_update", assistantMessageEvent: { type: delta } }, last);
	}
	return last;
}

describe("request performance", () => {
	test("tracks the first assistant output, including tool calls", () => {
		for (const delta of [
			"text_delta",
			"thinking_delta",
			"reasoning_delta",
			"toolcall_start",
		]) {
			const tracker = new RequestPerformanceTracker();
			const last = streamReply(tracker, 1000, 1800, 9, 150, delta);
			expect(last).toBe(3000);
			tracker.handle(assistantEnd(42), 9000);
			expect(tracker.value).toEqual({ ttftMs: 800, generationMs: 1200, outputTokens: 42 });
		}
	});

	test("omits incomplete, zero-token, and overlapping requests", () => {
		const tracker = new RequestPerformanceTracker();
		tracker.handle({ type: "message_start", message: { role: "assistant", timestamp: 100 } }, 100);
		tracker.handle({ type: "message_start", message: { role: "assistant", timestamp: 200 } }, 200);
		tracker.handle({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { output: 5 } } }, 300);
		expect(tracker.value).toBeUndefined();
		tracker.handle({ type: "message_start", message: { role: "assistant", timestamp: 400 } }, 400);
		tracker.handle({ type: "message_end", message: { role: "assistant", stopReason: "error", usage: { output: 2 } } }, 500);
		expect(tracker.value).toBeUndefined();
	});

	test("rejects out-of-order timestamps and preserves the prior metric", () => {
		const tracker = new RequestPerformanceTracker();
		streamReply(tracker, 100, 120, 10, 200);
		tracker.handle(assistantEnd(4), 2000);
		expect(tracker.value?.outputTokens).toBe(4);
		tracker.handle({ type: "message_start", message: { role: "assistant", timestamp: 5000 } }, 5000);
		for (let index = 0; index < 10; index += 1)
			tracker.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta" } }, 4000 + index * 200);
		tracker.handle(assistantEnd(8), 7000);
		expect(tracker.value?.outputTokens).toBe(4);
	});

	test("uses the assistant message model and emits a completion only once", () => {
		const tracker = new RequestPerformanceTracker();
		tracker.handle(
			{
				type: "message_start",
				message: {
					role: "assistant",
					timestamp: 100,
					provider: "openai",
					model: "gpt-5",
				},
			},
			100,
			{ provider: "stale-provider", id: "stale-model" },
		);
		for (let index = 0; index < 9; index += 1)
			tracker.handle(
				{ type: "message_update", assistantMessageEvent: { type: "text_delta" } },
				150 + index * 150,
			);
		const performance = tracker.handle(
			{
				type: "message_end",
				message: {
					role: "assistant",
					stopReason: "stop",
					usage: { output: 10 },
				},
			},
			5000,
		);
		expect(performance).toEqual({
			provider: "openai",
			modelId: "gpt-5",
			ttftMs: 50,
			generationMs: 1200,
			outputTokens: 10,
		});
		expect(
			tracker.handle(
				{ type: "message_end", message: { role: "toolResult" } },
				300,
			),
		).toBeUndefined();
		expect(tracker.value).toEqual(performance);
	});

	test("measures tok/s over the streamed window, not message_end", () => {
		const tracker = new RequestPerformanceTracker();
		const last = streamReply(tracker, 1000, 1500, 11, 200);
		expect(tracker.handle(assistantEnd(100), last + 5_000)).toEqual({ ttftMs: 500, generationMs: 2000, outputTokens: 100 });
	});

	test("rejects burst, short, and two-burst replies", () => {
		const burst = new RequestPerformanceTracker();
		streamReply(burst, 0, 500, 20, 0);
		expect(burst.handle(assistantEnd(100), 3000)).toBeUndefined();

		const short = new RequestPerformanceTracker();
		streamReply(short, 0, 500, 9, 50);
		expect(short.handle(assistantEnd(100), 3000)).toBeUndefined();

		const fewDeltas = new RequestPerformanceTracker();
		streamReply(fewDeltas, 0, 500, 7, 500);
		expect(fewDeltas.handle(assistantEnd(100), 5000)).toBeUndefined();

		// Two flushes 2s apart: long window, but only two distinct arrival times.
		const twoBursts = new RequestPerformanceTracker();
		twoBursts.handle({ type: "message_start", message: { role: "assistant", timestamp: 0 } }, 1);
		for (const at of [500, 500, 500, 500, 2500, 2500, 2500, 2500, 2500])
			twoBursts.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta" } }, at);
		expect(twoBursts.handle(assistantEnd(100), 3000)).toBeUndefined();
		expect(twoBursts.value).toBeUndefined();
	});
});
