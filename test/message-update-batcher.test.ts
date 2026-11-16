import { describe, expect, test } from "bun:test";
import { MessageUpdateBatcher } from "../src/state/message-update-batcher.ts";
import type { PiEvent } from "../src/types.ts";

type Timer = { callback: () => void; handle: ReturnType<typeof setTimeout>; delayMs: number };

function scheduler(timers: Timer[]) {
	return (callback: () => void, _delayMs: number): ReturnType<typeof setTimeout> => {
		const handle = setTimeout(() => undefined, 60_000);
		timers.push({ callback, handle, delayMs: _delayMs });
		return handle;
	};
}

function canceller(timer: ReturnType<typeof setTimeout>): void {
clearTimeout(timer);
}

const update = (index: number, delta: string): PiEvent => ({
	type: "message_update",
	assistantMessageEvent: { contentIndex: index, delta, type: "text_delta" },
} as Record<string, unknown>);

describe("MessageUpdateBatcher", () => {
	test("replays exact FIFO batches and flushes before boundaries", () => {
		const timers: Timer[] = [];
		const applied: PiEvent[] = [];
		const batches: PiEvent[][] = [];
		const batcher = new MessageUpdateBatcher({
			applyEvent: (event) => applied.push(event),
			onBatchComplete: (events) => batches.push([...events]),
			schedule: scheduler(timers),
			cancel: canceller,
		});
		const first = update(2, "a");
		const second = update(0, "b");
		batcher.handle(first);
		batcher.handle(second);
		expect(timers[0]?.delayMs).toBe(33);
		const boundary: PiEvent = { type: "message_end" };
		batcher.handle(boundary);
		expect(applied).toEqual([first, second, boundary]);
		expect(batches).toEqual([[first, second]]);
	});

	test("bounds burst retention without dropping FIFO updates", () => {
		const timers: Timer[] = [];
		const applied: PiEvent[] = [];
		const batches: PiEvent[][] = [];
		const batcher = new MessageUpdateBatcher({
			applyEvent: (event) => applied.push(event),
			onBatchComplete: (events) => batches.push([...events]),
			schedule: scheduler(timers),
			cancel: canceller,
			maxPending: 2,
		});
		const first = update(0, "a");
		const second = update(0, "b");
		const third = update(0, "c");
		batcher.handle(first);
		batcher.handle(second);
		batcher.handle(third);
		expect(applied).toEqual([first, second]);
		batcher.flush();
		expect(applied).toEqual([first, second, third]);
		expect(batches).toEqual([[first, second], [third]]);
	});

	test("coalesces adjacent text only when enabled and preserves event order", () => {
		const applied: PiEvent[] = [];
		const batcher = new MessageUpdateBatcher({
			applyEvent: (event) => applied.push(event),
			mergeTextDeltas: true,
		});
		const first = update(0, "a");
		const second = update(0, "a");
		const thinking = { type: "message_update", assistantMessageEvent: {
			type: "thinking_delta", contentIndex: 1, delta: "b",
		} } as PiEvent;
		batcher.handle(first);
		batcher.handle(second);
		batcher.handle(thinking);
		batcher.handle(update(0, "c"));
		batcher.flush();
		const deltas = applied.map((event) => (
			(event as Record<string, any>).assistantMessageEvent.delta
		));
		expect(deltas).toEqual(["aa", "b", "c"]);
		expect((first as Record<string, any>).assistantMessageEvent.delta).toBe("a");
	});
	test("never merges deltas with full provider snapshots", () => {
		const applied: PiEvent[] = [];
		const batcher = new MessageUpdateBatcher({
			applyEvent: (event) => applied.push(event), mergeTextDeltas: true,
		});
		batcher.handle(update(0, "first"));
		batcher.handle({ ...update(0, "second"), message: { role: "assistant" } } as PiEvent);
		batcher.flush();
		expect(applied).toHaveLength(2);
	});

	test("stale timer cannot replay after explicit flush", () => {
		const timers: Timer[] = [];
		const applied: PiEvent[] = [];
		const batcher = new MessageUpdateBatcher({ applyEvent: (event) => applied.push(event), schedule: scheduler(timers), cancel: canceller });
		const event = update(0, "x");
		batcher.handle(event);
		batcher.flush();
		const timer = timers[0];
		if (!timer) throw new Error("timer was not scheduled");
		timer.callback();
		expect(applied).toEqual([event]);
	});

	test("dispose flushes once and rejects later events", () => {
		const timers: Timer[] = [];
		const applied: PiEvent[] = [];
		const batches: PiEvent[][] = [];
		const batcher = new MessageUpdateBatcher({
			applyEvent: (event) => applied.push(event),
			onBatchComplete: (events) => batches.push([...events]),
			schedule: scheduler(timers),
			cancel: canceller,
		});
		const thinking = {
			type: "message_update",
			assistantMessageEvent: { type: "thinking_delta", contentIndex: 1, delta: "think" },
		} as Record<string, unknown>;
		const toolCall = {
			type: "message_update",
			assistantMessageEvent: { type: "toolcall_delta", contentIndex: 2, delta: "{\"path\":" },
		} as Record<string, unknown>;
		batcher.handle(thinking);
		batcher.handle(toolCall);
		batcher.dispose();
		const timer = timers[0];
		if (!timer) throw new Error("dispose timer was not scheduled");
		timer.callback();
		batcher.handle(update(0, "ignored"));

		expect(applied).toEqual([thinking, toolCall]);
		expect(batches).toEqual([[thinking, toolCall]]);
	});
});
