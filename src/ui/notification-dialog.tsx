import type { MarkdownRenderable } from "@opentui/core";
import { Show, type Accessor } from "solid-js";
import type { NotificationRecord } from "../types.ts";
import { createMarkdownLinkProps } from "./markdown-links.ts";
import { DialogFrame } from "./dialog-frame.tsx";
import { colors, getMarkdownStyle } from "./theme.ts";

export type NotificationDialogProps = {
	record: Accessor<NotificationRecord | undefined>;
	onClose: () => void;
};

export function NotificationDialog(props: NotificationDialogProps) {
	let markdown: MarkdownRenderable | undefined;
	const links = createMarkdownLinkProps(() => markdown);
	const finalize = function (this: MarkdownRenderable) {
		if (!this.streaming) return;
		queueMicrotask(() => {
			if (!this.isDestroyed) this.streaming = false;
		});
	};
	return (
		<box
			position="absolute"
			left={0}
			right={0}
			top={0}
			bottom={0}
			onMouseDown={(event) => {
				event.stopPropagation();
			}}
		>
			<DialogFrame title="Notification" width="wide" zIndex={160} onClose={props.onClose}>
				<scrollbox flexGrow={1} minHeight={1} scrollY scrollX={false}>
					<Show
						when={props.record()}
						fallback={<text fg={colors.muted}>Notification unavailable</text>}
					>
						{(record) => (
							<markdown
								{...links}
								ref={(value) => { markdown = value; }}
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
			</DialogFrame>
		</box>
	);
}
