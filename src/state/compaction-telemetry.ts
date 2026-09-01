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
export type OneRoundBoundaryMode = "whole-turn" | "split-turn" | "pi-fallback";

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
	/** One-round compaction plugin details (plugin: pi-one-round-compaction, versions 2 and 4). */
	plugin?: "pi-one-round-compaction";
	/** Wall-clock duration of the one-round compaction in milliseconds. */
	wallTimeMs?: number;
	/** Boundary strategy the plugin used to keep recent turns verbatim. */
	boundaryMode?: OneRoundBoundaryMode;
	/** Number of complete turns retained verbatim by the plugin. */
	retainedTurns?: number;
	/** Token budget for recent turns (compaction.keepRecentTokens). */
	keepRecentTokens?: number;
	/** Estimated tokens after compaction, including the plugin summary. */
	estimatedRetainedTokens?: number;
	/** Whether the plugin cut inside a turn. */
	isSplitTurn?: boolean;
	/** Per-lane summarization results (intent + execution). */
	lanes?: Array<OneRoundLane | OneRoundLaneV2>;
	/** Read-only / relevant files tracked by the plugin across compactions. */
	readFiles?: string[];
	/** Modified files tracked by the plugin across compactions. */
	modifiedFiles?: string[];
	/** Git state captured deterministically during compaction. */
	git?: OneRoundGit;
	/** Active intent-workflow ledger the plugin detected, if any. */
	intentWorkflow?: OneRoundIntentWorkflow;
};

export type OneRoundLaneV2 = {
	lane: "intent" | "execution";
	model: string;
	thinkingLevel: string;
	durationMs: number;
};

export type OneRoundUsageCost = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
};

export type OneRoundUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cacheWrite1h?: number;
	reasoning?: number;
	totalTokens: number;
	cost: OneRoundUsageCost;
};

export type OneRoundLane = {
	lane: "intent" | "execution";
	model: string;
	thinkingLevel: string;
	durationMs: number;
	usage: OneRoundUsage;
};

export type OneRoundUserMessage = {
	timestamp: number;
	text: string;
	originalChars: number;
	trimmed: boolean;
};

export type OneRoundDurableUserReference = {
	id: string;
	state: "active" | "cooling";
	misses: number;
	semanticNote?: string;
};

export type OneRoundRenderBudgets = {
	intentWorkflowChars: number;
	gitStateChars: number;
	editedFilesChars: number;
	readFilesChars: number;
	userMessagesChars: number;
	userArtifactReferencesChars: number;
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
export type OneRoundDetailsV2 = {
	plugin: "pi-one-round-compaction";
	version: 2;
	lanes: OneRoundLaneV2[];
	wallTimeMs: number;
	keepRecentTokens: number;
	boundaryMode: OneRoundBoundaryMode;
	retainedTurns: number;
	estimatedRetainedTokens: number;
	isSplitTurn: boolean;
	readFiles: string[];
	modifiedFiles: string[];
	git?: OneRoundGit;
	intentWorkflow: OneRoundIntentWorkflow;
};

/** Shape written by pi-one-round-compaction into CompactionResult.details (version 4). */
export type OneRoundDetailsV4 = {
	plugin: "pi-one-round-compaction";
	version: 4;
	lanes: OneRoundLane[];
	wallTimeMs: number;
	keepRecentTokens: number;
	boundaryMode: OneRoundBoundaryMode;
	retainedTurns: number;
	estimatedRetainedTokens: number;
	targetPostCompactTokens: number;
	effectiveRecentTokenBudget: number;
	estimatedTokensAfter: number;
	targetExceeded: boolean;
	isSplitTurn: boolean;
	readFiles: string[];
	modifiedFiles: string[];
	traceReadFiles: string[];
	traceEditedFiles: string[];
	userMessages: OneRoundUserMessage[];
	knownUserArtifactIds: string[];
	durableUserReferences: OneRoundDurableUserReference[];
	renderBudgets: OneRoundRenderBudgets;
	git?: OneRoundGit;
	intentWorkflow: OneRoundIntentWorkflow;
};

export type OneRoundDetails = OneRoundDetailsV2 | OneRoundDetailsV4;

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
	boundaryMode: OneRoundBoundaryMode;
	intentWorkflow?: { active: true; workstream: string; hasPlan: boolean };
	lanes: { intent: OneRoundLaneProgress; execution: OneRoundLaneProgress };
	error?: string;
};

