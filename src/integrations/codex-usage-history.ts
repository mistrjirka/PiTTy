import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodexUsage, CodexUsageWindow } from "./codex-usage.ts";

/**
 * A single point-in-time reading of one rate-limit window, persisted to disk
 * so consumption speed and a runout estimate can be derived across restarts.
 * `resetAt` (seconds, as returned by the API) doubles as an epoch id: it
 * only changes when the window actually resets, so samples can be grouped
 * by epoch without needing wall-clock reset detection.
 */
export type CodexUsageSample = {
	t: number;
	usedPercent: number;
	resetAt: number;
};

export type CodexUsageHistory = Record<number, CodexUsageSample[]>;

const MAX_HISTORY_MS = 9 * 24 * 60 * 60 * 1000;
const MIN_SAMPLE_INTERVAL_MS = 4 * 60 * 1000;

export function defaultCodexUsageHistoryPath(): string {
	const stateHome = process.env.XDG_STATE_HOME?.trim();
	const base = stateHome
		? path.join(stateHome, "pitty")
		: path.join(os.homedir(), ".local", "state", "pitty");
	return path.join(base, "codex-usage-history.json");
}

function isSample(value: unknown): value is CodexUsageSample {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.t === "number" &&
		typeof record.usedPercent === "number" &&
		typeof record.resetAt === "number"
	);
}

export function loadCodexUsageHistory(
	filePath: string = defaultCodexUsageHistoryPath(),
): CodexUsageHistory {
	try {
		const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
		if (!raw || typeof raw !== "object") return {};
		const history: CodexUsageHistory = {};
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
			const windowSeconds = Number(key);
			if (!Number.isFinite(windowSeconds) || !Array.isArray(value)) continue;
			history[windowSeconds] = value.filter(isSample);
		}
		return history;
	} catch {
		return {};
	}
}

export function saveCodexUsageHistory(
	history: CodexUsageHistory,
	filePath: string = defaultCodexUsageHistoryPath(),
): void {
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
		fs.writeFileSync(filePath, JSON.stringify(history), { mode: 0o600 });
	} catch {
		// Local usage history is a best-effort convenience; never let it crash the UI.
	}
}

/**
 * Appends a sample for each window in `usage`, throttled to at most one
 * sample every `MIN_SAMPLE_INTERVAL_MS` (a reset is always recorded
 * immediately, since it marks a new epoch boundary) and pruned to the
 * trailing `MAX_HISTORY_MS`.
 */
export function recordCodexUsageSample(
	history: CodexUsageHistory,
	usage: CodexUsage,
	now: number = Date.now(),
): CodexUsageHistory {
	const next: CodexUsageHistory = { ...history };
	for (const window of usage.windows) {
		const existing = next[window.windowSeconds] ?? [];
		const last = existing.at(-1);
		const isReset = !last || last.resetAt !== window.resetAt;
		const samples =
			isReset || now - last.t >= MIN_SAMPLE_INTERVAL_MS
				? [
						...existing,
						{
							t: now,
							usedPercent: window.usedPercent,
							resetAt: window.resetAt,
						},
					]
				: existing;
		next[window.windowSeconds] = samples.filter(
			(sample) => now - sample.t <= MAX_HISTORY_MS,
		);
	}
	return next;
}

export type CodexUsageStats = {
	remainingPercent: number;
	/** Percentage points consumed in roughly the last hour, within the current reset epoch. */
	lastHourDeltaPercent?: number;
	/** Average consumption speed in percentage points per hour, blended across the retained history. */
	ratePercentPerHour?: number;
	/** How many hours of history the rate above is based on. */
	rateSpanHours?: number;
	/** Projected timestamp (ms) at which usage would hit 100% at the current rate. */
	predictedRunoutAt?: number;
	/** True when the projected runout would land before the window's own reset. */
	runsOutBeforeReset?: boolean;
};

const MIN_RATE_SPAN_MS = 30 * 60_000;

/**
 * Turns raw samples plus the live window reading into the derived stats
 * shown in the UI. Resets never count as "negative consumption": a drop in
 * `usedPercent` (or a change in `resetAt`) marks a new epoch, and only
 * within-epoch increases are summed towards the consumption rate.
 */
export function computeCodexUsageStats(
	samples: CodexUsageSample[],
	current: CodexUsageWindow,
	now: number = Date.now(),
): CodexUsageStats {
	const remainingPercent = Math.max(0, 100 - current.usedPercent);
	const ordered = [
		...samples,
		{ t: now, usedPercent: current.usedPercent, resetAt: current.resetAt },
	].sort((a, b) => a.t - b.t);

	const hourAgo = now - 60 * 60_000;
	const currentEpoch = ordered.filter(
		(sample) => sample.resetAt === current.resetAt,
	);
	let hourAnchor: CodexUsageSample | undefined;
	for (let i = currentEpoch.length - 1; i >= 0; i--) {
		const sample = currentEpoch[i];
		if (sample && sample.t <= hourAgo) {
			hourAnchor = sample;
			break;
		}
	}
	const lastHourDeltaPercent = hourAnchor
		? Math.max(0, current.usedPercent - hourAnchor.usedPercent)
		: undefined;

	let consumed = 0;
	for (let i = 1; i < ordered.length; i++) {
		const prev = ordered[i - 1];
		const curr = ordered[i];
		if (!prev || !curr) continue;
		if (curr.resetAt === prev.resetAt && curr.usedPercent >= prev.usedPercent) {
			consumed += curr.usedPercent - prev.usedPercent;
		}
		// A reset epoch boundary (resetAt changed, or usedPercent dropped) is
		// skipped: the gap it spans doesn't count as usage either way.
	}
	const spanMs =
		ordered.length > 1 ? (ordered.at(-1)?.t ?? 0) - (ordered[0]?.t ?? 0) : 0;
	const hasEnoughSpan = spanMs >= MIN_RATE_SPAN_MS;
	const ratePercentPerHour = hasEnoughSpan
		? consumed / (spanMs / 3_600_000)
		: undefined;
	const rateSpanHours = hasEnoughSpan ? spanMs / 3_600_000 : undefined;

	let predictedRunoutAt: number | undefined;
	let runsOutBeforeReset: boolean | undefined;
	const rateForPrediction =
		lastHourDeltaPercent && lastHourDeltaPercent > 0
			? lastHourDeltaPercent
			: ratePercentPerHour;
	if (rateForPrediction && rateForPrediction > 0 && remainingPercent > 0) {
		predictedRunoutAt =
			now + (remainingPercent / rateForPrediction) * 3_600_000;
		runsOutBeforeReset = predictedRunoutAt < current.resetAt * 1000;
	}

	return {
		remainingPercent,
		...(lastHourDeltaPercent !== undefined ? { lastHourDeltaPercent } : {}),
		...(ratePercentPerHour !== undefined ? { ratePercentPerHour } : {}),
		...(rateSpanHours !== undefined ? { rateSpanHours } : {}),
		...(predictedRunoutAt !== undefined ? { predictedRunoutAt } : {}),
		...(runsOutBeforeReset !== undefined ? { runsOutBeforeReset } : {}),
	};
}

/** Formats a runout projection like `formatResetIn`, e.g. `2d 4h` or `no data yet`. */
export function formatRunoutIn(
	predictedRunoutAt: number | undefined,
	now: number = Date.now(),
): string {
	if (predictedRunoutAt === undefined) return "steady";
	const seconds = (predictedRunoutAt - now) / 1000;
	if (seconds <= 0) return "now";
	const totalMinutes = Math.floor(seconds / 60);
	const days = Math.floor(totalMinutes / (60 * 24));
	const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}
