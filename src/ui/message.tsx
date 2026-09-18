import { For, Show, createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import type {
	BoxRenderable,
	MarkdownRenderable,
	TextRenderable,
	ScrollBoxRenderable,
} from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import stripAnsi from "strip-ansi";
import type { ConversationItem, CustomItem, ToolItem } from "../types.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import { isProfiledSubagentTool, isSubagentFamilyToolName } from "../subagents/profiled.ts";
import {
	colors,
	getMarkdownStyle,
	getThinkingMarkdownStyle,
	getThemeRevision,
} from "./theme.ts";
import { formatDuration } from "./duration.ts";
import { friendlyTargetState, isResidentTargetState, targetFreshness } from "./model-context.tsx";
import {
	summarizeSubagentArgs,
	taskGist,
	nestedDescendantSummary,
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
	if (isSubagentFamilyToolName(name))
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

function collapsedThinkingPreview(value: string, maxChars: number): string {
	const clean = value.replace(/\s+/g, " ").trim();
	if (!clean) return "";
	const max = Math.max(24, Math.floor(maxChars));
	if (clean.length <= max) return clean;
	return `…${clean.slice(clean.length - (max - 1))}`;
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

function objectRecordValue(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function customDetailsRecord(item: CustomItem): Record<string, unknown> | undefined {
	return objectRecordValue(item.details);
}

function customDetail(item: CustomItem, key: string): string {
	const value = customDetailsRecord(item)?.[key];
	return typeof value === "string" && value.trim() ? value : "";
}

function customDetailObject(item: CustomItem, key: string): Record<string, unknown> | undefined {
	const value = customDetailsRecord(item)?.[key];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function parsedNotification(item: CustomItem): Record<string, unknown> {
	let parsed: Record<string, unknown> = {};
	try {
		const value: unknown = JSON.parse(item.text);
		if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
	} catch {
		// Details can still provide a valid notification when the text is not JSON.
	}
	return { ...parsed, ...customDetailsRecord(item) };
}

function notificationText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function toolTiming(item: ToolItem, now?: number): string {
	const startedAt = item.startedAt;
	if (startedAt === undefined)
		return item.timeoutMs
			? `timeout ${formatDuration(item.timeoutMs, "")}`
			: "";
	const end = item.endedAt ?? now;
	// No end and no clock (inactive child, non-tool row): render empty rather
	// than an epoch-based duration.
	if (end === undefined)
		return item.timeoutMs
			? `timeout ${formatDuration(item.timeoutMs, "")}`
			: "";
	const elapsed = Math.max(0, end - startedAt);
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
								fg={colors.purple}
								attributes={1}
							>
								{thinkingIsExpanded() ? "▼ Thinking" : "▶ Thinking"}
							</text>
							<box flexGrow={1} />
							<text
								fg={colors.subtle}
							>
								{thinkingLineCount(thinking())} line
								{thinkingLineCount(thinking()) === 1 ? "" : "s"} · {thinkingIsExpanded() ? "collapse" : "expand"}
							</text>
						</box>
						<text
							visible={!thinkingIsExpanded()}
							fg={colors.subtle}
							selectable
							wrapMode="none"
						>
							{collapsedThinkingPreview(thinking(), thinkingPreviewMax())}
						</text>
						<text
							id={`${item.id}-thinking-stream`}
							visible={thinkingIsExpanded() && assistantStatus() === "streaming"}
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
							visible={thinkingIsExpanded() && assistantStatus() !== "streaming"}
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
					const subagentFamily = () =>
						isSubagentFamilyToolName(item.name) || isProfiledSubagentTool(item);
					const terminal = () =>
						subagentFamily()
							? terminalBadge(
									item.status,
									item.isError,
									toolTiming(item, props.now ?? Date.now()),
								)
							: undefined;
					const subagentLabel = () => {
						if (!subagentFamily()) return undefined;
						if (isProfiledSubagentTool(item)) {
							const details = objectRecordValue(item.details);
							const agentId = typeof details?.agentId === "string" ? details.agentId : "";
							const label = typeof details?.label === "string" ? details.label : "";
							const profile = typeof details?.profile === "string" ? details.profile : "";
							// Keep the short type before the descriptive label: the label is
							// what truncates on narrow surfaces, never the type.
							const type = profile ? ` · ${profile}` : "";
							if (agentId && label) return `@${agentId}${type} — ${label}`;
							if (agentId && profile) return `@${agentId} · ${profile}`;
						}
						return summarizeSubagentArgs(item.args);
					};
					const subagentGist = () =>
						subagentFamily() ? taskGist(item.args) : undefined;
					const children = () =>
						subagentFamily()
							? nestedDescendantSummary(item.details) ??
								workflowChildrenSummary(item.args, item.output)
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
								<Show when={item.args !== undefined && !subagentGist() && !isProfiledSubagentTool(item) && (!subagentFamily() || subagentLabel() === undefined)}>
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
													{isResidentTargetState(target.state)
														? friendlyTargetState(target.state)
														: `${friendlyTargetState(target.state)} · ${targetFreshness(target, props.now ?? Date.now())}`}
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
					if (item.customType === "subagent-notification") {
						const payload = parsedNotification(item);
						const agentId = notificationText(payload.agent_id) || customDetail(item, "agent_id");
						const rawLabel = notificationText(payload.label) || customDetail(item, "label");
						const identity = rawLabel.startsWith("@")
							? rawLabel
							: agentId
								? `@${agentId}${rawLabel ? ` — ${rawLabel}` : ""}`
								: "subagent";
						const status = notificationText(payload.status) || customDetail(item, "status") || "completed";
						const usage = customDetailObject(item, "usage") ?? objectRecordValue(payload.usage);
						const usageParts = [
							typeof usage?.tokens === "number" ? `${usage.tokens} tokens` : "",
							typeof usage?.toolUses === "number" ? `${usage.toolUses} tools` : "",
							typeof usage?.durationMs === "number" ? formatDuration(usage.durationMs, "") : "",
						].filter(Boolean);
						const result = notificationText(payload.result) || customDetail(item, "result") || (customDetailsRecord(item) ? "" : item.text);
						const cleanedResult = cleanTerminalText(result).trim();
						const resultLines = cleanedResult ? cleanedResult.split(/\r?\n/) : [];
						const more = resultLines.length > 1
							? `${resultLines.length - 1} more lines`
							: cleanedResult.length > 100 ? "more content" : "";
						const sessionPath = customDetail(item, "sessionPath") || customDetail(item, "session_path");
						return (
							<box id={item.id} flexDirection="column" backgroundColor={colors.toolAgentBg} paddingLeft={1} paddingRight={1} marginBottom={1} border={["left"]} borderColor={colors.purple}>
								<text fg={colors.purple} attributes={1}>◆ subagent · {identity} · {status}</text>
								<Show when={usageParts.length > 0}><text fg={colors.muted} wrapMode="none">{usageParts.join(" · ")}</text></Show>
								<text fg={colors.textBright} selectable wrapMode="none">{collapsedPreview(cleanedResult) || "No result preview"}{more ? ` · ${more}` : ""}</text>
								<Show when={sessionPath}><text fg={colors.subtle} wrapMode="none">{clampDiffPath(sessionPath, 72)}</text></Show>
							</box>
						);
					}
					const legacyQuestion = item.customType === "subagent_supervisor_request";
					const profiledQuestion = item.customType === "subagent-question";
					const question = legacyQuestion || profiledQuestion;
					const context = profiledQuestion ? customDetail(item, "context") : "";
					const parts = profiledQuestion
						? {
							body: customDetail(item, "question") || item.text,
							hint: context ? `Context: ${context}` : "",
						}
						: customQuestionParts(item);
					const agent = profiledQuestion
						? customDetail(item, "profile") || customDetail(item, "label") || customDetail(item, "agentId") || "subagent"
						: customDetail(item, "agent") || "subagent";
					const reason = legacyQuestion ? customDetail(item, "reason") || "question" : "";
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
								◇ Child question · {agent}{reason ? ` · ${reason}` : ""}
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
