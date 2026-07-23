import type {
	KeyEvent,
	SelectRenderable,
	TextareaRenderable,
} from "@opentui/core";
import { createMemo, createSignal, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import {
	filterMemoryEntries,
	type MemoryEntry,
	type MemorySnapshot,
} from "../integrations/memory-store.ts";
import { colors } from "./theme.ts";
import {
	createSearchableDialogFocus,
	handleSearchableDialogCancel,
} from "./searchable-dialog-focus.ts";

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function label(value: string, max = 96): string {
	const text = oneLine(value);
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export type MemoryBrowserProps = {
	snapshot: MemorySnapshot;
	onRemove: (entry: MemoryEntry) => void;
	onCancel: () => void;
};

export function MemoryBrowserDialog(props: MemoryBrowserProps) {
	let search: TextareaRenderable | undefined;
	let select: SelectRenderable | undefined;
	const [query, setQuery] = createSignal("");
	const [pending, setPending] = createSignal<MemoryEntry>();

	const entries = createMemo(() =>
		filterMemoryEntries(props.snapshot.entries, query()),
	);
	const options = createMemo(() =>
		entries().map((entry) => ({
			name: `[${entry.sourceLabel}] ${label(entry.text)}`,
			description: entry.lastReferenced
				? `last used ${entry.lastReferenced}`
				: "",
			value: entry,
		})),
	);

	const focus = createSearchableDialogFocus({
		getSearch: () => search,
		getList: () => select,
		getListLength: () => entries().length,
	});
	const cancelOnEscape = (event: KeyEvent) => {
		handleSearchableDialogCancel(event, props.onCancel);
	};

	const requestDelete = (entry: MemoryEntry | undefined) => {
		if (entry) setPending(entry);
	};
	const confirmDelete = () => {
		const entry = pending();
		if (!entry) return;
		setPending(undefined);
		props.onRemove(entry);
	};

	useKeyboard((event) => {
		if (event.eventType === "release") return;
		if (pending()) {
			if (event.name === "n" || event.name === "escape") {
				event.preventDefault();
				event.stopPropagation();
				setPending(undefined);
			} else if (
				event.name === "enter" ||
				event.name === "return" ||
				event.name === "y"
			) {
				event.preventDefault();
				event.stopPropagation();
				confirmDelete();
			}
			return;
		}
		if (handleSearchableDialogCancel(event, props.onCancel)) return;
		if (focus.onKeyDown(event)) return;
		if (event.name === "d" && focus.activeFocus() === "list") {
			event.preventDefault();
			event.stopPropagation();
			const index = select?.selectedIndex ?? 0;
			requestDelete(entries()[index]);
			return;
		}
		if (
			(event.name === "enter" || event.name === "return") &&
			focus.activeFocus() === "search"
		) {
			const entry = entries()[0];
			if (entry) {
				event.preventDefault();
				event.stopPropagation();
				requestDelete(entry);
			}
		}
	});

	return (
		<box
			position="absolute"
			left="10%"
			right="10%"
			top="8%"
			bottom={5}
			flexDirection="column"
			backgroundColor={colors.panelRaised}
			border
			borderColor={colors.borderStrong}
			padding={1}
			zIndex={150}
		>
			<box flexDirection="row">
				<text fg={colors.textBright} attributes={1}>
					Memory
				</text>
				<text fg={colors.subtle}> {props.snapshot.entries.length}</text>
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
			<Show when={pending()}>
				{(entry) => (
					<box flexDirection="column">
						<text fg={colors.yellow}>
							Remove this {entry().sourceLabel} entry?
						</text>
						<text fg={colors.text} wrapMode="word">
							{entry().text}
						</text>
						<text fg={colors.subtle}>Enter/Y confirm · N/Esc cancel</text>
					</box>
				)}
			</Show>
			<Show when={!pending()}>
				<textarea
					ref={(value) => {
						search = value;
					}}
					focused={focus.focusTarget() === "search"}
					height={1}
					minHeight={1}
					maxHeight={1}
					placeholder="Search memory…"
					backgroundColor={colors.panel}
					focusedBackgroundColor={colors.panel}
					textColor={colors.textBright}
					placeholderColor={colors.muted}
					onKeyDown={cancelOnEscape}
					onContentChange={() => {
						setQuery(search?.plainText ?? "");
						queueMicrotask(() => select?.setSelectedIndex(0));
					}}
				/>
				<text fg={colors.subtle}>
					Tab list · ↑/↓ move · d delete · Esc close
				</text>
				<Show
					when={entries().length === 0}
					fallback={
						<select
							ref={(value) => {
								select = value;
							}}
							options={options()}
							selectedIndex={0}
							focused={focus.focusTarget() === "list"}
							height={Math.min(20, Math.max(5, options().length))}
							backgroundColor={colors.panelRaised}
							focusedBackgroundColor={colors.panelRaised}
							textColor={colors.text}
							focusedTextColor={colors.text}
							selectedBackgroundColor={colors.selection}
							selectedTextColor={colors.textBright}
							descriptionColor={colors.subtle}
							selectedDescriptionColor={colors.text}
							showScrollIndicator
							wrapSelection
							onKeyDown={cancelOnEscape}
							onSelect={(_index, option) =>
								requestDelete(option?.value as MemoryEntry | undefined)
							}
						/>
					}
				>
					<text fg={colors.muted}>
						{props.snapshot.entries.length === 0
							? "No stored memories yet."
							: "No memories match that search."}
					</text>
				</Show>
			</Show>
		</box>
	);
}
