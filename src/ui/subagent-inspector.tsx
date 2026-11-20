import type { MouseEvent, TextareaRenderable } from "@opentui/core";
import { createEffect, createMemo, For, Show } from "solid-js";
import { subagentControlAvailability } from "../subagents/control-availability.ts";
import {
	ownedSubagentTargetsForItems,
	type SubagentTarget,
	subagentTargets,
} from "../subagents/targets.ts";
import {
	directSubagentChildren,
	subagentAncestors,
} from "../subagents/tree.ts";
import type { ConversationItem, SubagentRun, ToolItem } from "../types.ts";
import { formatDuration } from "./duration.ts";
import { cleanTerminalText } from "./message.tsx";
import {
	friendlyTargetState,
	stateColor,
	stateIcon,
} from "./model-context.tsx";
import { spinnerFrames } from "./spinner.ts";
import { subagentElapsedMs } from "./subagent-format.ts";
import {
	InspectorSteerPanel,
	InspectorTranscriptPane,
} from "./subagent-inspector-panes.tsx";
import type { SubagentInspectorProps } from "./subagent-inspector-types.ts";
import { colors } from "./theme.ts";

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

/**
 * Where the inspector transcript should jump when the inspected target
 * changes. Finished runs open at the top so the first thinking section is
 * on screen; live runs keep the tail so the stream stays followed.
 * Exported for unit tests.
 */
export function inspectedTargetScrollY(
	target: { active: boolean } | undefined,
): number {
	return target?.active ? Number.MAX_SAFE_INTEGER : 0;
}

