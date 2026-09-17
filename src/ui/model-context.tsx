import { Show } from "solid-js";
import stripAnsi from "strip-ansi";
import { compactTokenCount } from "../state/compaction-telemetry.ts";
import { colors } from "./theme.ts";

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
	if (state === "stale") return "stale";
	if (state === "completed") return "finished";
	if (state === "failed" || state === "error") return "failed";
	return state;
}

export type ModelContextRowsProps = {
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

/** Sidebar-pattern `Context` + `Model` rows shared by sidebar and inspector. */
export function ModelContextRows(props: ModelContextRowsProps) {
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
