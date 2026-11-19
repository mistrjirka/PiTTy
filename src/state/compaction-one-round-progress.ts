/** Compaction telemetry wire schema and display projections | compaction-one-round-progress. */

import type {
	OneRoundDetails,
	OneRoundLaneProgress,
	OneRoundProgress,
	OneRoundProgressV1,
	OneRoundProgressV2,
} from "./compaction-model.ts";
import { isOneRoundBoundaryMode } from "./compaction-one-round-fields.ts";

import {
	parseOneRoundDetailsV2,
	parseOneRoundDetailsV4,
} from "./compaction-one-round-v2v4.ts";

import { parseOneRoundDetailsV6 } from "./compaction-one-round-v6.ts";
import {
	isCompactionReason,
	isFiniteNonNegative,
	isFiniteNonNegativeInteger,
	isRecord,
} from "./compaction-validation.ts";

export const ONE_ROUND_PROGRESS_PHASES = [
	"preparing",
	"streaming",
	"merging",
	"complete",
	"error",
	"aborted",
] as const;

export const ONE_ROUND_LEGACY_LANE_ROLES = [
	"intent",
	"execution",
	"implementation",
	"evidence",
] as const;

export const ONE_ROUND_CURRENT_LANE_ROLES = ["audit", "execution"] as const;

export const ONE_ROUND_LANE_STATES = [
	"queued",
	"streaming",
	"done",
	"error",
] as const;

export function parseOneRoundDetails(
	value: unknown,
): OneRoundDetails | undefined {
	if (!isRecord(value) || value.plugin !== "pi-one-round-compaction")
		return undefined;
	if (value.version === 2) return parseOneRoundDetailsV2(value);
	if (value.version === 4) return parseOneRoundDetailsV4(value);
	if (value.version === 6) return parseOneRoundDetailsV6(value);
	return undefined;
}

export function parseOneRoundLaneProgress(
	value: unknown,
	roles: readonly string[],
): OneRoundLaneProgress | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.role !== "string" || !roles.includes(value.role))
		return undefined;
	if (
		typeof value.state !== "string" ||
		!(ONE_ROUND_LANE_STATES as readonly string[]).includes(value.state)
	)
		return undefined;
	if (!isFiniteNonNegativeInteger(value.chars)) return undefined;
	if (value.delta !== undefined && typeof value.delta !== "string")
		return undefined;
	if (
		value.elapsedMs !== undefined &&
		!isFiniteNonNegativeInteger(value.elapsedMs)
	)
		return undefined;
	return {
		role: value.role as OneRoundLaneProgress["role"],
		state: value.state as OneRoundLaneProgress["state"],
		chars: value.chars,
		...(typeof value.delta === "string" && value.delta
			? { delta: value.delta }
			: {}),
		...(isFiniteNonNegativeInteger(value.elapsedMs)
			? { elapsedMs: value.elapsedMs }
			: {}),
	};
}

