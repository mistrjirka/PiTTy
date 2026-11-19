import type {
	KeyEvent,
	SelectRenderable,
	TextareaRenderable,
} from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { createMemo, createSignal, Show } from "solid-js";
import {
	formatModelPerformanceStats,
	type ModelPerformanceHistory,
	modelPerformanceKey,
	modelPerformanceStats,
} from "../tabs/model-performance-history.ts";
import {
	type RequestTiming,
	type RequestTimingStats,
	requestTimingStats,
	retainCurrentRequestTimings,
} from "../tabs/request-timing.ts";
import { formatDuration } from "./duration.ts";
import {
	createSearchableDialogFocus,
	handleSearchableDialogCancel,
} from "./searchable-dialog-focus.ts";
import { selectOptionIndexAtMouse } from "./select-mouse.ts";
import { colors } from "./theme.ts";

export type ModelChoice = {
	provider: string;
	id: string;
	name?: string | undefined;
	contextWindow?: number | undefined;
	reasoning?: boolean | undefined;
	thinkingLevelMap?: Record<string, string | null> | undefined;
};

function thinkingLevelMap(
	value: unknown,
): Record<string, string | null> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const entries: Record<string, string | null> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string") entries[key] = entry;
		else if (entry === null) entries[key] = null;
	}
	return Object.keys(entries).length ? entries : undefined;
}

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
	// The picker displays provider/model. Treat '/' as a separator, not a
	// required character in one field. A lone '/' must show every model.
	const terms = query
		.toLowerCase()
		.split(/[/\s]+/)
		.filter(Boolean);
	if (terms.length === 0) return models;
	return models.filter((model) => {
		const searchable =
			`${model.provider} ${model.id} ${model.name ?? ""}`.toLowerCase();
		return terms.every((term) => searchable.includes(term));
	});
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
		const reasoning =
			typeof record.reasoning === "boolean" ? record.reasoning : undefined;
		const map = thinkingLevelMap(record.thinkingLevelMap);
		models.push({
			provider,
			id,
			...(typeof record.name === "string" && record.name.trim()
				? { name: record.name.trim() }
				: {}),
			...(contextWindow ? { contextWindow } : {}),
			...(reasoning !== undefined ? { reasoning } : {}),
			...(map ? { thinkingLevelMap: map } : {}),
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
	// Keep picker rows short. Dispatch remains visible in the sidebar header.
	if (stats.medianToolExecutionMs !== undefined)
		parts.push(`Tool ${formatDuration(stats.medianToolExecutionMs)}`);
	return parts.join(" · ");
}

export function ModelSelectorDialog(props: {
	models: ModelChoice[];
	currentProvider?: string | undefined;
	currentModelId?: string | undefined;
	onSelect: (model: ModelChoice) => void;
	onCancel: () => void;
	performanceHistory?: ModelPerformanceHistory;
	timingHistory?: readonly RequestTiming[] | (() => readonly RequestTiming[]);
	/** Optional line naming the value this picker changes, e.g. the current profile model. */
	context?: string | undefined;
	/** Optional sync status, e.g. "syncing with Pi…" or a refresh failure. */
	notice?: string | undefined;
}) {
	let select: SelectRenderable | undefined;
	let search: TextareaRenderable | undefined;
	const [query, setQuery] = createSignal("");
	const filteredModels = createMemo(() =>
		filterModelChoices(props.models, query()),
	);
	// Stats depend only on the histories and the model list, never on the search text,
	// so compute them once per input change (one history read, one pass over the timing
	// history) instead of once per model on every keystroke.
	const detailsByModel = createMemo(() => {
		const performanceHistory = props.performanceHistory;
		const timingByModel = new Map<string, RequestTiming[]>();
		const timingHistory =
			typeof props.timingHistory === "function"
				? props.timingHistory()
				: (props.timingHistory ?? []);
		for (const sample of retainCurrentRequestTimings(timingHistory)) {
			if (!sample.provider || !sample.modelId) continue;
			const key = modelPerformanceKey(sample.provider, sample.modelId);
			const bucket = timingByModel.get(key);
			if (bucket) bucket.push(sample);
			else timingByModel.set(key, [sample]);
		}
		const details = new Map<string, string>();
		for (const model of props.models) {
			const key = modelPerformanceKey(model.provider, model.id);
			const timing = requestTimingStats(
				timingByModel.get(key) ?? [],
				model.provider,
				model.id,
			);
			details.set(
				key,
				[
					formatContextWindow(model.contextWindow),
					model.name && model.name !== model.id ? model.name : "",
					formatModelPerformanceStats(
						performanceHistory
							? modelPerformanceStats(
									performanceHistory,
									model.provider,
									model.id,
								)
							: undefined,
					),
					formatModelTimingLine(timing),
				]
					.filter(Boolean)
					.join(" · "),
			);
		}
		return details;
	});
	const options = createMemo(() => {
		const details = detailsByModel();
		return filteredModels().map((model) => ({
			name: `${model.provider}/${model.id}`,
			description:
				details.get(modelPerformanceKey(model.provider, model.id)) ?? "",
			value: model,
		}));
	});
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
				<Show when={props.context}>
					<text fg={colors.subtle} wrapMode="none">
						{props.context}
					</text>
				</Show>
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
				<Show when={props.notice}>
					<text fg={colors.yellow} wrapMode="none">
						{props.notice}
					</text>
				</Show>
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
							const index = selectOptionIndexAtMouse(select, event.y);
							if (index === undefined) return;
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
