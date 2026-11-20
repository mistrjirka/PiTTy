/** The message editor layout, controlled by one session-aware App state owner. */
import type {
	KeyEvent,
	MouseEvent,
	PasteEvent,
	TextareaRenderable,
} from "@opentui/core";
import type { Accessor } from "solid-js";
import { hasAlt, isEnterKey } from "./app-navigation.ts";
import { colors } from "./theme.ts";

export type PromptComposerProps = {
	streaming: Accessor<boolean>;
	focused: Accessor<boolean>;
	placeholder: Accessor<string | null>;
	onEditor: (editor: TextareaRenderable) => void;
	onPaste: (event: PasteEvent) => void;
	onKeyDown: (event: KeyEvent) => void | boolean;
	onMouseDown: (event: MouseEvent) => void;
	onContentChange: () => void;
	onCursorChange: () => void;
	onSubmit: () => void;
};

/** Empty-prompt hint. Short: the prompt box already says where to type. */
export function promptPlaceholder(streaming: boolean): string {
	return streaming ? "Queue a message…  alt+↑ edit queued" : "Ask Pi anything…";
}

export function PromptComposer(props: PromptComposerProps) {
	return (
		// One bordered input line that grows with the draft. The old dock spent
		// five rows (rule, padding, two editor rows, padding) on an empty prompt.
		<box
			border
			borderStyle="rounded"
			borderColor={props.streaming() ? colors.green : colors.borderStrong}
			flexDirection="row"
			flexShrink={0}
			paddingLeft={1}
			paddingRight={1}
			minHeight={3}
			maxHeight={12}
		>
			<text fg={colors.accent} wrapMode="none" flexShrink={0}>
				{"› "}
			</text>
			<textarea
				flexGrow={1}
				ref={props.onEditor}
				focused={props.focused()}
				placeholder={props.placeholder()}
				wrapMode="word"
				backgroundColor={colors.background}
				focusedBackgroundColor={colors.background}
				textColor={colors.textBright}
				focusedTextColor={colors.textBright}
				placeholderColor={colors.muted}
				selectionBg={colors.selection}
				keyBindings={[
					{ name: "return", action: "submit" },
					{ name: "enter", action: "submit" },
					{ name: "kpenter", action: "submit" },
					// Many terminals cannot report the shift modifier on Enter without
					// the Kitty keyboard protocol, and instead send a bare linefeed for
					// Shift+Enter. Treat unmodified linefeed as a newline (not submit) so
					// Shift+Enter reliably inserts a line in those terminals too.
					{ name: "linefeed", action: "newline" },
					{ name: "return", shift: true, action: "newline" },
					{ name: "enter", shift: true, action: "newline" },
					{ name: "kpenter", shift: true, action: "newline" },
					{ name: "linefeed", shift: true, action: "newline" },
				]}
				minHeight={1}
				maxHeight={10}
				onPaste={props.onPaste}
				onKeyDown={(event) => {
					// OpenTUI also binds Alt+Enter to submit. Suppress that default
					// now that the follow-up shortcut has been removed.
					if (hasAlt(event) && isEnterKey(event)) {
						event.preventDefault();
						event.stopPropagation();
						return;
					}
					return props.onKeyDown(event);
				}}
				onMouseDown={props.onMouseDown}
				onContentChange={props.onContentChange}
				onCursorChange={props.onCursorChange}
				onSubmit={props.onSubmit}
			/>
		</box>
	);
}