export function SubagentInspector(props: SubagentInspectorProps) {
	const target = () =>
		(props.target ??
			(props.run ? subagentTargets([props.run])[0] : undefined))!;
	const run = () => target().run;
	const allTargets = () => props.allTargets ?? [target()];
	const ancestors = createMemo(() => subagentAncestors(target(), allTargets()));
	const directChildren = createMemo(() =>
		directSubagentChildren(target(), allTargets()),
	);
	const ownedChildren = createMemo(() =>
		ownedSubagentTargetsForItems(
			props.items.filter((item): item is ToolItem => item.kind === "tool"),
			directChildren(),
		),
	);
	const compactAgentName = (entry: SubagentTarget): string => {
		const id = entry.run.agentId ? `@${entry.run.agentId}` : entry.label;
		return entry.run.profile ? `${id} · ${entry.run.profile}` : id;
	};
	// Legacy pi-subagents supports pause/resume through its file-control inbox.
	// Profiled subagents deliberately expose only steer/stop; do not invent a
	// pause state that the resident Pi RPC child does not have.
	const profiled = () =>
		run().control === "profiled" || run().runtime === "profiled-subagents";
	const controlAvailability = () => subagentControlAvailability(target());
	const canControl = () => controlAvailability().canControl;
	const step = () => target().step;
	const spinnerGlyph = () => props.spinner ?? spinnerFrames[0] ?? "◐";
	// `active` is not "working": profiled `idle`/`waiting` children are live
	// (resident / blocked on the parent) but must not show the spinner.
	const isWorkingState = (state: string): boolean =>
		state === "running" ||
		state === "queued" ||
		state === "active" ||
		state === "working";
	// Row 1 already names the state, so this row is only what the agent is
	// doing right now.
	const activityText = () => {
		const tool = currentTool();
		const path = currentPath();
		if (!tool && !path) return "";
		const timing = toolElapsed() !== undefined ? ` ${formatDuration(toolElapsed())}` : "";
		return `↳ ${cleanTerminalText(tool ?? "working")}${timing}${path ? ` · ${cleanTerminalText(path)}` : ""}`;
	};
	const activeTools = () =>
		target().active && target().state === "running"
			? (run().activeTools ?? [])
			: [];
	const commandTiming = (
		tool: NonNullable<SubagentRun["activeTools"]>[number],
	) => {
		const elapsed = Math.max(0, props.now - tool.startedAt);
		const prefix = `↳ ${cleanTerminalText(tool.toolName)} ${formatDuration(elapsed)}`;
		if (tool.timeoutSeconds === undefined) return `${prefix} · no timeout`;
		const limit = tool.timeoutSeconds * 1000;
		return `${prefix} of ${formatDuration(limit)} · ${
			elapsed < limit
				? `${formatDuration(limit - elapsed)} left`
				: "timed out, waiting for exit"
		}`;
	};
	const itemNow = (item: ConversationItem): number | undefined =>
		inspectorItemNow(target().active, item, props.now);
	const elapsed = () => subagentElapsedMs(target(), props.now);
	const toolStartedAt = () =>
		step()?.currentToolStartedAt ?? run().currentToolStartedAt;
	const toolElapsed = () =>
		toolStartedAt() ? props.now - toolStartedAt()! : undefined;
	const currentTool = () => step()?.currentTool ?? run().currentTool;
	const currentPath = () => step()?.currentPath ?? run().currentPath;
	const timeoutMs = () => step()?.timeoutMs ?? run().timeoutMs;
	const deadlineAt = () => step()?.deadlineAt ?? run().deadlineAt;
	const remaining = () =>
		deadlineAt() ? deadlineAt()! - props.now : undefined;
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

	const statusGlyph = () =>
		isWorkingState(target().state)
			? spinnerGlyph()
			: stateIcon(target().state);
	const crumbSeparator = () => (
		<text fg={colors.border} wrapMode="none" flexShrink={0}>
			{" › "}
		</text>
	);
	const controlButton = (
		id: string,
		label: string,
		color: string,
		action: (() => void) | undefined,
	) => (
		<text
			id={id}
			fg={color}
			wrapMode="none"
			flexShrink={0}
			marginRight={2}
			onMouseDown={(event) => {
				event.preventDefault();
				event.stopPropagation();
				action?.();
			}}
		>
			{label}
		</text>
	);
	// Keyboard twins of the pause/stop buttons, shown in the prompt box so
	// keyboard-only users can find them.
	const controlKeys = () => {
		if (!canControl()) return "";
		const pause =
			!profiled() && controlAvailability().canPause ? "ctrl+a pause  " : "";
		return canStop() ? `${pause}ctrl+shift+a stop` : pause.trim();
	};
	const canStop = () =>
		profiled()
			? ["running", "queued", "waiting", "idle"].includes(run().state)
			: ["running", "paused", "queued"].includes(run().state);

	// The subagent view is the main view scoped to one agent: same transcript
	// rows, same prompt box. Model and context for the agent live in the
	// sidebar, so this header is a breadcrumb plus at most a few detail rows.
	return (
		<box
			flexGrow={1}
			minHeight={1}
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
		>
			<box flexDirection="column" flexShrink={0} marginBottom={1}>
				<box height={1} minHeight={1} flexShrink={0} flexDirection="row">
					<text
						id="subagent-inspector-close"
						fg={colors.subtle}
						wrapMode="none"
						flexShrink={0}
						onMouseDown={requestClose}
					>
						Main
					</text>
					<For each={ancestors()}>
						{(ancestor) => (
							<>
								{crumbSeparator()}
								<text
									fg={colors.subtle}
									wrapMode="none"
									flexShrink={0}
									onMouseDown={(event) => {
										event.preventDefault();
										event.stopPropagation();
										props.onInspectSubagentTarget?.(ancestor.key);
									}}
								>
									{cleanTerminalText(compactAgentName(ancestor))}
								</text>
							</>
						)}
					</For>
					{crumbSeparator()}
					<text
						id="subagent-inspector-choose"
						fg={colors.purple}
						attributes={1}
						wrapMode="none"
						flexShrink={1}
						onMouseDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							props.onChooseTarget?.();
						}}
					>
						{cleanTerminalText(compactAgentName(target()))}
					</text>
					<box flexGrow={1} minWidth={2} />
					<Show when={canControl() && controlAvailability().canPause}>
						{controlButton("subagent-pause", "⏸ pause", colors.yellow, props.onPause)}
					</Show>
					<Show when={canControl() && controlAvailability().canResume}>
						{controlButton("subagent-resume", "▶ resume", colors.green, props.onResume)}
					</Show>
					<Show when={canControl() && canStop()}>
						{controlButton("subagent-stop", "⏹ stop", colors.red, props.onStop)}
					</Show>
					<text fg={stateColor(target().state)} wrapMode="none" flexShrink={0}>
						{`${statusGlyph()} ${cleanTerminalText(friendlyTargetState(target().state))}`}
					</text>
					<Show when={elapsed() !== undefined}>
						<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
							{` ${formatDuration(elapsed())}`}
							{timeoutMs() && remaining() !== undefined && target().active
								? ` · ${formatDuration(Math.max(0, remaining()!))} left`
								: ""}
						</text>
					</Show>
				</box>
				<Show when={activityText()}>
					<text height={1} minHeight={1} flexShrink={0} wrapMode="none" fg={colors.subtle}>
						{activityText()}
					</text>
				</Show>
				<Show when={target().state === "waiting" && run().pendingQuestion}>
					<box flexDirection="row" flexShrink={0}>
						<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
							{"asked main  "}
						</text>
						<text fg={colors.text} selectable wrapMode="word" flexShrink={1}>
							{run().pendingQuestion}
						</text>
					</box>
					<Show when={run().pendingQuestionContext}>
						<text fg={colors.subtle} selectable wrapMode="word" paddingLeft={12}>
							{run().pendingQuestionContext}
						</text>
					</Show>
				</Show>
				<For each={activeTools()}>
					{(tool) => (
						<text minHeight={1} flexShrink={0} wrapMode="word" fg={colors.subtle}>
							{commandTiming(tool)}
						</text>
					)}
				</For>
				<Show when={target().error}>
					<text height={1} minHeight={1} flexShrink={0} wrapMode="none" fg={colors.red}>
						✗ {cleanTerminalText(target().error!)}
					</text>
				</Show>
			</box>
			<InspectorTranscriptPane
				props={props}
				target={target}
				run={run}
				itemNow={itemNow}
				ownedChildren={ownedChildren}
			/>
			<InspectorSteerPanel
				props={props}
				target={target}
				setSteerEditor={(value) => {
					steerEditor = value;
				}}
				getSteerEditor={() => steerEditor}
				sendSteer={sendSteer}
				controlKeys={controlKeys}
			/>
		</box>
	);
}