/** Accumulated per-lane streamed text for the current one-round compaction run. */
export type OneRoundLaneTexts = {
	runId: string;
	intent: string;
	execution: string;
};

/** Bound for retained per-lane streamed text; only the tail is ever displayed. */
export const ONE_ROUND_LANE_TEXT_CAP = 20_000;

/** Keeps the cap-sized tail without leaving a dangling low surrogate at the cut. */
function capLaneTail(text: string): string {
	if (text.length <= ONE_ROUND_LANE_TEXT_CAP) return text;
	const tail = text.slice(-ONE_ROUND_LANE_TEXT_CAP);
	const first = tail.charCodeAt(0);
	return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail;
}

/**
 * Appends the plugin's per-lane `delta` fields verbatim (the plugin documents
 * deltas as "text produced since the previous emitted progress frame").
 * A new runId starts fresh accumulation; each lane is capped to its tail so
 * memory stays bounded for long summaries.
 */
export function applyOneRoundLaneDeltas(
	prev: OneRoundLaneTexts | undefined,
	progress: OneRoundProgress,
): OneRoundLaneTexts {
	const base = prev?.runId === progress.runId
		? prev
		: { runId: progress.runId, intent: "", execution: "" };
	const intentDelta = progress.lanes.intent.delta;
	const executionDelta = progress.lanes.execution.delta;
	return {
		runId: progress.runId,
		intent:
			intentDelta !== undefined
				? capLaneTail(base.intent + intentDelta)
				: base.intent,
		execution:
			executionDelta !== undefined
				? capLaneTail(base.execution + executionDelta)
				: base.execution,
	};
}

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
		if (oneRound.version === 4 && completion.estimatedTokensAfter === undefined) {
			completion.estimatedTokensAfter = oneRound.estimatedTokensAfter;
		}
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
					? ` · ${completion.boundaryMode === "whole-turn" ? "whole-turn boundary" : completion.boundaryMode === "split-turn" ? "split-turn boundary" : "Pi fallback boundary"}`
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

function isOneRoundBoundaryMode(value: unknown): value is OneRoundBoundaryMode {
	return value === "whole-turn" || value === "split-turn" || value === "pi-fallback";
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(record).every((key) => keys.includes(key));
}

function isOneRoundLaneName(value: unknown): value is "intent" | "execution" {
	return value === "intent" || value === "execution";
}

function parseOneRoundLaneV2(value: unknown): OneRoundLaneV2 | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["lane", "model", "thinkingLevel", "durationMs"]) ||
		!isOneRoundLaneName(value.lane) ||
		typeof value.model !== "string" ||
		typeof value.thinkingLevel !== "string" ||
		!isFiniteNonNegativeInteger(value.durationMs)
	) {
		return undefined;
	}
	return {
		lane: value.lane,
		model: value.model,
		thinkingLevel: value.thinkingLevel,
		durationMs: value.durationMs,
	};
}

function parseOneRoundLanesV2(value: unknown): OneRoundLaneV2[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const lanes: OneRoundLaneV2[] = [];
	for (const item of value) {
		const lane = parseOneRoundLaneV2(item);
		if (lane === undefined) return undefined;
		lanes.push(lane);
	}
	return lanes;
}

function parseOneRoundUsageCost(value: unknown): OneRoundUsageCost | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["input", "output", "cacheRead", "cacheWrite", "total"]) ||
		!isFiniteNonNegative(value.input) ||
		!isFiniteNonNegative(value.output) ||
		!isFiniteNonNegative(value.cacheRead) ||
		!isFiniteNonNegative(value.cacheWrite) ||
		!isFiniteNonNegative(value.total)
	) {
		return undefined;
	}
	return {
		input: value.input,
		output: value.output,
		cacheRead: value.cacheRead,
		cacheWrite: value.cacheWrite,
		total: value.total,
	};
}

