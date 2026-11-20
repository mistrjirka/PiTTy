import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RequestPerformance } from "./request-metrics.ts";

export type ModelPerformanceSample = {
  timestamp: number;
  ttftMs: number;
  outputTokensPerSecond: number;
  /**
   * 3 = latency starts at the Pi turn boundary. Earlier versions could record
   * near-zero first-output delay when a provider stamped messages late.
   * Output rate continues to exclude prefill and rejects buffered bursts.
   */
  version?: 2 | 3;
};
const SAMPLE_VERSION: 3 = 3;
export type ModelPerformanceHistory = Record<string, ModelPerformanceSample[]>;
export type ModelPerformanceStats = {
  medianTtftMs: number;
  medianOutputTokensPerSecond: number;
  /** Median of each sample's `effectiveTokensPerSecond`. */
  medianEffectiveTokensPerSecond: number;
};

/**
 * A reply's felt speed folds the wait for the first token into the output
 * rate: the rate a reply of `REFERENCE_REPLY_TOKENS` would have end to end.
 * A model with a fast stream but a slow start reads slower than its raw
 * tok/s, and a quick starter with a modest stream reads faster.
 * TODO: 500 tokens is a typical coding reply, chosen by judgement. Revisit if
 * verdicts feel dominated by first-token time (raise it) or ignore it (lower).
 */
export const REFERENCE_REPLY_TOKENS = 500;

export function effectiveTokensPerSecond(ttftMs: number, outputTokensPerSecond: number): number | undefined {
  if (!Number.isFinite(ttftMs) || ttftMs < 0 || !Number.isFinite(outputTokensPerSecond) || outputTokensPerSecond <= 0) return undefined;
  return REFERENCE_REPLY_TOKENS / (ttftMs / 1000 + REFERENCE_REPLY_TOKENS / outputTokensPerSecond);
}
const RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_SAMPLES_PER_MODEL = 1_000;
// Keep recording and selector reads bounded even during unusually busy use.

export function modelPerformanceKey(provider: string, modelId: string): string { return `${provider}\u0000${modelId}`; }
export function defaultModelPerformanceHistoryPath(): string {
  const base = process.env.XDG_STATE_HOME?.trim() || path.join(os.homedir(), ".local", "state");
  return path.join(base, "pitty", "model-performance-history.json");
}
function validSample(
	value: unknown,
	now: number,
): value is ModelPerformanceSample {
	if (!value || typeof value !== "object") return false;
	const item = value as Record<string, unknown>;
	const timestamp = item.timestamp;
	const ttftMs = item.ttftMs;
	const outputTokensPerSecond = item.outputTokensPerSecond;
	return (
		typeof timestamp === "number" &&
		Number.isFinite(timestamp) &&
		timestamp >= 0 &&
		timestamp <= now &&
		now - timestamp <= RETENTION_MS &&
		typeof ttftMs === "number" &&
		Number.isFinite(ttftMs) &&
		ttftMs >= 0 &&
		typeof outputTokensPerSecond === "number" &&
		Number.isFinite(outputTokensPerSecond) &&
		outputTokensPerSecond > 0
	);
}

export function loadModelPerformanceHistory(
	filePath = defaultModelPerformanceHistoryPath(),
	now = Date.now(),
): ModelPerformanceHistory {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf8");
	} catch {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	const history: ModelPerformanceHistory = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (!Array.isArray(value)) continue;
		const samples: ModelPerformanceSample[] = [];
		for (
			let index = value.length - 1;
			index >= 0 && samples.length < MAX_SAMPLES_PER_MODEL;
			index -= 1
		) {
			const candidate = value[index];
			if (validSample(candidate, now)) samples.push(candidate);
		}
		samples.reverse();
		if (samples.length) history[key] = samples;
	}
	return history;
}

type HistoryFileStamp = { mtimeMs: number; ctimeMs: number; ino: number; size: number };
let cachedHistory:
	| { filePath: string; stamp: HistoryFileStamp; history: ModelPerformanceHistory }
	| undefined;

function stampOf(stat: fs.Stats): HistoryFileStamp {
	return { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, size: stat.size };
}
function sameStamp(a: HistoryFileStamp, b: HistoryFileStamp): boolean {
	return (
		a.mtimeMs === b.mtimeMs &&
		a.ctimeMs === b.ctimeMs &&
		a.ino === b.ino &&
		a.size === b.size
	);
}

