export const COMPACTION_STATUS_KEY = "pitty.compaction.v1";
export const ONE_ROUND_PROGRESS_KEY = "pi-one-round-compaction.progress.v1";
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
	/** One-round compaction plugin details (plugin: pi-one-round-compaction, version 2). */
	plugin?: "pi-one-round-compaction";
	/** Wall-clock duration of the one-round compaction in milliseconds. */
	wallTimeMs?: number;
	/** Boundary strategy the plugin used to keep recent turns verbatim. */
	boundaryMode?: "whole-turn" | "pi-fallback";
	/** Number of complete turns retained verbatim by the plugin. */
	retainedTurns?: number;
	/** Token budget for recent turns (compaction.keepRecentTokens). */
	keepRecentTokens?: number;
	/** Estimated tokens after compaction, including the plugin summary. */
	estimatedRetainedTokens?: number;
	/** Whether the plugin cut inside a turn (Pi fallback boundary). */
	isSplitTurn?: boolean;
	/** Per-lane summarization results (intent + execution). */
	lanes?: OneRoundLane[];
	/** Read-only / relevant files tracked by the plugin across compactions. */
	readFiles?: string[];
	/** Modified files tracked by the plugin across compactions. */
	modifiedFiles?: string[];
	/** Git state captured deterministically during compaction. */
	git?: OneRoundGit;
	/** Active intent-workflow ledger the plugin detected, if any. */
	intentWorkflow?: OneRoundIntentWorkflow;
};

export type OneRoundLane = {
	lane: "intent" | "execution";
	model: string;
	thinkingLevel: string;
	durationMs: number;
};

export type OneRoundGit = {
	root: string;
	branch: string;
	head: string;
	dirty: string[];
	truncated: boolean;
};

export type OneRoundIntentWorkflow = {
	active: boolean;
	workstream?: string;
	hasPlan?: boolean;
	intentTruncated?: boolean;
	planTruncated?: boolean;
};

/** Shape written by pi-one-round-compaction into CompactionResult.details (version 2). */
export type OneRoundDetails = {
	plugin: "pi-one-round-compaction";
	version: 2;
	lanes: OneRoundLane[];
	wallTimeMs: number;
	keepRecentTokens: number;
	boundaryMode: "whole-turn" | "pi-fallback";
	retainedTurns: number;
	estimatedRetainedTokens: number;
	isSplitTurn: boolean;
	readFiles: string[];
	modifiedFiles: string[];
	git?: OneRoundGit;
	intentWorkflow: OneRoundIntentWorkflow;
};

export type OneRoundLaneProgress = {
	role: "intent" | "execution" | "implementation" | "evidence";
	state: "queued" | "streaming" | "done" | "error";
	chars: number;
	delta?: string;
	elapsedMs?: number;
};

