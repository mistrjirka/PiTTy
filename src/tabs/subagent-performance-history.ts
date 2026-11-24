/**
 * Read the pi-subagent append-only request journal. Keep it separate from
 * the main-agent read/modify/write history so concurrent child completions
 * cannot be lost or counted twice by a PiTTy save.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelPerformanceHistory } from "./model-performance-history.ts";
import type { RequestPerformance } from "./request-metrics.ts";

const RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_DAY_BYTES = 8 * 1024 * 1024;
const MAX_PER_MODEL = 1_000;
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

export function defaultSubagentPerformanceDirectory(): string {
	const base = process.env.XDG_STATE_HOME?.trim() || path.join(os.homedir(), ".local", "state");
	return path.join(base, "pi-subagent", "model-performance");
}

export function parseRequestPerformance(value: unknown): RequestPerformance | undefined {
	if (!value || typeof value !== "object") return undefined;
	const item = value as Record<string, unknown>;
	const { provider, modelId, ttftMs, generationMs, outputTokens } = item;
	if (
		typeof provider !== "string" || !provider.trim() || provider.length > 256 ||
		typeof modelId !== "string" || !modelId.trim() || modelId.length > 1024 ||
		typeof ttftMs !== "number" || !Number.isFinite(ttftMs) || ttftMs < 0 ||
		typeof generationMs !== "number" || !Number.isFinite(generationMs) || generationMs < 1000 ||
		typeof outputTokens !== "number" || !Number.isSafeInteger(outputTokens) || outputTokens <= 0
	) return undefined;
	return { provider, modelId, ttftMs, generationMs, outputTokens };
}

function parseDay(file: string): ModelPerformanceHistory {
	const history: ModelPerformanceHistory = {};
	// Bound the read even if another process grows or replaces the file.
	const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
	try {
		const stat = fs.fstatSync(fd);
		if (!stat.isFile() || stat.size > MAX_DAY_BYTES) return history;
		const buffer = Buffer.alloc(stat.size);
		const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
		const contents = buffer.subarray(0, bytes).toString("utf8");
		// The final line can be in flight. It will be retried on the next stat change.
		for (const line of contents.slice(0, contents.lastIndexOf("\n") + 1).split("\n")) {
			try {
				const value = JSON.parse(line) as Record<string, unknown>;
				if (value?.version !== 3 || typeof value.timestamp !== "number" ||
					!Number.isFinite(value.timestamp) || value.timestamp < 0) continue;
				const sample = parseRequestPerformance(value);
				if (!sample?.provider || !sample.modelId) continue;
				const rate = sample.outputTokens * 1000 / sample.generationMs;
				if (!Number.isFinite(rate) || rate <= 0) continue;
				const key = `${sample.provider}\u0000${sample.modelId}`;
				(history[key] ??= []).push({
					timestamp: value.timestamp,
					ttftMs: sample.ttftMs,
					outputTokensPerSecond: rate,
					version: 3,
				});
			} catch { /* Skip torn and unknown records. */ }
		}
	} finally { fs.closeSync(fd); }
	// Keep cached daily segments bounded even when a single model is used heavily.
	for (const [key, samples] of Object.entries(history)) {
		history[key] = samples.sort((a, b) => a.timestamp - b.timestamp).slice(-MAX_PER_MODEL);
	}
	return history;
}

export function mergePerformanceHistories(
	histories: readonly ModelPerformanceHistory[],
	now = Date.now(),
): ModelPerformanceHistory {
	const merged: ModelPerformanceHistory = {};
	for (const history of histories) {
		for (const [key, samples] of Object.entries(history)) {
			const retained = samples.filter(sample => sample.timestamp <= now && now - sample.timestamp <= RETENTION_MS);
			if (retained.length) (merged[key] ??= []).push(...retained);
		}
	}
	for (const [key, samples] of Object.entries(merged)) {
		merged[key] = samples.sort((a, b) => a.timestamp - b.timestamp).slice(-MAX_PER_MODEL);
	}
	return merged;
}

type CachedDay = { stamp: string; history: ModelPerformanceHistory };
let cached: {
	directory: string;
	days: Map<string, CachedDay>;
	history: ModelPerformanceHistory;
	day: string;
} | undefined;

/** Stat only the bounded set of daily files; reparse changed segments only. */
export function readSubagentModelPerformanceHistory(
	directory = defaultSubagentPerformanceDirectory(),
	now = Date.now(),
): ModelPerformanceHistory {
	let names: string[];
	try { names = fs.readdirSync(directory); } catch { return {}; }
	const day = new Date(now).toISOString().slice(0, 10);
	const oldestDay = new Date(Math.max(0, now - RETENTION_MS)).toISOString().slice(0, 10);
	const days = new Map<string, CachedDay>();
	const previous = cached?.directory === directory ? cached : undefined;
	let changed = previous?.day !== day;
	for (const name of names.filter(name => DAY_FILE.test(name) && name.slice(0, 10) >= oldestDay && name.slice(0, 10) <= day).sort()) {
		try {
			const file = path.join(directory, name);
			const stat = fs.lstatSync(file);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DAY_BYTES) continue;
			const stamp = [stat.mtimeMs, stat.ctimeMs, stat.ino, stat.size].join(":");
			const old = previous?.days.get(name);
			if (old?.stamp === stamp) days.set(name, old);
			else {
				days.set(name, { stamp, history: parseDay(file) });
				changed = true;
			}
		} catch { /* A concurrently pruned file is no longer present. */ }
	}
	if (!changed && previous && days.size === previous.days.size) return previous.history;
	const history = mergePerformanceHistories([...days.values()].map(item => item.history), now);
	cached = { directory, days, history, day };
	return history;
}