function parseOneRoundUsage(value: unknown): OneRoundUsage | undefined {
	if (!isRecord(value) || !hasOnlyKeys(value, ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "reasoning", "totalTokens", "cost"])) return undefined;
	if (
		!isFiniteNonNegative(value.input) ||
		!isFiniteNonNegative(value.output) ||
		!isFiniteNonNegative(value.cacheRead) ||
		!isFiniteNonNegative(value.cacheWrite) ||
		!isFiniteNonNegative(value.totalTokens)
	) {
		return undefined;
	}
	if (value.cacheWrite1h !== undefined && !isFiniteNonNegative(value.cacheWrite1h)) return undefined;
	if (value.reasoning !== undefined && !isFiniteNonNegative(value.reasoning)) return undefined;
	const cost = parseOneRoundUsageCost(value.cost);
	if (cost === undefined) return undefined;
	return {
		input: value.input,
		output: value.output,
		cacheRead: value.cacheRead,
		cacheWrite: value.cacheWrite,
		...(value.cacheWrite1h !== undefined ? { cacheWrite1h: value.cacheWrite1h } : {}),
		...(value.reasoning !== undefined ? { reasoning: value.reasoning } : {}),
		totalTokens: value.totalTokens,
		cost,
	};
}

function parseOneRoundLaneV4(value: unknown): OneRoundLane | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["lane", "model", "thinkingLevel", "durationMs", "usage"]) ||
		!isOneRoundLaneName(value.lane) ||
		typeof value.model !== "string" ||
		typeof value.thinkingLevel !== "string" ||
		!isFiniteNonNegativeInteger(value.durationMs)
	) {
		return undefined;
	}
	const usage = parseOneRoundUsage(value.usage);
	if (usage === undefined) return undefined;
	return {
		lane: value.lane,
		model: value.model,
		thinkingLevel: value.thinkingLevel,
		durationMs: value.durationMs,
		usage,
	};
}

function parseOneRoundLanesV4(value: unknown): OneRoundLane[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const lanes: OneRoundLane[] = [];
	for (const item of value) {
		const lane = parseOneRoundLaneV4(item);
		if (lane === undefined) return undefined;
		lanes.push(lane);
	}
	return lanes;
}

function parseOneRoundUserMessage(value: unknown): OneRoundUserMessage | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["timestamp", "text", "originalChars", "trimmed"]) ||
		!isFiniteNonNegative(value.timestamp) ||
		typeof value.text !== "string" ||
		!isFiniteNonNegativeInteger(value.originalChars) ||
		typeof value.trimmed !== "boolean"
	) {
		return undefined;
	}
	return {
		timestamp: value.timestamp,
		text: value.text,
		originalChars: value.originalChars,
		trimmed: value.trimmed,
	};
}

function parseOneRoundUserMessages(value: unknown): OneRoundUserMessage[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const messages: OneRoundUserMessage[] = [];
	for (const item of value) {
		const message = parseOneRoundUserMessage(item);
		if (message === undefined) return undefined;
		messages.push(message);
	}
	return messages;
}

function parseOneRoundDurableReference(value: unknown): OneRoundDurableUserReference | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["id", "state", "misses", "semanticNote"]) ||
		typeof value.id !== "string" ||
		(value.state !== "active" && value.state !== "cooling") ||
		!isFiniteNonNegativeInteger(value.misses) ||
		(value.semanticNote !== undefined && typeof value.semanticNote !== "string")
	) {
		return undefined;
	}
	return {
		id: value.id,
		state: value.state,
		misses: value.misses,
		...(typeof value.semanticNote === "string" ? { semanticNote: value.semanticNote } : {}),
	};
}

function parseOneRoundDurableReferences(value: unknown): OneRoundDurableUserReference[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const references: OneRoundDurableUserReference[] = [];
	for (const item of value) {
		const reference = parseOneRoundDurableReference(item);
		if (reference === undefined) return undefined;
		references.push(reference);
	}
	return references;
}

