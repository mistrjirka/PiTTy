import { describe, expect, test } from "bun:test";
import { RequestPerformanceTracker } from "../src/tabs/request-metrics.ts";

describe("request performance", () => {
	test("tracks text-first and thinking-first requests", () => {
		for (const delta of ["text_delta", "thinking_delta"]) {
			const tracker = new RequestPerformanceTracker();
			tracker.handle({ type: "message_start", message: { role: "assistant", timestamp: 1000 } }, 1001);
			tracker.handle({ type: "message_update", assistantMessageEvent: { type: delta } }, 1800);
			tracker.handle({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { output: 42 } } }, 2800);
			expect(tracker.value).toEqual({ ttftMs: 800, generationMs: 1000, outputTokens: 42 });
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
		tracker.handle({ type: "message_start", message: { role: "assistant", timestamp: 100 } }, 100);
		tracker.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta" } }, 120);
		tracker.handle({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { output: 4 } } }, 200);
		tracker.handle({ type: "message_start", message: { role: "assistant", timestamp: 500 } }, 500);
		tracker.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta" } }, 400);
		tracker.handle({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { output: 8 } } }, 600);
		expect(tracker.value?.outputTokens).toBe(4);
	});
});