export type OneRoundProgress = {
	v: 1;
	runId: string;
	seq: number;
	phase: "preparing" | "streaming" | "merging" | "complete" | "error" | "aborted";
	mode: "normal" | "workflow";
	reason: "manual" | "threshold" | "overflow";
	elapsedMs: number;
	retainedTurns: number;
	estimatedRetainedTokens: number;
	keepRecentTokens: number;
	boundaryMode: "whole-turn" | "pi-fallback";
	intentWorkflow?: { active: true; workstream: string; hasPlan: boolean };
	lanes: { intent: OneRoundLaneProgress; execution: OneRoundLaneProgress };
	error?: string;
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
	const oneRound = parseOneRoundDetails(record?.details);
	if (oneRound) {
		completion.plugin = oneRound.plugin;
		completion.wallTimeMs = oneRound.wallTimeMs;
		completion.boundaryMode = oneRound.boundaryMode;
		completion.retainedTurns = oneRound.retainedTurns;
		completion.keepRecentTokens = oneRound.keepRecentTokens;
		completion.estimatedRetainedTokens = oneRound.estimatedRetainedTokens;
		completion.isSplitTurn = oneRound.isSplitTurn;
		completion.lanes = oneRound.lanes;
		completion.readFiles = oneRound.readFiles;
		completion.modifiedFiles = oneRound.modifiedFiles;
		if (oneRound.git) completion.git = oneRound.git;
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
	if (completion.plugin === "pi-one-round-compaction") {
		if (completion.lanes !== undefined && completion.lanes.length > 0) {
			parts.push(
				`${completion.lanes.length} parallel lanes${completion.wallTimeMs !== undefined ? ` · ${formatCompactionDuration(completion.wallTimeMs)}` : ""}`,
			);
		}
		if (completion.retainedTurns !== undefined) {
			parts.push(
				`kept ${completion.retainedTurns} complete turn${completion.retainedTurns === 1 ? "" : "s"}${completion.boundaryMode
					? ` · ${completion.boundaryMode === "whole-turn" ? "whole-turn boundary" : "split-turn fallback"}`
					: ""}`,
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

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const ONE_ROUND_PROGRESS_PHASES = [
	"preparing",
	"streaming",
	"merging",
	"complete",
	"error",
	"aborted",
] as const;
const ONE_ROUND_LANE_ROLES = ["intent", "execution", "implementation", "evidence"] as const;
const ONE_ROUND_LANE_STATES = ["queued", "streaming", "done", "error"] as const;

/**
 * Validates the pi-one-round-compaction details object (version 2) that the
 * plugin writes into CompactionResult.details. Returns undefined for anything
 * that is not produced by that plugin so foreign/older details stay hidden.
 */
export function parseOneRoundDetails(value: unknown): OneRoundDetails | undefined {
	if (!isRecord(value)) return undefined;
	if (value.plugin !== "pi-one-round-compaction" || value.version !== 2) return undefined;
	if (!Array.isArray(value.lanes) || value.lanes.length === 0) return undefined;
	const lanes: OneRoundLane[] = [];
	for (const raw of value.lanes) {
		if (!isRecord(raw)) return undefined;
		if (raw.lane !== "intent" && raw.lane !== "execution") return undefined;
		if (typeof raw.model !== "string" || typeof raw.thinkingLevel !== "string") return undefined;
		if (!isFiniteNonNegativeInteger(raw.durationMs)) return undefined;
		lanes.push({
			lane: raw.lane,
			model: raw.model,
			thinkingLevel: raw.thinkingLevel,
			durationMs: raw.durationMs,
		});
	}
	if (!isFiniteNonNegativeInteger(value.wallTimeMs)) return undefined;
	if (!isFiniteNonNegative(value.keepRecentTokens)) return undefined;
	if (value.boundaryMode !== "whole-turn" && value.boundaryMode !== "pi-fallback") return undefined;
	if (!isFiniteNonNegativeInteger(value.retainedTurns)) return undefined;
	if (!isFiniteNonNegative(value.estimatedRetainedTokens)) return undefined;
	if (typeof value.isSplitTurn !== "boolean") return undefined;
	if (!isStringArray(value.readFiles) || !isStringArray(value.modifiedFiles)) return undefined;
	let git: OneRoundGit | undefined;
	if (value.git !== undefined) {
		if (!isRecord(value.git)) return undefined;
		if (
			typeof value.git.root !== "string" ||
			typeof value.git.branch !== "string" ||
			typeof value.git.head !== "string" ||
			!isStringArray(value.git.dirty) ||
			typeof value.git.truncated !== "boolean"
		) {
			return undefined;
		}
		git = {
			root: value.git.root,
			branch: value.git.branch,
			head: value.git.head,
			dirty: value.git.dirty,
			truncated: value.git.truncated,
		};
	}
	if (!isRecord(value.intentWorkflow) || typeof value.intentWorkflow.active !== "boolean") {
		return undefined;
	}
	const intentWorkflow: OneRoundIntentWorkflow = { active: value.intentWorkflow.active };
	const workflow = value.intentWorkflow;
	if (workflow.active) {
		if (typeof workflow.workstream !== "string" || typeof workflow.hasPlan !== "boolean") {
			return undefined;
		}
		intentWorkflow.workstream = workflow.workstream;
		intentWorkflow.hasPlan = workflow.hasPlan;
	}
	if (workflow.intentTruncated !== undefined) {
		if (typeof workflow.intentTruncated !== "boolean") return undefined;
		intentWorkflow.intentTruncated = workflow.intentTruncated;
	}
	if (workflow.planTruncated !== undefined) {
		if (typeof workflow.planTruncated !== "boolean") return undefined;
		intentWorkflow.planTruncated = workflow.planTruncated;
	}
	return {
		plugin: "pi-one-round-compaction",
		version: 2,
		lanes,
		wallTimeMs: value.wallTimeMs,
		keepRecentTokens: value.keepRecentTokens,
		boundaryMode: value.boundaryMode,
		retainedTurns: value.retainedTurns,
		estimatedRetainedTokens: value.estimatedRetainedTokens,
		isSplitTurn: value.isSplitTurn,
		readFiles: value.readFiles,
		modifiedFiles: value.modifiedFiles,
		...(git ? { git } : {}),
		intentWorkflow,
	};
}

function parseOneRoundLaneProgress(value: unknown): OneRoundLaneProgress | undefined {
	if (!isRecord(value)) return undefined;
	if (
		typeof value.role !== "string" ||
		!(ONE_ROUND_LANE_ROLES as readonly string[]).includes(value.role)
	) {
		return undefined;
	}
	if (
		typeof value.state !== "string" ||
		!(ONE_ROUND_LANE_STATES as readonly string[]).includes(value.state)
	) {
		return undefined;
	}
	if (!isFiniteNonNegativeInteger(value.chars)) return undefined;
	if (value.delta !== undefined && typeof value.delta !== "string") return undefined;
	if (value.elapsedMs !== undefined && !isFiniteNonNegativeInteger(value.elapsedMs)) {
		return undefined;
	}
	return {
		role: value.role as OneRoundLaneProgress["role"],
		state: value.state as OneRoundLaneProgress["state"],
		chars: value.chars,
		...(typeof value.delta === "string" && value.delta ? { delta: value.delta } : {}),
		...(isFiniteNonNegativeInteger(value.elapsedMs)
			? { elapsedMs: value.elapsedMs }
			: {}),
	};
}

/**
 * Validates the pi-one-round-compaction live progress frames the plugin
 * publishes via ctx.ui.setStatus("pi-one-round-compaction.progress.v1", ...).
 */
export function parseOneRoundProgress(value: unknown): OneRoundProgress | undefined {
	if (!isRecord(value) || value.v !== 1) return undefined;
	if (typeof value.runId !== "string" || !value.runId) return undefined;
	if (!isFiniteNonNegativeInteger(value.seq)) return undefined;
	if (
		typeof value.phase !== "string" ||
		!(ONE_ROUND_PROGRESS_PHASES as readonly string[]).includes(value.phase)
	) {
		return undefined;
	}
	if (value.mode !== "normal" && value.mode !== "workflow") return undefined;
	if (!isCompactionReason(value.reason)) return undefined;
	if (!isFiniteNonNegative(value.elapsedMs)) return undefined;
	if (!isFiniteNonNegativeInteger(value.retainedTurns)) return undefined;
	if (!isFiniteNonNegative(value.estimatedRetainedTokens)) return undefined;
	if (!isFiniteNonNegative(value.keepRecentTokens)) return undefined;
	if (value.boundaryMode !== "whole-turn" && value.boundaryMode !== "pi-fallback") return undefined;
	let intentWorkflow: { active: true; workstream: string; hasPlan: boolean } | undefined;
	if (value.intentWorkflow !== undefined) {
		if (
			!isRecord(value.intentWorkflow) ||
			value.intentWorkflow.active !== true ||
			typeof value.intentWorkflow.workstream !== "string" ||
			typeof value.intentWorkflow.hasPlan !== "boolean"
		) {
			return undefined;
		}
		intentWorkflow = {
			active: true,
			workstream: value.intentWorkflow.workstream,
			hasPlan: value.intentWorkflow.hasPlan,
		};
	}
	const lanesRecord = isRecord(value.lanes) ? value.lanes : undefined;
	if (!lanesRecord) return undefined;
	const intent = parseOneRoundLaneProgress(lanesRecord.intent);
	const execution = parseOneRoundLaneProgress(lanesRecord.execution);
	if (!intent || !execution) return undefined;
	return {
		v: 1,
		runId: value.runId,
		seq: value.seq,
		phase: value.phase as OneRoundProgress["phase"],
		mode: value.mode,
		reason: value.reason,
		elapsedMs: value.elapsedMs,
		retainedTurns: value.retainedTurns,
		estimatedRetainedTokens: value.estimatedRetainedTokens,
		keepRecentTokens: value.keepRecentTokens,
		boundaryMode: value.boundaryMode,
		...(intentWorkflow ? { intentWorkflow } : {}),
		lanes: { intent, execution },
		...(typeof value.error === "string" ? { error: value.error } : {}),
	};
}
