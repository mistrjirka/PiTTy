import type { RequestModelSnapshot } from "./request-metrics.ts";

export const REQUEST_TIMING_VERSION: 2 = 2;

type RequestTimingVersion = typeof REQUEST_TIMING_VERSION;

export type RequestTiming = {
	timingVersion: RequestTimingVersion;
	provider?: string;
	modelId?: string;
	turnMs: number;
	modelToToolMs?: number;
	toolCallDurationsMs: number[];
	/** Number of tool calls started during the model call, even when per-call timing was incomplete. */
	toolCallCount?: number;
	/** Wall time covered by the union of tool execution intervals for this model call. */
	toolWallMs?: number;
};

export const MAX_REQUEST_TIMING_HISTORY = 1_000;

export type RequestTimingStats = {
	medianTurnMs: number;
	medianModelToToolMs?: number;
	/** Median model-call Turn duration per tool call, from samples with a positive call count. */
	medianTurnPerToolMs?: number;
};

type TimingTurn = {
	startedAt: number;
	messageStarted: boolean;
	messageEndedAt?: number;
	failed: boolean;
	modelToToolRecorded: boolean;
	modelToToolMs?: number;
	provider?: string;
	modelId?: string;
	activeTools: Map<string, number>;
	toolIntervals: TimingInterval[];
	toolCallCount: number;
	toolTimingIncomplete: boolean;
};

type TimingInterval = {
	startedAt: number;
	endedAt: number;
};

type ActiveRequestTiming = {
	turn?: TimingTurn;
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
	turn: TimingTurn,
	message: Record<string, unknown> | undefined,
	model: RequestModelSnapshot | undefined,
): void {
	if (!turn.provider) {
		const provider = stringField(message, "provider") ?? model?.provider?.trim();
		if (provider) turn.provider = provider;
	}
	if (!turn.modelId) {
		const modelId =
			stringField(message, "model") ??
			stringField(message, "responseModel") ??
			model?.id?.trim();
		if (modelId) turn.modelId = modelId;
	}
}

