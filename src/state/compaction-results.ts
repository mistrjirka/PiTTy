import {
	isCompactionReason,
	isFiniteNonNegative,
	isFiniteNonNegativeInteger,
	isRecord,
} from "./compaction-validation.ts";

export { isCompactionReason } from "./compaction-validation.ts";

/** Compaction telemetry wire schema and display projections | compaction-results. */

import type {
	CompactionCompletion,
	CompactionPreparation,
	CompactionReason,
	CompactionTelemetry,
} from "./compaction-model.ts";
import { COMPACTION_TELEMETRY_VERSION } from "./compaction-model.ts";

import { parseOneRoundDetails } from "./compaction-one-round-progress.ts";

export const WIRE_KEYS = new Set([
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

export function parseCompactionTelemetry(
	serialized: string,
): CompactionTelemetry | undefined {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
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
					plannedRetainedContextMessages: value.plannedRetainedContextMessages,
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
		return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, "")}M`;
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
		...(retained === undefined ? {} : { retainedContextMessages: retained }),
		...(completionAttempt === undefined ? {} : { attempt: completionAttempt }),
	};
	const oneRound = parseOneRoundDetails(record?.details);
	if (oneRound) {
		completion.plugin = oneRound.plugin;
		completion.wallTimeMs = oneRound.wallTimeMs;
		completion.boundaryMode = oneRound.boundaryMode;
		completion.retainedTurns = oneRound.retainedTurns;
		completion.keepRecentTokens = oneRound.keepRecentTokens;
		completion.estimatedRetainedTokens = oneRound.estimatedRetainedTokens;
		if (
			(oneRound.version === 4 || oneRound.version === 6) &&
			completion.estimatedTokensAfter === undefined
		) {
			completion.estimatedTokensAfter = oneRound.estimatedTokensAfter;
		}
		if (oneRound.version === 4 || oneRound.version === 6) {
			completion.targetPostCompactTokens = oneRound.targetPostCompactTokens;
			completion.effectiveRecentTokenBudget =
				oneRound.effectiveRecentTokenBudget;
			completion.targetExceeded = oneRound.targetExceeded;
		}
		if (oneRound.version === 6)
			completion.laneOutputBudgetTokens = oneRound.laneOutputBudgetTokens;
		completion.isSplitTurn = oneRound.isSplitTurn;
		completion.lanes = oneRound.lanes;
		completion.readFiles = oneRound.readFiles;
		completion.modifiedFiles = oneRound.modifiedFiles;
		if (oneRound.git) completion.git = oneRound.git;
		if (oneRound.version !== 6)
			completion.intentWorkflow = oneRound.intentWorkflow;
	}
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

export function compactionSummaryCaption(
	completion: CompactionCompletion,
): string {
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
	if (completion.plugin === "pi-one-round-compaction") {
		if (completion.lanes !== undefined && completion.lanes.length > 0) {
			parts.push(
				`${completion.lanes.length} parallel lanes${completion.wallTimeMs !== undefined ? ` · ${formatCompactionDuration(completion.wallTimeMs)}` : ""}`,
			);
		}
		if (completion.retainedTurns !== undefined) {
			parts.push(
				`kept ${completion.retainedTurns} complete turn${completion.retainedTurns === 1 ? "" : "s"}${
					completion.boundaryMode
						? ` · ${completion.boundaryMode === "whole-turn" ? "whole-turn boundary" : completion.boundaryMode === "split-turn" ? "split-turn boundary" : "Pi fallback boundary"}`
						: ""
				}`,
			);
		}
	} else if (completion.durationMs !== undefined) {
		parts.push(formatCompactionDuration(completion.durationMs));
	}
	if (completion.retainedContextMessages !== undefined)
		parts.push(`kept ${completion.retainedContextMessages} messages`);
	return parts.join(" · ");
}

export function formatCompactionDuration(milliseconds: number): string {
	if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
	if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
	return `${(milliseconds / 1000).toFixed(1)}s`;
}

export function compactionCompletionForItem(
	items: readonly { id: string; kind: string; text?: string }[],
	itemId: string,
	completion: CompactionCompletion | undefined,
): CompactionCompletion | undefined {
	if (completion === undefined) return undefined;
	let newestNoticeId: string | undefined;
	for (const item of items) {
		if (item.kind === "system" && item.text?.startsWith("Context compacted")) {
			newestNoticeId = item.id;
		}
	}
	return newestNoticeId === itemId ? completion : undefined;
}
