import { describe, expect, test } from "bun:test";
import {
	compactTokenCount,
	compactionCompletionForItem,
	compactionCompletionFromResult,
	compactionSuccessText,
	compactionSummaryCaption,
	countCompactionMessages,
	countRetainedContextMessages,
	parseCompactionTelemetry,
	parseOneRoundDetails,
	parseOneRoundProgress,
	applyOneRoundLaneDeltas,
	ONE_ROUND_LANE_TEXT_CAP,
	parseSmartCompactProgress,
	type OneRoundDetails,
	type OneRoundProgress,
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

	test("compactionCompletionForItem attaches completion only to the newest notice", () => {
		const completion = { tokensBefore: 152_000, estimatedTokensAfter: 32_000 };
		const items = [
			{ id: "u1", kind: "user", text: "hello" },
			{ id: "s1", kind: "system", text: "Context compacted." },
			{ id: "t1", kind: "tool" },
			{ id: "u2", kind: "user", text: "next" },
			{ id: "s2", kind: "system", text: "Context compacted." },
		] as const;
		expect(compactionCompletionForItem(items, "s2", completion)).toEqual(completion);
		expect(compactionCompletionForItem(items, "s1", completion)).toBeUndefined();
		expect(compactionCompletionForItem(items, "u2", completion)).toBeUndefined();
		expect(compactionCompletionForItem(items, "s2", undefined)).toBeUndefined();
		expect(compactionCompletionForItem([], "s2", completion)).toBeUndefined();
	});
});

