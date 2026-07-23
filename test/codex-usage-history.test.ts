import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	computeCodexUsageStats,
	formatRunoutIn,
	loadCodexUsageHistory,
	recordCodexUsageSample,
	saveCodexUsageHistory,
	type CodexUsageSample,
} from "../src/integrations/codex-usage-history.ts";
import type {
	CodexUsage,
	CodexUsageWindow,
} from "../src/integrations/codex-usage.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function tempPath(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-codex-history-"));
	roots.push(root);
	return path.join(root, "history.json");
}

function window(overrides: Partial<CodexUsageWindow> = {}): CodexUsageWindow {
	return {
		usedPercent: 50,
		windowSeconds: 18_000,
		resetAfterSeconds: 9_000,
		resetAt: 1_000,
		...overrides,
	};
}

describe("loadCodexUsageHistory / saveCodexUsageHistory", () => {
	test("returns an empty history when the file is missing", () => {
		expect(
			loadCodexUsageHistory(path.join(os.tmpdir(), "does-not-exist.json")),
		).toEqual({});
	});

	test("round-trips a history written to disk", () => {
		const file = tempPath();
		const history = { 18000: [{ t: 1, usedPercent: 10, resetAt: 1 }] };
		saveCodexUsageHistory(history, file);
		expect(loadCodexUsageHistory(file)).toEqual(history);
	});

	test("ignores malformed entries", () => {
		const file = tempPath();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(
			file,
			JSON.stringify({
				18000: [{ t: 1 }, "bad", { t: 2, usedPercent: 5, resetAt: 1 }],
			}),
		);
		expect(loadCodexUsageHistory(file)).toEqual({
			18000: [{ t: 2, usedPercent: 5, resetAt: 1 }],
		});
	});
});

describe("recordCodexUsageSample", () => {
	const usage: CodexUsage = { windows: [window()] };

	test("records a first sample immediately", () => {
		const history = recordCodexUsageSample({}, usage, 1_000);
		expect(history[18_000]).toEqual([
			{ t: 1_000, usedPercent: 50, resetAt: 1_000 },
		]);
	});

	test("throttles samples that arrive within the minimum interval", () => {
		let history = recordCodexUsageSample({}, usage, 1_000);
		history = recordCodexUsageSample(history, usage, 1_000 + 60_000);
		expect(history[18_000]).toHaveLength(1);
	});

	test("always records a new sample immediately after a reset", () => {
		let history = recordCodexUsageSample({}, usage, 1_000);
		const resetUsage: CodexUsage = {
			windows: [window({ usedPercent: 2, resetAt: 2_000 })],
		};
		history = recordCodexUsageSample(history, resetUsage, 1_000 + 60_000);
		expect(history[18_000]).toHaveLength(2);
		expect(history[18_000]?.[1]).toEqual({
			t: 1_000 + 60_000,
			usedPercent: 2,
			resetAt: 2_000,
		});
	});

	test("prunes samples older than the retention window", () => {
		const now = 20 * 24 * 60 * 60 * 1000;
		const history = recordCodexUsageSample(
			{ 18000: [{ t: 0, usedPercent: 1, resetAt: 1_000 }] },
			usage,
			now,
		);
		expect(history[18_000]).toEqual([
			{ t: now, usedPercent: 50, resetAt: 1_000 },
		]);
	});
});

describe("computeCodexUsageStats", () => {
	test("reports remaining percent from the live window", () => {
		const stats = computeCodexUsageStats([], window({ usedPercent: 30 }), 0);
		expect(stats.remainingPercent).toBe(70);
	});

	test("computes the last-hour delta within the same reset epoch", () => {
		const now = 2 * 60 * 60_000;
		const samples: CodexUsageSample[] = [
			{ t: 0, usedPercent: 10, resetAt: 1 },
			{ t: 30 * 60_000, usedPercent: 15, resetAt: 1 },
			{ t: now - 60 * 60_000, usedPercent: 20, resetAt: 1 },
		];
		const stats = computeCodexUsageStats(
			samples,
			window({ usedPercent: 30, resetAt: 1 }),
			now,
		);
		expect(stats.lastHourDeltaPercent).toBe(10);
	});

	test("does not treat a reset as negative consumption", () => {
		const now = 2 * 60 * 60_000;
		const samples: CodexUsageSample[] = [
			{ t: 0, usedPercent: 95, resetAt: 1 },
			{ t: now - 30 * 60_000, usedPercent: 2, resetAt: 2 },
		];
		const stats = computeCodexUsageStats(
			samples,
			window({ usedPercent: 5, resetAt: 2 }),
			now,
		);
		expect(stats.ratePercentPerHour).toBeDefined();
		// Total consumption (3 points, ignoring the reset gap) over the full 2h span.
		expect(stats.ratePercentPerHour).toBeCloseTo(1.5, 5);
	});

	test("predicts a runout timestamp from the recent rate", () => {
		const now = 2 * 60 * 60_000;
		const samples: CodexUsageSample[] = [
			{ t: now - 60 * 60_000, usedPercent: 40, resetAt: 1 },
		];
		const stats = computeCodexUsageStats(
			samples,
			window({ usedPercent: 50, resetAt: 1, resetAfterSeconds: 3_600 }),
			now,
		);
		expect(stats.lastHourDeltaPercent).toBe(10);
		expect(stats.predictedRunoutAt).toBeDefined();
		// Remaining 50% at 10%/h => 5h to exhaustion.
		expect(stats.predictedRunoutAt).toBeCloseTo(now + 5 * 3_600_000, -2);
	});

	test("flags when the projected runout lands before the window resets", () => {
		const now = 2 * 60 * 60_000;
		const resetAtSeconds = now / 1000 + 3_600; // resets in 1h
		const samples: CodexUsageSample[] = [
			{ t: now - 60 * 60_000, usedPercent: 85, resetAt: resetAtSeconds },
		];
		const stats = computeCodexUsageStats(
			samples,
			window({
				usedPercent: 95,
				resetAt: resetAtSeconds,
				resetAfterSeconds: 3_600,
			}),
			now,
		);
		expect(stats.runsOutBeforeReset).toBe(true);
	});

	test("does not project a runout without enough history", () => {
		const stats = computeCodexUsageStats([], window({ usedPercent: 50 }), 0);
		expect(stats.predictedRunoutAt).toBeUndefined();
		expect(stats.ratePercentPerHour).toBeUndefined();
	});
});

describe("formatRunoutIn", () => {
	test("reports steady when there is no projection", () => {
		expect(formatRunoutIn(undefined)).toBe("steady");
	});

	test("formats a multi-hour projection", () => {
		expect(formatRunoutIn(5 * 3_600_000, 0)).toBe("5h 0m");
	});

	test("treats a past projection as now", () => {
		expect(formatRunoutIn(0, 1_000)).toBe("now");
	});
});