function parseOneRoundRenderBudgets(value: unknown): OneRoundRenderBudgets | undefined {
	if (!isRecord(value)) return undefined;
	const intentWorkflowChars = value.intentWorkflowChars;
	const gitStateChars = value.gitStateChars;
	const editedFilesChars = value.editedFilesChars;
	const readFilesChars = value.readFilesChars;
	const userMessagesChars = value.userMessagesChars;
	const userArtifactReferencesChars = value.userArtifactReferencesChars;
	if (
		!hasOnlyKeys(value, [
			"intentWorkflowChars",
			"gitStateChars",
			"editedFilesChars",
			"readFilesChars",
			"userMessagesChars",
			"userArtifactReferencesChars",
		]) ||
		!isFiniteNonNegativeInteger(intentWorkflowChars) ||
		!isFiniteNonNegativeInteger(gitStateChars) ||
		!isFiniteNonNegativeInteger(editedFilesChars) ||
		!isFiniteNonNegativeInteger(readFilesChars) ||
		!isFiniteNonNegativeInteger(userMessagesChars) ||
		!isFiniteNonNegativeInteger(userArtifactReferencesChars)
	) {
		return undefined;
	}
	return {
		intentWorkflowChars,
		gitStateChars,
		editedFilesChars,
		readFilesChars,
		userMessagesChars,
		userArtifactReferencesChars,
	};
}

function parseOneRoundGit(value: unknown): OneRoundGit | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["root", "branch", "head", "dirty", "truncated"]) ||
		typeof value.root !== "string" ||
		typeof value.branch !== "string" ||
		typeof value.head !== "string" ||
		!isStringArray(value.dirty) ||
		typeof value.truncated !== "boolean"
	) {
		return undefined;
	}
	return {
		root: value.root,
		branch: value.branch,
		head: value.head,
		dirty: value.dirty,
		truncated: value.truncated,
	};
}

function parseOneRoundIntentWorkflow(value: unknown): OneRoundIntentWorkflow | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["active", "workstream", "hasPlan", "intentTruncated", "planTruncated"]) ||
		typeof value.active !== "boolean" ||
		(value.workstream !== undefined && typeof value.workstream !== "string") ||
		(value.hasPlan !== undefined && typeof value.hasPlan !== "boolean") ||
		(value.intentTruncated !== undefined && typeof value.intentTruncated !== "boolean") ||
		(value.planTruncated !== undefined && typeof value.planTruncated !== "boolean")
	) {
		return undefined;
	}
	if (value.active && (typeof value.workstream !== "string" || typeof value.hasPlan !== "boolean")) return undefined;
	return {
		active: value.active,
		...(typeof value.workstream === "string" ? { workstream: value.workstream } : {}),
		...(typeof value.hasPlan === "boolean" ? { hasPlan: value.hasPlan } : {}),
		...(typeof value.intentTruncated === "boolean" ? { intentTruncated: value.intentTruncated } : {}),
		...(typeof value.planTruncated === "boolean" ? { planTruncated: value.planTruncated } : {}),
	};
}

function parseOneRoundDetailsV2(value: Record<string, unknown>): OneRoundDetailsV2 | undefined {
	if (
		!hasOnlyKeys(value, [
			"plugin",
			"version",
			"lanes",
			"wallTimeMs",
			"keepRecentTokens",
			"boundaryMode",
			"retainedTurns",
			"estimatedRetainedTokens",
			"isSplitTurn",
			"readFiles",
			"modifiedFiles",
			"git",
			"intentWorkflow",
		])
	) {
		return undefined;
	}
	const lanes = parseOneRoundLanesV2(value.lanes);
	const git = value.git === undefined ? undefined : parseOneRoundGit(value.git);
	const intentWorkflow = parseOneRoundIntentWorkflow(value.intentWorkflow);
	if (
		lanes === undefined ||
		!isFiniteNonNegativeInteger(value.wallTimeMs) ||
		!isFiniteNonNegative(value.keepRecentTokens) ||
		!isOneRoundBoundaryMode(value.boundaryMode) ||
		!isFiniteNonNegativeInteger(value.retainedTurns) ||
		!isFiniteNonNegative(value.estimatedRetainedTokens) ||
		typeof value.isSplitTurn !== "boolean" ||
		!isStringArray(value.readFiles) ||
		!isStringArray(value.modifiedFiles) ||
		(value.git !== undefined && git === undefined) ||
		intentWorkflow === undefined
	) {
		return undefined;
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
		...(git === undefined ? {} : { git }),
		intentWorkflow,
	};
}