/**
 * Like {@link loadModelPerformanceHistory}, but re-parses only when the file changed
 * (another PiTTy instance wrote it). The returned object is shared and never mutated.
 */
export function readModelPerformanceHistory(
	filePath = defaultModelPerformanceHistoryPath(),
): ModelPerformanceHistory {
	try {
		const stamp = stampOf(fs.statSync(filePath));
		if (cachedHistory?.filePath === filePath && sameStamp(cachedHistory.stamp, stamp))
			return cachedHistory.history;
		const history = loadModelPerformanceHistory(filePath);
		cachedHistory = { filePath, stamp, history };
		return history;
	} catch {
		cachedHistory = undefined;
		return {};
	}
}

export function saveModelPerformanceHistory(
	history: ModelPerformanceHistory,
	filePath = defaultModelPerformanceHistoryPath(),
): void {
	let temporary: string | undefined;
	try {
		const directory = path.dirname(filePath);
		fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
		temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
		fs.writeFileSync(temporary, JSON.stringify(history), { mode: 0o600 });
		fs.renameSync(temporary, filePath);
	} catch {
		// Local metrics are a best-effort convenience; never crash the UI.
	} finally {
		if (temporary) {
			try {
				fs.rmSync(temporary, { force: true });
			} catch {
				// A failed cleanup is harmless; the next save uses a new temp path.
			}
		}
	}
}

export function recordModelPerformanceSample(
	history: ModelPerformanceHistory,
	provider: string,
	modelId: string,
	performance: RequestPerformance,
	now = Date.now(),
): ModelPerformanceHistory {
	const normalizedProvider = provider.trim();
	const normalizedModelId = modelId.trim();
	if (
		!normalizedProvider ||
		!normalizedModelId ||
		performance.generationMs <= 0 ||
		performance.outputTokens <= 0 ||
		performance.ttftMs < 0
	)
		return history;
	const outputTokensPerSecond =
		performance.outputTokens / (performance.generationMs / 1000);
	if (!Number.isFinite(outputTokensPerSecond) || outputTokensPerSecond <= 0)
		return history;
	const key = modelPerformanceKey(normalizedProvider, normalizedModelId);
	const next: ModelPerformanceHistory = {};
	for (const [name, samples] of Object.entries(history)) {
		const retained = samples
			.filter(
				(sample) => sample.timestamp <= now && now - sample.timestamp <= RETENTION_MS,
			)
			.slice(-MAX_SAMPLES_PER_MODEL);
		if (retained.length) next[name] = retained;
	}
	const samples = [
		...(next[key] ?? []),
		{
			timestamp: now,
			ttftMs: performance.ttftMs,
			outputTokensPerSecond,
			version: SAMPLE_VERSION,
		},
	].slice(-MAX_SAMPLES_PER_MODEL);
	next[key] = samples;
	return next;
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
export function modelPerformanceStats(history: ModelPerformanceHistory, provider: string, modelId: string): ModelPerformanceStats | undefined {
  const all = history[modelPerformanceKey(provider, modelId)] ?? [];
  // Do not mix incompatible measurement boundaries into the same median.
  // Older samples remain in the file for inspection, not current comparisons.
  const now = Date.now();
  const samples = all.filter((sample) => sample.version === SAMPLE_VERSION && sample.timestamp <= now && now - sample.timestamp <= RETENTION_MS);
  if (!samples.length) return undefined;
  // Per-sample effective speed, then the median: combining the two separate
  // medians would pair a start and a stream from different requests.
  const effective = samples.flatMap((sample) => {
    const value = effectiveTokensPerSecond(sample.ttftMs, sample.outputTokensPerSecond);
    return value === undefined ? [] : [value];
  });
  return {
    medianTtftMs: median(samples.map((sample) => sample.ttftMs)),
    medianOutputTokensPerSecond: median(samples.map((sample) => sample.outputTokensPerSecond)),
    medianEffectiveTokensPerSecond: median(effective),
  };
}
export function formatModelPerformanceStats(stats: ModelPerformanceStats | undefined): string {
  // Same words as the sidebar speed rows, so no legend line is needed.
  return stats ? "median " + Math.round(stats.medianOutputTokensPerSecond) + " tok/s · first token " + (stats.medianTtftMs < 1000 ? Math.round(stats.medianTtftMs) + "ms" : (stats.medianTtftMs / 1000).toFixed(1) + "s") : "";
}
