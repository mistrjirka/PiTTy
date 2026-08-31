import { For, Show, createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import type {
	BoxRenderable,
	MarkdownRenderable,
	TextRenderable,
	ScrollBoxRenderable,
} from "@opentui/core";
import stripAnsi from "strip-ansi";
import type { ConversationItem, CustomItem, ToolItem } from "../types.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import {
	colors,
	getMarkdownStyle,
	getThinkingMarkdownStyle,
	getThemeRevision,
} from "./theme.ts";
import { formatDuration } from "./duration.ts";
import {
	summarizeSubagentArgs,
	taskGist,
	terminalBadge,
	workflowChildrenSummary,
} from "./subagent-format.ts";

function toolVisual(
	name: string,
	isError: boolean,
): { accent: string; background: string; icon: string } {
	if (isError)
		return { accent: colors.red, background: colors.toolOtherBg, icon: "×" };
	const normalized = name.toLowerCase();
	if (/write|edit|patch|replace/.test(normalized))
		return { accent: colors.green, background: colors.toolWriteBg, icon: "◆" };
	if (/bash|shell|exec|command|terminal/.test(normalized))
		return { accent: colors.orange, background: colors.toolShellBg, icon: "▣" };
	if (normalized === "subagent_supervisor")
		return { accent: colors.purple, background: colors.toolAgentBg, icon: "◇" };
	if (/subagent|task|agent|delegate/.test(normalized))
		return { accent: colors.purple, background: colors.toolAgentBg, icon: "◇" };
	if (/read|grep|find|search|list|glob|web|fetch/.test(normalized))
		return { accent: colors.accent, background: colors.toolReadBg, icon: "●" };
	return { accent: colors.cyan, background: colors.toolOtherBg, icon: "●" };
}

export function cleanTerminalText(value: string): string {
	return (
		stripAnsi(value)
			// A few transcript writers persist the CSI body after losing the ESC byte.
			// Remove only numeric ANSI color/cursor fragments, not ordinary bracketed text.
			.replace(/\[(?:\d{1,3};)+\d{0,3}[mGKHFJ]/g, "")
			.replace(/\[\d{1,3}[mGKHFJ]/g, "")
			.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
	);
}

function clampDiffPath(value: string, maxLength = 48): string {
	if (value.length <= maxLength) return value;
	if (maxLength < 4) return value.slice(0, maxLength);
	const left = Math.ceil((maxLength - 1) / 2);
	const right = Math.floor((maxLength - 1) / 2);
	return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function diffLines(value: string): string[] {
	return cleanTerminalText(value).trimEnd().split(/\r?\n/);
}

function diffStats(value: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const line of diffLines(value)) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) additions += 1;
		else if (line.startsWith("-")) deletions += 1;
	}
	return { additions, deletions };
}

function diffLineColor(line: string): string {
	if (line.startsWith("+++") || line.startsWith("---")) return colors.muted;
	if (line.startsWith("+")) return colors.green;
	if (line.startsWith("-")) return colors.red;
	if (line.startsWith("@@")) return colors.cyan;
	if (line.startsWith("diff ") || line.startsWith("Index:"))
		return colors.purple;
	return colors.text;
}

function expandedDiffHeight(value: string): number {
	return Math.max(6, Math.min(22, diffLines(value).length));
}

function prettyArgs(args: unknown): string {
	if (args === undefined) return "";
	if (typeof args === "string") return args;
	try {
		return JSON.stringify(args, null, 2);
	} catch {
		return String(args);
	}
}

function expandedToolHeight(output: string): number {
	return Math.max(6, Math.min(18, output.split("\n").length + 1));
}

export function toolOutputExpandable(output: string): boolean {
	const clean = cleanTerminalText(output).trimEnd();
	if (!clean) return false;
	const lines = clean.split("\n");
	// The collapsed preview shows the whitespace-collapsed text on one line
	// (capped at 100 chars) and the expanded view caps at 18 rows, so offer the
	// toggle only when expanding reveals something the preview cannot:
	// - more lines than the expanded viewport can show (scrolling reveals rest)
	// - a single line longer than the preview cap (wrapping reveals the tail)
	// - multi-line output whose normalized content exceeds the preview cap
	if (lines.length > 18) return true;
	const normalized = clean.replace(/\s+/g, " ").trim();
	if (normalized.length > 120) return true;
	return lines.some((line) => line.length > 180);
}

function collapsedPreview(output: string): string {
	const normalized = cleanTerminalText(output).replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	return normalized.length > 100 ? `${normalized.slice(0, 97)}…` : normalized;
}

