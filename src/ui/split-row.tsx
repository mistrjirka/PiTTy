/** One terminal row with a left value and a right-aligned value. */
import { Show } from "solid-js";
import { colors } from "./theme.ts";

export function SplitRow(props: {
	left: string;
	right?: string | undefined;
	leftColor?: string | undefined;
	rightColor?: string | undefined;
}) {
	return (
		<box height={1} minHeight={1} flexShrink={0} flexDirection="row">
			<text fg={props.leftColor ?? colors.text} wrapMode="none" flexShrink={1}>
				{props.left}
			</text>
			<box flexGrow={1} minWidth={1} />
			<Show when={props.right}>
				<text
					fg={props.rightColor ?? colors.subtle}
					wrapMode="none"
					flexShrink={0}
				>
					{props.right}
				</text>
			</Show>
		</box>
	);
}
