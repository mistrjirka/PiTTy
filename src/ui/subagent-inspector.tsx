import { For, Show, createEffect } from "solid-js";
import type {
	MouseEvent,
	ScrollBoxRenderable,
	TextareaRenderable,
} from "@opentui/core";
import type { ConversationItem, SubagentRun } from "../types.ts";
import type { PendingSteerEntry } from "../state/input-continuity.ts";
import {
	subagentTargets,
	targetContextPercent,
	targetContextUsage,
	type SubagentTarget,
} from "../subagents/targets.ts";
import { colors } from "./theme.ts";
import { formatDuration } from "./duration.ts";
import {
	ModelContextRows,
	friendlyTargetState,
	stateColor,
	stateIcon,
} from "./model-context.tsx";
import { spinnerFrames } from "./spinner.ts";
import { cleanTerminalText, MessageView } from "./message.tsx";

/**
 * Clock value for one inspector row. Non-tool rows of an inactive child
 * return undefined (never 0): `toolTiming` renders that as empty instead of
 * an epoch-based "took …". Exported for unit tests.
 */
export function inspectorItemNow(
	active: boolean,
	item: ConversationItem,
	now: number,
): number | undefined {
	if (active) return now;
	if (
		item.kind === "tool" &&
		(item.status === "streaming" || item.status === "pending")
	)
		return now;
	if (item.kind === "tool")
		return item.endedAt ?? item.startedAt ?? item.timestamp;
	return undefined;
}

