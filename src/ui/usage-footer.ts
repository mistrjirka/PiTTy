import type { ClaudeUsage } from "../integrations/doppelclaude-usage.ts";
import { formatResetIn, type CodexUsage } from "../integrations/codex-usage.ts";
import type { OpencodeUsage } from "../integrations/opencode-usage.ts";
import type { UsageStats } from "../integrations/codex-usage-history.ts";

export type UsageTone = "normal" | "warning" | "critical";
export type UsageFooterSegment = { text: string; tone: UsageTone };

export const USAGE_FOOTER_SEPARATOR = " │ ";

export type UsageFooterInput = {
	claudeUsage?: ClaudeUsage | undefined;
	claudeAccountLabel?: string | undefined;
	claudeHint?: string | undefined;
	codexUsage?: CodexUsage | undefined;
	codexUsageStats?: Record<number, UsageStats> | undefined;
	opencodeUsage?: OpencodeUsage | undefined;
	opencodeUsageStats?: Record<number, UsageStats> | undefined;
	/** Columns available for the segments joined by `USAGE_FOOTER_SEPARATOR`. */
	width: number;
	/** Epoch ms. */
	now: number;
};

type Entry = {
	percent: number;
	tone: UsageTone;
	/** Compact reset countdown, e.g. `1h26m`. */
	reset: string;
	/** Rank used to pick the tightest window: runs-out/critical beat warning beat the rest. */
	rank: number;
};

const TONE_RANK: Record<UsageTone, number> = { normal: 0, warning: 1, critical: 2 };

function compactReset(seconds: number): string {
	return formatResetIn(seconds).replace(/ /g, "");
}

function windowTone(
	percent: number,
	stats: UsageStats | undefined,
	severity?: UsageTone,
): UsageTone {
	if (severity === "critical" || stats?.runsOutBeforeReset) return "critical";
	if (severity === "warning" || percent >= 80) return "warning";
	return "normal";
}

function worstTone(tones: readonly UsageTone[]): UsageTone {
	return tones.reduce<UsageTone>(
		(worst, tone) => (TONE_RANK[tone] > TONE_RANK[worst] ? tone : worst),
		"normal",
	);
}

function tightest(entries: readonly Entry[]): Entry | undefined {
	let best: Entry | undefined;
	for (const entry of entries) {
		if (
			!best ||
			entry.rank > best.rank ||
			(entry.rank === best.rank && entry.percent > best.percent)
		)
			best = entry;
	}
	return best;
}

function pct(percent: number): string {
	return `${Math.round(percent)}%`;
}

function resetSeconds(
	window: { resetAt: number; resetAfterSeconds: number },
	now: number,
): number {
	// Codex/OpenCode report epoch seconds; fall back to the fetch-time countdown.
	return window.resetAt > 1e9
		? window.resetAt - now / 1000
		: window.resetAfterSeconds;
}

type Candidate = {
	provider: "claude" | "codex" | "oc";
	/** Builds the segment; `keep` limits OpenCode windows (by index). */
	build: (opts?: { windows?: readonly number[]; reset?: boolean }) => UsageFooterSegment;
	tone: UsageTone;
	percent: number;
};

function claudeCandidate(input: UsageFooterInput): Candidate | undefined {
	const limits = input.claudeUsage?.limits ?? [];
	if (limits.length === 0) {
		if (!input.claudeHint) return undefined;
		return {
			provider: "claude",
			tone: "warning",
			percent: 0,
			build: () => ({ text: "claude login expired", tone: "warning" }),
		};
	}
	const entries = limits.map<Entry>((limit) => {
		const tone = windowTone(limit.percent, undefined, limit.severity);
		return {
			percent: limit.percent,
			tone,
			rank: TONE_RANK[tone],
			reset: compactReset((limit.resetAt - input.now) / 1000),
		};
	});
	const best = tightest(entries)!;
	return {
		provider: "claude",
		tone: worstTone(entries.map((e) => e.tone)),
		percent: best.percent,
		build: (opts) => ({
			text: `claude${input.claudeAccountLabel ? `(${input.claudeAccountLabel.slice(0, 12)})` : ""} ${pct(best.percent)}${opts?.reset === false ? "" : `·${best.reset}`}`,
			tone: worstTone(entries.map((e) => e.tone)),
		}),
	};
}

function windowEntries(
	windows: readonly { usedPercent: number; windowSeconds: number; resetAt: number; resetAfterSeconds: number }[],
	stats: Record<number, UsageStats> | undefined,
	now: number,
): Entry[] {
	return windows.map((window) => {
		const tone = windowTone(window.usedPercent, stats?.[window.windowSeconds]);
		return {
			percent: window.usedPercent,
			tone,
			rank: TONE_RANK[tone],
			reset: compactReset(resetSeconds(window, now)),
		};
	});
}

