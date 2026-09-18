import { Show } from "solid-js";
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

export function stateColor(state: string): string {
	if (["running", "active", "working"].includes(state)) return colors.green;
	if (["queued", "paused", "needs_attention"].includes(state))
		return colors.yellow;
	if (["failed", "error", "timed_out"].includes(state)) return colors.red;
	return colors.borderStrong;
}

export function stateIcon(state: string): string {
	if (["running", "active", "working"].includes(state)) return "🟢";
	if (["queued", "paused", "needs_attention"].includes(state)) return "🟡";
	if (["failed", "error", "timed_out"].includes(state)) return "🔴";
	return "⚪";
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
	return `${formatDuration(Math.max(0, now - lastUpdate))} ago`;
}

/**
 * Third per-target line. `starting…` is only honest while the child is
 * actually starting (running/queued with no usage yet); any other usage-less
 * state reports nothing (`""`) because the sibling freshness/activity row
 * already names the state — restating it would print the state word twice.
 */
export function targetToolUsage(target: SubagentTarget): string {
	const parts: string[] = [];
	const toolCount = target.step?.toolCount ?? target.run.toolCount;
	if (toolCount !== undefined) parts.push(`${toolCount} tools`);
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
	if (target.state === "running" || target.state === "queued") return "starting…";
	return "";
}

/** Per-field caps for the inline inspector row, so one long value cannot crowd out the others. */
export const INLINE_CONTEXT_VALUE_WIDTH = 30;
export const INLINE_MODEL_VALUE_WIDTH = 60;
export const INLINE_THINKING_VALUE_WIDTH = 24;

export type ModelContextRowsProps = {
	/**
	 * `"stacked"` (default) is the sidebar pattern: `Context` / value /
	 * `% used` / `Model` / value / `Thinking: …` as separate full-width rows.
	 * `"inline"` is the wide-inspector variant: one row with the known fields
	 * side by side. An empty (after sanitising) value omits that field.
	 */
	layout?: "stacked" | "inline" | undefined;
	/** Preformatted `used / limit` line (or `"— / —"` when unknown). */
	contextText: string;
	/** Renders `{pct}% used` when defined (null/undefined hide it). */
	percentUsed?: number | null | undefined;
	/** Preformatted `provider/id` line (or `"—"` when unknown). */
	modelText: string;
	/** Preformatted thinking level (or `"—"` when unknown). */
	thinkingText: string;
	/**
	 * Truncate row lines to this width (defaults to 32, the sidebar content
	 * width both call sites inherited). Lines are always sanitised
	 * (ANSI/control stripped) regardless of truncation.
	 */
	clipWidth?: number | undefined;
};

/**
 * Sidebar-pattern `Context` + `Model` rows shared by sidebar and inspector.
 *
 * The inline layout renders one row (`Context <value>` then `Model <value>`
 * then `Thinking: <value>`, percent appended to the Context field) for the
 * wide inspector. Unknown fields are omitted by passing an empty value; the
 * component stays dumb and the sidebar keeps its `"—"` placeholders.
 */
export function ModelContextRows(props: ModelContextRowsProps) {
	if (props.layout === "inline") {
		const percent = () => props.percentUsed ?? undefined;
		const hasContext = () => cleanInline(props.contextText) !== "";
		const hasModel = () => cleanInline(props.modelText) !== "";
		const hasThinking = () => cleanInline(props.thinkingText) !== "";
		if (!hasContext() && !hasModel() && !hasThinking()) return <></>;
		return (
			<box flexDirection="row" height={1} minHeight={1} flexShrink={0} width="100%">
				<Show when={hasContext()}>
					<text fg={colors.textBright} attributes={1} wrapMode="none">
						Context{" "}
					</text>
					<text fg={colors.muted} wrapMode="none">
						{clip(props.contextText, INLINE_CONTEXT_VALUE_WIDTH)}
						{percent() !== undefined ? ` · ${Math.round(percent() ?? 0)}% used` : ""}
					</text>
				</Show>
				<Show when={hasContext() && (hasModel() || hasThinking())}>
					<box width={2} flexShrink={0} />
				</Show>
				<Show when={hasModel()}>
					<text fg={colors.textBright} attributes={1} wrapMode="none">
						Model{" "}
					</text>
					<text fg={colors.muted} wrapMode="none">
						{clip(props.modelText, INLINE_MODEL_VALUE_WIDTH)}
					</text>
				</Show>
				<Show when={hasModel() && hasThinking()}>
					<box width={2} flexShrink={0} />
				</Show>
				<Show when={hasThinking()}>
					<text fg={colors.muted} wrapMode="none">
						Thinking: {clip(props.thinkingText, INLINE_THINKING_VALUE_WIDTH)}
					</text>
				</Show>
			</box>
		);
	}
	const width = () => props.clipWidth ?? 32;
	const contextLine = () => clip(props.contextText, width());
	const modelLine = () => clip(props.modelText, width());
	const thinkingLine = () => clip(props.thinkingText, width());
	const percent = () => props.percentUsed ?? undefined;
	return (
		<>
			<text width="100%" height={1} fg={colors.textBright} attributes={1}>
				Context
			</text>
			<text width="100%" height={1} fg={colors.muted} wrapMode="none">
				{contextLine()}
			</text>
			<Show when={percent() !== undefined}>
				<text width="100%" height={1} fg={colors.muted}>
					{Math.round(percent() ?? 0)}% used
				</text>
			</Show>
			<text width="100%" height={1} fg={colors.textBright} attributes={1}>
				Model
			</text>
			<text width="100%" height={1} fg={colors.muted} wrapMode="none">
				{modelLine()}
			</text>
			<text width="100%" height={1} fg={colors.muted}>
				Thinking: {thinkingLine()}
			</text>
		</>
	);
}
