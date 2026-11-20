import { For, Show } from "solid-js";
import type { ConversationTab } from "../tabs/manager.ts";
import { resolveTabTitle } from "../tabs/manager.ts";
import { colors } from "./theme.ts";

export type TabStripProps = {
	tabs: readonly ConversationTab[];
	activeId: string;
	onActivate: (id: string) => void;
	onClose: (id: string) => void;
	onCreate: () => void;
	onOpenForkPicker: () => void;
	maxTabs?: number;
	/** True while that tab's session is streaming, so background work stays visible. */
	isWorking?: ((id: string) => boolean) | undefined;
	/** Current spinner frame for working tabs. */
	spinner?: string | undefined;
};

/**
 * Status glyph before a tab title: working beats unseen output. A finished
 * background session with unseen activity shows ✓ (or ✗ after an error)
 * instead of a bare counter.
 */
export function tabStatusGlyph(
	tab: Pick<ConversationTab, "badges" | "badgeKind">,
	working: boolean,
	spinner: string,
): { glyph: string; color: string } | undefined {
	if (working) return { glyph: spinner, color: colors.accent };
	if (tab.badges <= 0) return undefined;
	if (tab.badgeKind === "error") return { glyph: "✗", color: colors.red };
	return { glyph: "✓", color: colors.green };
}

export function TabStrip(props: TabStripProps) {
	return (
		<box
			id="tab-strip"
			flexDirection="column"
			height={1}
			width="100%"
			overflow="hidden"
		>
			<box height={1} minHeight={1} flexShrink={0} flexDirection="row">
				<box
					id="tab-strip-tabs"
					flexDirection="row"
					height={1}
					minHeight={1}
					flexShrink={1}
					minWidth={0}
					overflow="hidden"
				>
					<box flexDirection="row" minWidth={0} overflow="hidden">
						<For each={props.tabs}>
							{(tab) => (
								<box
									flexDirection="row"
									alignItems="center"
									height={1}
									minHeight={1}
									flexShrink={0}
									paddingLeft={1}
									paddingRight={1}
									backgroundColor={
										tab.id === props.activeId
											? colors.panelRaised
											: colors.background
									}
									onMouseDown={(event) => {
										event.preventDefault();
										props.onActivate(tab.id);
									}}
								>
									<Show
										when={tabStatusGlyph(
											tab,
											props.isWorking?.(tab.id) === true,
											props.spinner ?? "◉",
										)}
									>
										{(status) => (
											<text fg={status().color} wrapMode="none">
												{`${status().glyph} `}
											</text>
										)}
									</Show>
									<text
										fg={
											tab.id === props.activeId
												? colors.textBright
												: colors.muted
										}
										wrapMode="none"
									>
										{resolveTabTitle(tab)}
									</text>
									<Show when={props.tabs.length > 1}>
										<text
											fg={colors.muted}
											onMouseDown={(event) => {
												event.preventDefault();
												event.stopPropagation();
												props.onClose(tab.id);
											}}
										>
											{" × "}
										</text>
									</Show>
								</box>
							)}
						</For>
					</box>
				</box>
				<box
					flexDirection="row"
					height={1}
					minHeight={1}
					flexShrink={0}
				>
					<text
						id="tab-strip-fork"
						fg={colors.cyan}
						onMouseDown={(event) => {
							event.preventDefault();
							props.onOpenForkPicker();
						}}
					>
						{" ⑂ "}
					</text>
					<text
						id="tab-strip-create"
						fg={
							props.tabs.length >= (props.maxTabs ?? 8)
								? colors.muted
								: colors.cyan
						}
						onMouseDown={(event) => {
							event.preventDefault();
							props.onCreate();
						}}
					>
						{" + "}
					</text>
				</box>
			</box>
		</box>
	);
}
