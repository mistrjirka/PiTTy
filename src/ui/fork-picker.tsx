import type { KeyEvent, SelectRenderable, TextareaRenderable } from "@opentui/core";
import { createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { ForkPickerOption } from "../tabs/entry-index.ts";
import { DialogFrame } from "./dialog-frame.tsx";
import { colors } from "./theme.ts";
import { createSearchableDialogFocus, handleSearchableDialogCancel } from "./searchable-dialog-focus.ts";

export type ForkPickerProps = {
	options: readonly ForkPickerOption[];
	onSelect: (entryId: string) => void;
	onCancel: () => void;
};

function selectScrollOffset(select: SelectRenderable): number {
	// OpenTUI does not expose the visible-window offset; read it defensively so
	// mouse selection stays aligned after keyboard scrolling.
	const value: unknown = Object.getOwnPropertyDescriptor(select, "scrollOffset")?.value;
	return typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: 0;
}

export function ForkPicker(props: ForkPickerProps) {
	let search: TextareaRenderable | undefined;
	let select: SelectRenderable | undefined;
	const [query, setQuery] = createSignal("");
	const choices = createMemo(() => {
		const value = query().trim().toLowerCase();
		return value ? props.options.filter((option) => option.label.toLowerCase().includes(value)) : [...props.options];
	});
	const options = createMemo(() => choices().map((option) => ({ name: option.label, description: "", value: option })));
	const focus = createSearchableDialogFocus({ getSearch: () => search, getList: () => select, getListLength: () => choices().length, moveSelectionOnArrow: true });
	const cancel = (event: KeyEvent) => { handleSearchableDialogCancel(event, props.onCancel); };
	useKeyboard((event) => {
		if (event.eventType === "release") return;
		if (handleSearchableDialogCancel(event, props.onCancel)) return;
		if (focus.onKeyDown(event)) return;
		if ((event.name === "enter" || event.name === "return") && focus.activeFocus() === "search") {
			const option = choices()[0];
			if (option) { event.preventDefault(); event.stopPropagation(); props.onSelect(option.entryId); }
		}
	});
	return (
		<DialogFrame
			title="Fork conversation"
			// The summary carries the empty state: on a short terminal the frame
			// has no rows left for a body message.
			summary={choices().length === 0 ? "no fork points" : undefined}
			hint={choices().length === 0 ? undefined : "tab list · ↑/↓ move · enter fork"}
			height="tall"
			onClose={props.onCancel}
		>
			<textarea ref={(value) => { search = value; }} focused={focus.focusTarget() === "search"} height={1} minHeight={1} maxHeight={1} placeholder="Search messages…" backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} textColor={colors.textBright} placeholderColor={colors.muted} onKeyDown={cancel} onContentChange={() => { setQuery(search?.plainText ?? ""); queueMicrotask(() => select?.setSelectedIndex(0)); }} />
			{choices().length === 0 ? null : (
				<select
					ref={(value) => { select = value; }}
					options={options()}
					selectedIndex={0}
					focused={focus.focusTarget() === "list"}
					flexGrow={1}
					minHeight={1}
					backgroundColor={colors.panelRaised}
					focusedBackgroundColor={colors.panelRaised}
					textColor={colors.text}
					focusedTextColor={colors.text}
					selectedBackgroundColor={colors.selection}
					selectedTextColor={colors.textBright}
					descriptionColor={colors.muted}
					selectedDescriptionColor={colors.text}
					showDescription={false}
					showScrollIndicator
					wrapSelection
					onKeyDown={cancel}
					onMouseDown={(event) => {
						if (!select) return;
						event.preventDefault();
						event.stopPropagation();
						focus.focusList();
						const index = selectScrollOffset(select) + Math.floor(event.y - select.screenY);
						const option = choices()[index];
						if (!option) return;
						select.setSelectedIndex(index);
						props.onSelect(option.entryId);
					}}
					onSelect={(_index, option) => {
						if (option?.value) props.onSelect(option.value.entryId);
					}}
				/>
			)}
		</DialogFrame>
	);
}