export function cleanThinkingText(value: string): string {
	let result = cleanTerminalText(value).trimStart();
	// Some providers include their own “Thinking” heading. Strip every leading
	// copy so the UI heading is shown exactly once. Only strip an actual heading
	// (a colon or newline must follow), not normal prose such as “Thinking about…”.
	for (let index = 0; index < 4; index++) {
		const next = result
			.replace(
				/^\s*(?:[>|#*_`-]+\s*)*(?:thinking|reasoning)\s*(?::\s*|\r?\n\s*)/i,
				"",
			)
			.trimStart();
		if (next === result) break;
		result = next;
	}
	return result;
}

function cleanAnswerText(value: string): string {
	return cleanTerminalText(value).trimStart();
}

function thinkingLineCount(value: string): number {
	const clean = value.trim();
	return clean ? clean.split(/\r?\n/).length : 0;
}

function collapsedThinkingPreview(value: string): string {
	const clean = value.replace(/\s+/g, " ").trim();
	if (!clean) return "";
	return clean.length > 180 ? `${clean.slice(0, 177)}…` : clean;
}

function supervisorArgs(args: unknown): Record<string, unknown> | undefined {
	return args && typeof args === "object" && !Array.isArray(args)
		? (args as Record<string, unknown>)
		: undefined;
}

function supervisorToolLabel(args: unknown): string | undefined {
	const record = supervisorArgs(args);
	const action = typeof record?.action === "string" ? record.action.toLowerCase() : "";
	if (action === "reply") {
		const recipient =
			typeof record?.agent === "string" && record.agent.trim()
				? record.agent
				: typeof record?.replyTo === "string" && record.replyTo.trim()
					? record.replyTo
					: "";
		return `→ reply ${recipient}`.trim();
	}
	if (action === "status") return "supervisor status";
	if (action === "pending" || action === "list") return "pending supervisor requests";
	return undefined;
}

function supervisorMessage(args: unknown): string {
	const message = supervisorArgs(args)?.message;
	return typeof message === "string" ? message : "";
}

function customQuestionParts(item: CustomItem): { body: string; hint: string } {
	const lines = cleanTerminalText(item.text).split(/\r?\n/);
	let hintIndex = -1;
	for (let index = lines.length - 1; index >= 0; index--) {
		if (/^\s*Reply with:\s*subagent_supervisor\(/.test(lines[index] ?? "")) {
			hintIndex = index;
			break;
		}
	}
	if (hintIndex < 0 || lines.slice(hintIndex + 1).some((line: string) => line.trim()))
		return { body: lines.join("\n"), hint: "" };
	return { body: lines.slice(0, hintIndex).join("\n").trimEnd(), hint: lines[hintIndex]!.trim() };
}

function customDetail(item: CustomItem, key: string): string {
	const details = item.details;
	if (!details || typeof details !== "object" || Array.isArray(details)) return "";
	const value = (details as Record<string, unknown>)[key];
	return typeof value === "string" && value.trim() ? value : "";
}

function toolTiming(item: ToolItem, now: number): string {
	const startedAt = item.startedAt;
	if (startedAt === undefined)
		return item.timeoutMs
			? `timeout ${formatDuration(item.timeoutMs, "")}`
			: "";
	const elapsed = Math.max(0, (item.endedAt ?? now) - startedAt);
	const duration = formatDuration(elapsed, "");
	const timeout = formatDuration(item.timeoutMs, "");
	if (item.status === "streaming" || item.status === "pending") {
		return `${duration}${timeout ? ` / timeout ${timeout}` : ""}`;
	}
	return duration
		? `took ${duration}${timeout ? ` · timeout ${timeout}` : ""}`
		: timeout
			? `timeout ${timeout}`
			: "";
}

type MessageItemSource = ConversationItem | Accessor<ConversationItem>;

function currentMessageItem(source: MessageItemSource): ConversationItem {
	return typeof source === "function" ? source() : source;
}

function resolvedBoolean(
	value: boolean | Accessor<boolean> | undefined,
): boolean {
	return typeof value === "function" ? value() : value === true;
}

function ToolDetails(props: {
	item: ToolItem;
	toolExpanded: boolean | Accessor<boolean>;
	onToggleTool?: ((toolId: string) => void) | undefined;
	diffExpanded?: boolean | Accessor<boolean> | undefined;
	onToggleDiff?: ((toolId: string) => void) | undefined;
}) {
	const output = () => props.item.output;
	const diff = () => props.item.diff ?? "";
	const expandable = () => Boolean(output() && toolOutputExpandable(output()));
	const toolExpanded = () => expandable() && resolvedBoolean(props.toolExpanded);
	const diffExpanded = () => resolvedBoolean(props.diffExpanded);
	const stats = () => diffStats(diff());
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
			diffScrollLabel.content = owner === "diff" ? "chat scroll" : "scroll diff";
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
							<text
								fg={colors.subtle}
								wrapMode="none"
								visible={toolExpanded()}
							>
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
								height={expandedToolHeight(output())}
								minHeight={6}
								overflow="hidden"
							>
								<text fg={colors.muted} selectable wrapMode="word">
									{cleanTerminalText(output())}
								</text>
							</box>
							<scrollbox
								id={`${props.item.id}-output-scroll`}
								ref={(value) => {
									outputScrollBox = value;
								}}
								visible={scrollOwner() === "output"}
								focusable={false}
								height={expandedToolHeight(output())}
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
									{cleanTerminalText(output())}
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
							<text fg={colors.muted} wrapMode="none" flexShrink={1} marginRight={1}>
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
							height={expandedDiffHeight(diff())}
							minHeight={6}
							overflow="hidden"
							backgroundColor={colors.diffBg}
						>
							<For each={diffLines(diff())}>
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
						</box>
						<scrollbox
							id={`${props.item.id}-diff-scroll`}
							ref={(value) => {
								diffScrollBox = value;
							}}
							visible={scrollOwner() === "diff"}
							focusable={false}
							height={expandedDiffHeight(diff())}
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
							<For each={diffLines(diff())}>
								{(line) => (
									<text
										fg={diffLineColor(line)}
										selectable
										wrapMode="char"
									>
										{line || " "}
									</text>
								)}
							</For>
						</scrollbox>
					</box>
				</box>
			</Show>
		</>
	);
}

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
	const assistantStatus = createMemo(() => {
		const value = currentItem();
		return value.kind === "assistant" ? value.status : "done";
	});
	const thinkingIsExpanded = () =>
		typeof props.thinkingExpanded === "function"
			? props.thinkingExpanded()
			: props.thinkingExpanded !== false;
	let thinkingWrapper: BoxRenderable | undefined;
	let thinkingTitle: TextRenderable | undefined;
	let thinkingCount: TextRenderable | undefined;
	let thinkingPreview: TextRenderable | undefined;
	let thinkingMarkdown: MarkdownRenderable | undefined;
	let thinkingStreamText: TextRenderable | undefined;
	let answerWrapper: BoxRenderable | undefined;
	let streamingAnswer: TextRenderable | undefined;
	let finalAnswer: MarkdownRenderable | undefined;

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

	createEffect(() => {
		const value = currentItem();
		if (value.kind !== "assistant") return;
		const thought = thinking();
		const response = answer();
		const streaming = value.status === "streaming";
		const showThinking = props.showThinking && Boolean(thought.trim());
		const expanded = thinkingIsExpanded();
		if (thinkingWrapper) {
			thinkingWrapper.visible = showThinking;
			thinkingWrapper.marginBottom = response.trim() ? 1 : 0;
		}
		if (thinkingTitle)
			thinkingTitle.content = expanded ? "▼ Thinking" : "▶ Thinking";
		if (thinkingCount) {
			const lines = thinkingLineCount(thought);
			thinkingCount.content = `${lines} line${lines === 1 ? "" : "s"} · ${
				expanded ? "collapse" : "expand"
			}`;
		}
		if (thinkingPreview) {
			thinkingPreview.content = collapsedThinkingPreview(thought);
			thinkingPreview.visible = !expanded;
		}
		if (thinkingMarkdown) {
			thinkingMarkdown.visible = expanded && !streaming;
			if (expanded && !streaming) {
				if (!thinkingMarkdown.streaming) thinkingMarkdown.streaming = true;
				thinkingMarkdown.content = thought;
			}
		}
		if (thinkingStreamText) {
			thinkingStreamText.visible = expanded && streaming;
			if (expanded && streaming) thinkingStreamText.content = thought || "▍";
		}

		const showAnswer =
			Boolean(response.trim()) ||
			(value.status === "streaming" && !thought.trim());
		if (answerWrapper) answerWrapper.visible = showAnswer;
		if (streamingAnswer) {
			streamingAnswer.content = response || "▍";
			streamingAnswer.visible = value.status === "streaming";
		}
		if (finalAnswer) {
			const final = value.status !== "streaming";
			finalAnswer.visible = final;
			if (final) {
				if (!finalAnswer.streaming) finalAnswer.streaming = true;
				finalAnswer.content = response || "▍";
			}
		}
	});

	return (
		<>
			<Show when={item.kind === "user"}>
				<box
					id={item.id}
					backgroundColor={colors.panelRaised}
					paddingLeft={2}
					paddingRight={2}
					paddingTop={1}
					paddingBottom={1}
					marginBottom={1}
					border={["left"]}
					borderColor={colors.accent}
				>
					<text fg={colors.textBright} selectable wrapMode="word">
						{(item.kind === "user" ? item.text : "") +
							(item.kind === "user" && item.optimistic ? "  …" : "")}
					</text>
					<Show when={props.canFork && item.kind === "user" && item.entryId && props.onFork}>
						<box flexDirection="row" justifyContent="flex-end" width="100%">
							<text
								fg={colors.cyan}
								onMouseDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									if (item.kind === "user" && item.entryId) props.onFork?.(item.entryId);
								}}
							>
									⑂ fork
								</text>
						</box>
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
					border={["left"]}
					borderColor={colors.cyan}
				>
					<box
						ref={(value) => {
							thinkingWrapper = value;
						}}
						id={`${item.id}-thinking`}
						visible={props.showThinking && Boolean(thinking().trim())}
						flexDirection="column"
						marginBottom={answer().trim() ? 1 : 0}
						paddingLeft={1}
						paddingRight={1}
						backgroundColor={colors.thinkingBg}
					>
						<box
							flexDirection="row"
							onMouseDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								props.onToggleThinking?.();
							}}
						>
							<text
								ref={(value) => {
									thinkingTitle = value;
								}}
								fg={colors.purple}
								attributes={1}
							>
								{thinkingIsExpanded() ? "▼ Thinking" : "▶ Thinking"}
							</text>
							<box flexGrow={1} />
							<text
								ref={(value) => {
									thinkingCount = value;
								}}
								fg={colors.subtle}
							>
								{thinkingLineCount(thinking())} line
								{thinkingLineCount(thinking()) === 1 ? "" : "s"} · {thinkingIsExpanded() ? "collapse" : "expand"}
							</text>
						</box>
						<text
							ref={(value) => {
								thinkingPreview = value;
							}}
							visible={!thinkingIsExpanded()}
							fg={colors.subtle}
							selectable
							wrapMode="none"
						>
							{collapsedThinkingPreview(thinking())}
						</text>
						<text
							id={`${item.id}-thinking-stream`}
							ref={(value) => {
								thinkingStreamText = value;
							}}
							visible={false}
							fg={colors.muted}
							selectable
							wrapMode="word"
						>
							{thinking() || "▍"}
						</text>
						<markdown
							id={`${item.id}-thinking-markdown`}
							ref={(value) => {
								thinkingMarkdown = value;
							}}
							visible={thinkingIsExpanded()}
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
						ref={(value) => {
							answerWrapper = value;
						}}
						id={`${item.id}-answer`}
						visible={
							Boolean(answer().trim()) ||
							(assistantStatus() === "streaming" && !thinking().trim())
						}
						paddingLeft={1}
						paddingRight={1}
					>
						<text
							ref={(value) => {
								streamingAnswer = value;
							}}
							visible={assistantStatus() === "streaming"}
							fg={colors.textBright}
							selectable
							wrapMode="word"
						>
							{answer() || "▍"}
						</text>
						<markdown
							id={`${item.id}-answer-markdown`}
							ref={(value) => {
								finalAnswer = value;
							}}
							visible={assistantStatus() !== "streaming"}
							syntaxStyle={getMarkdownStyle()}
							fg={colors.textBright}
							conceal
							streaming
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
				</box>
			</Show>

			<Show when={item.kind === "tool"}>
				{(() => {
					if (item.kind !== "tool") return null;
					const expandable = () => toolOutputExpandable(item.output);
					const expanded = () =>
						expandable() && resolvedBoolean(props.toolExpanded);
					const visual = () => toolVisual(item.name, item.isError);
					const supervisor = () =>
						item.name.toLowerCase() === "subagent_supervisor";
					const supervisorLabel = () =>
						supervisor() ? supervisorToolLabel(item.args) : undefined;
					const subagentFamily = () => {
						const name = item.name.toLowerCase();
						return (
							name === "subagent" ||
							name === "workflow" ||
							name.endsWith("_subagent")
						);
					};
					const terminal = () =>
						subagentFamily()
							? terminalBadge(
									item.status,
									item.isError,
									toolTiming(item, props.now ?? Date.now()),
								)
							: undefined;
					const subagentLabel = () =>
						subagentFamily() ? summarizeSubagentArgs(item.args) : undefined;
					const subagentGist = () =>
						subagentFamily() ? taskGist(item.args) : undefined;
					const children = () =>
						subagentFamily()
							? workflowChildrenSummary(item.args, item.output)
							: undefined;
					return (
						<box
							id={item.id}
							flexDirection="column"
							backgroundColor={
								expanded() ? colors.panelRaised : visual().background
							}
							border={["left"]}
							borderColor={visual().accent}
							paddingLeft={1}
							paddingRight={1}
							marginBottom={1}
						>
							<box flexDirection="row">
								<text fg={visual().accent} attributes={1}>
									{`${item.status === "streaming" ? "◉" : visual().icon
									} TOOL · ${
										supervisorLabel() ?? subagentLabel() ?? item.name
									}${children() ? ` ${children()}` : ""}${
										terminal() ? ` · ${terminal()}` : ""
									}`}
								</text>
								<Show when={item.args !== undefined && !subagentGist()}>
									<text fg={colors.muted} selectable wrapMode="word">
										{supervisorLabel()
											? `  ${supervisorMessage(item.args)}`
											: `  ${prettyArgs(item.args).replace(/\s+/g, " ").slice(0, 150)}`}
									</text>
								</Show>
								<box flexGrow={1} />
								<Show
									when={
										toolTiming(item, props.now ?? Date.now()) &&
										!subagentFamily()
									}
								>
									<text fg={colors.subtle}>
										{toolTiming(item, props.now ?? Date.now())}
									</text>
								</Show>
							</box>
							<Show when={subagentGist()}>
								<text fg={colors.muted} selectable wrapMode="word">
									{subagentGist()}
								</text>
							</Show>
							<Show when={(props.subagentTargets?.length ?? 0) > 0}>
								<box
									flexDirection="column"
									marginTop={1}
									border={["top"]}
									borderColor={colors.borderStrong}
									paddingTop={1}
								>
									<text fg={colors.purple} attributes={1}>
										Subagents
									</text>
									<For each={props.subagentTargets ?? []}>
										{(target) => (
											<box
												height={3}
												minHeight={3}
												flexShrink={0}
												flexDirection="column"
												paddingLeft={1}
												border={["left"]}
												borderColor={
													target.active
														? colors.green
														: target.state === "failed"
															? colors.red
															: colors.borderStrong
												}
												onMouseDown={(event) => {
													event.preventDefault();
													event.stopPropagation();
													props.onInspectSubagentTarget?.(target.key);
												}}
											>
												<box height={1} flexDirection="row">
													<text
														fg={target.active ? colors.textBright : colors.text}
														attributes={target.active ? 1 : 0}
														wrapMode="none"
													>
														{target.active ? "●" : "○"} {target.label}
													</text>
													<box flexGrow={1} />
													<text fg={colors.cyan}>inspect</text>
												</box>
												<text height={1} fg={colors.muted} wrapMode="none">
													{target.state} · {target.run.mode} · last activity{" "}
													{target.lastUpdate === undefined
														? "unknown"
														: `${formatDuration(Math.max(0, (props.now ?? Date.now()) - target.lastUpdate))} ago`}
												</text>
												<text height={1} fg={colors.subtle} wrapMode="none">
													{target.step?.currentTool ??
														target.run.currentTool ??
														target.step?.currentPath ??
														target.run.currentPath ??
														"click to inspect"}
												</text>
											</box>
										)}
									</For>
								</box>
							</Show>
							<ToolDetails
								item={item}
								toolExpanded={props.toolExpanded}
								onToggleTool={props.onToggleTool}
								diffExpanded={props.diffExpanded}
								onToggleDiff={props.onToggleDiff}
							/>
						</box>
					);
				})()}
			</Show>

							<Show when={item.kind === "custom"}>
				{(() => {
					if (item.kind !== "custom") return null;
					const question = item.customType === "subagent_supervisor_request";
					const parts = customQuestionParts(item);
					const agent = customDetail(item, "agent") || "subagent";
					const reason = customDetail(item, "reason") || "question";
					return question ? (
						<box
							id={item.id}
							flexDirection="column"
							backgroundColor={colors.toolAgentBg}
							paddingLeft={1}
							paddingRight={1}
							marginBottom={1}
							border={["left"]}
							borderColor={colors.purple}
						>
							<text fg={colors.purple} attributes={1}>
								◇ Child question · {agent} · {reason}
							</text>
							<text fg={colors.textBright} selectable wrapMode="word">{parts.body}</text>
							<Show when={parts.hint}>
								<text fg={colors.muted} selectable wrapMode="word">{parts.hint}</text>
							</Show>
						</box>
					) : (
						<box id={item.id} paddingLeft={1} marginBottom={1}>
							<text fg={colors.muted} selectable wrapMode="word">
								· {item.customType}: {item.text}
							</text>
						</box>
					);
				})()}
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
