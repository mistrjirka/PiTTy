import type { MarkdownRenderable } from "@opentui/core";
import { Show, type Accessor } from "solid-js";
import type { NotificationRecord } from "../types.ts";
import { colors, getMarkdownStyle } from "./theme.ts";

export type NotificationDialogProps = {
	record: Accessor<NotificationRecord | undefined>;
	onClose: () => void;
};

export function NotificationDialog(props: NotificationDialogProps) {
	const finalize = function (this: MarkdownRenderable) {
		if (!this.streaming) return;
		queueMicrotask(() => {
			if (!this.isDestroyed) this.streaming = false;
		});
	};
	return (
		<box
			position="absolute"
			left="8%"
			right="8%"
			top="7%"
			maxHeight="86%"
			flexDirection="column"
			backgroundColor={colors.panelRaised}
			border
			borderColor={colors.borderStrong}
			padding={1}
			zIndex={160}
		>
			<box height={1} flexDirection="row">
				<text fg={colors.textBright} attributes={1}>
					Notification
				</text>
				<box flexGrow={1} />
				<text
					fg={colors.muted}
					onMouseDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
						props.onClose();
					}}
				>
					× Close
				</text>
			</box>
			<text height={1} fg={colors.subtle}>
				Esc close · scroll to read
			</text>
			<scrollbox flexGrow={1} minHeight={1} scrollY scrollX={false}>
				<Show
					when={props.record()}
					fallback={<text fg={colors.muted}>Notification unavailable</text>}
				>
					{(record) => (
						<markdown
							content={record().text}
							syntaxStyle={getMarkdownStyle()}
							fg={colors.text}
							conceal
							streaming
							renderAfter={finalize}
							tableOptions={{
								style: "columns",
								wrapMode: "word",
								selectable: true,
							}}
						/>
					)}
				</Show>
			</scrollbox>
		</box>
	);
}
