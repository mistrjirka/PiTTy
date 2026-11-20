import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import type { SubagentRun } from "../src/types.ts";
import { nextItemIsTool, toolArgSummary } from "../src/ui/message-format.tsx";
import {
	compareSpeedToMedian,
	latestModelSpeed,
	speedVerdictText,
} from "../src/ui/model-speed.ts";
import { contextMeterCells } from "../src/ui/sidebar-layout.ts";
import { splitDiffRows } from "../src/ui/diff-split.tsx";
import { subagentElapsedMs } from "../src/ui/subagent-format.ts";
import { type SubagentTarget, subagentTargets } from "../src/subagents/targets.ts";
import { tabStatusGlyph } from "../src/ui/tab-strip.tsx";
import type { ConversationItem } from "../src/types.ts";

describe("model speed verdict", () => {
	test("reads within ±10% of the median as usual, outside it as faster or slower", () => {
		expect(compareSpeedToMedian(52, 48)).toEqual({ kind: "usual" });
		expect(compareSpeedToMedian(44, 48)).toEqual({ kind: "usual" });
		expect(compareSpeedToMedian(61, 48)).toEqual({ kind: "faster", percent: 27 });
		expect(compareSpeedToMedian(37, 48)).toEqual({ kind: "slower", percent: 23 });
		expect(compareSpeedToMedian(0, 48)).toBeUndefined();
		expect(compareSpeedToMedian(50, Number.NaN)).toBeUndefined();
	});

	test("carries the verdict in glyphs, not colour alone", () => {
		expect(speedVerdictText({ kind: "faster", percent: 27 })).toBe("▲ 27% faster");
		expect(speedVerdictText({ kind: "slower", percent: 23 })).toBe("▼ 23% slower");
		expect(speedVerdictText({ kind: "usual" })).toBe("= usual");
	});

	test("never shows another model's reply as the selected model's speed", () => {
		const history = () => ({});
		const speed = latestModelSpeed(
			{ provider: "openai", id: "new" },
			{ provider: "openai", modelId: "old", ttftMs: 100, outputTokens: 100, generationMs: 1000 },
			history,
		);
		expect(speed).toBeUndefined();
		const own = latestModelSpeed(
			{ provider: "openai", id: "new" },
			{ provider: "openai", modelId: "new", ttftMs: 100, outputTokens: 100, generationMs: 2000 },
			history,
		);
		expect(own?.current?.tokensPerSecond).toBe(50);
		// No median yet: the speed shows without a verdict.
		expect(own?.verdict).toBeUndefined();
	});
});

describe("quiet transcript rows", () => {
	test("summarises a tool call by the argument a reader recognises", () => {
		expect(toolArgSummary({ command: "bun run  typecheck" })).toBe("bun run typecheck");
		expect(toolArgSummary({ pattern: "timeoutMs", path: "src/rpc" })).toBe('"timeoutMs" src/rpc');
		expect(toolArgSummary({ path: "src/app.tsx", edits: [] })).toBe("src/app.tsx");
		expect(toolArgSummary({})).toBe("");
		expect(toolArgSummary({ unknown: 1 })).toBe('{ "unknown": 1 }');
		expect(toolArgSummary({ command: "x".repeat(200) }).length).toBe(150);
	});

	test("stacks consecutive tool rows and separates the last one from prose", () => {
		const tool = (id: string): ConversationItem => ({
			kind: "tool", id, toolCallId: id, name: "read", args: {}, output: "",
			timestamp: 1, status: "done", isError: false,
		});
		const prose: ConversationItem = { kind: "assistant", id: "c", text: "done", thinking: "", timestamp: 1, status: "done" };
		const items = [tool("a"), tool("b"), prose];
		expect(nextItemIsTool(items, "a")).toBe(true);
		expect(nextItemIsTool(items, "b")).toBe(false);
		expect(nextItemIsTool(items, "missing")).toBe(false);
	});
});

