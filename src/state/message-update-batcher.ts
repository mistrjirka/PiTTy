import type { PiEvent } from "../types.ts";

export const MESSAGE_UPDATE_FLUSH_DELAY_MS = 33;
export const MAX_PENDING_MESSAGE_UPDATES = 512;

export type MessageUpdateTimerHandle = ReturnType<typeof setTimeout>;
export type MessageUpdateScheduler = (callback: () => void, delayMs: number) => MessageUpdateTimerHandle;
export type MessageUpdateCanceller = (handle: MessageUpdateTimerHandle) => void;

export type MessageUpdateBatcherOptions = {
	applyEvent: (event: PiEvent) => void;
	onBatchComplete?: (events: readonly PiEvent[]) => void;
	flushDelayMs?: number;
	schedule?: MessageUpdateScheduler;
	cancel?: MessageUpdateCanceller;
	maxPending?: number;
};

function eventType(event: PiEvent): string | undefined {
	if (!event || typeof event !== "object") return undefined;
	const type = (event as Record<string, unknown>).type;
	return typeof type === "string" ? type : undefined;
}

/** Buffers only adjacent message_update events; all other events are barriers. */
export class MessageUpdateBatcher {
	private readonly pending: PiEvent[] = [];
	private timer: MessageUpdateTimerHandle | undefined;
	private disposed = false;
	private generation = 0;
	private readonly applyEvent: (event: PiEvent) => void;
	private readonly onBatchComplete: (events: readonly PiEvent[]) => void;
	private readonly delayMs: number;
	private readonly schedule: MessageUpdateScheduler;
	private readonly cancel: MessageUpdateCanceller;
	private readonly maxPending: number;

	constructor(options: MessageUpdateBatcherOptions) {
		this.applyEvent = options.applyEvent;
		this.onBatchComplete = options.onBatchComplete ?? (() => undefined);
		this.delayMs = options.flushDelayMs ?? MESSAGE_UPDATE_FLUSH_DELAY_MS;
		this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
		this.cancel = options.cancel ?? ((handle) => clearTimeout(handle));
		this.maxPending = Math.max(1, options.maxPending ?? MAX_PENDING_MESSAGE_UPDATES);
	}

	handle(event: PiEvent): void {
		if (this.disposed) return;
		if (eventType(event) !== "message_update") {
			this.flush();
			this.applyEvent(event);
			return;
		}
		if (this.pending.length >= this.maxPending) this.flush();
		this.pending.push(event);
		if (this.timer === undefined) {
			const generation = ++this.generation;
			this.timer = this.schedule(() => {
				if (generation !== this.generation || this.disposed) return;
				this.timer = undefined;
				this.flushPending();
			}, this.delayMs);
		}
	}

	flush(): void {
		if (this.disposed) return;
		this.cancelTimer();
		this.flushPending();
	}

	dispose(): void {
		if (this.disposed) return;
		this.cancelTimer();
		this.flushPending();
		this.disposed = true;
		this.generation += 1;
	}

	private flushPending(): void {
		if (this.pending.length === 0) return;
		const events = this.pending.splice(0);
		for (const event of events) this.applyEvent(event);
		this.onBatchComplete(events);
	}

	private cancelTimer(): void {
		if (this.timer === undefined) return;
		this.cancel(this.timer);
		this.timer = undefined;
		this.generation += 1;
	}
}
