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

type ActiveRequest = { startedAt: number; firstOutputAt?: number; provider?: string; modelId?: string };

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
				...(provider && modelId ? { provider, modelId } : {}),
			};
			return undefined;
		}
		if (event.type === "message_update" && this.active && !this.active.firstOutputAt) {
			const deltaType = assistantEvent?.type;
			if (
				deltaType === "text_delta" ||
				deltaType === "thinking_delta" ||
				deltaType === "reasoning_delta" ||
				deltaType === "toolcall_start" ||
				deltaType === "toolcall_delta" ||
				deltaType === "toolcall_end"
			)
				this.active.firstOutputAt = receivedAt;
			return undefined;
		}
		if (
			event.type !== "message_end" ||
			!this.active ||
			message?.role !== "assistant"
		)
			return undefined;
		const endedAt = receivedAt;
		const usage = isRecord(message.usage) ? message.usage : undefined;
		const outputTokens = usage?.output;
		const firstOutputAt = this.active.firstOutputAt;
		const stopReason = message.stopReason;
		const completedNormally =
			stopReason === "stop" ||
			stopReason === "toolUse" ||
			stopReason === "length";
		let performance: RequestPerformance | undefined;
		if (
			completedNormally &&
			firstOutputAt !== undefined &&
			firstOutputAt >= this.active.startedAt &&
			endedAt > firstOutputAt &&
			typeof outputTokens === "number" &&
			outputTokens > 0
		) {
			performance = {
				...(this.active.provider && this.active.modelId
					? { provider: this.active.provider, modelId: this.active.modelId }
					: {}),
				ttftMs: firstOutputAt - this.active.startedAt,
				generationMs: endedAt - firstOutputAt,
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
