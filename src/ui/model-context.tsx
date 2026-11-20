import stripAnsi from "strip-ansi";
import { compactTokenCount } from "../state/compaction-telemetry.ts";
import { colors } from "./theme.ts";
import { formatDuration } from "./duration.ts";
import { targetContextUsage, type SubagentTarget } from "../subagents/targets.ts";

/**
 * Shared Model/Context presentation, extracted from the sidebar so the
 * parent session rows and the subagent inspector detail page render the same
 * rows from the same helpers.
 *
 * Formatter decision: token counts go through `compactTokenCount` (with
 * `"—"` for unknown) rather than the sidebar's old local `formatTokens`.
 * The two agree on every pinned value (`4K`, `33K / 400K`, `168K / 1M`);
 * `compactTokenCount` additionally strips the `.0` artifact (`1M` instead of
 * `1.0M`) and is already what `targetContextUsage` uses, so parent rows and
 * child `used / limit` strings can no longer disagree.
 */
export function formatTokens(value: number | undefined): string {
	if (value === undefined) return "—";
	return compactTokenCount(value);
}

export function cleanInline(value: string): string {
	return stripAnsi(value)
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function clip(value: string, width = 32): string {
	const clean = cleanInline(value);
	if (clean.length <= width) return clean;
	return `${clean.slice(0, Math.max(1, width - 1))}…`;
}

const WORKING_STATES = ["running", "active", "working"];
const QUEUED_STATES = ["queued"];
const ATTENTION_STATES = ["paused", "needs_attention"];
const FAILED_STATES = ["failed", "error", "timed_out"];
const FINISHED_STATES = ["completed", "finished", "done"];

/** Colour for a state glyph. Running is the accent, like a running tool row. */
export function stateColor(state: string): string {
	if (WORKING_STATES.includes(state)) return colors.accent;
	if (QUEUED_STATES.includes(state) || ATTENTION_STATES.includes(state))
		return colors.yellow;
	if (FAILED_STATES.includes(state)) return colors.red;
	if (FINISHED_STATES.includes(state)) return colors.green;
	return colors.subtle;
}

/**
 * Single-cell state glyph shared by tool rows, spawn groups, the sidebar and
 * the subagent view. Plain glyphs, not emoji: emoji render two cells wide in
 * most terminals and break column alignment.
 */
export function stateIcon(state: string): string {
	if (WORKING_STATES.includes(state)) return "●";
	if (QUEUED_STATES.includes(state)) return "◌";
	if (state === "waiting" || ATTENTION_STATES.includes(state)) return "◷";
	if (FAILED_STATES.includes(state)) return "✗";
	if (FINISHED_STATES.includes(state)) return "✓";
	return "○";
}

/**
 * One humanised state vocabulary for the inspector, mirroring the main
 * footer's `displayStatus()` (`working` / `ready` / transient phases).
 * Anything not in the table passes through unchanged.
 */
export function friendlyTargetState(state: string): string {
	if (state === "running" || state === "queued") return "working";
	if (state === "waiting") return "waiting for parent";
	if (state === "idle") return "resident";
	if (state === "unresponsive") return "unresponsive";
	if (state === "completed") return "finished";
	if (state === "failed" || state === "error") return "failed";
	return state;
}

function targetTokens(target: SubagentTarget): number | undefined {
	return (
		target.step?.tokens?.total ??
		target.run.tokens?.window ??
		(target.run.steps.length <= 1 ? target.run.totalTokens : undefined)
	);
}

/**
 * Second per-target line (sidebar row 2, group-row activity). State-aware: a
 * finished, resident, waiting or unresponsive child with no current tool must not
 * read `working` — it falls back to the shared `friendlyTargetState`
 * vocabulary so the sidebar, the group card, the inline block, the subagent
 * selector and the inspector cannot drift apart again.
 */
export function targetToolActivity(target: SubagentTarget): string {
	const tool = target.step?.currentTool ?? target.run.currentTool;
	const path = target.step?.currentPath ?? target.run.currentPath;
	if (!tool && !path) return friendlyTargetState(target.state);
	return `${tool ?? friendlyTargetState(target.state)}${path ? ` · ${path}` : ""}`;
}

/**
 * A resident (`idle`) or parent-waiting (`waiting`) child is live-but-idle:
 * its status-file timestamp is not an age of anything the user did, so rows
 * for these states omit the age and name the state on its own.
 */
export function isResidentTargetState(state: string): boolean {
	return state === "idle" || state === "waiting";
}

export function targetFreshness(target: SubagentTarget, now: number): string {
	const lastUpdate = target.lastUpdate;
	if (lastUpdate === undefined) return "unknown";
	const age = Math.max(0, now - lastUpdate);
	// `0ms ago` reads as a glitch; under a second is simply now.
	return age < 1_000 ? "just now" : `${formatDuration(age)} ago`;
}

/**
 * Third per-target line. `starting…` is only honest while the child is
 * actually starting (running/queued with no usage yet); any other usage-less
 * state reports nothing (`""`) because the sibling freshness/activity row
 * already names the state — restating it would print the state word twice.
 */
export function targetToolUsage(target: SubagentTarget, now = Date.now()): string {
	const parts: string[] = [];
	const toolCount = target.step?.toolCount ?? target.run.toolCount;
	if (toolCount !== undefined && toolCount > 0) parts.push(`${toolCount} tools`);
	// Residents (`idle`) and parent-waiters (`waiting`) are live-but-idle:
	// their context window is stale (nothing is running), so the row keeps
	// only the tool count. Deliberately keeps `${toolCount} tools`.
	if (isResidentTargetState(target.state)) {
		if (parts.length > 0) return parts.join(" · ");
		return "";
	}
	const contextUsage = targetContextUsage(target);
	if (contextUsage) {
		parts.push(contextUsage);
	} else {
		const tokens = targetTokens(target);
		if (tokens !== undefined) parts.push(`${formatTokens(tokens)} tok`);
	}
	if (parts.length > 0) return parts.join(" · ");
	const turns = target.step?.turnCount ?? target.run.turnCount;
	if (turns !== undefined && turns > 0) return `${turns} ${turns === 1 ? "turn" : "turns"} · usage unavailable`;
	if (target.state === "running" || target.state === "queued") {
		const startedAt = target.run.startedAt ?? target.startedAt;
		const lastActivityAt = target.step?.lastActivityAt ?? target.run.lastActivityAt;
		if (startedAt !== undefined && (now - startedAt >= 15_000 ||
			(lastActivityAt !== undefined && lastActivityAt - startedAt >= 1_000))) {
			return "working · usage unavailable";
		}
		return "starting…";
	}
	return "";
}

/**
 * Short usage for the sidebar agent row: the live context window when known,
 * else cumulative tokens. Empty for residents, whose window is stale.
 */
export function targetUsageShort(target: SubagentTarget): string {
	if (isResidentTargetState(target.state)) return "";
	const context = targetContextUsage(target);
	if (context) return context;
	const tokens = targetTokens(target);
	return tokens === undefined ? "" : `${formatTokens(tokens)} tok`;
}
