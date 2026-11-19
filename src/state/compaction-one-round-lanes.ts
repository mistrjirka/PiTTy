/** Compaction one-round field validators | compaction-one-round-lanes. */

import type {
	OneRoundBoundaryMode,
	OneRoundLane,
	OneRoundLaneV2,
	OneRoundLaneV6,
	OneRoundUsage,
	OneRoundUsageCost,
} from "./compaction-model.ts";

import {
	isFiniteNonNegative,
	isFiniteNonNegativeInteger,
	isRecord,
} from "./compaction-validation.ts";

export function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

export function isOneRoundBoundaryMode(
	value: unknown,
): value is OneRoundBoundaryMode {
	return (
		value === "whole-turn" || value === "split-turn" || value === "pi-fallback"
	);
}

export function hasOnlyKeys(
	record: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	return Object.keys(record).every((key) => keys.includes(key));
}

export function isOneRoundLegacyLaneName(
	value: unknown,
): value is "intent" | "execution" {
	return value === "intent" || value === "execution";
}

export function isOneRoundCurrentLaneName(
	value: unknown,
): value is "audit" | "execution" {
	return value === "audit" || value === "execution";
}

export function parseOneRoundLaneV2(
	value: unknown,
): OneRoundLaneV2 | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["lane", "model", "thinkingLevel", "durationMs"]) ||
		!isOneRoundLegacyLaneName(value.lane) ||
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

export function parseOneRoundLanesV2(
	value: unknown,
): OneRoundLaneV2[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const lanes: OneRoundLaneV2[] = [];
	for (const item of value) {
		const lane = parseOneRoundLaneV2(item);
		if (lane === undefined) return undefined;
		lanes.push(lane);
	}
	return lanes;
}

export function parseOneRoundUsageCost(
	value: unknown,
): OneRoundUsageCost | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, [
			"input",
			"output",
			"cacheRead",
			"cacheWrite",
			"total",
		]) ||
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

export function parseOneRoundUsage(value: unknown): OneRoundUsage | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, [
			"input",
			"output",
			"cacheRead",
			"cacheWrite",
			"cacheWrite1h",
			"reasoning",
			"totalTokens",
			"cost",
		])
	)
		return undefined;
	if (
		!isFiniteNonNegative(value.input) ||
		!isFiniteNonNegative(value.output) ||
		!isFiniteNonNegative(value.cacheRead) ||
		!isFiniteNonNegative(value.cacheWrite) ||
		!isFiniteNonNegative(value.totalTokens)
	) {
		return undefined;
	}
	if (
		value.cacheWrite1h !== undefined &&
		!isFiniteNonNegative(value.cacheWrite1h)
	)
		return undefined;
	if (value.reasoning !== undefined && !isFiniteNonNegative(value.reasoning))
		return undefined;
	const cost = parseOneRoundUsageCost(value.cost);
	if (cost === undefined) return undefined;
	return {
		input: value.input,
		output: value.output,
		cacheRead: value.cacheRead,
		cacheWrite: value.cacheWrite,
		...(value.cacheWrite1h !== undefined
			? { cacheWrite1h: value.cacheWrite1h }
			: {}),
		...(value.reasoning !== undefined ? { reasoning: value.reasoning } : {}),
		totalTokens: value.totalTokens,
		cost,
	};
}

export function parseOneRoundLaneV4(value: unknown): OneRoundLane | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, [
			"lane",
			"model",
			"thinkingLevel",
			"durationMs",
			"usage",
		]) ||
		!isOneRoundLegacyLaneName(value.lane) ||
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

export function parseOneRoundLanesV4(
	value: unknown,
): OneRoundLane[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const lanes: OneRoundLane[] = [];
	for (const item of value) {
		const lane = parseOneRoundLaneV4(item);
		if (lane === undefined) return undefined;
		lanes.push(lane);
	}
	return lanes;
}

export function parseOneRoundLaneV6(
	value: unknown,
): OneRoundLaneV6 | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, [
			"lane",
			"model",
			"thinkingLevel",
			"durationMs",
			"usage",
		]) ||
		!isOneRoundCurrentLaneName(value.lane) ||
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

export function parseOneRoundLanesV6(
	value: unknown,
): OneRoundLaneV6[] | undefined {
	if (!Array.isArray(value) || value.length !== 2) return undefined;
	const lanes: OneRoundLaneV6[] = [];
	for (const item of value) {
		const lane = parseOneRoundLaneV6(item);
		if (lane === undefined) return undefined;
		lanes.push(lane);
	}
	if (
		!lanes.some((lane) => lane.lane === "audit") ||
		!lanes.some((lane) => lane.lane === "execution")
	)
		return undefined;
	return lanes;
}
