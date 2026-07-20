import { For, Show, createEffect, createMemo, type Accessor } from "solid-js";
import type {
	BoxRenderable,
	MarkdownRenderable,
	TextRenderable,
} from "@opentui/core";
import stripAnsi from "strip-ansi";
import type { ConversationItem, ToolItem } from "../types.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import {
	colors,
	getMarkdownStyle,
	getThinkingMarkdownStyle,
	getThemeRevision,
} from "./theme.ts";
import { formatDuration } from "./duration.ts";

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
	return (
		lines.length > 4 ||
		clean.length > 320 ||
		lines.some((line) => line.length > 180)
	);
}

function collapsedPreview(output: string): string {
	const normalized = cleanTerminalText(output).replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	return normalized.length > 220 ? `${normalized.slice(0, 217)}…` : normalized;
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

export function MessageView(props: {
	item: MessageItemSource;
	showThinking: boolean;
	thinkingExpanded?: boolean | Accessor<boolean>;
	onToggleThinking?: () => void;
	toolExpanded: boolean;
	onToggleTool?: (toolId: string) => void;
	diffExpanded?: boolean;
	onToggleDiff?: (toolId: string) => void;
	subagentTargets?: SubagentTarget[] | undefined;
	onInspectSubagentTarget?: ((targetKey: string) => void) | undefined;
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
			thinkingCount.content = `${lines} line${lines === 1 ? "" : "s"} · click`;
		}
		if (thinkingPreview) {
			thinkingPreview.content = collapsedThinkingPreview(thought);
			thinkingPreview.visible = !expanded;
		}
		if (thinkingMarkdown) {
			if (!thinkingMarkdown.streaming) thinkingMarkdown.streaming = true;
			thinkingMarkdown.content = thought;
			thinkingMarkdown.visible = expanded;
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
								{thinkingLineCount(thinking()) === 1 ? "" : "s"} · click
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
						<markdown
							id={`${item.id}-thinking-markdown`}
							ref={(value) => {
								thinkingMarkdown = value;
							}}
							visible={thinkingIsExpanded()}
							content={thinking()}
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
							content={answer() || "▍"}
							syntaxStyle={getMarkdownStyle()}
							fg={colors.textBright}
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
				</box>
			</Show>

			<Show when={item.kind === "tool"}>
				{(() => {
					const output = () => (item.kind === "tool" ? item.output : "");
					const diff = () => (item.kind === "tool" ? (item.diff ?? "") : "");
					const expandable = () =>
						Boolean(output() && toolOutputExpandable(output()));
					const expanded = () => expandable() && props.toolExpanded;
					const visual = () =>
						item.kind === "tool"
							? toolVisual(item.name, item.isError)
							: toolVisual("tool", false);
					const stats = () => diffStats(diff());
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
							<box
								flexDirection="row"
								onMouseDown={(event) => {
									if (!expandable()) return;
									event.preventDefault();
									event.stopPropagation();
									if (item.kind === "tool") props.onToggleTool?.(item.id);
								}}
							>
								<text fg={visual().accent} attributes={1}>
									{item.kind === "tool"
										? `${expandable() ? (expanded() ? "▼ " : "▶ ") : ""}${item.status === "streaming" ? "◉" : visual().icon} TOOL · ${item.name}`
										: ""}
								</text>
								<Show when={item.kind === "tool" && item.args !== undefined}>
									<text fg={colors.muted} selectable wrapMode="word">
										{item.kind === "tool"
											? `  ${prettyArgs(item.args).replace(/\s+/g, " ").slice(0, 150)}`
											: ""}
									</text>
								</Show>
								<box flexGrow={1} />
								<Show
									when={
										item.kind === "tool" &&
										toolTiming(item, props.now ?? Date.now())
									}
								>
									<text fg={colors.subtle}>
										{item.kind === "tool"
											? toolTiming(item, props.now ?? Date.now())
											: ""}
									</text>
								</Show>
							</box>
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
							<Show when={output()}>
								<Show
									when={expandable()}
									fallback={
										<text fg={colors.muted} selectable wrapMode="word">
											{cleanTerminalText(output())}
										</text>
									}
								>
									<Show
										when={expanded()}
										fallback={
											<box flexDirection="row">
												<text fg={colors.subtle} wrapMode="none">
													{collapsedPreview(output())}
												</text>
												<box flexGrow={1} />
												<text fg={colors.subtle}>click to expand</text>
											</box>
										}
									>
										<scrollbox
											height={expandedToolHeight(output())}
											minHeight={6}
											scrollY
											scrollX={false}
											stickyScroll
											stickyStart="bottom"
											viewportCulling={true}
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
									</Show>
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
										flexDirection="row"
										onMouseUp={(event) => {
											event.preventDefault();
											event.stopPropagation();
											if (item.kind === "tool") props.onToggleDiff?.(item.id);
										}}
									>
										<text fg={colors.green} attributes={1}>
											{props.diffExpanded ? "▼" : "▶"} Changes
										</text>
										<text fg={colors.green}> +{stats().additions}</text>
										<text fg={colors.red}> -{stats().deletions}</text>
										<Show when={item.kind === "tool" && item.diffPath}>
											<text fg={colors.muted}>
												{" "}
												{item.kind === "tool" ? (item.diffPath ?? "") : ""}
											</text>
										</Show>
										<box flexGrow={1} />
										<text fg={colors.subtle}>
											{props.diffExpanded
												? "click to collapse"
												: "click to view diff"}
										</text>
									</box>
									<Show when={props.diffExpanded}>
										<scrollbox
											height={expandedDiffHeight(diff())}
											minHeight={6}
											scrollY
											scrollX={false}
											viewportCulling={true}
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
														wrapMode="none"
													>
														{line || " "}
													</text>
												)}
											</For>
										</scrollbox>
									</Show>
								</box>
							</Show>
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