function codexCandidate(input: UsageFooterInput): Candidate | undefined {
	const windows = input.codexUsage?.windows ?? [];
	if (windows.length === 0) return undefined;
	const entries = windowEntries(windows, input.codexUsageStats, input.now);
	const best = tightest(entries)!;
	const tone = worstTone(entries.map((e) => e.tone));
	return {
		provider: "codex",
		tone,
		percent: best.percent,
		build: (opts) => ({
			text: `codex ${pct(best.percent)}${opts?.reset === false ? "" : `·${best.reset}`}`,
			tone,
		}),
	};
}

function opencodeCandidate(input: UsageFooterInput): Candidate | undefined {
	const windows = [...(input.opencodeUsage?.windows ?? [])].sort(
		(a, b) => a.windowSeconds - b.windowSeconds,
	);
	if (windows.length === 0) return undefined;
	const entries = windowEntries(windows, input.opencodeUsageStats, input.now);
	const best = tightest(entries)!;
	const tone = worstTone(entries.map((e) => e.tone));
	return {
		provider: "oc",
		tone,
		percent: best.percent,
		build: (opts) => {
			const keep = opts?.windows ?? entries.map((_, index) => index);
			const parts = keep.map((index) => {
				const entry = entries[index]!;
				return entry === best && opts?.reset !== false
					? `${pct(entry.percent)}·${entry.reset}`
					: pct(entry.percent);
			});
			return { text: `oc ${parts.join(" ")}`, tone };
		},
	};
}

/**
 * OpenCode windows ordered by drop priority: least used goes first, longer
 * windows first on ties. The returned list is the indices that survive after
 * dropping `count` windows (keeping at least one).
 */
function opencodeKeep(input: UsageFooterInput, drop: number): number[] {
	const windows = [...(input.opencodeUsage?.windows ?? [])].sort(
		(a, b) => a.windowSeconds - b.windowSeconds,
	);
	const order = windows
		.map((window, index) => ({ index, window }))
		.sort(
			(a, b) =>
				a.window.usedPercent - b.window.usedPercent ||
				b.window.windowSeconds - a.window.windowSeconds,
		)
		.map((item) => item.index);
	const dropped = new Set(order.slice(0, Math.min(drop, windows.length - 1)));
	return windows.map((_, index) => index).filter((index) => !dropped.has(index));
}

export function usageFooterWidth(segments: readonly UsageFooterSegment[]): number {
	if (segments.length === 0) return 0;
	return (
		segments.reduce((sum, segment) => sum + segment.text.length, 0) +
		USAGE_FOOTER_SEPARATOR.length * (segments.length - 1)
	);
}

/**
 * Ordered footer segments (claude, codex, oc) that fit into `width` columns.
 *
 * Degradation ladder, tried in order until the result fits:
 *  1. everything
 *  2. drop OpenCode's least-used window, 3. drop its next least-used window
 *  4. drop Codex
 *  5. drop OpenCode entirely (Claude only)
 *  6. only the single worst limit across providers
 *  7. that limit without its reset countdown
 *  8. nothing
 */
export function usageFooterSegments(input: UsageFooterInput): UsageFooterSegment[] {
	const claude = claudeCandidate(input);
	const codex = codexCandidate(input);
	const oc = opencodeCandidate(input);
	const all = [claude, codex, oc].filter((c): c is Candidate => c !== undefined);
	if (all.length === 0) return [];

	const ocWindowCount = input.opencodeUsage?.windows.length ?? 0;
	const attempt = (
		list: (Candidate | undefined)[],
		ocDrop = 0,
	): UsageFooterSegment[] =>
		list
			.filter((c): c is Candidate => c !== undefined)
			.map((c) =>
				c.provider === "oc" && ocDrop > 0
					? c.build({ windows: opencodeKeep(input, ocDrop) })
					: c.build(),
			);

	const ladder: UsageFooterSegment[][] = [attempt([claude, codex, oc])];
	if (oc) {
		for (let drop = 1; drop <= Math.min(2, ocWindowCount - 1); drop++)
			ladder.push(attempt([claude, codex, oc], drop));
		ladder.push(attempt([claude, oc], Math.min(2, ocWindowCount - 1)));
	}
	if (codex || oc) ladder.push(attempt([claude]));

	for (const segments of ladder) {
		if (segments.length > 0 && usageFooterWidth(segments) <= input.width)
			return segments;
	}

	const worst = all.reduce((best, c) =>
		TONE_RANK[c.tone] > TONE_RANK[best.tone] ||
		(TONE_RANK[c.tone] === TONE_RANK[best.tone] && c.percent > best.percent)
			? c
			: best,
	);
	for (const opts of [undefined, { reset: false }] as const) {
		const segment = worst.build(opts);
		if (segment.text.length <= input.width) return [segment];
	}
	return [];
}