export function SubagentInspector(props: {
	target?: SubagentTarget | undefined;
	run?: SubagentRun | undefined;
	items: ConversationItem[];
	now: number;
	scrollRef?: (value: ScrollBoxRenderable) => void;
	onClose?: () => void;
	onPause?: () => void;
	onResume?: () => void;
	onStop?: () => void;
	onChooseTarget?: () => void;
	targetCount?: number;
	/** Current shared spinner glyph from the main conversation's 250 ms tick. */
	spinner?: string | undefined;
	draft?: (() => string) | undefined;
	onDraftChange?: (message: string) => void;
	onSteer?: (message: string) => void;
	pendingSteers?: readonly PendingSteerEntry[];
	thinkingExpanded?: (itemId: string) => boolean;
	onToggleThinking?: (itemId: string) => void;
	toolExpanded?: (toolId: string) => boolean;
	onToggleTool?: (toolId: string) => void;
	diffExpanded?: (toolId: string) => boolean;
	onToggleDiff?: (toolId: string) => void;
}) {
	const target = () =>
		(props.target ?? (props.run ? subagentTargets([props.run])[0] : undefined))!;
	const run = () => target().run;
	// Legacy pi-subagents supports pause/resume through its file-control inbox.
	// Profiled subagents deliberately expose only steer/stop; do not invent a
	// pause state that the resident Pi RPC child does not have.
	const profiled = () => run().control === "profiled";
	const controlState = () => {
		const state = run().state;
		return profiled()
			? ["running", "queued", "waiting", "idle"].includes(state)
			: state === "running" || state === "paused" || state === "queued";
	};
	const canControl = () =>
		controlState() &&
		(target().canSteer || (!profiled() && run().state === "paused")) &&
		Boolean(profiled() ? run().controlDir : run().asyncDir) &&
		run().control !== "foreground";
	const controlHint = () => {
		if (profiled()) return "Steer below · Ctrl+Shift+A stop";
		if (run().state === "running") return "Ctrl+A pause · Ctrl+Shift+A stop";
		if (run().state === "paused") return "Resume via click · Ctrl+Shift+A stop";
		return "Ctrl+Shift+A stop";
	};
	const step = () => target().step;
	const spinnerGlyph = () => props.spinner ?? spinnerFrames[0] ?? "◐";
	const childContextUsage = () => targetContextUsage(target());
	const childContextPercent = () => targetContextPercent(target());
	// `active` is not "working": profiled `idle`/`waiting` children are live
	// (resident / blocked on the parent) but must not show the spinner.
	const isWorkingState = (state: string): boolean =>
		state === "running" ||
		state === "queued" ||
		state === "active" ||
		state === "working";
	const presenceText = (): string | undefined => {
		const state = target().state;
		if (isWorkingState(state)) return `${spinnerGlyph()} Working…`;
		if (state === "waiting") return "⏸ waiting for parent";
		if (state === "idle") return "◆ resident · idle";
		return undefined;
	};
	const activityText = () => {
		const parts: string[] = [];
		const presence = presenceText();
		if (presence) parts.push(presence);
		const tool = currentTool();
		const path = currentPath();
		if (tool ?? path) {
			parts.push(
				`⚙${cleanTerminalText(tool ?? "working")}${toolElapsed() !== undefined ? ` ${formatDuration(toolElapsed())}` : ""}${path ? ` · ${cleanTerminalText(path)}` : ""}`,
			);
		}
		return parts.join(" · ");
	};
	const itemNow = (item: ConversationItem): number | undefined =>
		inspectorItemNow(target().active, item, props.now);
	const elapsed = () =>
		target().startedAt
			? (step()?.endedAt ?? run().endedAt ?? props.now) - target().startedAt!
			: undefined;
	const toolStartedAt = () =>
		step()?.currentToolStartedAt ?? run().currentToolStartedAt;
	const toolElapsed = () =>
		toolStartedAt() ? props.now - toolStartedAt()! : undefined;
	const currentTool = () => step()?.currentTool ?? run().currentTool;
	const currentPath = () => step()?.currentPath ?? run().currentPath;
	const timeoutMs = () => step()?.timeoutMs ?? run().timeoutMs;
	const deadlineAt = () => step()?.deadlineAt ?? run().deadlineAt;
	const remaining = () => (deadlineAt() ? deadlineAt()! - props.now : undefined);
	let closePending = false;
	let steerEditor: TextareaRenderable | undefined;

	const requestClose = (event?: MouseEvent) => {
		event?.preventDefault();
		event?.stopPropagation();
		if (closePending) return;
		closePending = true;
		props.onClose?.();
	};

	createEffect(() => {
		if (!target().canSteer) {
			steerEditor = undefined;
			return;
		}
		const value = props.draft?.() ?? "";
		if (steerEditor && steerEditor.plainText !== value)
			steerEditor.setText(value);
	});

	const sendSteer = () => {
		const message = steerEditor?.plainText.trim() ?? "";
		if (!message) return;
		props.onSteer?.(message);
	};

	return (
		<box
			flexGrow={1}
			minHeight={1}
			flexDirection="column"
			paddingLeft={2}
			paddingRight={2}
		>
			<box
				flexDirection="column"
				flexShrink={0}
				border={["bottom"]}
				borderColor={colors.borderStrong}
				paddingBottom={1}
				marginBottom={1}
			>
				<box
					height={1}
					minHeight={1}
					flexShrink={0}
					flexDirection="row"
					zIndex={10}
				>
					<text height={1} wrapMode="none" fg={colors.textBright} attributes={1}>
						Subagent detail
					</text>
					<box flexGrow={1} height={1} />
					<text
						id="subagent-inspector-choose"
						fg={colors.purple}
						attributes={1}
						onMouseDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							props.onChooseTarget?.();
						}}
					>
						{cleanTerminalText(target().label)} ▼
					</text>
					<text
						id="subagent-inspector-close"
						fg={colors.cyan}
						attributes={1}
						marginLeft={2}
						onMouseDown={requestClose}
					>
						← Main chat
					</text>
				</box>
				<text
					height={1}
					minHeight={1}
					flexShrink={0}
					wrapMode="none"
					fg={colors.subtle}
				>
					{props.targetCount && props.targetCount > 1
						? "←/→ or Ctrl+←/→ switch · "
						: ""}
					↑/Ctrl+↑ main chat · Esc / Ctrl+I close
				</text>
				<Show
					when={canControl()}
				>
					<box flexDirection="row" height={1} minHeight={1} flexShrink={0}>
						<Show when={!profiled() && run().state === "running"}>
							<text
								id="subagent-pause"
								fg={colors.yellow}
								attributes={1}
								wrapMode="none"
								onMouseDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									props.onPause?.();
								}}
							>
								⏸ Pause
							</text>
						</Show>
						<Show when={!profiled() && run().state === "paused"}>
							<text
								id="subagent-resume"
								fg={colors.green}
								attributes={1}
								wrapMode="none"
								onMouseDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									props.onResume?.();
								}}
							>
								▶ Resume
							</text>
						</Show>
						<Show
							when={profiled()
								? ["running", "queued", "waiting", "idle"].includes(run().state)
								: ["running", "paused", "queued"].includes(run().state)}
						>
							<text
								id="subagent-stop"
								marginLeft={2}
								fg={colors.red}
								attributes={1}
								wrapMode="none"
								onMouseDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									props.onStop?.();
								}}
							>
								⏹ Stop
							</text>
						</Show>
						<box flexGrow={1} height={1} />
						<text fg={colors.muted} wrapMode="none">{controlHint()}</text>
					</box>
				</Show>
				{(() => {
					const currentStep = step();
					const who = currentStep
						? `${cleanTerminalText(currentStep.agent)} #${currentStep.index + 1}`
						: cleanTerminalText(target().label);
					const timing = [
						`⏱${formatDuration(elapsed())}`,
						timeoutMs() ? `⏳${formatDuration(timeoutMs())}` : "",
						remaining() !== undefined && target().active
							? `${formatDuration(Math.max(0, remaining()!))} left`
							: "",
					]
						.filter(Boolean)
						.join(" · ");
					return (
						<text
							height={1}
							minHeight={1}
							flexShrink={0}
							wrapMode="none"
							fg={stateColor(target().state)}
						>
							{stateIcon(target().state)} {who} ·{" "}
							{cleanTerminalText(friendlyTargetState(target().state))} ·{" "}
							{timing}
						</text>
					);
				})()}
				<Show when={activityText()}>
					<text
						height={1}
						minHeight={1}
						flexShrink={0}
						wrapMode="none"
						fg={colors.cyan}
					>
						{activityText()}
					</text>
				</Show>
				<ModelContextRows
					contextText={childContextUsage() ?? "— / —"}
					percentUsed={childContextPercent()}
					modelText={target().model ?? "—"}
					thinkingText={target().thinking ?? "—"}
				/>
				<Show when={target().error}>
					<text
						height={1}
						minHeight={1}
						flexShrink={0}
						wrapMode="none"
						fg={colors.red}
					>
						✖ {cleanTerminalText(target().error!)}
					</text>
				</Show>
			</box>
			<scrollbox
				id="subagent-inspector-transcript"
				ref={(value) => props.scrollRef?.(value)}
				flexGrow={1}
				minHeight={1}
				scrollY
				scrollX={false}
				stickyScroll
				stickyStart="bottom"
				viewportCulling={false}
				verticalScrollbarOptions={{ showArrows: false }}
			>
				<Show when={props.items.length === 0}>
					<text fg={colors.muted}>
						No transcript has been written for this subagent yet.
					</text>
					<Show when={props.target?.active}>
						<text fg={colors.cyan} wrapMode="none">
							{cleanTerminalText(`⚙${currentTool() ?? "working"}${toolElapsed() !== undefined ? ` ${formatDuration(toolElapsed())}` : ""}`)}
							{run().toolCount !== undefined ? ` · ${run().toolCount} tools` : ""}
							{run().turnCount !== undefined ? ` · ${run().turnCount} turns` : ""}
						</text>
					</Show>
				</Show>
				<For each={props.items}>
					{(item) => (
						<MessageView
							item={item}
							showThinking
							thinkingExpanded={() => props.thinkingExpanded?.(item.id) ?? true}
							onToggleThinking={() => props.onToggleThinking?.(item.id)}
							toolExpanded={
								item.kind === "tool" ? (props.toolExpanded?.(item.id) ?? false) : false
							}
							{...(props.onToggleTool ? { onToggleTool: props.onToggleTool } : {})}
							diffExpanded={
								item.kind === "tool" ? (props.diffExpanded?.(item.id) ?? false) : false
							}
							{...(props.onToggleDiff ? { onToggleDiff: props.onToggleDiff } : {})}
							{...(() => {
								const now = itemNow(item);
								return now === undefined ? {} : { now };
							})()}
						/>
					)}
				</For>
			</scrollbox>
			<Show when={props.pendingSteers && props.pendingSteers.length > 0}>
				<box
					flexShrink={0}
					flexDirection="column"
					paddingLeft={1}
					paddingRight={1}
					paddingTop={1}
				>
					<For each={props.pendingSteers}>
						{(entry) => {
							const age = () => props.now - entry.submittedAt;
							return (
								<text fg={colors.yellow} wrapMode="word">
									{age() >= 120_000 ? "Waiting (over 120s)" : "Queued for delivery"} ·{" "}
									{entry.text} · Waiting for pi-subagents to pick this up
								</text>
							);
						}}
					</For>
				</box>
			</Show>
			<Show when={target().canSteer}>
				<box
					flexShrink={0}
					border={["top"]}
					borderColor={colors.purple}
					backgroundColor={colors.panel}
					paddingLeft={1}
					paddingRight={1}
					paddingTop={1}
					paddingBottom={1}
					minHeight={4}
					maxHeight={9}
				>
					<textarea
						id="subagent-inspector-steer"
						ref={(value) => {
							steerEditor = value;
						}}
						focused
						placeholder={`Steer ${cleanTerminalText(target().label)}…`}
						wrapMode="word"
						backgroundColor={colors.panel}
						focusedBackgroundColor={colors.panel}
						textColor={colors.textBright}
						focusedTextColor={colors.textBright}
						placeholderColor={colors.muted}
						selectionBg={colors.selection}
						keyBindings={[
							{ name: "return", action: "submit" },
							{ name: "enter", action: "submit" },
							{ name: "kpenter", action: "submit" },
							// Terminals lacking the Kitty keyboard protocol send a bare linefeed
							// for Shift+Enter, so treat unmodified linefeed as a newline.
							{ name: "linefeed", action: "newline" },
							{ name: "return", shift: true, action: "newline" },
							{ name: "enter", shift: true, action: "newline" },
							{ name: "kpenter", shift: true, action: "newline" },
							{ name: "linefeed", shift: true, action: "newline" },
						]}
						minHeight={2}
						maxHeight={7}
						onContentChange={() =>
							props.onDraftChange?.(steerEditor?.plainText ?? "")
						}
						onSubmit={sendSteer}
					/>
				</box>
			</Show>
			<Show when={!target().canSteer}>
				<box
					height={3}
					minHeight={3}
					flexShrink={0}
					border={["top"]}
					borderColor={colors.borderStrong}
					paddingTop={1}
					paddingLeft={1}
				>
					<text fg={colors.subtle} wrapMode="none">
						Steering input hidden: this child is finished or has no live steerable Pi
						session.
					</text>
				</box>
			</Show>
		</box>
	);
}
