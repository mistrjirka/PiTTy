export type RequestPerformance = {
	provider?: string;
	modelId?: string;
	ttftMs: number;
	generationMs: number;
	outputTokens: number;
};

export type RequestModelSnapshot = {
	provider?: string | undefined;
	id?: string | undefined;
};

type ActiveRequest = {
	startedAt: number;
	firstOutputAt?: number;
	/** Arrival of the most recent output delta; ends the measured streaming window. */
	lastOutputAt?: number;
	/** Number of output deltas that arrived at distinct milliseconds. */
	outputArrivals: number;
	provider?: string;
	modelId?: string;
};

// Throughput is only meaningful for a response that really streamed. Providers that
// buffer a reply and flush it at once (or a UI stall that delivers many events in one
// tick) collapse the window to ~0 ms and yield absurd tok/s, so those are not sampled.
const MIN_GENERATION_MS = 1_000;
const MIN_OUTPUT_ARRIVALS = 8;

const OUTPUT_DELTA_TYPES: ReadonlySet<string> = new Set([
	"text_delta",
	"thinking_delta",
	"reasoning_delta",
	"toolcall_start",
	"toolcall_delta",
	"toolcall_end",
]);

import type { PiEvent } from "../types.ts";

export type PerformanceEvent = {
	type: string;
	message?: {
		role?: string;
		timestamp?: number;
		provider?: string;
		model?: string;
		responseModel?: string;
		stopReason?: string;
		usage?: { output?: number };
	};
	assistantMessageEvent?: { type?: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export class RequestPerformanceTracker {
	private active: ActiveRequest | undefined;
	private completed: RequestPerformance | undefined;

	handle(
		event: PerformanceEvent | PiEvent,
		receivedAt: number,
		model?: RequestModelSnapshot,
	): RequestPerformance | undefined {
		const message =
			"message" in event && isRecord(event.message) ? event.message : undefined;
		const assistantEvent =
			"assistantMessageEvent" in event && isRecord(event.assistantMessageEvent)
				? event.assistantMessageEvent
				: undefined;
		if (event.type === "message_start") {
			if (message?.role !== "assistant") return undefined;
			if (this.active) {
				// Pi normally serializes model calls. If two starts overlap, discard
				// both rather than attributing the second completion to the first call.
				this.active = undefined;
				return undefined;
			}
			const timestamp = message.timestamp;
			const provider =
				typeof message.provider === "string" && message.provider.trim()
					? message.provider.trim()
					: model?.provider?.trim();
			// The selected request model is the selector key; responseModel is a
			// provider fallback for event variants that omit the requested model.
			const modelId =
				typeof message.model === "string" && message.model.trim()
					? message.model.trim()
					: typeof message.responseModel === "string" &&
							message.responseModel.trim()
						? message.responseModel.trim()
						: model?.id?.trim();
			this.active = {
				startedAt:
					typeof timestamp === "number" && timestamp > 0
						? timestamp
						: receivedAt,
				outputArrivals: 0,
				...(provider && modelId ? { provider, modelId } : {}),
			};
			return undefined;
		}
		if (event.type === "message_update" && this.active) {
			const deltaType = assistantEvent?.type;
			if (typeof deltaType === "string" && OUTPUT_DELTA_TYPES.has(deltaType)) {
				const active = this.active;
				if (active.firstOutputAt === undefined) {
					active.firstOutputAt = receivedAt;
					active.lastOutputAt = receivedAt;
					active.outputArrivals = 1;
				} else if (active.lastOutputAt === undefined || receivedAt > active.lastOutputAt) {
					active.lastOutputAt = receivedAt;
					active.outputArrivals += 1;
				}
			}
			return undefined;
		}
		if (
			event.type !== "message_end" ||
			!this.active ||
			message?.role !== "assistant"
		)
			return undefined;
		const usage = isRecord(message.usage) ? message.usage : undefined;
		const outputTokens = usage?.output;
		const firstOutputAt = this.active.firstOutputAt;
		// End the window at the last streamed delta rather than at message_end, which
		// also waits for the final usage frame and for the UI to get to the event.
		const lastOutputAt = this.active.lastOutputAt;
		const stopReason = message.stopReason;
		const completedNormally =
			stopReason === "stop" ||
			stopReason === "toolUse" ||
			stopReason === "length";
		let performance: RequestPerformance | undefined;
		if (
			completedNormally &&
			firstOutputAt !== undefined &&
			lastOutputAt !== undefined &&
			firstOutputAt >= this.active.startedAt &&
			lastOutputAt - firstOutputAt >= MIN_GENERATION_MS &&
			this.active.outputArrivals >= MIN_OUTPUT_ARRIVALS &&
			typeof outputTokens === "number" &&
			outputTokens > 0
		) {
			performance = {
				...(this.active.provider && this.active.modelId
					? { provider: this.active.provider, modelId: this.active.modelId }
					: {}),
				ttftMs: firstOutputAt - this.active.startedAt,
				generationMs: lastOutputAt - firstOutputAt,
				outputTokens,
			};
			this.completed = performance;
		}
		this.active = undefined;
		return performance;
	}

	get value(): RequestPerformance | undefined {
		return this.completed;
	}
}
