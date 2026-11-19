/** Compaction telemetry wire schema and display projections | compaction-one-round-v6. */

import type { OneRoundDetailsV6 } from "./compaction-model.ts";

import {
	hasOnlyKeys,
	isOneRoundBoundaryMode,
	isStringArray,
	parseOneRoundDurableReferencesV6,
	parseOneRoundGit,
	parseOneRoundLanesV6,
	parseOneRoundRenderBudgetsV6,
	parseOneRoundUserArtifactLocators,
	parseOneRoundUserMessages,
} from "./compaction-one-round-fields.ts";

import {
	isFiniteNonNegative,
	isFiniteNonNegativeInteger,
} from "./compaction-validation.ts";

export function parseOneRoundDetailsV6(
	value: Record<string, unknown>,
): OneRoundDetailsV6 | undefined {
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
			"laneOutputBudgetTokens",
			"estimatedTokensAfter",
			"targetExceeded",
			"isSplitTurn",
			"readFiles",
			"modifiedFiles",
			"traceReadFiles",
			"traceEditedFiles",
			"userMessages",
			"knownUserArtifactIds",
			"knownUserArtifacts",
			"durableUserReferences",
			"renderBudgets",
			"git",
		])
	)
		return undefined;
	const lanes = parseOneRoundLanesV6(value.lanes);
	const userMessages = parseOneRoundUserMessages(value.userMessages);
	const knownUserArtifacts = parseOneRoundUserArtifactLocators(
		value.knownUserArtifacts,
	);
	const durableUserReferences = parseOneRoundDurableReferencesV6(
		value.durableUserReferences,
	);
	const renderBudgets = parseOneRoundRenderBudgetsV6(value.renderBudgets);
	const git = value.git === undefined ? undefined : parseOneRoundGit(value.git);
	if (
		lanes === undefined ||
		!isFiniteNonNegativeInteger(value.wallTimeMs) ||
		!isFiniteNonNegative(value.keepRecentTokens) ||
		!isOneRoundBoundaryMode(value.boundaryMode) ||
		!isFiniteNonNegativeInteger(value.retainedTurns) ||
		!isFiniteNonNegative(value.estimatedRetainedTokens) ||
		!isFiniteNonNegative(value.targetPostCompactTokens) ||
		!isFiniteNonNegative(value.effectiveRecentTokenBudget) ||
		!isFiniteNonNegative(value.laneOutputBudgetTokens) ||
		!isFiniteNonNegative(value.estimatedTokensAfter) ||
		typeof value.targetExceeded !== "boolean" ||
		typeof value.isSplitTurn !== "boolean" ||
		!isStringArray(value.readFiles) ||
		!isStringArray(value.modifiedFiles) ||
		!isStringArray(value.traceReadFiles) ||
		!isStringArray(value.traceEditedFiles) ||
		userMessages === undefined ||
		!isStringArray(value.knownUserArtifactIds) ||
		knownUserArtifacts === undefined ||
		durableUserReferences === undefined ||
		renderBudgets === undefined ||
		(value.git !== undefined && git === undefined)
	)
		return undefined;
	return {
		plugin: "pi-one-round-compaction",
		version: 6,
		lanes,
		wallTimeMs: value.wallTimeMs,
		keepRecentTokens: value.keepRecentTokens,
		boundaryMode: value.boundaryMode,
		retainedTurns: value.retainedTurns,
		estimatedRetainedTokens: value.estimatedRetainedTokens,
		targetPostCompactTokens: value.targetPostCompactTokens,
		effectiveRecentTokenBudget: value.effectiveRecentTokenBudget,
		laneOutputBudgetTokens: value.laneOutputBudgetTokens,
		estimatedTokensAfter: value.estimatedTokensAfter,
		targetExceeded: value.targetExceeded,
		isSplitTurn: value.isSplitTurn,
		readFiles: value.readFiles,
		modifiedFiles: value.modifiedFiles,
		traceReadFiles: value.traceReadFiles,
		traceEditedFiles: value.traceEditedFiles,
		userMessages,
		knownUserArtifactIds: value.knownUserArtifactIds,
		knownUserArtifacts,
		durableUserReferences,
		renderBudgets,
		...(git === undefined ? {} : { git }),
	};
}
