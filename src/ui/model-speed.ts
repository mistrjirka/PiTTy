/**
 * Live model speed compared with that model's own recorded median, for the
 * sidebar's Model block. The comparison helpers are pure; `latestModelSpeed`
 * reads the history file unless the caller passes a reader.
 */
import {
	modelPerformanceStats,
	type ModelPerformanceStats,
	readModelPerformanceHistory,
} from "../tabs/model-performance-history.ts";
import type { RequestPerformance } from "../tabs/request-metrics.ts";
import { colors } from "./theme.ts";

export type SpeedVerdict =
	| { kind: "faster"; percent: number }
	| { kind: "usual" }
	| { kind: "slower"; percent: number };

/**
 * Within ±10% of the median reads as "usual": request-to-request variance is
 * that large on most providers, so a tighter band would flicker on noise.
 * TODO: the 10% band is a guess. Revisit if users report "usual" hiding real
 * slowdowns; a per-model spread (IQR) from the history would be the upgrade.
 */
export const USUAL_SPEED_BAND = 0.1;

export function compareSpeedToMedian(
	currentTokensPerSecond: number,
	medianTokensPerSecond: number,
	band = USUAL_SPEED_BAND,
): SpeedVerdict | undefined {
	if (
		!Number.isFinite(currentTokensPerSecond) ||
		!Number.isFinite(medianTokensPerSecond) ||
		currentTokensPerSecond <= 0 ||
		medianTokensPerSecond <= 0
	)
		return undefined;
	const ratio = currentTokensPerSecond / medianTokensPerSecond - 1;
	if (Math.abs(ratio) <= band) return { kind: "usual" };
	const percent = Math.round(Math.abs(ratio) * 100);
	return ratio > 0 ? { kind: "faster", percent } : { kind: "slower", percent };
}

/** The glyph carries the meaning too, so the verdict never depends on colour. */
export function speedVerdictText(verdict: SpeedVerdict): string {
	if (verdict.kind === "usual") return "= usual";
	return verdict.kind === "faster"
		? `▲ ${verdict.percent}% faster`
		: `▼ ${verdict.percent}% slower`;
}

export function speedVerdictColor(verdict: SpeedVerdict | undefined): string {
	if (verdict?.kind === "faster") return colors.green;
	if (verdict?.kind === "slower") return colors.orange;
	return colors.text;
}

export function formatLatency(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export type LatestModelSpeed = {
	median: ModelPerformanceStats | undefined;
	current: { tokensPerSecond: number; ttftMs: number } | undefined;
	verdict: SpeedVerdict | undefined;
};

/**
 * Speed of the latest reply next to the selected model's median. A reply
 * from a previously selected model must not masquerade as the current
 * model's speed, so it is dropped unless provider and id both match.
 */
export function latestModelSpeed(
	model: { provider?: string; id?: string } | undefined,
	performance: RequestPerformance | undefined,
	readHistory = readModelPerformanceHistory,
): LatestModelSpeed | undefined {
	if (!model?.provider || !model.id) return undefined;
	const median = modelPerformanceStats(readHistory(), model.provider, model.id);
	const current =
		performance &&
		performance.provider === model.provider &&
		performance.modelId === model.id &&
		performance.generationMs > 0
			? {
					tokensPerSecond:
						performance.outputTokens / (performance.generationMs / 1000),
					ttftMs: performance.ttftMs,
				}
			: undefined;
	if (!median && !current) return undefined;
	const verdict =
		current && median
			? compareSpeedToMedian(
					current.tokensPerSecond,
					median.medianOutputTokensPerSecond,
				)
			: undefined;
	return { median, current, verdict };
}
