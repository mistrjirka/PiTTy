/** The message editor layout, controlled by one session-aware App state owner. */
import type {
	KeyEvent,
	MouseEvent,
	PasteEvent,
	TextareaRenderable,
} from "@opentui/core";
import type { Accessor } from "solid-js";
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

export function PromptComposer(props: PromptComposerProps) {
	return (
		<box
			border={["top"]}
			borderColor={props.streaming() ? colors.green : colors.borderStrong}
			backgroundColor={colors.panel}
			paddingLeft={2}
			paddingRight={2}
			paddingTop={1}
			paddingBottom={1}
			minHeight={4}
			maxHeight={12}
		>
			<textarea
				ref={props.onEditor}
				focused={props.focused()}
				placeholder={props.placeholder()}
				wrapMode="word"
				backgroundColor={colors.panel}
				focusedBackgroundColor={colors.panel}
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
				minHeight={2}
				maxHeight={10}
				onPaste={props.onPaste}
				onKeyDown={props.onKeyDown}
				onMouseDown={props.onMouseDown}
				onContentChange={props.onContentChange}
				onCursorChange={props.onCursorChange}
				onSubmit={props.onSubmit}
			/>
		</box>
	);
}
