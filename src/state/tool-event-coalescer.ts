import type { PiEvent } from "../types.ts";

export const TOOL_UPDATE_FLUSH_DELAY_MS = 250;
export const MAX_PENDING_TOOL_UPDATES = 512;

export type ToolEventTimerHandle = ReturnType<typeof setTimeout>;
export type ToolEventApply = (event: PiEvent) => void;
export type ToolEventScheduler = (
	callback: () => void,
	delayMs: number,
) => ToolEventTimerHandle;
export type ToolEventCanceller = (handle: ToolEventTimerHandle) => void;

export type ToolEventCoalescerOptions = {
	applyEvent: ToolEventApply;
	flushDelayMs?: number;
	schedule?: ToolEventScheduler;
	cancel?: ToolEventCanceller;
};

function eventRecord(event: PiEvent): Record<string, unknown> {
	return event && typeof event === "object" ? event : {};
}

function toolCallId(event: PiEvent): string | undefined {
	const value = eventRecord(event).toolCallId;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isEventType(event: PiEvent, type: string): boolean {
	return eventRecord(event).type === type;
}

function isLifecycleBoundary(event: PiEvent): boolean {
	const type = eventRecord(event).type;
	return (
		type === "tool_execution_start" ||
		type === "agent_start" ||
		type === "agent_settled" ||
		type === "agent_end" ||
		type === "compaction_start" ||
		type === "compaction_end" ||
		type === "auto_retry_start" ||
		type === "auto_retry_end"
	);
}

export class ToolEventCoalescer {
	private readonly pending = new Map<string, PiEvent>();
	private scheduledTimer: ToolEventTimerHandle | undefined;
	private readonly applyEvent: ToolEventApply;
	private readonly flushDelayMs: number;
	private readonly schedule: ToolEventScheduler;
	private readonly cancel: ToolEventCanceller;

	constructor(options: ToolEventCoalescerOptions) {
		this.applyEvent = options.applyEvent;
		this.flushDelayMs = options.flushDelayMs ?? TOOL_UPDATE_FLUSH_DELAY_MS;
		this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
		this.cancel = options.cancel ?? ((handle) => clearTimeout(handle));
	}

	handle(event: PiEvent): void {
		if (isEventType(event, "tool_execution_update")) {
			const id = toolCallId(event);
			if (!id) {
				this.flushPending();
				this.applyEvent(event);
				return;
			}
			if (!this.pending.has(id) && this.pending.size >= MAX_PENDING_TOOL_UPDATES)
				this.flushPending();
			this.pending.set(id, event);
			this.scheduleFlush();
			return;
		}

		if (isEventType(event, "tool_execution_end")) {
			const id = toolCallId(event);
			if (id) this.pending.delete(id);
			this.flushPending();
			this.applyEvent(event);
			return;
		}

		if (isLifecycleBoundary(event)) this.flushPending();
		this.applyEvent(event);
	}

	/** Flush pending updates before lifecycle boundaries or teardown. */
	flush(): void {
		this.flushPending();
	}

	private scheduleFlush(): void {
		if (this.scheduledTimer !== undefined) return;
		this.scheduledTimer = this.schedule(() => {
			this.scheduledTimer = undefined;
			this.flushPending();
		}, this.flushDelayMs);
	}

	private flushPending(): void {
		if (this.pending.size === 0) {
			this.cancelScheduledTimer();
			return;
		}

		const events = [...this.pending.values()];
		this.pending.clear();
		this.cancelScheduledTimer();
		for (const event of events) this.applyEvent(event);
	}

	private cancelScheduledTimer(): void {
		if (this.scheduledTimer === undefined) return;
		this.cancel(this.scheduledTimer);
		this.scheduledTimer = undefined;
	}
}
