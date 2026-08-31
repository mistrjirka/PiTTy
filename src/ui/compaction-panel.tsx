import {
	compactTokenCount,
	compactionSummaryCaption,
	type CompactionCompletion,
	type CompactionTelemetry,
} from "../state/compaction-telemetry.ts";
import { formatDuration } from "./duration.ts";
import { colors, getMarkdownStyle } from "./theme.ts";

import { createMemo, Show } from "solid-js";
import type { MarkdownRenderable } from "@opentui/core";

const BAR_WIDTH = 16;

export function indeterminateCompactionBar(frame: number, width = BAR_WIDTH): string {
	const segmentWidth = Math.min(4, width);
	const travel = width + segmentWidth;
	const start = ((frame % travel) + travel) % travel - segmentWidth;
	return Array.from({ length: width }, (_, index) =>
		index >= start && index < start + segmentWidth ? "█" : "░",
	).join("");
}

export function compactionContextPercent(
	telemetry: CompactionTelemetry,
): number | undefined {
	if (
		telemetry.tokensBefore !== undefined &&
		telemetry.contextWindow !== undefined &&
		telemetry.contextWindow > 0
	) {
		return Math.min(100, (telemetry.tokensBefore / telemetry.contextWindow) * 100);
	}
	return telemetry.contextPercent;
}

export function determinateContextBar(
	percent: number,
	width = BAR_WIDTH,
): string {
	const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
	return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

export function CompactionPanel(props: {
	telemetry: CompactionTelemetry;
	now: number;
	spinner: string;
	frame: number;
	smartCompactProgress?: string;
}) {
	const elapsed = () =>
		Math.max(0, props.now - (props.telemetry.startedAt ?? props.now));
	const percent = () => compactionContextPercent(props.telemetry);
	const contextLine = () => {
		const value = percent();
		if (value === undefined) return "";
		const size =
			props.telemetry.tokensBefore === undefined
				? ""
				: `${compactTokenCount(props.telemetry.tokensBefore)}${
						props.telemetry.contextWindow === undefined
							? ""
							: ` / ${compactTokenCount(props.telemetry.contextWindow)}`
					}`;
		return `Context size [${determinateContextBar(value)}]${
			size ? ` ${size}` : ""
		} · ${Math.round(value)}% full`;
	};
	const messageLine = () => {
		if (
			props.telemetry.summarizingContextMessages === undefined &&
			props.telemetry.plannedRetainedContextMessages === undefined
		)
			return "";
		const summarize =
			props.telemetry.summarizingContextMessages === undefined
				? ""
				: `summarize ${props.telemetry.summarizingContextMessages} context messages`;
		const keep =
			props.telemetry.plannedRetainedContextMessages === undefined
				? ""
				: `keep ${props.telemetry.plannedRetainedContextMessages} recent context messages`;
		return `Plan: ${[summarize, keep].filter(Boolean).join(" · ")}`;
	};

	return (
		<box
			height={4}
			minHeight={4}
			flexShrink={0}
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			marginBottom={1}
			backgroundColor={colors.panelSoft}
			border={["left"]}
			borderColor={colors.cyan}
		>
			<text height={1} fg={colors.cyan} attributes={1} wrapMode="none">
				{props.spinner} Compacting
				{props.telemetry.reason ? ` · ${props.telemetry.reason}` : ""} ·{" "}
				{formatDuration(elapsed())} elapsed
			</text>
			<text height={1} fg={colors.subtle} wrapMode="none">
				Activity [{indeterminateCompactionBar(props.frame)}] indeterminate{props.smartCompactProgress ? ` · ${props.smartCompactProgress}` : ""}
			</text>
			<text height={1} fg={colors.muted} wrapMode="none">
				{contextLine()}
			</text>
			<text height={1} fg={colors.muted} wrapMode="none">
				{messageLine()}
			</text>
		</box>
	);
}

export function CompactedSummary(props: {
	completion: CompactionCompletion;
	expanded: () => boolean;
	onToggle: () => void;
}) {
	const expanded = createMemo(() => props.expanded());
	const finalizeSummary = function (this: MarkdownRenderable) {
		if (!this.streaming) return;
		queueMicrotask(() => {
			if (!this.isDestroyed) this.streaming = false;
		});
	};
	return (
		<box
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			marginBottom={1}
			backgroundColor={colors.panelSoft}
			border={["left"]}
			borderColor={colors.cyan}
		>
			<text height={1} fg={colors.cyan} attributes={1} wrapMode="none">
				{"── Compacted " + "─".repeat(34)}
			</text>
			<text height={1} fg={colors.muted} wrapMode="none">
				{compactionSummaryCaption(props.completion)}
			</text>
			<Show
				when={expanded()}
				fallback={
					<box
						height={1}
						id="compacted-summary-toggle"
						flexShrink={0}
						onMouseDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							props.onToggle();
						}}
					>
						<text height={1} fg={colors.subtle} selectable wrapMode="none">
							▶ Show compaction summary
						</text>
					</box>
				}
			>
				{(() => (
					[
						<box
							height={1}
							id="compacted-summary-toggle"
							flexShrink={0}
							onMouseDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								props.onToggle();
							}}
						>
							<text height={1} fg={colors.subtle} selectable wrapMode="none">
								▼ Hide compaction summary
							</text>
						</box>,
						Boolean(props.completion.summary) ? (
							<markdown
								content={props.completion.summary ?? ""}
								syntaxStyle={getMarkdownStyle()}
								fg={colors.textBright}
								conceal
								streaming
								renderAfter={finalizeSummary}
								tableOptions={{
									style: "columns",
									wrapMode: "word",
									selectable: true,
								}}
							/>
						) : null,
					]
				))()}
			</Show>
		</box>
	);
}
