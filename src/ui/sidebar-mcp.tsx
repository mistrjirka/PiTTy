/** MCP summary row with a hover card listing servers. */
import { type Accessor, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { McpConfiguredSummary } from "../config/mcp-config.ts";
import {
	connectedMcpServerNames,
	type McpStatusCounts,
	type McpStatusSnapshot,
	mcpEnabledCount,
} from "../state/mcp-status.ts";
import { MCP_HOVER_LIMIT, McpHoverCard } from "./mcp-hover-card.tsx";
import { clip, stateIcon } from "./model-context.tsx";
import { mcpSummaryColor, mcpSummaryText } from "./sidebar-layout.ts";
import { colors } from "./theme.ts";

export type SidebarMcpProps = {
	mcpStatus?: Accessor<McpStatusSnapshot | undefined> | undefined;
	mcpCounts?: Accessor<McpStatusCounts | undefined> | undefined;
	mcpConfigured?: Accessor<McpConfiguredSummary | undefined> | undefined;
};

/** Live counts win over the fallback counts; both may be absent. */
export function resolvedMcpCounts(
	props: SidebarMcpProps,
): McpStatusCounts | { enabled: number; connected: number; disabled: number } | undefined {
	const snapshot = props.mcpStatus?.();
	if (snapshot)
		return {
			enabled: mcpEnabledCount(snapshot),
			connected: snapshot.connectedCount,
			disabled: snapshot.disabledCount,
		};
	return props.mcpCounts?.();
}

export function SidebarMcpRow(props: SidebarMcpProps) {
	const mcpSnapshot = () => props.mcpStatus?.();
	const mcpConfigured = () => props.mcpConfigured?.();
	const mcpCounts = () => resolvedMcpCounts(props);
	const [mcpHover, setMcpHover] = createSignal(false);
	// The card floats left of the row with a small gap. Moving across that gap
	// emits out-then-over, so a short hide delay keeps the card readable while
	// the pointer travels between the row and the card.
	let mcpHideTimer: ReturnType<typeof setTimeout> | undefined;
	const showMcpDetails = () => {
		if (mcpHideTimer !== undefined) {
			clearTimeout(mcpHideTimer);
			mcpHideTimer = undefined;
		}
		setMcpHover(true);
	};
	const scheduleMcpHide = () => {
		if (mcpHideTimer !== undefined) clearTimeout(mcpHideTimer);
		mcpHideTimer = setTimeout(() => {
			mcpHideTimer = undefined;
			setMcpHover(false);
		}, 250);
	};
	onCleanup(() => {
		if (mcpHideTimer !== undefined) clearTimeout(mcpHideTimer);
	});
	const mcpConnectedNames = createMemo(() => {
		const snapshot = mcpSnapshot();
		return snapshot ? connectedMcpServerNames(snapshot) : [];
	});
	return (
		<>
		<Show when={!mcpCounts() && mcpConfigured()}>
			{(configured) => (
				<box
					id="mcp-configured-status"
					flexDirection="column"
					flexShrink={0}
					onMouseOver={showMcpDetails}
					onMouseOut={scheduleMcpHide}
				>
					<text width="100%" height={1} fg={colors.subtle} wrapMode="none">
						{clip(
							`MCP ${configured().enabled} server${configured().enabled === 1 ? "" : "s"}${configured().disabled ? ` · ${configured().disabled} off` : ""}`,
							31,
						)}
					</text>
					<Show when={mcpHover()}>
						<McpHoverCard
							names={configured().enabledNames}
							bullet="·"
							emptyText="no servers enabled"
							overflowText={`+${configured().enabledNames.length - MCP_HOVER_LIMIT} more`}
							note="Pi manages connections"
							onEnter={showMcpDetails}
							onLeave={scheduleMcpHide}
						/>
					</Show>
				</box>
			)}
		</Show>
		<Show when={mcpCounts()}>
			{(counts) => (
				<box
					id="mcp-status"
					flexDirection="column"
					flexShrink={0}
					onMouseOver={showMcpDetails}
					onMouseOut={scheduleMcpHide}
				>
					<text
						width="100%"
						height={1}
						fg={mcpSummaryColor(
							counts(),
							(mcpSnapshot()?.servers ?? []).some(
								(server) => server.status === "failed",
							),
						)}
						wrapMode="none"
					>
						{clip(mcpSummaryText(counts()), 31)}
					</text>
					<Show when={mcpHover()}>
						<McpHoverCard
							names={mcpConnectedNames()}
							bullet={stateIcon("running")}
							emptyText={
								counts().connected > 0
									? `${counts().connected} connected (names unavailable)`
									: "none connected"
							}
							overflowText={`+${mcpConnectedNames().length - MCP_HOVER_LIMIT} more connected`}
							onEnter={showMcpDetails}
							onLeave={scheduleMcpHide}
						/>
					</Show>
				</box>
			)}
		</Show>
		</>
	);
}