function parseOneRoundDetailsV4(value: Record<string, unknown>): OneRoundDetailsV4 | undefined {
	if (
		!hasOnlyKeys(value, [
			"plugin",
			"version",
			"lanes",
			"wallTimeMs",
			"keepRecentTokens",
			"boundaryMode",
			"retainedTurns",
			"estimatedRetainedTokens",
			"targetPostCompactTokens",
			"effectiveRecentTokenBudget",
			"estimatedTokensAfter",
			"targetExceeded",
			"isSplitTurn",
			"readFiles",
			"modifiedFiles",
			"traceReadFiles",
			"traceEditedFiles",
			"userMessages",
			"knownUserArtifactIds",
			"durableUserReferences",
			"renderBudgets",
			"git",
			"intentWorkflow",
		])
	) {
		return undefined;
	}
	const lanes = parseOneRoundLanesV4(value.lanes);
	const userMessages = parseOneRoundUserMessages(value.userMessages);
	const durableUserReferences = parseOneRoundDurableReferences(value.durableUserReferences);
	const renderBudgets = parseOneRoundRenderBudgets(value.renderBudgets);
	const git = value.git === undefined ? undefined : parseOneRoundGit(value.git);
	const intentWorkflow = parseOneRoundIntentWorkflow(value.intentWorkflow);
	if (
		lanes === undefined ||
		!isFiniteNonNegativeInteger(value.wallTimeMs) ||
		!isFiniteNonNegative(value.keepRecentTokens) ||
		!isOneRoundBoundaryMode(value.boundaryMode) ||
		!isFiniteNonNegativeInteger(value.retainedTurns) ||
		!isFiniteNonNegative(value.estimatedRetainedTokens) ||
		!isFiniteNonNegative(value.targetPostCompactTokens) ||
		!isFiniteNonNegative(value.effectiveRecentTokenBudget) ||
		!isFiniteNonNegative(value.estimatedTokensAfter) ||
		typeof value.targetExceeded !== "boolean" ||
		typeof value.isSplitTurn !== "boolean" ||
		!isStringArray(value.readFiles) ||
		!isStringArray(value.modifiedFiles) ||
		!isStringArray(value.traceReadFiles) ||
		!isStringArray(value.traceEditedFiles) ||
		userMessages === undefined ||
		!isStringArray(value.knownUserArtifactIds) ||
		durableUserReferences === undefined ||
		renderBudgets === undefined ||
		(value.git !== undefined && git === undefined) ||
		intentWorkflow === undefined
	) {
		return undefined;
	}
	return {
		plugin: "pi-one-round-compaction",
		version: 4,
		lanes,
		wallTimeMs: value.wallTimeMs,
		keepRecentTokens: value.keepRecentTokens,
		boundaryMode: value.boundaryMode,
		retainedTurns: value.retainedTurns,
		estimatedRetainedTokens: value.estimatedRetainedTokens,
		targetPostCompactTokens: value.targetPostCompactTokens,
		effectiveRecentTokenBudget: value.effectiveRecentTokenBudget,
		estimatedTokensAfter: value.estimatedTokensAfter,
		targetExceeded: value.targetExceeded,
		isSplitTurn: value.isSplitTurn,
		readFiles: value.readFiles,
		modifiedFiles: value.modifiedFiles,
		traceReadFiles: value.traceReadFiles,
		traceEditedFiles: value.traceEditedFiles,
		userMessages,
		knownUserArtifactIds: value.knownUserArtifactIds,
		durableUserReferences,
		renderBudgets,
		...(git === undefined ? {} : { git }),
		intentWorkflow,
	};
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
 * Validates the pi-one-round-compaction details objects (versions 2 and 4) that the
 * plugin writes into CompactionResult.details. Returns undefined for anything
 * that is not produced by that plugin so foreign/older details stay hidden.
 */
export function parseOneRoundDetails(value: unknown): OneRoundDetails | undefined {
	if (!isRecord(value) || value.plugin !== "pi-one-round-compaction") return undefined;
	if (value.version === 2) return parseOneRoundDetailsV2(value);
	if (value.version === 4) return parseOneRoundDetailsV4(value);
	return undefined;
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
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return undefined;
		}
	}
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
	if (!isOneRoundBoundaryMode(value.boundaryMode)) return undefined;
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
