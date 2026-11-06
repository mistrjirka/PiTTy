import { For, Show } from "solid-js";
import { colors } from "./theme.ts";
import { clip } from "./model-context.tsx";

export const MCP_HOVER_LIMIT = 6;
const CARD_WIDTH = 32;

/**
 * Floating server list for the sidebar MCP row, in the spirit of an HTML
 * tooltip: it is absolutely positioned to the left of the row, so revealing
 * it never moves the panels below. The caller keeps it mounted while the
 * pointer is over the row or the card (with a short hide delay).
 */
export function McpHoverCard(props: {
	names: string[];
	/** Bullet per name: connected rows pass a status dot, configured rows a neutral marker. */
	bullet: string;
	/** Shown when `names` is empty. */
	emptyText: string;
	/** Trailing overflow line, e.g. "+2 more connected". */
	overflowText?: string | undefined;
	/** Optional last line, e.g. "Pi manages connections". */
	note?: string | undefined;
	onEnter: () => void;
	onLeave: () => void;
}) {
	const shown = () => props.names.slice(0, MCP_HOVER_LIMIT);
	const hiddenCount = () => props.names.length - shown().length;
	const overflow = () =>
		hiddenCount() > 0 ? props.overflowText : undefined;
	const innerWidth = CARD_WIDTH - 4;
	return (
		<box
			id="mcp-hover-card"
			position="absolute"
			right="100%"
			top={0}
			width={CARD_WIDTH}
			flexDirection="column"
			backgroundColor={colors.panelRaised}
			border
			borderColor={colors.borderStrong}
			paddingLeft={1}
			paddingRight={1}
			zIndex={140}
			onMouseOver={props.onEnter}
			onMouseOut={props.onLeave}
		>
			<Show
				when={shown().length > 0}
				fallback={
					<text width="100%" height={1} fg={colors.subtle} wrapMode="none">
						{clip(props.emptyText, innerWidth)}
					</text>
				}
			>
				<For each={shown()}>
					{(name) => (
						<text width="100%" height={1} fg={colors.muted} wrapMode="none">
							{clip(`${props.bullet} ${name}`, innerWidth)}
						</text>
					)}
				</For>
				<Show when={overflow()}>
					{(line) => (
						<text width="100%" height={1} fg={colors.subtle} wrapMode="none">
							{clip(line(), innerWidth)}
						</text>
					)}
				</Show>
			</Show>
			<Show when={props.note}>
				{(line) => (
					<text width="100%" height={1} fg={colors.subtle} wrapMode="none">
						{clip(line(), innerWidth)}
					</text>
				)}
			</Show>
		</box>
	);
}
