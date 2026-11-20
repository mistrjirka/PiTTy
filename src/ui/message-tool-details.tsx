/** Message display, tool detail UI, and stable formatting | message-tool-details. */

import type { BoxRenderable, TextRenderable } from "@opentui/core";

import { type MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	For,
	Show,
} from "solid-js";

import type { ToolItem } from "../types.ts";
import {
	clampDiffPath,
	cleanTerminalText,
	collapsedPreview,
	diffLineColor,
	diffLines,
	diffStats,
	expandedToolHeight,
	resolvedBoolean,
	toolOutputExpandable,
} from "./message-format.tsx";
import { useTerminalDimensions } from "@opentui/solid";
import { SPLIT_DIFF_MIN_WIDTH, SplitDiffView, splitDiffRows } from "./diff-split.tsx";
import { colors } from "./theme.ts";

export function ToolDetails(props: {
	item: ToolItem;
	toolExpanded: boolean | Accessor<boolean>;
	onToggleTool?: ((toolId: string) => void) | undefined;
	diffExpanded?: boolean | Accessor<boolean> | undefined;
	onToggleDiff?: ((toolId: string) => void) | undefined;
}) {
	const output = () => props.item.output;
	const diff = () => props.item.diff ?? "";
	const expandable = () => Boolean(output() && toolOutputExpandable(output()));
	const toolExpanded = () =>
		expandable() && resolvedBoolean(props.toolExpanded);
	const diffExpanded = () => resolvedBoolean(props.diffExpanded);
	const stats = () => diffStats(diff());
	// Hidden OpenTUI nodes still process their text. Gate full output and diff
	// preprocessing behind the user's explicit expansion.
	const expandedOutputText = createMemo(() =>
		toolExpanded() ? cleanTerminalText(output()) : "",
	);
	const expandedOutputRows = () =>
		toolExpanded() ? expandedToolHeight(output()) : 6;
	const expandedDiffLines = createMemo(() =>
		diffExpanded() ? diffLines(diff()) : [],
	);
	const terminalDimensions = useTerminalDimensions();
	// Same transcript width estimate as the thinking preview: wide terminals
	// reserve the 38-column sidebar plus padding.
	const splitDiff = () => {
		const width = terminalDimensions().width;
		return width - (width >= 104 ? 38 : 0) - 6 >= SPLIT_DIFF_MIN_WIDTH;
	};
	const splitRows = createMemo(() =>
		diffExpanded() && splitDiff() ? splitDiffRows(expandedDiffLines()) : [],
	);
	const expandedDiffRows = () => {
		if (!diffExpanded()) return 6;
		const count = splitDiff() ? splitRows().length : expandedDiffLines().length;
		return Math.max(6, Math.min(22, count));
	};
	const [scrollOwner, setScrollOwner] = createSignal<
		"transcript" | "output" | "diff"
	>("transcript");

	let outputCollapsedBox: BoxRenderable | undefined;
	let outputExpandedBox: BoxRenderable | undefined;
	let outputPreviewBox: BoxRenderable | undefined;
	let outputScrollBox: ScrollBoxRenderable | undefined;
	let outputScrollToggle: BoxRenderable | undefined;
	let outputScrollLabel: TextRenderable | undefined;
	let toolToggleLabel: TextRenderable | undefined;
	let diffContentBox: BoxRenderable | undefined;
	let diffPreviewBox: BoxRenderable | undefined;
	let diffScrollBox: ScrollBoxRenderable | undefined;
	let diffScrollToggle: BoxRenderable | undefined;
	let diffScrollLabel: TextRenderable | undefined;
	let diffToggleLabel: TextRenderable | undefined;

	const syncView = (owner: "transcript" | "output" | "diff") => {
		const outputOpen = toolExpanded();
		const diffOpen = diffExpanded();
		if (outputCollapsedBox) outputCollapsedBox.visible = !outputOpen;
		if (outputExpandedBox) outputExpandedBox.visible = outputOpen;
		if (outputPreviewBox)
			outputPreviewBox.visible = outputOpen && owner !== "output";
		if (outputScrollBox)
			outputScrollBox.visible = outputOpen && owner === "output";
		if (outputScrollToggle) outputScrollToggle.visible = outputOpen;
		if (outputScrollLabel)
			outputScrollLabel.content =
				owner === "output" ? "chat scroll" : "scroll output";
		if (toolToggleLabel)
			toolToggleLabel.content = outputOpen ? "collapse" : "expand";
		if (diffContentBox) diffContentBox.visible = diffOpen;
		if (diffPreviewBox) diffPreviewBox.visible = diffOpen && owner !== "diff";
		if (diffScrollBox) diffScrollBox.visible = diffOpen && owner === "diff";
		if (diffScrollToggle) diffScrollToggle.visible = diffOpen;
		if (diffScrollLabel)
			diffScrollLabel.content =
				owner === "diff" ? "chat scroll" : "scroll diff";
		if (diffToggleLabel)
			diffToggleLabel.content = diffOpen ? "collapse" : "view diff";
	};

	const applyScrollOwner = (owner: "transcript" | "output" | "diff") => {
		setScrollOwner(owner);
		syncView(owner);
	};

	createEffect(() => {
		const owner = scrollOwner();
		if (
			(owner === "output" && !toolExpanded()) ||
			(owner === "diff" && !diffExpanded())
		) {
			applyScrollOwner("transcript");
			return;
		}
		syncView(owner);
	});

	// OpenTUI 0.9 receives wheel events on the visible tool preview, but no
	// longer forwards the movement to the enclosing transcript automatically.
	// Explicitly forward to the nearest parent scrollbox until the user opts
	// into scrolling the nested tool output or diff.
	const scrollTranscriptFromPreview = (
		source: BoxRenderable | undefined,
		event: MouseEvent,
	) => {
		if (scrollOwner() !== "transcript") return;
		const direction = event.scroll?.direction;
		if (direction !== "up" && direction !== "down") return;
		let ancestor = source?.parent;
		while (ancestor) {
			if (ancestor instanceof ScrollBoxRenderable) {
				ancestor.scrollBy(
					(direction === "down" ? 1 : -1) *
						Math.max(1, event.scroll?.delta ?? 1) *
						3,
					"absolute",
				);
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			ancestor = ancestor.parent;
		}
	};

	return (
		<>
			<Show when={output()}>
				<Show
					when={expandable()}
					fallback={
						<text fg={colors.muted} selectable wrapMode="word">
							{cleanTerminalText(output())}
						</text>
					}
				>
					<box flexDirection="column">
						<box flexDirection="row">
							<text fg={colors.subtle} wrapMode="none">
								Output
							</text>
							<box flexGrow={1} />
							<box
								id={`${props.item.id}-output-scroll-toggle`}
								ref={(value) => {
									outputScrollToggle = value;
								}}
								visible={toolExpanded()}
								height={1}
								flexShrink={0}
								onMouseDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									applyScrollOwner(
										scrollOwner() === "output" ? "transcript" : "output",
									);
								}}
							>
								<text
									ref={(value) => {
										outputScrollLabel = value;
									}}
									fg={colors.cyan}
									wrapMode="none"
								>
									{scrollOwner() === "output" ? "chat scroll" : "scroll output"}
								</text>
							</box>
							<text fg={colors.subtle} wrapMode="none" visible={toolExpanded()}>
								{" · "}
							</text>
							<box
								id={`${props.item.id}-tool-toggle`}
								height={1}
								flexShrink={0}
								onMouseDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									props.onToggleTool?.(props.item.id);
								}}
							>
								<text
									ref={(value) => {
										toolToggleLabel = value;
									}}
									fg={colors.cyan}
									wrapMode="none"
								>
									{toolExpanded() ? "collapse" : "expand"}
								</text>
							</box>
						</box>
						<box
							ref={(value) => {
								outputCollapsedBox = value;
							}}
							visible={!toolExpanded()}
							flexDirection="row"
						>
							<text fg={colors.subtle} wrapMode="none">
								{collapsedPreview(output())}
							</text>
						</box>
						<box
							ref={(value) => {
								outputExpandedBox = value;
							}}
							visible={toolExpanded()}
							flexDirection="column"
						>
							<box
								id={`${props.item.id}-output-preview`}
								ref={(value) => {
									outputPreviewBox = value;
								}}
								visible={scrollOwner() !== "output"}
								height={expandedOutputRows()}
								minHeight={6}
								overflow="hidden"
								onMouseScroll={(event) => {
									scrollTranscriptFromPreview(outputPreviewBox, event);
								}}
							>
								<text fg={colors.muted} selectable wrapMode="word">
									{expandedOutputText()}
								</text>
							</box>
							<scrollbox
								id={`${props.item.id}-output-scroll`}
								ref={(value) => {
									outputScrollBox = value;
								}}
								visible={scrollOwner() === "output"}
								focusable={false}
								height={expandedOutputRows()}
								minHeight={6}
								scrollY
								scrollX={false}
								stickyScroll
								stickyStart="bottom"
								viewportCulling
								onMouseScroll={(event) => {
									event.preventDefault();
									event.stopPropagation();
								}}
								verticalScrollbarOptions={{ showArrows: false }}
							>
								<text fg={colors.muted} selectable wrapMode="word">
									{expandedOutputText()}
								</text>
							</scrollbox>
						</box>
					</box>
				</Show>
			</Show>

			<Show when={diff().trim()}>
				<box
					flexDirection="column"
					marginTop={1}
					border={["top"]}
					borderColor={colors.borderStrong}
					paddingTop={1}
				>
					<box
						id={`${props.item.id}-diff-header`}
						flexDirection="row"
						onMouseDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							props.onToggleDiff?.(props.item.id);
						}}
					>
						<text fg={colors.green} attributes={1}>
							{diffExpanded() ? "▼" : "▶"} Changes
						</text>
						<text fg={colors.green}> +{stats().additions}</text>
						<text fg={colors.red}> -{stats().deletions}</text>
						<Show when={props.item.diffPath}>
							<text
								fg={colors.muted}
								wrapMode="none"
								flexShrink={1}
								marginRight={1}
							>
								{" "}
								{clampDiffPath(props.item.diffPath ?? "")}
							</text>
						</Show>
						<box flexGrow={1} />
						<box
							id={`${props.item.id}-diff-scroll-toggle`}
							ref={(value) => {
								diffScrollToggle = value;
							}}
							visible={diffExpanded()}
							height={1}
							flexShrink={0}
							onMouseDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								applyScrollOwner(
									scrollOwner() === "diff" ? "transcript" : "diff",
								);
							}}
						>
							<text
								ref={(value) => {
									diffScrollLabel = value;
								}}
								fg={colors.cyan}
								wrapMode="none"
							>
								{scrollOwner() === "diff" ? "chat scroll" : "scroll diff"}
							</text>
						</box>
						<text fg={colors.subtle} wrapMode="none" visible={diffExpanded()}>
							{" · "}
						</text>
						<box
							id={`${props.item.id}-diff-toggle`}
							height={1}
							flexShrink={0}
							onMouseDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								props.onToggleDiff?.(props.item.id);
							}}
						>
							<text
								ref={(value) => {
									diffToggleLabel = value;
								}}
								fg={colors.cyan}
								wrapMode="none"
							>
								{diffExpanded() ? "collapse" : "view diff"}
							</text>
						</box>
					</box>
					<box
						ref={(value) => {
							diffContentBox = value;
						}}
						visible={diffExpanded()}
						flexDirection="column"
					>
						<box
							id={`${props.item.id}-diff-preview`}
							ref={(value) => {
								diffPreviewBox = value;
							}}
							visible={scrollOwner() !== "diff"}
							height={expandedDiffRows()}
							minHeight={6}
							overflow="hidden"
							backgroundColor={colors.diffBg}
							onMouseScroll={(event) =>
								scrollTranscriptFromPreview(diffPreviewBox, event)
							}
						>
							<Show when={splitDiff()} fallback={
								<For each={expandedDiffLines()}>
									{(line) => (
										<text
											fg={diffLineColor(line)}
											selectable
											wrapMode="char"
											flexShrink={0}
										>
											{line || " "}
										</text>
									)}
								</For>
							}>
								<SplitDiffView rows={splitRows()} />
							</Show>
						</box>
						<scrollbox
							id={`${props.item.id}-diff-scroll`}
							ref={(value) => {
								diffScrollBox = value;
							}}
							visible={scrollOwner() === "diff"}
							focusable={false}
							height={expandedDiffRows()}
							minHeight={6}
							scrollY
							scrollX={false}
							viewportCulling
							backgroundColor={colors.diffBg}
							onMouseScroll={(event) => {
								event.preventDefault();
								event.stopPropagation();
							}}
							verticalScrollbarOptions={{ showArrows: false }}
						>
							<Show when={splitDiff()} fallback={
								<For each={expandedDiffLines()}>
									{(line) => (
										<text fg={diffLineColor(line)} selectable wrapMode="char">
											{line || " "}
										</text>
									)}
								</For>
							}>
								<SplitDiffView rows={splitRows()} />
							</Show>
						</scrollbox>
					</box>
				</box>
			</Show>
		</>
	);
}