export function parseOneRoundProgressV1(
	value: Record<string, unknown>,
): OneRoundProgressV1 | undefined {
	if (typeof value.runId !== "string" || !value.runId) return undefined;
	if (!isFiniteNonNegativeInteger(value.seq)) return undefined;
	if (
		typeof value.phase !== "string" ||
		!(ONE_ROUND_PROGRESS_PHASES as readonly string[]).includes(value.phase)
	)
		return undefined;
	if (value.mode !== "normal" && value.mode !== "workflow") return undefined;
	if (
		!isCompactionReason(value.reason) ||
		!isFiniteNonNegative(value.elapsedMs)
	)
		return undefined;
	if (
		!isFiniteNonNegativeInteger(value.retainedTurns) ||
		!isFiniteNonNegative(value.estimatedRetainedTokens) ||
		!isFiniteNonNegative(value.keepRecentTokens)
	)
		return undefined;
	if (!isOneRoundBoundaryMode(value.boundaryMode)) return undefined;
	let intentWorkflow:
		| { active: true; workstream: string; hasPlan: boolean }
		| undefined;
	if (value.intentWorkflow !== undefined) {
		if (
			!isRecord(value.intentWorkflow) ||
			value.intentWorkflow.active !== true ||
			typeof value.intentWorkflow.workstream !== "string" ||
			typeof value.intentWorkflow.hasPlan !== "boolean"
		)
			return undefined;
		intentWorkflow = {
			active: true,
			workstream: value.intentWorkflow.workstream,
			hasPlan: value.intentWorkflow.hasPlan,
		};
	}
	const lanesRecord = isRecord(value.lanes) ? value.lanes : undefined;
	if (!lanesRecord) return undefined;
	const intent = parseOneRoundLaneProgress(
		lanesRecord.intent,
		ONE_ROUND_LEGACY_LANE_ROLES,
	);
	const execution = parseOneRoundLaneProgress(
		lanesRecord.execution,
		ONE_ROUND_LEGACY_LANE_ROLES,
	);
	if (!intent || !execution) return undefined;
	return {
		v: 1,
		runId: value.runId,
		seq: value.seq,
		phase: value.phase as OneRoundProgressV1["phase"],
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

export function parseOneRoundProgressV2(
	value: Record<string, unknown>,
): OneRoundProgressV2 | undefined {
	if (typeof value.runId !== "string" || !value.runId) return undefined;
	if (!isFiniteNonNegativeInteger(value.seq)) return undefined;
	if (
		typeof value.phase !== "string" ||
		!(ONE_ROUND_PROGRESS_PHASES as readonly string[]).includes(value.phase)
	)
		return undefined;
	if (
		!isCompactionReason(value.reason) ||
		!isFiniteNonNegative(value.elapsedMs)
	)
		return undefined;
	if (
		!isFiniteNonNegativeInteger(value.retainedTurns) ||
		!isFiniteNonNegative(value.estimatedRetainedTokens) ||
		!isFiniteNonNegative(value.keepRecentTokens)
	)
		return undefined;
	if (
		!isFiniteNonNegative(value.targetPostCompactTokens) ||
		!isFiniteNonNegative(value.effectiveRecentTokenBudget)
	)
		return undefined;
	if (!isOneRoundBoundaryMode(value.boundaryMode)) return undefined;
	if (value.mode !== undefined || value.intentWorkflow !== undefined)
		return undefined;
	const lanesRecord = isRecord(value.lanes) ? value.lanes : undefined;
	if (
		!lanesRecord ||
		Object.keys(lanesRecord).some(
			(key) => key !== "audit" && key !== "execution",
		)
	)
		return undefined;
	const audit = parseOneRoundLaneProgress(
		lanesRecord.audit,
		ONE_ROUND_CURRENT_LANE_ROLES,
	);
	const execution = parseOneRoundLaneProgress(
		lanesRecord.execution,
		ONE_ROUND_CURRENT_LANE_ROLES,
	);
	if (
		!audit ||
		!execution ||
		audit.role !== "audit" ||
		execution.role !== "execution"
	)
		return undefined;
	return {
		v: 2,
		runId: value.runId,
		seq: value.seq,
		phase: value.phase as OneRoundProgressV2["phase"],
		reason: value.reason,
		elapsedMs: value.elapsedMs,
		retainedTurns: value.retainedTurns,
		estimatedRetainedTokens: value.estimatedRetainedTokens,
		keepRecentTokens: value.keepRecentTokens,
		targetPostCompactTokens: value.targetPostCompactTokens,
		effectiveRecentTokenBudget: value.effectiveRecentTokenBudget,
		boundaryMode: value.boundaryMode,
		lanes: { audit, execution },
		...(typeof value.error === "string" ? { error: value.error } : {}),
	};
}

export function parseOneRoundProgress(
	value: unknown,
): OneRoundProgress | undefined {
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return undefined;
		}
	}
	if (!isRecord(value)) return undefined;
	if (value.v === 1) return parseOneRoundProgressV1(value);
	if (value.v === 2) return parseOneRoundProgressV2(value);
	return undefined;
}
