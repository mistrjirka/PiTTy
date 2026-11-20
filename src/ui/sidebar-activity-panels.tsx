/** Live work in allocated sidebar space: background commands, agents, notices. */
import { type Accessor, For, type JSX, Show } from "solid-js";
import type { BackgroundTask } from "../state/background-tasks.ts";
import { backgroundStatus } from "../state/background-tasks.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { SubagentTreeRow } from "../subagents/tree.ts";
import type { NotificationRecord } from "../types.ts";
import { backgroundTaskDuration } from "./background-task-duration.ts";
import { clip } from "./model-context.tsx";
import {
	notificationToneColor,
	notificationToneIcon,
	SIDEBAR_CONTENT_WIDTH,
} from "./sidebar-layout.ts";
import { SplitRow } from "./split-row.tsx";
import { colors } from "./theme.ts";
export interface SidebarActivityPanelsProps {
	backgroundHeight: Accessor<number>;
	backgroundTasks: Accessor<BackgroundTask[]>;
	now: () => number;
	onOpenBackgroundTask?: ((id: string) => void) | undefined;
	hasSubagents: () => boolean;
	subagentHeight: Accessor<number>;
	/** `2 working · 1 finished`, from the same buckets as spawn groups. */
	agentSummary: () => string;
	/** The `◆ Main` row at the top of the agent tree. */
	mainRow: () => JSX.Element;
	treeRows: Accessor<SubagentTreeRow[]>;
	renderTarget: (target: SubagentTarget, prefix: string) => JSX.Element;
	hasNotifications: () => boolean;
	notificationHeight: Accessor<number>;
	orderedNotifications: Accessor<NotificationRecord[]>;
	onOpenNotification?: ((id: string) => void) | undefined;
}

function backgroundGlyph(task: BackgroundTask): { glyph: string; color: string } {
	if (task.state === "running") return { glyph: "●", color: colors.accent };
	if (task.state === "exited" && task.exitCode === 0)
		return { glyph: "✓", color: colors.green };
	return { glyph: "✗", color: colors.red };
}

export function SidebarActivityPanels(props: SidebarActivityPanelsProps) {
	const running = () =>
		props.backgroundTasks().filter((task) => task.state === "running").length;
	const unread = () =>
		props.orderedNotifications().filter((record) => !record.read).length;
	return (
		<>
			<Show when={props.backgroundHeight() > 0}>
				<box
					id="background-panel"
					height={props.backgroundHeight()}
					minHeight={props.backgroundHeight()}
					flexShrink={0}
					flexDirection="column"
				>
					<SplitRow
						left="Running"
						leftColor={colors.muted}
						right={`${running()} of ${props.backgroundTasks().length}`}
					/>
					<scrollbox
						id="background-scroll"
						flexGrow={1}
						minHeight={1}
						scrollY
						scrollX={false}
						viewportCulling
					>
						<For each={props.backgroundTasks()}>
							{(task) => (
								<box
									id={`background-row-${task.id}`}
									height={1}
									minHeight={1}
									flexShrink={0}
									flexDirection="row"
									onMouseDown={(event) => {
										event.preventDefault();
										event.stopPropagation();
										props.onOpenBackgroundTask?.(task.id);
									}}
								>
									<text fg={backgroundGlyph(task).color} wrapMode="none" flexShrink={0}>
										{`${backgroundGlyph(task).glyph} `}
									</text>
									{/* The id is how the agent and its tools name the job. */}
									<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
										{`${task.id} `}
									</text>
									<text
										fg={task.state === "running" ? colors.text : colors.muted}
										wrapMode="none"
										flexShrink={1}
									>
										{clip(
											task.command.replace(/\s+/g, " ").trim() ||
												backgroundStatus(task),
											SIDEBAR_CONTENT_WIDTH - task.id.length - 10,
										)}
									</text>
									<box flexGrow={1} minWidth={1} />
									<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
										{backgroundTaskDuration(task, props.now()) ?? ""}
									</text>
								</box>
							)}
						</For>
					</scrollbox>
				</box>
			</Show>
			<Show when={props.hasSubagents()}>
				<box
					id="subagent-panel"
					height={props.subagentHeight()}
					minHeight={props.subagentHeight()}
					flexShrink={1}
					flexDirection="column"
				>
					<SplitRow
						left="Agents"
						leftColor={colors.muted}
						right={props.agentSummary()}
					/>
					{props.mainRow()}
					<scrollbox
						id="subagent-scroll"
						flexGrow={1}
						minHeight={1}
						scrollY
						scrollX={false}
						viewportCulling={true}
						verticalScrollbarOptions={{
							showArrows: false,
							trackOptions: {
								foregroundColor: colors.borderStrong,
								backgroundColor: colors.background,
							},
						}}
						onMouseScroll={(event) => {
							event.preventDefault();
							event.stopPropagation();
						}}
					>
						<For each={props.treeRows()}>
							{(row) => props.renderTarget(row.target, row.prefix)}
						</For>
					</scrollbox>
				</box>
			</Show>
			<box flexGrow={1} />
			<Show when={props.hasNotifications() && props.notificationHeight() > 0}>
				<box
					id="notification-panel"
					height={props.notificationHeight()}
					minHeight={props.notificationHeight()}
					flexShrink={1}
					flexDirection="column"
				>
					<SplitRow
						left="Notices"
						leftColor={colors.muted}
						right={unread() > 0 ? `${unread()} new` : undefined}
						rightColor={colors.yellow}
					/>
					<scrollbox
						flexGrow={1}
						minHeight={1}
						scrollY
						scrollX={false}
						viewportCulling={true}
					>
						<For each={props.orderedNotifications()}>
							{(record) => (
								<box
									height={1}
									minHeight={1}
									flexShrink={0}
									flexDirection="row"
									onMouseDown={(event) => {
										event.preventDefault();
										event.stopPropagation();
										props.onOpenNotification?.(record.id);
									}}
								>
									<text fg={notificationToneColor(record.tone)} wrapMode="none" flexShrink={0}>
										{`${notificationToneIcon(record.tone)} `}
									</text>
									<text
										fg={record.read ? colors.subtle : colors.text}
										wrapMode="none"
										flexShrink={1}
									>
										{clip(record.text, SIDEBAR_CONTENT_WIDTH - 2)}
									</text>
								</box>
							)}
						</For>
					</scrollbox>
				</box>
			</Show>
		</>
	);
}
