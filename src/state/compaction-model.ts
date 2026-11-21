/** Compaction telemetry wire schema and display projections | compaction-model. */

export const COMPACTION_STATUS_KEY = "pitty.compaction.v1";

export const ONE_ROUND_PROGRESS_KEY = "pi-one-round-compaction.progress.v2";

export const ONE_ROUND_LEGACY_PROGRESS_KEY =
	"pi-one-round-compaction.progress.v1";

export const SMART_COMPACT_PROGRESS_KEY = "smart-compact-progress";

export const COMPACTION_TELEMETRY_VERSION = 1;

export const SMART_COMPACT_PROGRESS_VALUES = new Set([
	"Smart Compact 1/5 · Extract",
	"Smart Compact 5/5 · Apply",
]);

export function parseSmartCompactProgress(value: unknown): string | undefined {
	if (typeof value !== "string" || !SMART_COMPACT_PROGRESS_VALUES.has(value))
		return undefined;
	return value;
}

export type CompactionReason = "manual" | "threshold" | "overflow" | "cache-expiry";

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
	/** One-round compaction plugin details. */
	plugin?: "pi-one-round-compaction";
	wallTimeMs?: number;
	boundaryMode?: OneRoundBoundaryMode;
	retainedTurns?: number;
	keepRecentTokens?: number;
	estimatedRetainedTokens?: number;
	targetPostCompactTokens?: number;
	effectiveRecentTokenBudget?: number;
	laneOutputBudgetTokens?: number;
	targetExceeded?: boolean;
	isSplitTurn?: boolean;
	lanes?: Array<OneRoundLane | OneRoundLaneV2 | OneRoundLaneV6>;
	readFiles?: string[];
	modifiedFiles?: string[];
	git?: OneRoundGit;
	/** Historical v2/v4 metadata only. Current v6 details never contain intent workflow state. */
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

export type OneRoundLaneV6 = {
	lane: "audit" | "execution";
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
	sourceSessionId?: string;
	state: "active" | "cooling";
	misses: number;
	kind?:
		| "plan"
		| "spec"
		| "requirements"
		| "correction"
		| "log"
		| "evidence"
		| "other";
	authority?: "governing" | "supporting";
	semanticNote?: string;
};

export type OneRoundUserArtifactLocator = {
	id: string;
	sourceSessionId?: string;
};

export type OneRoundRenderBudgets = {
	intentWorkflowChars: number;
	gitStateChars: number;
	editedFilesChars: number;
	readFilesChars: number;
	userMessagesChars: number;
	userArtifactReferencesChars: number;
};

export type OneRoundRenderBudgetsV6 = {
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

export type OneRoundDetailsV6 = {
	plugin: "pi-one-round-compaction";
	version: 6;
	lanes: OneRoundLaneV6[];
	wallTimeMs: number;
	keepRecentTokens: number;
	boundaryMode: OneRoundBoundaryMode;
	retainedTurns: number;
	estimatedRetainedTokens: number;
	targetPostCompactTokens: number;
	effectiveRecentTokenBudget: number;
	laneOutputBudgetTokens: number;
	estimatedTokensAfter: number;
	targetExceeded: boolean;
	isSplitTurn: boolean;
	readFiles: string[];
	modifiedFiles: string[];
	traceReadFiles: string[];
	traceEditedFiles: string[];
	userMessages: OneRoundUserMessage[];
	knownUserArtifactIds: string[];
	knownUserArtifacts: OneRoundUserArtifactLocator[];
	durableUserReferences: OneRoundDurableUserReference[];
	renderBudgets: OneRoundRenderBudgetsV6;
	git?: OneRoundGit;
};

export type OneRoundDetails =
	| OneRoundDetailsV2
	| OneRoundDetailsV4
	| OneRoundDetailsV6;

export type OneRoundLaneProgress = {
	role: "intent" | "execution" | "implementation" | "evidence" | "audit";
	state: "queued" | "streaming" | "done" | "error";
	chars: number;
	delta?: string;
	elapsedMs?: number;
};

export type OneRoundProgressV1 = {
	v: 1;
	runId: string;
	seq: number;
	phase:
		| "preparing"
		| "streaming"
		| "merging"
		| "complete"
		| "error"
		| "aborted";
	mode: "normal" | "workflow";
	reason: CompactionReason;
	elapsedMs: number;
	retainedTurns: number;
	estimatedRetainedTokens: number;
	keepRecentTokens: number;
	boundaryMode: OneRoundBoundaryMode;
	intentWorkflow?: { active: true; workstream: string; hasPlan: boolean };
	lanes: { intent: OneRoundLaneProgress; execution: OneRoundLaneProgress };
	error?: string;
};

export type OneRoundProgressV2 = {
	v: 2;
	runId: string;
	seq: number;
	phase:
		| "preparing"
		| "streaming"
		| "merging"
		| "complete"
		| "error"
		| "aborted";
	reason: CompactionReason;
	elapsedMs: number;
	retainedTurns: number;
	estimatedRetainedTokens: number;
	keepRecentTokens: number;
	targetPostCompactTokens: number;
	effectiveRecentTokenBudget: number;
	boundaryMode: OneRoundBoundaryMode;
	lanes: { audit: OneRoundLaneProgress; execution: OneRoundLaneProgress };
	error?: string;
};

export type OneRoundProgress = OneRoundProgressV1 | OneRoundProgressV2;

export type OneRoundLaneTexts = {
	runId: string;
	intent: string;
	audit: string;
	execution: string;
};

export const ONE_ROUND_LANE_TEXT_CAP = 20_000;

export function capLaneTail(text: string): string {
	if (text.length <= ONE_ROUND_LANE_TEXT_CAP) return text;
	const tail = text.slice(-ONE_ROUND_LANE_TEXT_CAP);
	const first = tail.charCodeAt(0);
	return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail;
}

export function applyOneRoundLaneDeltas(
	prev: OneRoundLaneTexts | undefined,
	progress: OneRoundProgress,
): OneRoundLaneTexts {
	const base =
		prev?.runId === progress.runId
			? prev
			: { runId: progress.runId, intent: "", audit: "", execution: "" };
	const executionDelta = progress.lanes.execution.delta;
	if (progress.v === 2) {
		const auditDelta = progress.lanes.audit.delta;
		return {
			runId: progress.runId,
			intent: base.intent,
			audit:
				auditDelta !== undefined
					? capLaneTail(base.audit + auditDelta)
					: base.audit,
			execution:
				executionDelta !== undefined
					? capLaneTail(base.execution + executionDelta)
					: base.execution,
		};
	}
	const intentDelta = progress.lanes.intent.delta;
	return {
		runId: progress.runId,
		intent:
			intentDelta !== undefined
				? capLaneTail(base.intent + intentDelta)
				: base.intent,
		audit: base.audit,
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