function validTimestamp(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

function createTurn(startedAt: number): TimingTurn {
	return {
		startedAt,
		messageStarted: false,
		failed: false,
		modelToToolRecorded: false,
		activeTools: new Map(),
		toolIntervals: [],
		toolCallCount: 0,
		toolTimingIncomplete: false,
	};
}

function ensureTurn(active: ActiveRequestTiming, startedAt: number): TimingTurn {
	if (!active.turn) active.turn = createTurn(startedAt);
	return active.turn;
}

function recordModelToTool(active: ActiveRequestTiming, at: number): void {
	const turn = active.turn;
	if (!turn || turn.modelToToolRecorded || at < turn.startedAt) return;
	turn.modelToToolRecorded = true;
	turn.modelToToolMs = at - turn.startedAt;
}

export class RequestTimingTracker {
	private active: ActiveRequestTiming | undefined;
	private completed: RequestTiming | undefined;

	private finishTurn(): RequestTiming | undefined {
		const turn = this.active?.turn;
		if (!turn || turn.messageEndedAt === undefined) return undefined;
		const endedAt = turn.messageEndedAt;
		const intervals = turn.toolTimingIncomplete ? [] : turn.toolIntervals;
		const turnMs = endedAt - turn.startedAt;
		if (turn.failed || turnMs <= 0 || turn.activeTools.size > 0) return undefined;
		const timing: RequestTiming = {
			timingVersion: REQUEST_TIMING_VERSION,
			turnMs,
			toolCallDurationsMs: intervals.map(
				(interval) => interval.endedAt - interval.startedAt,
			),
			toolCallCount: turn.toolCallCount,
			...(turn.provider ? { provider: turn.provider } : {}),
			...(turn.modelId ? { modelId: turn.modelId } : {}),
			...(turn.modelToToolMs !== undefined
				? { modelToToolMs: turn.modelToToolMs }
				: {}),
			...(intervals.length ? { toolWallMs: unionDuration(intervals) } : {}),
		};
		delete this.active!.turn;
		this.completed = timing;
		return timing;
	}

	handle(
		event: Record<string, unknown>,
		receivedAt: number,
		model?: RequestModelSnapshot,
	): RequestTiming | undefined {
		const record = isRecord(event) ? event : undefined;
		const type = stringField(record, "type");
		if (!type) return undefined;

		if (type === "agent_start") {
			this.active = {};
			return undefined;
		}

		const active = this.active;
		if (!active) return undefined;

		if (type === "turn_start") {
			const prior = this.finishTurn();
			if (active.turn) delete active.turn;
			active.turn = createTurn(receivedAt);
			return prior;
		}
		if (type === "message_start") {
			const message = messageFromEvent(record);
			if (stringField(message, "role") !== "assistant") return undefined;
			const turn = ensureTurn(active, receivedAt);
			if (turn.messageStarted) {
				delete active.turn;
				return undefined;
			}
			turn.messageStarted = true;
			turn.startedAt = validTimestamp(message?.timestamp) ?? receivedAt;
			updateModelIdentity(turn, message, model);
			return undefined;
		}
		if (type === "message_update") {
			const assistantEvent = assistantEventFromEvent(record);
			const deltaType = stringField(assistantEvent, "type");
			if (deltaType === "toolcall_start") recordModelToTool(active, receivedAt);
			return undefined;
		}
		if (type === "message_end") {
			const message = messageFromEvent(record);
			if (stringField(message, "role") !== "assistant") return undefined;
			const turn = ensureTurn(active, receivedAt);
			if (turn.messageEndedAt !== undefined) {
				delete active.turn;
				return undefined;
			}
			if (!turn.messageStarted) {
				turn.messageStarted = true;
				const timestamp = validTimestamp(message?.timestamp);
				if (timestamp !== undefined) turn.startedAt = timestamp;
			}
			updateModelIdentity(turn, message, model);
			turn.messageEndedAt = receivedAt;
			const stopReason = stringField(message, "stopReason");
			turn.failed = stopReason === "error" || stopReason === "aborted";
			return undefined;
		}
		if (type === "tool_execution_start") {
			const turn = active.turn;
			const toolCallId = stringField(record, "toolCallId");
			if (!turn || !toolCallId || turn.activeTools.has(toolCallId)) {
				if (turn) turn.toolTimingIncomplete = true;
				return undefined;
			}
			recordModelToTool(active, receivedAt);
			turn.activeTools.set(toolCallId, receivedAt);
			turn.toolCallCount += 1;
			return undefined;
		}
		if (type === "tool_execution_end") {
			const turn = active.turn;
			const toolCallId = stringField(record, "toolCallId");
			if (!turn || !toolCallId) {
				if (turn) turn.toolTimingIncomplete = true;
				return undefined;
			}
			const startedAt = turn.activeTools.get(toolCallId);
			if (startedAt === undefined) {
				turn.toolTimingIncomplete = true;
				return undefined;
			}
			turn.activeTools.delete(toolCallId);
			if (receivedAt >= startedAt)
				turn.toolIntervals.push({ startedAt, endedAt: receivedAt });
			else turn.toolTimingIncomplete = true;
			return undefined;
		}
		if (type === "turn_end") {
			const timing = this.finishTurn();
			if (active.turn) delete active.turn;
			return timing;
		}
		if (type === "agent_settled") {
			const timing = this.finishTurn();
			this.active = undefined;
			return timing;
		}
		return undefined;
	}

	get value(): RequestTiming | undefined {
		return this.completed;
	}
}

function isCurrentRequestTiming(value: unknown): value is RequestTiming {
	if (!isRecord(value)) return false;
	const toolDurations = value.toolCallDurationsMs;
	return (
		value.timingVersion === REQUEST_TIMING_VERSION &&
		validTimestamp(value.turnMs) !== undefined &&
		Array.isArray(toolDurations) &&
		toolDurations.every(
			(duration): duration is number =>
				typeof duration === "number" && Number.isFinite(duration) && duration >= 0,
		)
	);
}

/** Discards request-level samples produced before per-call Turn semantics. */
export function retainCurrentRequestTimings(
	history: readonly unknown[],
): RequestTiming[] {
	return history.filter(isCurrentRequestTiming);
}

export function requestTimingStats(
	history: readonly RequestTiming[],
	provider: string,
	modelId: string,
): RequestTimingStats | undefined {
	const normalizedProvider = provider.trim();
	const normalizedModelId = modelId.trim();
	if (!normalizedProvider || !normalizedModelId) return undefined;
	const samples = retainCurrentRequestTimings(history).filter(
		(sample) =>
			sample.provider === normalizedProvider &&
			sample.modelId === normalizedModelId,
	);
	if (!samples.length) return undefined;
	const modelToTool = samples.flatMap((sample) =>
		sample.modelToToolMs === undefined ? [] : [sample.modelToToolMs],
	);
	const turnPerTool = samples.flatMap((sample) => {
		const count = sample.toolCallCount;
		if (count === undefined || !Number.isInteger(count) || count <= 0) return []
		const value = sample.turnMs / count;
		return Number.isFinite(value) && value > 0 ? [value] : [];
	});
	const stats: RequestTimingStats = {
		medianTurnMs: median(samples.map((sample) => sample.turnMs))!,
	};
	const medianModelToToolMs = median(modelToTool);
	if (medianModelToToolMs !== undefined)
		stats.medianModelToToolMs = medianModelToToolMs;
	const medianTurnPerToolMs = median(turnPerTool);
	if (medianTurnPerToolMs !== undefined) stats.medianTurnPerToolMs = medianTurnPerToolMs;
	return stats;
}
