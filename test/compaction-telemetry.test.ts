import { describe, expect, test } from "bun:test";
import {
	compactTokenCount,
	compactionCompletionFromResult,
	compactionSuccessText,
	compactionSummaryCaption,
	countCompactionMessages,
	countRetainedContextMessages,
	parseCompactionTelemetry,
	parseSmartCompactProgress,
} from "../src/state/compaction-telemetry.ts";

describe("compaction telemetry boundary", () => {
	test("accepts only documented Smart Compact progress statuses", () => {
		expect(parseSmartCompactProgress("Smart Compact 1/5 · Extract")).toBe("Smart Compact 1/5 · Extract");
		expect(parseSmartCompactProgress("Smart Compact 5/5 · Apply")).toBe("Smart Compact 5/5 · Apply");
		for (const value of [
			undefined,
			"Smart Compact 2/5 · Explore",
			"Smart Compact 3/5 · Synthesize",
			"Smart Compact 4/5 · Verify",
			"Smart Compact 6/5 · Apply",
			"Smart Compact 1/5 · Apply",
			42,
		])
			expect(parseSmartCompactProgress(value)).toBeUndefined();
	});
	test("decodes the strict wire payload", () => {
		expect(parseCompactionTelemetry(JSON.stringify({ version: 1, phase: "preparing", attempt: 1, tokensBefore: 120 }))).toEqual({
			version: 1,
			phase: "preparing",
			attempt: 1,
			tokensBefore: 120,
		});
	});

	test("rejects malformed, unknown, wrong-version, and invalid field payloads", () => {
		expect(parseCompactionTelemetry("not json")).toBeUndefined();
		for (const payload of [
			{ version: 1, phase: "preparing", extra: true },
			{ version: 2, phase: "preparing" },
			{ version: 1, phase: "running" },
			{ version: 1, phase: "preparing", reason: "timer" },
			{ version: 1, phase: "preparing", contextPercent: 101 },
			{ version: 1, phase: "preparing", retainedContextMessages: 2.5 },
			{ version: 1, phase: "preparing", attempt: 1.5 },
		]) {
			expect(parseCompactionTelemetry(JSON.stringify(payload))).toBeUndefined();
		}
	});

	test("counts turn prefixes and only retained message entries", () => {
		const entries = [
			{ id: "before", type: "message" },
			{ id: "keep", type: "message" },
			{ id: "compaction", type: "compaction" },
			{ id: "tool", type: "toolResult" },
			{ id: "after", type: "message" },
		];
		expect(countCompactionMessages({ firstKeptEntryId: "keep", messagesToSummarize: [1, 2], turnPrefixMessages: [3] }, entries)).toEqual({
			summarizingContextMessages: 3,
			plannedRetainedContextMessages: 2,
		});
		expect(countRetainedContextMessages(entries, "keep")).toBe(2);
		expect(countRetainedContextMessages(entries, "missing")).toBeUndefined();
	});

	test("formats compact token counts and truthful terminal results", () => {
		expect(compactTokenCount(950)).toBe("950");
		expect(compactTokenCount(150_000)).toBe("150K");
		expect(compactTokenCount(1_250_000)).toBe("1.3M");
		expect(
			compactionSuccessText(
				{ tokensBefore: 150_000, estimatedTokensAfter: 32_000 },
				23,
			),
		).toBe(
			"Context compacted (150K → ~32K tokens · kept 23 recent context messages).",
		);
		expect(compactionSuccessText(undefined)).toBe("Context compacted.");
		expect(
			compactionSuccessText({
				tokensBefore: 150_000,
				estimatedTokensAfter: 32_000,
				retainedContextMessages: 23,
			}),
		).toContain("kept 23 recent context messages");
	});

	test("retains only finite completion metadata for late terminal status", () => {
		expect(
			compactionCompletionFromResult(
				{ tokensBefore: 150_000, estimatedTokensAfter: 32_000 },
				23,
				4,
			),
		).toEqual({
			tokensBefore: 150_000,
			estimatedTokensAfter: 32_000,
			retainedContextMessages: 23,
			attempt: 4,
		});
		expect(
			compactionCompletionFromResult({ tokensBefore: Number.NaN }, 2.5),
		).toEqual({});
	});

	test("compactionCompletionFromResult retains the summary text", () => {
		expect(
			compactionCompletionFromResult({
				summary: "  The agent verified the release workflow.  ",
				tokensBefore: 50_000,
			estimatedTokensAfter: 12_000,
			}),
		).toEqual({
			summary: "The agent verified the release workflow.",
			tokensBefore: 50_000,
			estimatedTokensAfter: 12_000,
		});
		expect(compactionCompletionFromResult({ summary: "   " })).toEqual({});
		expect(compactionCompletionFromResult({ summary: 42 })).toEqual({});
	});

	test("compactionSummaryCaption formats sizes, reason, duration, and kept messages", () => {
		expect(
			compactionSummaryCaption({
				tokensBefore: 152_000,
				estimatedTokensAfter: 32_000,
				reason: "threshold",
				durationMs: 2_300,
				retainedContextMessages: 41,
			}),
		).toBe("152K → ~32K · threshold · 2.3s · kept 41 messages");
		expect(compactionSummaryCaption({ tokensBefore: 12_000 })).toBe("12K");
		expect(compactionSummaryCaption({})).toBe("");
		expect(compactionSummaryCaption({ durationMs: 400 })).toBe("400ms");
	});
});
