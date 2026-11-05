import type { SelectRenderable } from "@opentui/core";
import { createEffect, createMemo } from "solid-js";
import { colors } from "./theme.ts";

export type ExtensionSettingRow = {
	id: string;
	label: string;
	summary: string;
};

/**
 * Nested Settings list for extension-owned values.
 *
 * The same layout serves the profile list and the Model/Thinking detail screen
 * so keyboard and mouse behavior stay identical at both depths.
 */
export function ExtensionSettingsList(props: {
	title: string;
	hint: string;
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
			name: row.label,
			description: row.summary,
			value: row.id,
		}));
		select.selectedIndex = selectedIndex();
	});
	const open = (row: ExtensionSettingRow | undefined) => {
		if (!row || props.busy) return;
		props.onSelected(row.id);
		props.onOpen(row.id);
	};
	return (
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
		>
			<box flexDirection="row">
				<text fg={colors.textBright} attributes={1}>
					{props.title}
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
					× Back
				</text>
			</box>
			<text fg={colors.subtle}>{props.hint}</text>
			<select
				ref={(value) => {
					select = value;
				}}
				id="extension-setting-rows"
				options={[]}
				selectedIndex={0}
				focused
				flexGrow={1}
				minHeight={5}
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
					// SAFETY: OpenTUI exposes these fields at runtime but omits them from its public type.
					const scrollOffset =
						(select as unknown as { scrollOffset?: number }).scrollOffset ?? 0;
					// SAFETY: OpenTUI exposes these fields at runtime but omits them from its public type.
					const linesPerItem =
						(select as unknown as { linesPerItem?: number }).linesPerItem ?? 2;
					const visibleIndex = Math.floor(
						(event.y - select.screenY) / Math.max(1, linesPerItem),
					);
					const index = scrollOffset + visibleIndex;
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
			<text fg={props.busy ? colors.yellow : colors.subtle}>
				{props.busy ? "Saving…" : "↑/↓ choose · Enter open · Esc back"}
			</text>
			<text fg={colors.red}>{props.error ?? ""}</text>
		</box>
	);
}
