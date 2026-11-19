/** Tool cards and nested subagent summaries. */
import { type Accessor, For, Show } from "solid-js";
import {
	isProfiledSubagentTool,
	isSubagentFamilyToolName,
} from "../subagents/profiled.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { ToolItem } from "../types.ts";
import {
	objectRecordValue,
	prettyArgs,
	resolvedBoolean,
	supervisorMessage,
	supervisorToolLabel,
	toolOutputExpandable,
	toolTiming,
	toolVisual,
} from "./message-format.tsx";
import { ToolDetails } from "./message-tool-details.tsx";
import {
	friendlyTargetState,
	isResidentTargetState,
	targetFreshness,
} from "./model-context.tsx";
import {
	nestedDescendantSummary,
	summarizeSubagentArgs,
	taskGist,
	terminalBadge,
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
}
export function ToolMessage(props: ToolMessageProps) {
	const item = props.item;
	const expandable = () => toolOutputExpandable(item.output);
	const expanded = () => expandable() && resolvedBoolean(props.toolExpanded);
	const visual = () => toolVisual(item.name, item.isError);
	const supervisor = () => item.name.toLowerCase() === "subagent_supervisor";
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
	const singleProfiledTarget = () =>
		isProfiledSubagentTool(item) && props.subagentTargets?.length === 1
			? props.subagentTargets[0]
			: undefined;
	return (
		<box
			id={item.id}
			flexDirection="column"
			backgroundColor={expanded() ? colors.panelRaised : visual().background}
			border={["left"]}
			borderColor={visual().accent}
			paddingLeft={1}
			paddingRight={1}
			marginBottom={1}
		>
			<box flexDirection="row">
				<text fg={visual().accent} attributes={1}>
					{`${item.status === "streaming" ? "◉" : visual().icon} TOOL · ${
						supervisorLabel() ?? subagentLabel() ?? item.name
					}${children() ? ` ${children()}` : ""}${
						terminal() ? ` · ${terminal()}` : ""
					}`}
				</text>
				<Show
					when={
						item.args !== undefined &&
						!subagentGist() &&
						!isProfiledSubagentTool(item) &&
						(!subagentFamily() || subagentLabel() === undefined)
					}
				>
					<text fg={colors.muted} selectable wrapMode="word">
						{supervisorLabel()
							? `  ${supervisorMessage(item.args)}`
							: `  ${prettyArgs(item.args).replace(/\s+/g, " ").slice(0, 150)}`}
					</text>
				</Show>
				<box flexGrow={1} />
				<Show when={singleProfiledTarget()}>
					{(target) => (
						<text
							fg={colors.cyan}
							attributes={1}
							onMouseDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								props.onInspectSubagentTarget?.(target().key);
							}}
						>
							inspect
						</text>
					)}
				</Show>
				<Show
					when={toolTiming(item, props.now ?? Date.now()) && !subagentFamily()}
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
			<Show
				when={
					(props.subagentTargets?.length ?? 0) > 0 && !singleProfiledTarget()
				}
			>
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
										: `${friendlyTargetState(target.state)} · last activity ${targetFreshness(target, props.now ?? Date.now())}`}
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
}
