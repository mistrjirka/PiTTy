/** Expanded original tool arguments. No source is serialized into a single-line JSON preview. */
import type { ToolInputDetail } from "./tool-input-format.ts";
import { cleanTerminalText } from "./message-format.tsx";
import { colors } from "./theme.ts";

export function ToolInputPanel(props: {
	id: string;
	detail: ToolInputDetail;
	receipt?: string | undefined;
}) {
	const lines = () => props.detail.text.split(/\r?\n/).length;
	return (
		<box id={props.id} width="100%" flexDirection="column" marginTop={1}
			backgroundColor={colors.panelSoft} paddingLeft={1} paddingRight={1}>
			<text fg={colors.subtle} height={1} minHeight={1} wrapMode="none">
				{props.detail.title}
			</text>
			<scrollbox height={Math.min(10, Math.max(2, lines() + 1))}
				minHeight={2} scrollY scrollX={false} viewportCulling
				verticalScrollbarOptions={{ showArrows: false }}>
				<text fg={colors.text} selectable wrapMode="word">
					{cleanTerminalText(props.detail.text)}
				</text>
			</scrollbox>
			{props.receipt ? <text fg={colors.subtle} selectable wrapMode="word">
				{cleanTerminalText(props.receipt)}
			</text> : null}
		</box>
	);
}
