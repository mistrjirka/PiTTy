import { describe, expect, test } from "bun:test";
import type { PiEvent } from "../src/types.ts";
import {
	ToolEventCoalescer,
	TOOL_UPDATE_FLUSH_DELAY_MS,
	MAX_PENDING_TOOL_UPDATES,
	type ToolEventCanceller,
	type ToolEventScheduler,
	type ToolEventTimerHandle,
} from "../src/state/tool-event-coalescer.ts";

const update = (toolCallId: string, output: string): PiEvent => ({
	type: "tool_execution_update",
	toolCallId,
	toolName: "bash",
	args: { command: "test" },
	partialResult: { content: [{ type: "text", text: output }] },
});

const end = (toolCallId: string, output: string, isError = false): PiEvent => ({
	type: "tool_execution_end",
	toolCallId,
	toolName: "bash",
	result: { content: [{ type: "text", text: output }] },
	isError,
});

const updateWithoutId = (output: string): PiEvent => ({
	type: "tool_execution_update",
	partialResult: { content: [{ type: "text", text: output }] },
});

type Harness = {
	coalescer: ToolEventCoalescer;
	flushScheduled: () => void;
	cancelled: number;
	scheduledDelay: number | undefined;
};

function harness(applied: PiEvent[] = []): Harness & { advance: (ms: number) => void } {
	let scheduled: (() => void) | undefined;
	let timer: ToolEventTimerHandle | undefined;
	let now = 0;
	let dueAt: number | undefined;
	let cancelled = 0;
	let scheduledDelay: number | undefined;
	const schedule: ToolEventScheduler = (callback, delayMs) => {
		scheduled = callback;
		dueAt = now + delayMs;
		scheduledDelay = delayMs;
		timer = setTimeout(() => undefined, 10_000);
		return timer;
	};
	const cancel: ToolEventCanceller = (handle) => {
		cancelled += 1;
		clearTimeout(handle);
		dueAt = undefined;
	};
	const runScheduled = (): void => {
		const callback = scheduled;
		scheduled = undefined;
		dueAt = undefined;
		callback?.();
	};
	return {
		coalescer: new ToolEventCoalescer({
			applyEvent: (event) => applied.push(event),
			schedule,
			cancel,
		}),
		flushScheduled: runScheduled,
		advance: (ms) => {
			now += ms;
			if (dueAt !== undefined && now >= dueAt) runScheduled();
		},
		get cancelled() {
			return cancelled;
		},
		get scheduledDelay() {
			return scheduledDelay;
		},
	};
}

describe("ToolEventCoalescer", () => {
	test("keeps only the newest update for each tool call until the bounded flush", () => {
		const applied: PiEvent[] = [];
		const coalescingHarness = harness(applied);

		coalescingHarness.coalescer.handle(update("one", "first"));
		coalescingHarness.coalescer.handle(update("one", "latest"));
		coalescingHarness.coalescer.handle(update("two", "other"));

		expect(applied).toEqual([]);
		expect(coalescingHarness.scheduledDelay).toBe(TOOL_UPDATE_FLUSH_DELAY_MS);
		coalescingHarness.flushScheduled();
		expect(applied).toEqual([update("one", "latest"), update("two", "other")]);
	});

	test("reduces a 100ms Bash update stream to the newest snapshot per flush", () => {
		const applied: PiEvent[] = [];
		const coalescingHarness = harness(applied);

		for (let index = 1; index <= 20; index++) {
			coalescingHarness.coalescer.handle(update("bash", `line-${index}`));
			coalescingHarness.advance(100);
		}
		coalescingHarness.advance(250);

		expect(coalescingHarness.scheduledDelay).toBe(250);
		expect(applied.length).toBeGreaterThanOrEqual(7);
		expect(applied.length).toBeLessThan(20);
		expect(applied.at(-1)).toEqual(update("bash", "line-20"));
	});

	test("applies an end immediately and drops its queued update", () => {
		const applied: PiEvent[] = [];
		const { coalescer, flushScheduled } = harness(applied);

		coalescer.handle(update("one", "intermediate"));
		coalescer.handle(end("one", "final"));

		expect(applied).toEqual([end("one", "final")]);
		flushScheduled();
		expect(applied).toEqual([end("one", "final")]);
	});

	test("applies final failures immediately without stale updates", () => {
		const applied: PiEvent[] = [];
		const { coalescer, flushScheduled } = harness(applied);

		coalescer.handle(update("one", "intermediate"));
		coalescer.handle(end("one", "failed", true));
		flushScheduled();

		expect(applied).toEqual([end("one", "failed", true)]);
	});

	test("does not flush pending updates for unrelated events", () => {
		const applied: PiEvent[] = [];
		const pendingHarness = harness(applied);
		const extensionEvent: PiEvent = { type: "extension_ui_request", id: "request" };

		pendingHarness.coalescer.handle(update("one", "pending"));
		pendingHarness.coalescer.handle(extensionEvent);

		expect(applied).toEqual([extensionEvent]);
		expect(pendingHarness.cancelled).toBe(0);
		pendingHarness.flushScheduled();
		expect(applied).toEqual([extensionEvent, update("one", "pending")]);
	});

	test("flushes pending updates before lifecycle boundaries and clears the timer", () => {
		const applied: PiEvent[] = [];
		const pendingHarness = harness(applied);

		pendingHarness.coalescer.handle(update("one", "pending"));
		pendingHarness.coalescer.handle({ type: "agent_start" });

		expect(applied).toEqual([update("one", "pending"), { type: "agent_start" }]);
		expect(pendingHarness.cancelled).toBe(1);
		pendingHarness.flushScheduled();
		expect(applied).toHaveLength(2);
	});

	test("applies id-less updates immediately and flushes pending updates on cleanup", () => {
		const applied: PiEvent[] = [];
		const coalescingHarness = harness(applied);

		coalescingHarness.coalescer.handle(updateWithoutId("immediate"));
		expect(applied).toEqual([updateWithoutId("immediate")]);
		expect(coalescingHarness.scheduledDelay).toBeUndefined();

		coalescingHarness.coalescer.handle(update("one", "pending"));
		coalescingHarness.coalescer.flush();
		expect(applied).toEqual([
			updateWithoutId("immediate"),
			update("one", "pending"),
		]);
		expect(coalescingHarness.cancelled).toBe(1);
	});

	test("flushes before the distinct-tool pending limit is exceeded", () => {
		const applied: PiEvent[] = [];
		const coalescingHarness = harness(applied);

		for (let index = 0; index <= MAX_PENDING_TOOL_UPDATES; index++)
			coalescingHarness.coalescer.handle(update(`tool-${index}`, String(index)));

		expect(applied).toHaveLength(MAX_PENDING_TOOL_UPDATES);
		coalescingHarness.flushScheduled();
		expect(applied).toHaveLength(MAX_PENDING_TOOL_UPDATES + 1);
	});
});
