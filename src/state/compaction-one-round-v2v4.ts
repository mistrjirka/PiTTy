/** Compaction telemetry wire schema and display projections | compaction-one-round-v2v4. */

import type {
	OneRoundDetailsV2,
	OneRoundDetailsV4,
} from "./compaction-model.ts";

import {
	hasOnlyKeys,
	isOneRoundBoundaryMode,
	isStringArray,
	parseOneRoundDurableReferences,
	parseOneRoundGit,
	parseOneRoundIntentWorkflow,
	parseOneRoundLanesV2,
	parseOneRoundLanesV4,
	parseOneRoundRenderBudgets,
	parseOneRoundUserMessages,
} from "./compaction-one-round-fields.ts";

import {
	isFiniteNonNegative,
	isFiniteNonNegativeInteger,
} from "./compaction-validation.ts";

export function parseOneRoundDetailsV2(
	value: Record<string, unknown>,
): OneRoundDetailsV2 | undefined {
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

export function parseOneRoundDetailsV4(
	value: Record<string, unknown>,
): OneRoundDetailsV4 | undefined {
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
	const durableUserReferences = parseOneRoundDurableReferences(
		value.durableUserReferences,
	);
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