describe("pi-one-round-compaction details", () => {
	const details: OneRoundDetails = {
		plugin: "pi-one-round-compaction",
		version: 2,
		lanes: [
			{ lane: "intent", model: "opencode-go/muse-spark-1.2-contributor", thinkingLevel: "low", durationMs: 4123 },
			{ lane: "execution", model: "opencode-go/muse-spark-1.2-contributor", thinkingLevel: "low", durationMs: 4233 },
		],
		wallTimeMs: 4600,
		keepRecentTokens: 32_000,
		boundaryMode: "whole-turn",
		retainedTurns: 3,
		estimatedRetainedTokens: 34_200,
		isSplitTurn: false,
		readFiles: ["src/a.ts"],
		modifiedFiles: ["src/b.ts"],
		git: { root: "/repo", branch: "main", head: "abc123", dirty: [], truncated: false },
		intentWorkflow: { active: true, workstream: "fix-flicker", hasPlan: true },
	};

	const v4Usage = {
		input: 1_200,
		output: 600,
		cacheRead: 80,
		cacheWrite: 0,
		cacheWrite1h: 0,
		reasoning: 200,
		totalTokens: 1_880,
		cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0, total: 0.031 },
	};
	const detailsV4: OneRoundDetails = {
		...details,
		version: 4 as const,
		lanes: details.lanes.map((lane) => ({ ...lane, usage: v4Usage })),
		targetPostCompactTokens: 32_000,
		effectiveRecentTokenBudget: 30_000,
		estimatedTokensAfter: 31_000,
		targetExceeded: false,
		traceReadFiles: ["src/a.ts"],
		traceEditedFiles: ["src/b.ts"],
		userMessages: [{ timestamp: 1_000, text: "hello", originalChars: 5, trimmed: false }],
		knownUserArtifactIds: ["U0001"],
		durableUserReferences: [{ id: "U0001", state: "active", misses: 0, semanticNote: "exact" }],
		renderBudgets: {
			intentWorkflowChars: 100,
			gitStateChars: 200,
			editedFilesChars: 300,
			readFilesChars: 400,
			userMessagesChars: 500,
			userArtifactReferencesChars: 600,
		},
	};

	test("parses a valid version-2 details object", () => {
		expect(parseOneRoundDetails(details)).toEqual(details);
	});

	test("parses the installed version-4 details shape without dropping usage or metadata", () => {
		expect(parseOneRoundDetails(detailsV4)).toEqual(detailsV4);
		const completion = compactionCompletionFromResult({ details: detailsV4 });
		expect(completion.wallTimeMs).toBe(detailsV4.wallTimeMs);
		expect(completion.lanes).toEqual(detailsV4.lanes);
		expect(completion.estimatedTokensAfter).toBe(detailsV4.estimatedTokensAfter);
		expect(completion.git).toEqual(detailsV4.git);
		const invalidUsage = detailsV4.lanes.map((lane) => ({
			...lane,
			usage: { ...lane.usage, cost: { ...lane.usage.cost, total: -1 } },
		}));
		expect(parseOneRoundDetails({ ...detailsV4, extra: true })).toBeUndefined();
		expect(parseOneRoundDetails({ ...detailsV4, lanes: invalidUsage })).toBeUndefined();
	});

	test("accepts every plugin boundary mode and preserves split-turn details", () => {
		for (const boundaryMode of ["whole-turn", "split-turn", "pi-fallback"] as const) {
			const parsed = parseOneRoundDetails({
				...details,
				boundaryMode,
				isSplitTurn: boundaryMode === "split-turn",
			});
			expect(parsed?.boundaryMode).toBe(boundaryMode);
		}

		const splitDetails = {
			...details,
			boundaryMode: "split-turn" as const,
			isSplitTurn: true,
		};
		const completion = compactionCompletionFromResult({ details: splitDetails });
		expect(completion.boundaryMode).toBe("split-turn");
		expect(compactionSummaryCaption(completion)).toContain("split-turn boundary");
		const fallbackCompletion = compactionCompletionFromResult({
			details: { ...details, boundaryMode: "pi-fallback" },
		});
		expect(compactionSummaryCaption(fallbackCompletion)).toContain("Pi fallback boundary");
	});

	test("rejects foreign plugins, wrong versions, and malformed shapes", () => {
		for (const value of [
			undefined,
			null,
			42,
			"pi-one-round-compaction",
			{ ...details, plugin: "other" },
			{ ...details, version: 1 },
			{ ...details, version: 3 },
			{ ...details, lanes: [] },
			{ ...details, lanes: [{ lane: "intent" }] },
			{ ...details, lanes: [{ lane: "weird", model: "m", thinkingLevel: "low", durationMs: 1 }] },
			{ ...details, wallTimeMs: -1 },
			{ ...details, boundaryMode: "split" },
			{ ...details, retainedTurns: 1.5 },
			{ ...details, readFiles: ["ok", 42] },
			{ ...details, git: { root: "/repo", branch: "main" } },
			{ ...details, intentWorkflow: { active: true } },
			{ ...details, intentWorkflow: { active: true, workstream: "wf", hasPlan: "yes" } },
		])
			expect(parseOneRoundDetails(value)).toBeUndefined();
	});

	test("tolates optional git absence and inactive workflow", () => {
		const { git: _git, ...withoutGit } = details;
		expect(parseOneRoundDetails({ ...withoutGit, intentWorkflow: { active: false } })).toEqual({
			plugin: "pi-one-round-compaction",
			version: 2,
			lanes: withoutGit.lanes,
			wallTimeMs: withoutGit.wallTimeMs,
			keepRecentTokens: withoutGit.keepRecentTokens,
			boundaryMode: withoutGit.boundaryMode,
			retainedTurns: withoutGit.retainedTurns,
			estimatedRetainedTokens: withoutGit.estimatedRetainedTokens,
			isSplitTurn: withoutGit.isSplitTurn,
			readFiles: withoutGit.readFiles,
			modifiedFiles: withoutGit.modifiedFiles,
			intentWorkflow: { active: false },
		});
	});

	test("folds one-round details into the compaction completion", () => {
		const completion = compactionCompletionFromResult({
			summary: "# Compaction Checkpoint",
			tokensBefore: 152_000,
			estimatedTokensAfter: 32_000,
			firstKeptEntryId: "keep",
			details,
		});
		expect(completion.plugin).toBe("pi-one-round-compaction");
		expect(completion.wallTimeMs).toBe(4600);
		expect(completion.boundaryMode).toBe("whole-turn");
		expect(completion.retainedTurns).toBe(3);
		expect(completion.lanes).toHaveLength(2);
		expect(completion.git?.branch).toBe("main");
		expect(completion.intentWorkflow?.workstream).toBe("fix-flicker");
		expect(completion.tokensBefore).toBe(152_000);
	});

	test("leaves completions without plugin details untouched", () => {
		const completion = compactionCompletionFromResult({
			summary: "native",
			tokensBefore: 100,
			estimatedTokensAfter: 20,
		});
		expect(completion.plugin).toBeUndefined();
		expect(completion.lanes).toBeUndefined();
		expect(completion.summary).toBe("native");
	});

	test("caption shows lanes and retained turns for plugin completions", () => {
		const completion = compactionCompletionFromResult({
			summary: "# Compaction Checkpoint",
			tokensBefore: 152_000,
			estimatedTokensAfter: 32_000,
			details,
		});
		const caption = compactionSummaryCaption(completion);
		expect(caption).toContain("2 parallel lanes");
		expect(caption).toContain("kept 3 complete turns");
		expect(caption).toContain("whole-turn boundary");
	});
});

