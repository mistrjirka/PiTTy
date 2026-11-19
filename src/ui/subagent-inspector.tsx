import type { MouseEvent, TextareaRenderable } from "@opentui/core";
import { createEffect, createMemo, For, Show } from "solid-js";
import { subagentControlAvailability } from "../subagents/control-availability.ts";
import {
	ownedSubagentTargetsForItems,
	type SubagentTarget,
	subagentTargets,
	targetContextPercent,
	targetContextUsage,
} from "../subagents/targets.ts";
import {
	directSubagentChildren,
	parentSubagentTarget,
	subagentAncestors,
} from "../subagents/tree.ts";
import type { ConversationItem, SubagentRun, ToolItem } from "../types.ts";
import { formatDuration } from "./duration.ts";
import { cleanTerminalText } from "./message.tsx";
import {
	friendlyTargetState,
	ModelContextRows,
	stateColor,
	stateIcon,
} from "./model-context.tsx";
import { spinnerFrames } from "./spinner.ts";
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
	const parentTarget = createMemo(() =>
		parentSubagentTarget(target(), allTargets()),
	);
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
	const breadcrumb = () =>
		[
			"Main",
			...ancestors().map(compactAgentName),
			compactAgentName(target()),
		].join(" › ");
	// Legacy pi-subagents supports pause/resume through its file-control inbox.
	// Profiled subagents deliberately expose only steer/stop; do not invent a
	// pause state that the resident Pi RPC child does not have.
	const profiled = () =>
		run().control === "profiled" || run().runtime === "profiled-subagents";
	const controlAvailability = () => subagentControlAvailability(target());
	const canControl = () => controlAvailability().canControl;
	const controlHint = () => {
		if (profiled()) return "Steer below · Ctrl+Shift+A stop";
		if (run().state === "running") return "Ctrl+A pause · Ctrl+Shift+A stop";
		if (run().state === "paused") return "Resume via click · Ctrl+Shift+A stop";
		return "Ctrl+Shift+A stop";
	};
	const step = () => target().step;
	const spinnerGlyph = () => props.spinner ?? spinnerFrames[0] ?? "◐";
	// Residents (`idle`) and parent-waiters (`waiting`) are live-but-idle:
	// their context window is stale, so the inline Context field drops (the
	// tool count stays visible through the activity row). Mirrors the
	// `targetToolUsage` resident rule at the row choke point.
	const residentIdle = () =>
		target().state === "idle" || target().state === "waiting";
	const childContextUsage = () =>
		residentIdle() ? "" : (targetContextUsage(target()) ?? "");
	const childContextPercent = () =>
		residentIdle() ? undefined : targetContextPercent(target());
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
	const activeTools = () =>
		target().active && target().state === "running"
			? (run().activeTools ?? [])
			: [];
	const commandTiming = (
		tool: NonNullable<SubagentRun["activeTools"]>[number],
	) => {
		const elapsed = Math.max(0, props.now - tool.startedAt);
		const prefix = `${cleanTerminalText(tool.toolName)} running · elapsed ${formatDuration(elapsed)}`;
		if (tool.timeoutSeconds === undefined)
			return `${prefix} · command timeout not specified`;
		const limit = tool.timeoutSeconds * 1000;
		return `${prefix} · command timeout ${formatDuration(limit)} · ${
			elapsed < limit
				? `${formatDuration(limit - elapsed)} left`
				: "timeout reached; awaiting completion"
		}`;
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
					<text
						height={1}
						wrapMode="none"
						fg={colors.textBright}
						attributes={1}
					>
						{cleanTerminalText(breadcrumb())}
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
				<box height={1} minHeight={1} flexShrink={0} flexDirection="row">
					<Show when={parentTarget()}>
						{(parent) => (
							<text
								id="subagent-inspector-parent"
								fg={colors.purple}
								attributes={1}
								onMouseDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									props.onInspectSubagentTarget?.(parent().key);
								}}
							>
								← {cleanTerminalText(compactAgentName(parent()))} parent
							</text>
						)}
					</Show>
					<Show when={parentTarget()}>
						<text fg={colors.subtle}> · </text>
					</Show>
					<text wrapMode="none" fg={colors.subtle}>
						{props.targetCount && props.targetCount > 1 ? "←/→ switch · " : ""}
						Esc / Ctrl+I main chat
					</text>
				</box>
				<Show when={canControl()}>
					<box flexDirection="row" height={1} minHeight={1} flexShrink={0}>
						<Show when={controlAvailability().canPause}>
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
						<Show when={controlAvailability().canResume}>
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
							when={
								profiled()
									? ["running", "queued", "waiting", "idle"].includes(
											run().state,
										)
									: ["running", "paused", "queued"].includes(run().state)
							}
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
						<text fg={colors.muted} wrapMode="none">
							{controlHint()}
						</text>
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
				<Show when={target().state === "waiting" && run().pendingQuestion}>
					<box
						flexDirection="column"
						border={["left"]}
						borderColor={colors.purple}
						paddingLeft={1}
					>
						<text fg={colors.purple} attributes={1}>
							Awaiting parent answer
						</text>
						<text fg={colors.textBright} selectable wrapMode="word">
							{run().pendingQuestion}
						</text>
						<Show when={run().pendingQuestionContext}>
							<text fg={colors.muted} selectable wrapMode="word">
								{run().pendingQuestionContext}
							</text>
						</Show>
					</box>
				</Show>
				<For each={activeTools()}>
					{(tool) => (
						<text minHeight={1} flexShrink={0} wrapMode="word" fg={colors.cyan}>
							{commandTiming(tool)}
						</text>
					)}
				</For>
				<ModelContextRows
					layout="inline"
					contextText={childContextUsage() ?? ""}
					percentUsed={childContextPercent()}
					modelText={target().model ?? ""}
					thinkingText={target().thinking ?? ""}
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
			<InspectorTranscriptPane
				props={props}
				target={target}
				run={run}
				currentTool={currentTool}
				toolElapsed={toolElapsed}
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
			/>
		</box>
	);
}
