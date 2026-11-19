/** Shared wire-format guards for historical and current compaction payloads.
 * No result formatting or version parser dependencies.
 */
import type { CompactionReason } from "./compaction-model.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isFiniteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isFiniteNonNegativeInteger(value: unknown): value is number {
	return isFiniteNonNegative(value) && Number.isInteger(value);
}

export function isCompactionReason(value: unknown): value is CompactionReason {
	return value === "manual" || value === "threshold" || value === "overflow";
}
