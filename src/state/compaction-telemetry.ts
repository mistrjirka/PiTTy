export const COMPACTION_STATUS_KEY = "pitty.compaction.v1";
export const SMART_COMPACT_PROGRESS_KEY = "smart-compact-progress";
export const COMPACTION_TELEMETRY_VERSION = 1;

const SMART_COMPACT_PROGRESS_VALUES = new Set([
	"Smart Compact 1/5 · Extract",
	"Smart Compact 5/5 · Apply",
]);

export function parseSmartCompactProgress(value: unknown): string | undefined {
	if (typeof value !== "string" || !SMART_COMPACT_PROGRESS_VALUES.has(value))
		return undefined;
	return value;
}

export type CompactionReason = "manual" | "threshold" | "overflow";
export type CompactionPhase = "preparing" | "complete" | "failed";

export type CompactionTelemetry = {
	version: 1;
	phase: CompactionPhase;
	attempt?: number;
	reason?: CompactionReason;
	tokensBefore?: number;
	estimatedTokensAfter?: number;
	contextWindow?: number;
	contextPercent?: number;
	summarizingContextMessages?: number;
	plannedRetainedContextMessages?: number;
	retainedContextMessages?: number;
	splitTurn?: boolean;
	startedAt?: number;
};

export type CompactionCompletion = {
	tokensBefore?: number;
	estimatedTokensAfter?: number;
	attempt?: number;
	retainedContextMessages?: number;
	/** Summary text Pi generated for the compacted context. */
	summary?: string;
	/** Wall-clock duration of the compaction attempt in milliseconds. */
	durationMs?: number;
	reason?: CompactionReason;
};

export type CompactionPreparation = {
	firstKeptEntryId?: string;
	messagesToSummarize?: unknown[];
	turnPrefixMessages?: unknown[];
	tokensBefore?: number;
	isSplitTurn?: boolean;
};

