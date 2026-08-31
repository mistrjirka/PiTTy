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
};

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
									<text
										fg={
											tab.id === props.activeId
												? colors.textBright
												: colors.muted
										}
										attributes={tab.id === props.activeId ? 1 : 0}
										wrapMode="none"
									>
										{tab.id === props.activeId ? "▸ " : "  "}
										{resolveTabTitle(tab)}
										{tab.badges > 0 ? ` •${tab.badges}` : ""}
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
