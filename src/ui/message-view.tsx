import { CustomMessage } from "./message-custom-card.tsx";
import { ToolMessage } from "./message-tool-card.tsx";

/** Message display, tool detail UI, and stable formatting | message-view. */

import type { MarkdownRenderable } from "@opentui/core";
import { createMarkdownLinkProps } from "./markdown-links.ts";
import { createMermaidBlockRenderer } from "./mermaid-renderer.ts";
import { useTerminalDimensions } from "@opentui/solid";
import { type Accessor, createEffect, createMemo, Show } from "solid-js";

import type { SubagentTarget } from "../subagents/targets.ts";
import type { MessageItemSource } from "./message-format.tsx";

import {
	cleanAnswerText,
	cleanTerminalText,
	cleanThinkingText,
	collapsedThinkingPreview,
	currentMessageItem,
	thinkingHeading,
	thinkingLineCount,
} from "./message-format.tsx";
import {
	colors,
	getMarkdownStyle,
	getThemeRevision,
	getThinkingMarkdownStyle,
} from "./theme.ts";

export function MessageView(props: {
	item: MessageItemSource;
	showThinking: boolean;
	thinkingExpanded?: boolean | Accessor<boolean>;
	onToggleThinking?: () => void;
	toolExpanded: boolean | Accessor<boolean>;
	onToggleTool?: (toolId: string) => void;
	diffExpanded?: boolean | Accessor<boolean>;
	onToggleDiff?: (toolId: string) => void;
	subagentTargets?: SubagentTarget[] | undefined;
	onInspectSubagentTarget?: ((targetKey: string) => void) | undefined;
	onFork?: ((entryId: string) => void) | undefined;
	canFork?: boolean;
	/** Label before a user message: "you" in the main chat, "task"/"steer" in a subagent. */
	userLabel?: string | undefined;
	/** See `ToolMessageProps.compactBelow`. */
	compactBelow?: boolean | undefined;
	now?: number;
}) {
	const currentItem = createMemo(() => currentMessageItem(props.item));
	const initialItem = currentItem();
	const item =
		typeof props.item === "function"
			? new Proxy(initialItem, {
					get(_target, property, receiver) {
						return Reflect.get(currentItem(), property, receiver);
					},
				})
			: initialItem;
	const thinking = createMemo(() => {
		const value = currentItem();
		return value.kind === "assistant" ? cleanThinkingText(value.thinking) : "";
	});
	const answer = createMemo(() => {
		const value = currentItem();
		return value.kind === "assistant" ? cleanAnswerText(value.text) : "";
	});
	const assistantError = createMemo(() => {
		const value = currentItem();
		return value.kind === "assistant" ? cleanTerminalText(value.errorMessage ?? "") : "";
	});
	const assistantStatus = createMemo(() => {
		const value = currentItem();
		return value.kind === "assistant" ? value.status : "done";
	});
	const terminalDimensions = useTerminalDimensions();
	// The preview is one non-wrapping line; terminals clip its right edge,
	// so it is sized to the visible conversation width to keep the true tail
	// of the thought on screen. Wide terminals reserve the 38-column
	// sidebar and the conversation padding.
	const thinkingPreviewMax = () => {
		const width = terminalDimensions().width;
		return Math.max(24, width - (width >= 104 ? 38 : 0) - 6);
	};
	const thinkingIsExpanded = () =>
		typeof props.thinkingExpanded === "function"
			? props.thinkingExpanded()
			: props.thinkingExpanded !== false;
	// Only the markdown nodes keep refs (theme sync above, content writes
	// below); every other thinking/answer property is bound declaratively in
	// JSX — see the note above for why there must be no imperative mirror for
	// `visible`.
	let thinkingMarkdown: MarkdownRenderable | undefined;
	let finalAnswer: MarkdownRenderable | undefined;
	const renderMermaid = createMermaidBlockRenderer(() => finalAnswer);
	const thinkingLinks = createMarkdownLinkProps(() => thinkingMarkdown);
	const answerLinks = createMarkdownLinkProps(() => finalAnswer);

	createEffect(() => {
		getThemeRevision();
		if (thinkingMarkdown)
			thinkingMarkdown.syntaxStyle = getThinkingMarkdownStyle();
		if (finalAnswer) finalAnswer.syntaxStyle = getMarkdownStyle();
	});

	const finalizeMarkdownAfterRender = function (this: MarkdownRenderable) {
		if (assistantStatus() === "streaming" || !this.streaming) return;
		queueMicrotask(() => {
			if (!this.isDestroyed && assistantStatus() !== "streaming")
				this.streaming = false;
		});
	};

	// NOTE: visibility for the thinking/answer pair below is bound
	// declaratively in JSX with no imperative mirror. An earlier revision also
	// drove `.visible` from this effect, and the two writers disagreed for a
	// frame on every transition (both the streaming text and its markdown
	// replacement visible, or neither). One owner per property: JSX owns
	// `visible`; the effect below owns markdown `content` (+ the `streaming`
	// flag), which the markdown renderable requires as an imperative
	// write-update cycle in order to re-parse its blocks — a declarative
	// `content` prop alone updates the property but never repaints.
	createEffect(() => {
		const value = currentItem();
		if (value.kind !== "assistant") return;
		const streaming = value.status === "streaming";
		const expanded = thinkingIsExpanded();
		if (thinkingMarkdown) {
			if (expanded && !streaming) {
				if (!thinkingMarkdown.streaming) thinkingMarkdown.streaming = true;
				thinkingMarkdown.content = thinking();
			}
		}
		if (finalAnswer) {
			if (!streaming) {
				if (!finalAnswer.streaming) finalAnswer.streaming = true;
				finalAnswer.content = answer() || "▍";
			}
		}
	});

	return (
		<>
			<Show when={item.kind === "user"}>
				<box
					id={item.id}
					flexDirection="row"
					backgroundColor={colors.panelRaised}
					paddingLeft={1}
					paddingRight={1}
					marginBottom={1}
				>
					<text fg={colors.accent} wrapMode="none" flexShrink={0}>
						{`${props.userLabel ?? "you"}  `}
					</text>
					<text
						fg={colors.textBright}
						selectable
						wrapMode="word"
						flexGrow={1}
						flexShrink={1}
					>
						{(item.kind === "user" ? item.text : "") +
							(item.kind === "user" && item.optimistic ? "  …" : "")}
					</text>
					<Show
						when={
							props.canFork &&
							item.kind === "user" &&
							item.entryId &&
							props.onFork
						}
					>
						<text
							fg={colors.subtle}
							wrapMode="none"
							flexShrink={0}
							onMouseDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								if (item.kind === "user" && item.entryId)
									props.onFork?.(item.entryId);
							}}
						>
							{"  ⑂ fork"}
						</text>
					</Show>
				</box>
			</Show>

			<Show when={item.kind === "assistant"}>
				<box
					id={item.id}
					flexDirection="column"
					marginBottom={1}
					paddingLeft={0}
					paddingRight={0}
				>
					<box
						id={`${item.id}-thinking`}
						visible={props.showThinking && Boolean(thinking().trim())}
						flexDirection="column"
						marginBottom={answer().trim() ? 1 : 0}
						paddingLeft={1}
						paddingRight={1}
						backgroundColor={
							thinkingIsExpanded() ? colors.thinkingBg : "transparent"
						}
					>
						<box
							flexDirection="row"
							onMouseDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								props.onToggleThinking?.();
							}}
						>
							<text fg={colors.subtle} wrapMode="none">
								{thinkingHeading(
									assistantStatus() === "streaming",
									thinkingIsExpanded(),
									thinkingLineCount(thinking()),
								)}
								{item.kind === "assistant" &&
								item.retriedAfterInterruptedThinking
									? " · retry"
									: ""}
							</text>
						</box>
						<text
							// A finished, collapsed thought is just its heading. The
							// one-line preview only earns its row while the thought is
							// still streaming and the user wants to see it move.
							visible={
								!thinkingIsExpanded() && assistantStatus() === "streaming"
							}
							fg={colors.subtle}
							selectable
							wrapMode="none"
						>
							{collapsedThinkingPreview(thinking(), thinkingPreviewMax())}
						</text>
						<text
							id={`${item.id}-thinking-stream`}
							visible={
								thinkingIsExpanded() && assistantStatus() === "streaming"
							}
							fg={colors.muted}
							selectable
							wrapMode="word"
						>
							{thinking() || "▍"}
						</text>
						<markdown
							id={`${item.id}-thinking-markdown`}
							{...thinkingLinks}
							ref={(value) => {
								thinkingMarkdown = value;
							}}
							visible={
								thinkingIsExpanded() && assistantStatus() !== "streaming"
							}
							syntaxStyle={getThinkingMarkdownStyle()}
							fg={colors.muted}
							conceal
							streaming
							renderAfter={finalizeMarkdownAfterRender}
							tableOptions={{
								style: "columns",
								wrapMode: "word",
								selectable: true,
							}}
						/>
					</box>
					<box
						id={`${item.id}-answer`}
						visible={
							Boolean(answer().trim()) ||
							(assistantStatus() === "streaming" && !thinking().trim())
						}
						paddingLeft={1}
						paddingRight={1}
					>
						<text
							id={`${item.id}-answer-stream`}
							visible={assistantStatus() === "streaming"}
							fg={colors.textBright}
							selectable
							wrapMode="word"
						>
							{answer() || "▍"}
						</text>
						<markdown
							id={`${item.id}-answer-markdown`}
							{...answerLinks}
							ref={(value) => {
								finalAnswer = value;
							}}
							visible={assistantStatus() !== "streaming"}
							syntaxStyle={getMarkdownStyle()}
							fg={colors.textBright}
							conceal
							streaming
							renderBlock={renderMermaid}
							renderAfter={finalizeMarkdownAfterRender}
							tableOptions={{
								style: "grid",
								widthMode: "content",
								cellPaddingX: 1,
								wrapMode: "word",
								selectable: true,
								borderColor: colors.borderStrong,
							}}
						/>
					</box>
					<Show when={assistantError()}>
						<box paddingLeft={1} paddingRight={1}>
							<text fg={colors.red} selectable wrapMode="word">
								{assistantError()}
							</text>
						</box>
					</Show>
				</box>
			</Show>

			<Show when={item.kind === "tool"}>
				{(() =>
					item.kind === "tool" ? (
						<ToolMessage
							item={item}
							toolExpanded={props.toolExpanded}
							onToggleTool={props.onToggleTool}
							diffExpanded={props.diffExpanded}
							onToggleDiff={props.onToggleDiff}
							subagentTargets={props.subagentTargets}
							onInspectSubagentTarget={props.onInspectSubagentTarget}
							now={props.now}
							compactBelow={props.compactBelow}
						/>
					) : null)()}
			</Show>
			<Show when={item.kind === "custom"}>
				{(() =>
					item.kind === "custom" ? <CustomMessage item={item} /> : null)()}
			</Show>

			<Show when={item.kind === "system"}>
				<box id={item.id} paddingLeft={1} marginBottom={1}>
					<text
						selectable
						wrapMode="word"
						fg={
							item.kind !== "system"
								? colors.muted
								: item.tone === "error"
									? colors.red
									: item.tone === "warning"
										? colors.yellow
										: item.tone === "success"
											? colors.green
											: item.tone === "info"
												? colors.cyan
												: colors.muted
						}
					>
						{item.kind === "system" ? `· ${cleanTerminalText(item.text)}` : ""}
					</text>
				</box>
			</Show>
		</>
	);
}
