import type { RequestModelSnapshot } from "./request-metrics.ts";

export type RequestTiming = {
	provider?: string;
	modelId?: string;
	requestMs: number;
	modelToToolMs?: number;
	toolCallDurationsMs: number[];
	/** Number of tool calls started during the request, even when per-call timing was incomplete. */
	toolCallCount?: number;
	toolWallMs?: number;
};

export const MAX_REQUEST_TIMING_HISTORY = 1_000;

export type RequestTimingStats = {
	medianRequestMs: number;
	medianModelToToolMs?: number;
	medianToolCallMs?: number;
};

type TimingTurn = {
	startedAt: number;
	modelToToolRecorded: boolean;
};

type TimingInterval = {
	startedAt: number;
	endedAt: number;
};

type ActiveRequestTiming = {
	startedAt: number;
	provider?: string;
	modelId?: string;
	turn?: TimingTurn;
	modelToToolMs?: number;
	activeTools: Map<string, number>;
	toolIntervals: TimingInterval[];
	toolCallCount: number;
	toolTimingIncomplete: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringField(
	record: Record<string, unknown> | undefined,
	field: string,
): string | undefined {
	const value = record?.[field];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function median(values: readonly number[]): number | undefined {
	if (!values.length) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function unionDuration(intervals: readonly TimingInterval[]): number {
	if (!intervals.length) return 0;
	const sorted = [...intervals].sort((a, b) => a.startedAt - b.startedAt);
	let total = 0;
	let start = sorted[0]!.startedAt;
	let end = sorted[0]!.endedAt;
	for (const interval of sorted.slice(1)) {
		if (interval.startedAt > end) {
			total += end - start;
			start = interval.startedAt;
			end = interval.endedAt;
		} else {
			end = Math.max(end, interval.endedAt);
		}
	}
	return total + end - start;
}

function messageFromEvent(
	event: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	const message = event?.message;
	return isRecord(message) ? message : undefined;
}

function assistantEventFromEvent(
	event: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	const assistantEvent = event?.assistantMessageEvent;
	return isRecord(assistantEvent) ? assistantEvent : undefined;
}

function updateModelIdentity(
	active: ActiveRequestTiming,
	message: Record<string, unknown> | undefined,
	model: RequestModelSnapshot | undefined,
): void {
	if (!active.provider) {
		const provider = stringField(message, "provider") ?? model?.provider?.trim();
		if (provider) active.provider = provider;
	}
	if (!active.modelId) {
		const modelId =
			stringField(message, "model") ??
			stringField(message, "responseModel") ??
			model?.id?.trim();
		if (modelId) active.modelId = modelId;
	}
}

function ensureTurn(active: ActiveRequestTiming, startedAt: number): TimingTurn {
	if (!active.turn) active.turn = { startedAt, modelToToolRecorded: false };
	return active.turn;
}

function recordModelToTool(active: ActiveRequestTiming, at: number): void {
	const turn = active.turn;
	if (!turn || turn.modelToToolRecorded || at < turn.startedAt) return;
	active.modelToToolMs = (active.modelToToolMs ?? 0) + at - turn.startedAt;
	turn.modelToToolRecorded = true;
}

export class RequestTimingTracker {
	private active: ActiveRequestTiming | undefined;
	private completed: RequestTiming | undefined;

	handle(
		event: Record<string, unknown>,
		receivedAt: number,
		model?: RequestModelSnapshot,
	): RequestTiming | undefined {
		const record = isRecord(event) ? event : undefined;
		const type = stringField(record, "type");
		if (!type) return undefined;

		if (type === "agent_start") {
			if (this.active) {
				this.active = undefined;
				return undefined;
			}
			this.active = {
				startedAt: receivedAt,
				...(model?.provider?.trim() ? { provider: model.provider.trim() } : {}),
				...(model?.id?.trim() ? { modelId: model.id.trim() } : {}),
				activeTools: new Map(),
				toolIntervals: [],
				toolCallCount: 0,
				toolTimingIncomplete: false,
			};
			return undefined;
		}

		const active = this.active;
		if (!active) return undefined;

		if (type === "turn_start") {
			active.turn = { startedAt: receivedAt, modelToToolRecorded: false };
			return undefined;
		}
		if (type === "turn_end") {
			delete active.turn;
			return undefined;
		}
		if (type === "message_start") {
			const message = messageFromEvent(record);
			if (stringField(message, "role") === "assistant") {
				updateModelIdentity(active, message, model);
				ensureTurn(active, receivedAt);
			}
			return undefined;
		}
		if (type === "message_update") {
			const assistantEvent = assistantEventFromEvent(record);
			const deltaType = stringField(assistantEvent, "type");
			if (deltaType === "toolcall_start") recordModelToTool(active, receivedAt);
			return undefined;
		}
		if (type === "tool_execution_start") {
			const toolCallId = stringField(record, "toolCallId");
			if (!toolCallId || active.activeTools.has(toolCallId)) {
				active.toolTimingIncomplete = true;
				return undefined;
			}
			recordModelToTool(active, receivedAt);
			active.activeTools.set(toolCallId, receivedAt);
			active.toolCallCount += 1;
			return undefined;
		}
		if (type === "tool_execution_end") {
			const toolCallId = stringField(record, "toolCallId");
			if (!toolCallId) {
				active.toolTimingIncomplete = true;
				return undefined;
			}
			const startedAt = active.activeTools.get(toolCallId);
			if (startedAt === undefined) {
				active.toolTimingIncomplete = true;
				return undefined;
			}
			active.activeTools.delete(toolCallId);
			if (receivedAt >= startedAt)
				active.toolIntervals.push({ startedAt, endedAt: receivedAt });
			else active.toolTimingIncomplete = true;
			return undefined;
		}
		if (type !== "agent_settled") return undefined;

		const endedAt = receivedAt;
		const intervals = active.toolTimingIncomplete ? [] : active.toolIntervals;
		const timing =
			endedAt > active.startedAt && active.activeTools.size === 0
				? {
						requestMs: endedAt - active.startedAt,
						toolCallDurationsMs: intervals.map(
							(interval) => interval.endedAt - interval.startedAt,
						),
						toolCallCount: active.toolCallCount,
						...(active.provider ? { provider: active.provider } : {}),
						...(active.modelId ? { modelId: active.modelId } : {}),
						...(active.modelToToolMs !== undefined
							? { modelToToolMs: active.modelToToolMs }
							: {}),
						...(intervals.length
							? { toolWallMs: unionDuration(intervals) }
							: {}),
				  }
				: undefined;
		this.active = undefined;
		if (timing) this.completed = timing;
		return timing;
	}

	get value(): RequestTiming | undefined {
		return this.completed;
	}
}

export function requestTimingStats(
	history: readonly RequestTiming[],
	provider: string,
	modelId: string,
): RequestTimingStats | undefined {
	const normalizedProvider = provider.trim();
	const normalizedModelId = modelId.trim();
	if (!normalizedProvider || !normalizedModelId) return undefined;
	const samples = history.filter(
		(sample) =>
			sample.provider === normalizedProvider &&
			sample.modelId === normalizedModelId,
	);
	if (!samples.length) return undefined;
	const modelToTool = samples.flatMap((sample) =>
		sample.modelToToolMs === undefined ? [] : [sample.modelToToolMs],
	);
	// Per turn, the tool metric is the turn's share per tool call (turn time divided
	// by how many tools ran in that turn), then the median across turns. Turns
	// without tool calls contribute nothing. The turn span already includes TTFT,
	// so the share reflects prompt processing too without double-counting it.
	const toolShares = samples.flatMap((sample) => {
		const toolCallCount = sample.toolCallCount ?? sample.toolCallDurationsMs.length;
		return toolCallCount >= 1 ? [sample.requestMs / toolCallCount] : [];
	});
	const stats: RequestTimingStats = {
		medianRequestMs: median(samples.map((sample) => sample.requestMs))!,
	};
	const medianModelToToolMs = median(modelToTool);
	if (medianModelToToolMs !== undefined)
		stats.medianModelToToolMs = medianModelToToolMs;
	const medianToolCallMs = median(toolShares);
	if (medianToolCallMs !== undefined) stats.medianToolCallMs = medianToolCallMs;
	return stats;
}
