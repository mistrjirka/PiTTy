import type { KeyEvent, SelectRenderable, TextareaRenderable } from "@opentui/core";
import { createMemo, createSignal, type Accessor } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { CommandChoice } from "./command-suggestions.ts";
import { colors } from "./theme.ts";
import { createSearchableDialogFocus, handleSearchableDialogCancel } from "./searchable-dialog-focus.ts";

export type SkillSelectorProps = {
	commands: CommandChoice[] | Accessor<CommandChoice[]>;
	/** Receives the exact invocation text, e.g. `/skill:brave-search`. */
	onSelect: (invocation: string) => void;
	onCancel: () => void;
};

/** Display name without the `skill:` prefix; the prefix is kept on send. */
export function skillDisplayName(name: string): string {
	return name.replace(/^skill:/, "");
}

export function SkillSelector(props: SkillSelectorProps) {
	let search: TextareaRenderable | undefined;
	let select: SelectRenderable | undefined;
	const [query, setQuery] = createSignal("");
	const all = () =>
		typeof props.commands === "function" ? props.commands() : props.commands;
	const skills = createMemo(() =>
		all()
			.filter((command) => command.source === "skill")
			.sort((a, b) => a.name.localeCompare(b.name)),
	);
	const filtered = createMemo(() => {
		const text = query().trim().toLowerCase();
		if (!text) return skills();
		return skills().filter((skill) =>
			`${skillDisplayName(skill.name)} ${skill.description ?? ""}`
				.toLowerCase()
				.includes(text),
		);
	});
	const options = createMemo(() =>
		filtered().map((skill) => ({
			name: skillDisplayName(skill.name),
			description: `${skill.description ?? ""}${skill.location ? ` · ${skill.location}` : ""}`.trim(),
			value: skill,
		})),
	);

	const focus = createSearchableDialogFocus({
		getSearch: () => search,
		getList: () => select,
		getListLength: () => filtered().length,
	});
	const cancelOnEscape = (event: KeyEvent) => {
		handleSearchableDialogCancel(event, props.onCancel);
	};
	useKeyboard((event) => {
		if (event.eventType === "release") return;
		if (handleSearchableDialogCancel(event, props.onCancel)) return;
		if (focus.onKeyDown(event)) return;
		if (
			(event.name === "enter" || event.name === "return") &&
			focus.activeFocus() === "search"
		) {
			const skill = filtered()[0];
			if (skill) {
				event.preventDefault();
				event.stopPropagation();
				props.onSelect(`/${skill.name}`);
			}
		}
	});

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
					Skills
				</text>
				<box flexGrow={1} />
				<text fg={colors.muted}>
					{filtered().length} of {skills().length}
				</text>
				<text
					fg={colors.muted}
					marginLeft={2}
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
				height={1}
				minHeight={1}
				maxHeight={1}
				placeholder="Search skills…"
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
			<text fg={colors.subtle}>Tab list · ↑/↓ move · Enter send · Esc close</text>
			{skills().length === 0 ? (
				<text fg={colors.yellow}>No skills reported by Pi.</text>
			) : filtered().length === 0 ? (
				<text fg={colors.yellow}>No skills match “{query().trim()}”.</text>
			) : (
				<select
					ref={(value) => {
						select = value;
					}}
					options={options()}
					selectedIndex={0}
					focused={focus.focusTarget() === "list"}
					height={Math.min(18, Math.max(5, options().length * 2))}
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
					onSelect={(_index, option) => {
						const skill = option?.value;
						if (skill) props.onSelect(`/${skill.name}`);
					}}
				/>
			)}
		</box>
	);
}