describe("pi-one-round-compaction live progress", () => {
	const progress: OneRoundProgress = {
		v: 1,
		runId: "run-1",
		seq: 7,
		phase: "streaming",
		mode: "workflow",
		reason: "threshold",
		elapsedMs: 2140,
		retainedTurns: 3,
		estimatedRetainedTokens: 34_200,
		keepRecentTokens: 32_000,
		boundaryMode: "whole-turn",
		intentWorkflow: { active: true, workstream: "fix-flicker", hasPlan: true },
		lanes: {
			intent: { role: "implementation", state: "streaming", chars: 1204, delta: " new text", elapsedMs: 1990 },
			execution: { role: "evidence", state: "done", chars: 4200, elapsedMs: 2100 },
		},
	};

	test("parses a valid live progress frame", () => {
		expect(parseOneRoundProgress(progress)).toEqual(progress);
	});

	test("parses a serialized live progress frame from the RPC status wire", () => {
		expect(parseOneRoundProgress(JSON.stringify(progress))).toEqual(progress);
	});

	test("rejects malformed serialized live progress frames safely", () => {
		expect(parseOneRoundProgress('{"v":1,')).toBeUndefined();
		expect(parseOneRoundProgress(JSON.stringify({ ...progress, v: 2 }))).toBeUndefined();
	});

	test("accepts split-turn in the plugin live progress frame", () => {
		const splitProgress: OneRoundProgress = {
			...progress,
			boundaryMode: "split-turn",
		};
		expect(parseOneRoundProgress(splitProgress)).toEqual(splitProgress);
		expect(parseOneRoundProgress({ ...progress, boundaryMode: "pi-fallback" })?.boundaryMode).toBe("pi-fallback");
	});

	test("accepts normal mode without intent workflow", () => {
		const { mode: _mode, intentWorkflow: _iw, ...rest } = progress;
		const parsed = parseOneRoundProgress({ ...rest, mode: "normal" });
		expect(parsed?.mode).toBe("normal");
		expect(parsed?.intentWorkflow).toBeUndefined();
	});

	test("rejects malformed frames", () => {
		for (const value of [
			undefined,
			"not progress",
			{ ...progress, v: 2 },
			{ ...progress, seq: -1 },
			{ ...progress, phase: "unknown" },
			{ ...progress, mode: "other" },
			{ ...progress, reason: "sometimes" },
			{ ...progress, boundaryMode: "split" },
			{ ...progress, lanes: {} },
			{ ...progress, lanes: { intent: { role: "x", state: "queued", chars: 0 } } },
			{ ...progress, lanes: { intent: { role: "intent", state: "weird", chars: 0 } } },
			{ ...progress, intentWorkflow: { active: false, workstream: "wf", hasPlan: false } },
		])
			expect(parseOneRoundProgress(value)).toBeUndefined();
	});

	test("drops delta from the parsed payload when absent", () => {
		const { lanes: { intent: _i, ...lanesOuter }, ...rest } = progress as any;
		const { delta: _d, ...intent } = progress.lanes.intent as any;
		const parsed = parseOneRoundProgress({ ...rest, lanes: { ...lanesOuter, intent } });
		expect(parsed?.lanes.intent.delta).toBeUndefined();
	});
	test("accumulates per-lane deltas for the active run", () => {
		const frame1 = parseOneRoundProgress(progress)!;
		const afterFirst = applyOneRoundLaneDeltas(undefined, frame1);
		expect(afterFirst).toEqual({ runId: "run-1", intent: " new text", execution: "" });

		const frame2 = parseOneRoundProgress({ ...frame1, seq: 8, lanes: { intent: { ...frame1.lanes.intent, chars: 1304, delta: " more" }, execution: { ...frame1.lanes.execution, delta: "evidence text" } } })!;
		const afterSecond = applyOneRoundLaneDeltas(afterFirst, frame2);
		expect(afterSecond.intent).toBe(" new text more");
		expect(afterSecond.execution).toBe("evidence text");
	});

	test("resets accumulation when the run id changes", () => {
		const first = applyOneRoundLaneDeltas(undefined, parseOneRoundProgress(progress)!);
		const nextRun = parseOneRoundProgress({ ...progress, runId: "run-2", lanes: { intent: { role: "intent", state: "streaming", chars: 5, delta: "fresh" }, execution: { role: "execution", state: "queued", chars: 0 } } })!;
		const after = applyOneRoundLaneDeltas(first, nextRun);
		expect(after).toEqual({ runId: "run-2", intent: "fresh", execution: "" });
	});

	test("keeps only the tail of long lane text", () => {
		let state = applyOneRoundLaneDeltas(undefined, parseOneRoundProgress(progress)!);
		const chunk = "x".repeat(ONE_ROUND_LANE_TEXT_CAP);
		for (let i = 0; i < 3; i++) {
			const frame = parseOneRoundProgress({ ...progress, seq: 10 + i, lanes: { ...progress.lanes, intent: { ...progress.lanes.intent, chars: (i + 1) * ONE_ROUND_LANE_TEXT_CAP, delta: chunk } } })!;
			state = applyOneRoundLaneDeltas(state, frame);
		}
		expect(state.intent).toHaveLength(ONE_ROUND_LANE_TEXT_CAP);
		expect(state.intent.endsWith(chunk.slice(-100))).toBe(true);
	});
	test("keeps the tail on a code point boundary", () => {
		// The cap cut lands between the surrogate halves; the lone low
		// surrogate must be dropped instead of displayed as a replacement char.
		const emoji = "\ud83d\ude00"; // 😀 astral character
		const delta = "a" + emoji + "c".repeat(ONE_ROUND_LANE_TEXT_CAP - 1);
		const frame = parseOneRoundProgress({ ...progress, lanes: { intent: { ...progress.lanes.intent, chars: delta.length, delta }, execution: { ...progress.lanes.execution } } })!;
		const state = applyOneRoundLaneDeltas(undefined, frame);
		expect(state.intent).toBe("c".repeat(ONE_ROUND_LANE_TEXT_CAP - 1));
		const first = state.intent.charCodeAt(0);
		expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
	});

	test("keeps prior text when a frame carries no deltas", () => {
		const first = applyOneRoundLaneDeltas(undefined, parseOneRoundProgress(progress)!);
		const quiet = parseOneRoundProgress({ ...progress, seq: 9, lanes: { intent: { ...progress.lanes.intent, delta: undefined }, execution: { ...progress.lanes.execution } } })!;
		expect(applyOneRoundLaneDeltas(first, quiet)).toEqual(first);
	});
});
