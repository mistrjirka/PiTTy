import type { SelectRenderable } from "@opentui/core";
import { createEffect, createMemo, For, Show } from "solid-js";
import { selectOptionIndexAtMouse } from "./select-mouse.ts";
import { DialogFrame } from "./dialog-frame.tsx";
import { settingsRowText } from "./settings-hub.tsx";
import { colors } from "./theme.ts";

export type ExtensionSettingRow = {
	id: string;
	label: string;
	summary: string;
	disabledReason?: string;
	detail?: string;
};

/**
 * Nested Settings list for extension-owned values.
 *
 * The same layout serves the profile list and the Model/Thinking detail screen
 * so keyboard and mouse behavior stay identical at both depths.
 */
export function ExtensionSettingsList(props: {
	title: string;
	/** Where Esc returns to, e.g. `esc ‹ settings`. */
	backLabel: string;
	rows: ExtensionSettingRow[];
	selectedId: string;
	busy: boolean;
	error?: string | undefined;
	onSelected: (id: string) => void;
	onOpen: (id: string) => void;
	onCancel: () => void;
}) {
	let select: SelectRenderable | undefined;
	const rows = createMemo(() => props.rows);
	const selectedIndex = () =>
		Math.max(
			0,
			rows().findIndex((row) => row.id === props.selectedId),
		);
	createEffect(() => {
		const current = rows();
		if (!select) return;
		select.options = current.map((row) => ({
			name: settingsRowText(row.label, row.summary),
			description: "",
			value: row.id,
		}));
		select.selectedIndex = selectedIndex();
	});
	const open = (row: ExtensionSettingRow | undefined) => {
		if (!row || props.busy || row.disabledReason) return;
		props.onSelected(row.id);
		props.onOpen(row.id);
	};
	return (
		<DialogFrame
			title={props.title}
			hint="↑/↓ choose · enter open"
			closeLabel={props.backLabel}
			onClose={props.onCancel}
		>
			<select
				ref={(value) => {
					select = value;
				}}
				id="extension-setting-rows"
				options={[]}
				selectedIndex={0}
				focused
				showDescription={false}
				height={Math.min(16, Math.max(3, rows().length))}
				showScrollIndicator
				wrapSelection
				backgroundColor={colors.panelRaised}
				focusedBackgroundColor={colors.panelRaised}
				textColor={colors.text}
				focusedTextColor={colors.textBright}
				selectedBackgroundColor={colors.selection}
				selectedTextColor={colors.textBright}
				descriptionColor={colors.muted}
				selectedDescriptionColor={colors.text}
				onMouseDown={(event) => {
					if (!select) return;
					event.preventDefault();
					event.stopPropagation();
					const index = selectOptionIndexAtMouse(select, event.y);
					if (index === undefined) return;
					const row = rows()[index];
					if (!row) return;
					select.setSelectedIndex(index);
					open(row);
				}}
				onSelect={(_index, option) => {
					const id =
						typeof option?.value === "string" ? option.value : undefined;
					open(rows().find((row) => row.id === id));
				}}
			/>
			<For each={rows().filter((row) => row.disabledReason || row.detail)}>
				{(row) => <text fg={colors.muted}>{row.disabledReason ?? row.detail}</text>}
			</For>
			<Show when={props.busy}>
				<text fg={colors.yellow}>Saving…</text>
			</Show>
			<Show when={props.error}>
				<text fg={colors.red}>{props.error}</text>
			</Show>
		</DialogFrame>
	);
}