describe("tab status and context meter", () => {
	test("a working tab shows the spinner; an idle tab with unseen activity shows its outcome", () => {
		expect(tabStatusGlyph({ badges: 0 }, true, "◐")?.glyph).toBe("◐");
		expect(tabStatusGlyph({ badges: 0 }, false, "◐")).toBeUndefined();
		expect(tabStatusGlyph({ badges: 2, badgeKind: "activity" }, false, "◐")?.glyph).toBe("✓");
		expect(tabStatusGlyph({ badges: 1, badgeKind: "error" }, false, "◐")?.glyph).toBe("✗");
	});

	test("the meter always spans the full width and clamps out-of-range percents", () => {
		for (const percent of [undefined, -5, 0, 8, 50, 100, 140]) {
			const { filled, empty } = contextMeterCells(percent, 35);
			expect(filled.length + empty.length).toBe(35);
		}
		expect(contextMeterCells(50, 10).filled.length).toBe(5);
		expect(contextMeterCells(140, 10).filled.length).toBe(10);
	});
});

describe("subagent elapsed time", () => {
	const target = (state: string, endedAt?: number): SubagentTarget => {
		const run: SubagentRun = {
			runId: `elapsed-${state}`, mode: "single", state, agent: "worker", steps: [],
			startedAt: 1_000, ...(endedAt === undefined ? {} : { endedAt }),
		};
		const [first] = subagentTargets([run]);
		if (!first) throw new Error("no target");
		return first;
	};
	test("a running child counts to now; a finished child stops at its end or shows none", () => {
		expect(subagentElapsedMs(target("running"), 5_000)).toBe(4_000);
		expect(subagentElapsedMs(target("completed", 3_000), 9_000)).toBe(2_000);
		// No recorded end: the duration is unknown, never `now - start`.
		expect(subagentElapsedMs(target("completed"), 9_000)).toBeUndefined();
	});
});

describe("compaction in a child transcript", () => {
	test("a child's compaction entry shows as one row between its turns", () => {
		const dir = mkdtempSync(join(tmpdir(), "pitty-compaction-"));
		const sessionFile = join(dir, "child.jsonl");
		const entry = (value: object) => JSON.stringify(value);
		writeFileSync(sessionFile, [
			entry({ type: "message", id: "a", message: { role: "user", content: "before", timestamp: 1 } }),
			entry({ type: "compaction", id: "c", timestamp: "2026-01-01T00:00:00.000Z", summary: "s", tokensBefore: 120_000 }),
			entry({ type: "message", id: "b", message: { role: "user", content: "after", timestamp: 3 } }),
		].join("\n") + "\n");
		const run: SubagentRun = { runId: "r", mode: "single", state: "completed", agent: "x", steps: [], sessionFile };
		const rows = readSubagentConversation(run).map((item) =>
			item.kind === "system" ? item.text : item.kind === "user" ? item.text : item.kind,
		);
		expect(rows).toEqual(["before", "Context compacted · 120K tokens summarized", "after"]);
	});
});

describe("side-by-side diff rows", () => {
	test("pairs a removed run with its added run and keeps line numbers per side", () => {
		const rows = splitDiffRows([
			"--- a/x.ts",
			"+++ b/x.ts",
			"@@ -10,4 +10,4 @@",
			" keep",
			"-old one",
			"-old two",
			"+new one",
			" tail",
		]);
		expect(rows).toEqual([
			{ kind: "hunk", text: "@@ -10,4 +10,4 @@" },
			{ kind: "context", left: { line: 10, text: "keep" }, right: { line: 10, text: "keep" } },
			{ kind: "change", left: { line: 11, text: "old one" }, right: { line: 11, text: "new one" } },
			// The shorter run leaves its side empty instead of shifting later rows.
			{ kind: "change", left: { line: 12, text: "old two" } },
			{ kind: "context", left: { line: 13, text: "tail" }, right: { line: 12, text: "tail" } },
		]);
	});
});
