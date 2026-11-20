/**
 * Shared frame for every overlay dialog: one rounded box, one header row
 * (title, optional summary, close target) and at most one row of key hints.
 * Dialogs used to copy this frame with their own offsets, borders and close
 * labels, so they drifted apart; this is the single owner now.
 */
import type { KeyEvent } from "@opentui/core";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { colors } from "./theme.ts";

export type DialogWidth = "narrow" | "normal" | "wide";

const SIDE_INSET: Record<DialogWidth, `${number}%`> = {
	narrow: "25%",
	normal: "12%",
	wide: "8%",
};

export function DialogFrame(props: {
	id?: string | undefined;
	title: string;
	/** Short state next to the title, e.g. `2 active · 3 finished`. */
	summary?: string | undefined;
	/** One row of keys, e.g. `↑/↓ move · enter open`. Esc is implied by the close target. */
	hint?: string | undefined;
	onClose: () => void;
	/** Sub-pages of Settings go back rather than close. */
	closeLabel?: string | undefined;
	width?: DialogWidth | undefined;
	/**
	 * `fit` (default) sizes to content and suits short lists and forms;
	 * `tall` fills down to the prompt for long, scrolling lists.
	 */
	height?: "fit" | "tall" | undefined;
	zIndex?: number | undefined;
	/** For dialogs whose Esc means "leave the sub-view" before "close". */
	onKeyDown?: ((event: KeyEvent) => void) | undefined;
	children: JSX.Element;
}) {
	const inset = () => SIDE_INSET[props.width ?? "normal"];
	const tall = () => props.height === "tall";
	// The transparent slot always stops 5 rows above the bottom so the prompt
	// and its unsent draft stay visible under any dialog. A `fit` frame shrinks
	// inside the slot; `overflow="hidden"` clips content (a select paints its
	// whole height) that would otherwise spill over the prompt.
	return (
		<box
			position="absolute"
			left={inset()}
			right={inset()}
			top={2}
			bottom={5}
			flexDirection="column"
			zIndex={props.zIndex ?? 150}
		>
		<box
			{...(props.id ? { id: props.id } : {})}
			{...(tall() ? { flexGrow: 1 } : { flexShrink: 1 })}
			maxHeight="100%"
			overflow="hidden"
			flexDirection="column"
			backgroundColor={colors.panelRaised}
			border
			borderStyle="rounded"
			borderColor={colors.borderStrong}
			paddingLeft={2}
			paddingRight={2}
			paddingTop={1}
			paddingBottom={1}
			{...(props.onKeyDown ? { onKeyDown: props.onKeyDown } : {})}
			onMouseDown={(event) => {
				event.stopPropagation();
			}}
		>
			<box height={1} minHeight={1} flexShrink={0} flexDirection="row">
				<text fg={colors.textBright} attributes={1} wrapMode="none" flexShrink={1}>
					{props.title}
				</text>
				<Show when={props.summary}>
					<text fg={colors.subtle} wrapMode="none" flexShrink={1}>
						{`  ${props.summary}`}
					</text>
				</Show>
				<box flexGrow={1} minWidth={2} />
				<text
					{...(props.id ? { id: `${props.id}-close` } : {})}
					fg={colors.subtle}
					wrapMode="none"
					flexShrink={0}
					onMouseDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
						props.onClose();
					}}
				>
					{props.closeLabel ?? "esc ×"}
				</text>
			</box>
			<Show when={props.hint}>
				<text fg={colors.subtle} wrapMode="none" height={1} flexShrink={0}>
					{props.hint}
				</text>
			</Show>
			<box height={1} flexShrink={0} />
			{props.children}
		</box>
		</box>
	);
}
