/** Tool rows and nested subagent summaries. */
import { type Accessor, For, Show } from "solid-js";
import {
	isProfiledSubagentTool,
	isSubagentFamilyToolName,
} from "../subagents/profiled.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { ToolItem } from "../types.ts";
import {
	objectRecordValue,
	resolvedBoolean,
	supervisorMessage,
	supervisorToolLabel,
	toolArgSummary,
	toolOutputExpandable,
	toolStatusGlyph,
	toolTiming,
	toolVisual,
} from "./message-format.tsx";
import { ToolDetails } from "./message-tool-details.tsx";
import {
	isResidentTargetState,
	stateColor,
	stateIcon,
	targetFreshness,
	targetToolActivity,
} from "./model-context.tsx";
import {
	nestedDescendantSummary,
	summarizeSubagentArgs,
	taskGist,
	workflowChildrenSummary,
} from "./subagent-format.ts";
import { colors } from "./theme.ts";
export interface ToolMessageProps {
	item: ToolItem;
	toolExpanded: boolean | Accessor<boolean>;
	onToggleTool?: ((id: string) => void) | undefined;
	diffExpanded?: boolean | Accessor<boolean> | undefined;
	onToggleDiff?: ((id: string) => void) | undefined;
	subagentTargets?: SubagentTarget[] | undefined;
	onInspectSubagentTarget?: ((targetKey: string) => void) | undefined;
	now?: number | undefined;
	/**
	 * Consecutive tool calls stack as one block of rows. The renderer sets this
	 * when the next transcript item is also a tool, so only the last row of a
	 * run keeps the blank line that separates it from prose.
	 */
	compactBelow?: boolean | undefined;
}
export function ToolMessage(props: ToolMessageProps) {
	const item = props.item;
	const expandable = () => toolOutputExpandable(item.output);
	const expanded = () => expandable() && resolvedBoolean(props.toolExpanded);
	const visual = () => toolVisual(item.name, item.isError);
	const status = () => toolStatusGlyph(item);
	const timing = () => toolTiming(item, props.now ?? Date.now());
	const supervisor = () => item.name.toLowerCase() === "subagent_supervisor";
	const supervisorLabel = () =>
		supervisor() ? supervisorToolLabel(item.args) : undefined;
	const subagentFamily = () =>
		isSubagentFamilyToolName(item.name) || isProfiledSubagentTool(item);
	const subagentLabel = () => {
		if (!subagentFamily()) return undefined;
		if (isProfiledSubagentTool(item)) {
			const details = objectRecordValue(item.details);
			const agentId =
				typeof details?.agentId === "string" ? details.agentId : "";
			const label = typeof details?.label === "string" ? details.label : "";
			const profile =
				typeof details?.profile === "string" ? details.profile : "";
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
			? (nestedDescendantSummary(item.details) ??
				workflowChildrenSummary(item.args, item.output))
			: undefined;
	const argSummary = () => {
		if (supervisorLabel()) return supervisorMessage(item.args);
		if (
			item.args === undefined ||
			subagentGist() ||
			isProfiledSubagentTool(item) ||
			(subagentFamily() && subagentLabel() !== undefined)
		)
			return "";
		return toolArgSummary(item.args);
	};
	const singleProfiledTarget = () =>
		isProfiledSubagentTool(item) && props.subagentTargets?.length === 1
			? props.subagentTargets[0]
			: undefined;
	const multipleTargets = () =>
		(props.subagentTargets?.length ?? 0) > 0 && !singleProfiledTarget();
	return (
		<box
			id={item.id}
			flexDirection="column"
			backgroundColor={expanded() ? colors.panelRaised : "transparent"}
			paddingLeft={1}
			paddingRight={1}
			marginBottom={props.compactBelow ? 0 : 1}
		>
			<box flexDirection="row" height={1} minHeight={1} flexShrink={0}>
				<text fg={status().color} wrapMode="none" flexShrink={0}>
					{`${status().glyph} `}
				</text>
				{/* Subagent labels carry the task description and can be long: they
				    shrink so timing and `inspect ›` stay inside the row. */}
				<text fg={visual().accent} attributes={1} wrapMode="none" flexShrink={1}>
					{supervisorLabel() ?? subagentLabel() ?? item.name}
				</text>
				<Show when={children()}>
					<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
						{` ${children()}`}
					</text>
				</Show>
				<Show when={argSummary()}>
					<text fg={colors.text} selectable wrapMode="none" flexShrink={1}>
						{`  ${argSummary()}`}
					</text>
				</Show>
				<box flexGrow={1} minWidth={1} />
				<Show when={timing()}>
					<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
						{timing()}
					</text>
				</Show>
				<Show when={singleProfiledTarget()}>
					{(target) => (
						<text
							fg={colors.accent}
							wrapMode="none"
							flexShrink={0}
							onMouseDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								props.onInspectSubagentTarget?.(target().key);
							}}
						>
							{"  inspect ›"}
						</text>
					)}
				</Show>
			</box>
			<Show when={subagentGist()}>
				<text fg={colors.muted} selectable wrapMode="word" paddingLeft={2}>
					{subagentGist()}
				</text>
			</Show>
			<Show when={multipleTargets()}>
				<box flexDirection="column">
					<For each={props.subagentTargets ?? []}>
						{(target, index) => {
							const last = () =>
								index() === (props.subagentTargets?.length ?? 0) - 1;
							return (
								<box
									height={2}
									minHeight={2}
									flexShrink={0}
									flexDirection="column"
									onMouseDown={(event) => {
										event.preventDefault();
										event.stopPropagation();
										props.onInspectSubagentTarget?.(target.key);
									}}
								>
									<box height={1} flexDirection="row">
										<text fg={colors.borderStrong} wrapMode="none">
											{last() ? "└ " : "├ "}
										</text>
										<text fg={stateColor(target.state)} wrapMode="none">
											{`${stateIcon(target.state)} `}
										</text>
										<text fg={colors.purple} wrapMode="none">
											{target.label}
										</text>
										<box flexGrow={1} />
										<text fg={colors.subtle} wrapMode="none">
											{isResidentTargetState(target.state)
												? ""
												: targetFreshness(target, props.now ?? Date.now())}
										</text>
									</box>
									<box height={1} flexDirection="row">
										<text fg={colors.borderStrong} wrapMode="none">
											{last() ? "    " : "│   "}
										</text>
										<text fg={colors.subtle} wrapMode="none">
											{targetToolActivity(target)}
										</text>
									</box>
								</box>
							);
						}}
					</For>
				</box>
			</Show>
			<box flexDirection="column" paddingLeft={2}>
				<ToolDetails
					item={item}
					toolExpanded={props.toolExpanded}
					onToggleTool={props.onToggleTool}
					diffExpanded={props.diffExpanded}
					onToggleDiff={props.onToggleDiff}
				/>
			</box>
		</box>
	);
}
