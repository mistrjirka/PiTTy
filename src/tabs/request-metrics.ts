export type RequestPerformance = {
	ttftMs: number;
	generationMs: number;
	outputTokens: number;
};

type ActiveRequest = { startedAt: number; firstOutputAt?: number };

import type { PiEvent } from "../types.ts";

export type PerformanceEvent = {
	type: string;
	message?: { role?: string; timestamp?: number; stopReason?: string; usage?: { output?: number } };
	assistantMessageEvent?: { type?: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export class RequestPerformanceTracker {
	private active: ActiveRequest | undefined;
	private completed: RequestPerformance | undefined;

	handle(event: PerformanceEvent | PiEvent, receivedAt: number): RequestPerformance | undefined {
		const message = "message" in event && isRecord(event.message) ? event.message : undefined;
		const assistantEvent = "assistantMessageEvent" in event && isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : undefined;
		if (event.type === "message_start") {
			if (message?.role !== "assistant") return this.completed;
			if (this.active) {
				// Pi normally serializes model calls. If two starts overlap, discard
				// both rather than attributing the second completion to the first call.
				this.active = undefined;
				return this.completed;
			}
			const timestamp = message.timestamp;
			this.active = { startedAt: typeof timestamp === "number" && timestamp > 0 ? timestamp : receivedAt };
			return this.completed;
		}
		if (event.type === "message_update" && this.active && !this.active.firstOutputAt) {
			const deltaType = assistantEvent?.type;
			if (deltaType === "text_delta" || deltaType === "thinking_delta") this.active.firstOutputAt = receivedAt;
			return this.completed;
		}
		if (event.type !== "message_end" || !this.active || message?.role !== "assistant") return this.completed;
		const endedAt = receivedAt;
		const usage = isRecord(message.usage) ? message.usage : undefined;
		const outputTokens = usage?.output;
		const firstOutputAt = this.active.firstOutputAt;
		const stopReason = message.stopReason;
		const completedNormally = stopReason === "stop" || stopReason === "toolUse" || stopReason === "length";
		if (completedNormally && firstOutputAt !== undefined && firstOutputAt >= this.active.startedAt && endedAt > firstOutputAt && typeof outputTokens === "number" && outputTokens > 0) {
			this.completed = { ttftMs: firstOutputAt - this.active.startedAt, generationMs: endedAt - firstOutputAt, outputTokens };
		}
		this.active = undefined;
		return this.completed;
	}

	get value(): RequestPerformance | undefined { return this.completed; }
}
