import type { KeyEvent, SelectRenderable, TextareaRenderable } from "@opentui/core";
import { createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { ForkPickerOption } from "../tabs/entry-index.ts";
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
		<box position="absolute" left="12%" right="12%" top="8%" bottom={5} flexDirection="column" backgroundColor={colors.panelRaised} border borderColor={colors.borderStrong} padding={1} zIndex={150}>
			<box flexDirection="row"><text fg={colors.textBright} attributes={1}>Fork conversation</text><box flexGrow={1} /><text fg={colors.muted} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); props.onCancel(); }}>× Close</text></box>
			<textarea ref={(value) => { search = value; }} focused={focus.focusTarget() === "search"} height={1} minHeight={1} maxHeight={1} placeholder="Search messages…" backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} textColor={colors.textBright} placeholderColor={colors.muted} onKeyDown={cancel} onContentChange={() => { setQuery(search?.plainText ?? ""); queueMicrotask(() => select?.setSelectedIndex(0)); }} />
			<text fg={colors.subtle}>Message list · ↑/↓ move · Enter select · Esc close</text>
			{choices().length === 0 ? <text fg={colors.yellow}>No fork points.</text> : (
				<select
					ref={(value) => { select = value; }}
					options={options()}
					selectedIndex={0}
					focused={focus.focusTarget() === "list"}
					height={Math.min(18, Math.max(5, options().length))}
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
		</box>
	);
}
