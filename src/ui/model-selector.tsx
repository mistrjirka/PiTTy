import type {
	KeyEvent,
	SelectRenderable,
	TextareaRenderable,
} from "@opentui/core";
import { createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { colors } from "./theme.ts";
import { formatDuration } from "./duration.ts";
import { formatModelPerformanceStats, modelPerformanceStats, type ModelPerformanceHistory } from "../tabs/model-performance-history.ts";
import {
	requestTimingStats,
	type RequestTiming,
	type RequestTimingStats,
} from "../tabs/request-timing.ts";
import {
	createSearchableDialogFocus,
	handleSearchableDialogCancel,
} from "./searchable-dialog-focus.ts";

export type ModelChoice = {
	provider: string;
	id: string;
	name?: string | undefined;
	contextWindow?: number | undefined;
};

function positiveNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
		return undefined;
	return Math.round(value);
}

export function formatContextWindow(value: number | undefined): string {
	if (!value) return "";
	if (value >= 1_000_000) {
		const millions = value / 1_000_000;
		return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1).replace(/\.0$/, "")}M ctx`;
	}
	if (value >= 1_000) {
		const thousands = value / 1_000;
		return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1).replace(/\.0$/, "")}k ctx`;
	}
	return `${value} ctx`;
}

export function filterModelChoices(
	models: ModelChoice[],
	query: string,
): ModelChoice[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return models;
	return models.filter((model) =>
		[model.provider, model.id, model.name ?? ""].some((value) =>
			value.toLowerCase().includes(normalized),
		),
	);
}