const WIRE_KEYS = new Set([
	"version",
	"phase",
	"reason",
	"tokensBefore",
	"estimatedTokensAfter",
	"contextWindow",
	"contextPercent",
	"summarizingContextMessages",
	"plannedRetainedContextMessages",
	"retainedContextMessages",
	"splitTurn",
	"startedAt",
	"attempt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
	return isFiniteNonNegative(value) && Number.isInteger(value);
}

export function isCompactionReason(value: unknown): value is CompactionReason {
	return value === "manual" || value === "threshold" || value === "overflow";
}

export function parseCompactionTelemetry(
	serialized: string,
): CompactionTelemetry | undefined {
	let value: unknown;
	try {
		value = JSON.parse(serialized) as unknown;
	} catch {
		return undefined;
	}
	if (!isRecord(value) || value.version !== COMPACTION_TELEMETRY_VERSION)
		return undefined;
	if (Object.keys(value).some((key) => !WIRE_KEYS.has(key))) return undefined;
	if (
		value.phase !== "preparing" &&
		value.phase !== "complete" &&
		value.phase !== "failed"
	)
		return undefined;
	if (value.reason !== undefined && !isCompactionReason(value.reason))
		return undefined;
	if (value.splitTurn !== undefined && typeof value.splitTurn !== "boolean")
		return undefined;

	for (const key of [
		"tokensBefore",
		"estimatedTokensAfter",
		"contextWindow",
	] as const) {
		if (value[key] !== undefined && !isFiniteNonNegative(value[key]))
			return undefined;
	}
	for (const key of [
		"summarizingContextMessages",
		"plannedRetainedContextMessages",
		"retainedContextMessages",
		"startedAt",
		"attempt",
	] as const) {
		if (value[key] !== undefined && !isFiniteNonNegativeInteger(value[key]))
			return undefined;
	}
	if (
		value.contextPercent !== undefined &&
		(!isFiniteNonNegative(value.contextPercent) || value.contextPercent > 100)
	)
		return undefined;

	return {
		version: 1,
		phase: value.phase,
		...(isCompactionReason(value.reason) ? { reason: value.reason } : {}),
		...(isFiniteNonNegative(value.tokensBefore)
			? { tokensBefore: value.tokensBefore }
			: {}),
		...(isFiniteNonNegative(value.estimatedTokensAfter)
			? { estimatedTokensAfter: value.estimatedTokensAfter }
			: {}),
		...(isFiniteNonNegative(value.contextWindow)
			? { contextWindow: value.contextWindow }
			: {}),
		...(isFiniteNonNegative(value.contextPercent)
			? { contextPercent: value.contextPercent }
			: {}),
		...(isFiniteNonNegativeInteger(value.summarizingContextMessages)
			? { summarizingContextMessages: value.summarizingContextMessages }
			: {}),
		...(isFiniteNonNegativeInteger(value.plannedRetainedContextMessages)
			? {
					plannedRetainedContextMessages:
						value.plannedRetainedContextMessages,
				}
			: {}),
		...(isFiniteNonNegativeInteger(value.retainedContextMessages)
			? { retainedContextMessages: value.retainedContextMessages }
			: {}),
		...(typeof value.splitTurn === "boolean"
			? { splitTurn: value.splitTurn }
			: {}),
		...(isFiniteNonNegativeInteger(value.startedAt)
			? { startedAt: value.startedAt }
			: {}),
		...(isFiniteNonNegativeInteger(value.attempt)
			? { attempt: value.attempt }
			: {}),
	};
}

export function countRetainedContextMessages(
	branchEntries: unknown[],
	firstKeptEntryId: string | undefined,
): number | undefined {
	if (firstKeptEntryId === undefined) return undefined;
	const index = branchEntries.findIndex(
		(entry) => isRecord(entry) && entry.id === firstKeptEntryId,
	);
	if (index < 0) return undefined;
	return branchEntries
		.slice(index)
		.filter((entry) => isRecord(entry) && entry.type === "message").length;
}

export function countCompactionMessages(
	preparation: CompactionPreparation,
	branchEntries: unknown[],
): Pick<
	CompactionTelemetry,
	"summarizingContextMessages" | "plannedRetainedContextMessages"
> {
	const historyCount = Array.isArray(preparation.messagesToSummarize)
		? preparation.messagesToSummarize.length
		: undefined;
	const prefixCount = Array.isArray(preparation.turnPrefixMessages)
		? preparation.turnPrefixMessages.length
		: undefined;
	const summarized =
		historyCount === undefined && prefixCount === undefined
			? undefined
			: (historyCount ?? 0) + (prefixCount ?? 0);
	const retained = countRetainedContextMessages(
		branchEntries,
		preparation.firstKeptEntryId,
	);
	return {
		...(summarized === undefined
			? {}
			: { summarizingContextMessages: summarized }),
		...(retained === undefined
			? {}
			: { plannedRetainedContextMessages: retained }),
	};
}

export function compactTokenCount(value: number): string {
	if (value >= 1_000_000) {
		const millions = value / 1_000_000;
		return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`;
	}
	if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
	return String(Math.round(value));
}

export function compactionCompletionFromResult(
	result: unknown,
	retainedContextMessages?: number,
	attempt?: number,
): CompactionCompletion {
	const record = isRecord(result) ? result : undefined;
	const retained = isFiniteNonNegativeInteger(retainedContextMessages)
		? retainedContextMessages
		: isFiniteNonNegativeInteger(record?.retainedContextMessages)
			? record.retainedContextMessages
			: undefined;
	const completionAttempt = isFiniteNonNegativeInteger(attempt)
		? attempt
		: isFiniteNonNegativeInteger(record?.attempt)
			? record.attempt
			: undefined;
	const completion: CompactionCompletion = {
		...(isFiniteNonNegative(record?.tokensBefore)
			? { tokensBefore: record.tokensBefore }
			: {}),
		...(isFiniteNonNegative(record?.estimatedTokensAfter)
			? { estimatedTokensAfter: record.estimatedTokensAfter }
			: {}),
		...(record?.summary !== undefined &&
		typeof record.summary === "string" &&
		record.summary.trim()
			? { summary: record.summary.trim() }
			: {}),
		...(retained === undefined
			? {}
			: { retainedContextMessages: retained }),
		...(completionAttempt === undefined
			? {}
			: { attempt: completionAttempt }),
	};
	return completion;
}

export function compactionSuccessText(
	result: unknown,
	retainedContextMessages?: number,
): string {
	const completion = compactionCompletionFromResult(
		result,
		retainedContextMessages,
	);
	const details: string[] = [];
	if (
		completion.tokensBefore !== undefined &&
		completion.estimatedTokensAfter !== undefined
	) {
		details.push(
			`${compactTokenCount(completion.tokensBefore)} → ~${compactTokenCount(completion.estimatedTokensAfter)} tokens`,
		);
	}
	if (completion.retainedContextMessages !== undefined) {
		details.push(
			`kept ${completion.retainedContextMessages} recent context messages`,
		);
	}
	return details.length > 0
		? `Context compacted (${details.join(" · ")}).`
		: "Context compacted.";
}

export function compactionSummaryCaption(completion: CompactionCompletion): string {
	const parts: string[] = [];
	if (
		completion.tokensBefore !== undefined &&
		completion.estimatedTokensAfter !== undefined
	) {
		parts.push(
			`${compactTokenCount(completion.tokensBefore)} → ~${compactTokenCount(completion.estimatedTokensAfter)}`,
		);
	} else if (completion.tokensBefore !== undefined) {
		parts.push(compactTokenCount(completion.tokensBefore));
	}
	if (completion.reason) parts.push(completion.reason);
	if (completion.durationMs !== undefined)
		parts.push(formatCompactionDuration(completion.durationMs));
	if (completion.retainedContextMessages !== undefined)
		parts.push(`kept ${completion.retainedContextMessages} messages`);
	return parts.join(" · ");
}

export function formatCompactionDuration(milliseconds: number): string {
	if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
	if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
	return `${(milliseconds / 1000).toFixed(1)}s`;
}
