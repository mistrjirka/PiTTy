import type { SelectRenderable } from "@opentui/core";
import { createEffect, createMemo } from "solid-js";
import type { SubagentModelEntry } from "../config/extension-models.ts";
import { colors } from "./theme.ts";

export function formatSubagentModelSummary(entry: SubagentModelEntry): string {
	if (!entry.model) return "No model configured";
	const parts = [entry.model];
	if (entry.thinking) parts.push(`thinking ${entry.thinking}`);
	if (entry.source) parts.push(entry.source);
	return parts.join(" · ");
}

export function SubagentModelSettings(props: {
	entries: SubagentModelEntry[];
	selectedId: string;
	busy: boolean;
	error?: string | undefined;
	onSelected: (id: string) => void;
	onPick: (entry: SubagentModelEntry) => void;
	onCancel: () => void;
}) {
	let select: SelectRenderable | undefined;
	const rows = createMemo(() =>
		props.entries.map((entry) => ({
			entry,
			name: entry.kind === "defaults" ? "Defaults" : entry.id,
			description: formatSubagentModelSummary(entry),
		})),
	);
	const selectedIndex = () =>
		Math.max(
			0,
			rows().findIndex((row) => row.entry.id === props.selectedId),
		);
	createEffect(() => {
		const current = rows();
		if (!select) return;
		select.options = current.map((row) => ({
			name: row.name,
			description: row.description,
			value: row.entry,
		}));
		select.selectedIndex = selectedIndex();
	});
	const pick = (entry: SubagentModelEntry | undefined) => {
		if (!entry || props.busy) return;
		props.onSelected(entry.id);
		props.onPick(entry);
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
					Subagent models
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
			<text fg={colors.subtle}>
				Model for each @mistrjirka/pi-subagent profile. Applies to the next
				spawned child.
			</text>
			<select
				ref={(value) => {
					select = value;
				}}
				id="subagent-model-entries"
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
					props.onSelected(row.entry.id);
					pick(row.entry);
				}}
				onSelect={(_index, option) => {
					const entry =
						option?.value && typeof option.value === "object"
							? (option.value as SubagentModelEntry)
							: undefined;
					pick(entry);
				}}
			/>
			<text fg={props.busy ? colors.yellow : colors.subtle}>
				{props.busy
					? "Saving…"
					: "↑/↓ choose · Enter pick model · Esc back"}
			</text>
			<text fg={colors.red}>{props.error ?? ""}</text>
		</box>
	);
}