export function normalizeModelChoices(values: unknown[]): ModelChoice[] {
	const seen = new Set<string>();
	const models: ModelChoice[] = [];
	for (const value of values) {
		if (!value || typeof value !== "object") continue;
		const record = value as Record<string, unknown>;
		if (typeof record.provider !== "string" || typeof record.id !== "string")
			continue;
		const provider = record.provider.trim();
		const id = record.id.trim();
		if (!provider || !id) continue;
		const key = `${provider}\u0000${id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const contextWindow =
			positiveNumber(record.contextWindow) ??
			positiveNumber(record.context_window);
		models.push({
			provider,
			id,
			...(typeof record.name === "string" && record.name.trim()
				? { name: record.name.trim() }
				: {}),
			...(contextWindow ? { contextWindow } : {}),
		});
	}
	return models.sort(
		(a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id),
	);
}

	export function formatModelTimingLine(
	stats: RequestTimingStats | undefined,
): string {
	if (!stats) return "";
	const parts = [`Turn ${formatDuration(stats.medianTurnMs)}`];
	if (stats.medianTurnPerToolMs !== undefined)
		parts.push(`Tool ${formatDuration(stats.medianTurnPerToolMs)}`);
	return parts.join(" · ");
}

export function ModelSelectorDialog(props: {
	models: ModelChoice[];
	currentProvider?: string | undefined;
	currentModelId?: string | undefined;
	onSelect: (model: ModelChoice) => void;
	onCancel: () => void;
	performanceHistory?: ModelPerformanceHistory;
	timingHistory?: readonly RequestTiming[];
}) {
	let select: SelectRenderable | undefined;
	let search: TextareaRenderable | undefined;
	const [query, setQuery] = createSignal("");
	const filteredModels = createMemo(() =>
		filterModelChoices(props.models, query()),
	);
	const options = createMemo(() =>
		filteredModels().map((model) => {
			const timing = requestTimingStats(props.timingHistory ?? [], model.provider, model.id);
			const details = [
				formatContextWindow(model.contextWindow),
				model.name && model.name !== model.id ? model.name : "",
				formatModelPerformanceStats(props.performanceHistory ? modelPerformanceStats(props.performanceHistory, model.provider, model.id) : undefined),
				formatModelTimingLine(timing),
			].filter(Boolean);
			return {
				name: `${model.provider}/${model.id}`,
				description: details.join(" · "),
				value: model,
			};
		}),
	);
	const focus = createSearchableDialogFocus({
		getSearch: () => search,
		getList: () => select,
		getListLength: () => filteredModels().length,
	});
	const cancelOnEscape = (event: KeyEvent) => {
		handleSearchableDialogCancel(event, props.onCancel);
	};

	const currentIndex = createMemo(() => {
		const index = filteredModels().findIndex(
			(model) =>
				model.provider === props.currentProvider &&
				model.id === props.currentModelId,
		);
		return index >= 0 ? index : 0;
	});
	const [highlight, setHighlight] = createSignal(currentIndex());

	useKeyboard((event) => {
		if (event.eventType === "release") return;
		if (handleSearchableDialogCancel(event, props.onCancel)) return;
		if (event.name === "up" || event.name === "down") {
			const models = filteredModels();
			if (!models.length) return;
			event.preventDefault();
			event.stopPropagation();
			const next =
				event.name === "down"
					? Math.min(models.length - 1, highlight() + 1)
					: Math.max(0, highlight() - 1);
			setHighlight(next);
			select?.setSelectedIndex(next);
			focus.focusList();
			return;
		}
		if (focus.onKeyDown(event)) return;
		if (event.name === "enter" || event.name === "return") {
			const model = filteredModels()[highlight()];
			if (model) {
				event.preventDefault();
				event.stopPropagation();
				props.onSelect(model);
			}
			return;
		}
	});

	return (
		<box
			position="absolute"
			left={0}
			right={0}
			top={0}
			bottom={0}
			onMouseDown={(event) => {
				event.stopPropagation();
			}}
		>
			<box
				position="absolute"
				left="12%"
				right="12%"
				top="8%"
				bottom={5}
				flexDirection="column"
				backgroundColor={colors.panelRaised}
				border
				borderColor={colors.borderStrong}
				padding={1}
				zIndex={150}
				onMouseDown={(event) => {
					event.stopPropagation();
				}}
			>
				<box flexDirection="row">
					<text fg={colors.textBright} attributes={1}>
						Select model
					</text>
					<box flexGrow={1} />
					<text
						fg={colors.muted}
						onMouseDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							props.onCancel();
						}}
					>
						× Close
					</text>
				</box>
				<textarea
					ref={(value) => {
						search = value;
					}}
					focused={focus.focusTarget() === "search"}
					onMouseDown={(event) => {
						event.stopPropagation();
						focus.focusSearch();
					}}
					height={1}
					minHeight={1}
					maxHeight={1}
					placeholder="Search provider, model id, or name…"
					backgroundColor={colors.panel}
					focusedBackgroundColor={colors.panel}
					textColor={colors.textBright}
					placeholderColor={colors.muted}
					onKeyDown={cancelOnEscape}
					onContentChange={() => {
						setQuery(search?.plainText ?? "");
						queueMicrotask(() => {
							const target = currentIndex();
							setHighlight(target);
							select?.setSelectedIndex(target);
						});
					}}
				/>
				<text fg={colors.subtle}>
					Tab list · Shift+Tab search · ↑/↓ move · Enter select · Esc close ·{" "}
					{filteredModels().length} match
					{filteredModels().length === 1 ? "" : "es"}
				</text>
				{filteredModels().length === 0 ? (
					<text fg={colors.yellow}>No matching models.</text>
				) : (
					<select
						ref={(value) => {
							select = value;
						}}
						options={options()}
						selectedIndex={highlight()}
						focused={focus.focusTarget() === "list"}
						flexGrow={1}
						minHeight={5}
						backgroundColor={colors.panelRaised}
						focusedBackgroundColor={colors.panelRaised}
						textColor={colors.text}
						focusedTextColor={colors.text}
						selectedBackgroundColor={colors.selection}
						selectedTextColor={colors.textBright}
						descriptionColor={colors.muted}
						selectedDescriptionColor={colors.text}
						showScrollIndicator
						wrapSelection
						onKeyDown={cancelOnEscape}
						onMouseDown={(event) => {
							if (!select) return;
							event.preventDefault();
							event.stopPropagation();
							focus.focusList();
							// SAFETY: OpenTUI exposes these layout fields at runtime but omits them from the public type.
							const scrollOffset =
								(select as unknown as { scrollOffset?: number }).scrollOffset ??
								0;
							// SAFETY: OpenTUI exposes these layout fields at runtime but omits them from the public type.
							const linesPerItem =
								(select as unknown as { linesPerItem?: number }).linesPerItem ??
								2;
							const visibleIndex = Math.floor(
								(event.y - select.screenY) / Math.max(1, linesPerItem),
							);
							const index = scrollOffset + visibleIndex;
							const model = filteredModels()[index];
							if (!model) return;
							select.setSelectedIndex(index);
							setHighlight(index);
							props.onSelect(model);
						}}
						onSelect={(_index, option) => {
							const model = option?.value;
							if (
								model &&
								filteredModels().some(
									(candidate) =>
										candidate.provider === model.provider &&
										candidate.id === model.id,
								)
							)
								props.onSelect(model);
						}}
					/>
				)}
			</box>
		</box>
	);
}
