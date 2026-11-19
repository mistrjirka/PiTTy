/** Background tasks, child agents, todos and notifications in allocated sidebar space. */
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
} from "./sidebar-layout.ts";
import { colors } from "./theme.ts";
import { TodoPanel, type TodoViewItem } from "./todos.tsx";
export interface SidebarActivityPanelsProps {
	backgroundHeight: Accessor<number>;
	backgroundTasks: Accessor<BackgroundTask[]>;
	now: () => number;
	onOpenBackgroundTask?: ((id: string) => void) | undefined;
	hasSubagents: () => boolean;
	subagentHeight: Accessor<number>;
	targets: Accessor<SubagentTarget[]>;
	active: () => SubagentTarget[];
	treeRows: Accessor<SubagentTreeRow[]>;
	renderTarget: (target: SubagentTarget, prefix: string) => JSX.Element;
	hasTodos: () => boolean;
	todoHeight: Accessor<number>;
	todos: () => TodoViewItem[];
	onOpenTodo?: ((todo: TodoViewItem) => void) | undefined;
	hasNotifications: () => boolean;
	notificationHeight: Accessor<number>;
	orderedNotifications: Accessor<NotificationRecord[]>;
	onOpenNotification?: ((id: string) => void) | undefined;
}
export function SidebarActivityPanels(props: SidebarActivityPanelsProps) {
	const {
		backgroundHeight,
		backgroundTasks,
		now,
		hasSubagents,
		subagentHeight,
		targets,
		active,
		treeRows,
		renderTarget,
		hasTodos,
		todoHeight,
		todos,
		hasNotifications,
		notificationHeight,
		orderedNotifications,
	} = props;
	return (
		<>
			<Show when={backgroundHeight() > 0}>
				<box
					id="background-panel"
					height={backgroundHeight()}
					minHeight={backgroundHeight()}
					flexShrink={0}
					flexDirection="column"
					border={["top"]}
					borderColor={colors.borderStrong}
				>
					<text height={1} fg={colors.textBright} attributes={1}>
						{clip(
							`Background (${backgroundTasks().filter((task) => task.state === "running").length} active · ${backgroundTasks().length} total)`,
							31,
						)}
					</text>
					<scrollbox
						id="background-scroll"
						flexGrow={1}
						minHeight={1}
						scrollY
						scrollX={false}
						viewportCulling
					>
						<For each={backgroundTasks()}>
							{(task) => (
								<box
									id={`background-row-${task.id}`}
									height={1}
									minHeight={1}
									flexShrink={0}
									border={["left"]}
									borderColor={
										task.state === "running"
											? colors.green
											: task.exitCode === 0
												? colors.borderStrong
												: colors.red
									}
									paddingLeft={1}
									onMouseDown={(event) => {
										event.preventDefault();
										event.stopPropagation();
										props.onOpenBackgroundTask?.(task.id);
									}}
								>
									<text
										height={1}
										width="100%"
										fg={
											task.state === "running"
												? colors.textBright
												: colors.muted
										}
										wrapMode="none"
									>
										{clip(
											`${task.state === "running" ? "●" : task.state === "exited" && task.exitCode === 0 ? "✓" : "×"} ${task.id} ${backgroundTaskDuration(task, now()) ?? ""} ${task.command.replace(/\s+/g, " ").trim() || backgroundStatus(task)}`,
											31,
										)}
									</text>
								</box>
							)}
						</For>
					</scrollbox>
				</box>
			</Show>
			<Show when={hasSubagents()}>
				<box
					id="subagent-panel"
					height={subagentHeight()}
					minHeight={subagentHeight()}
					flexShrink={1}
					flexDirection="column"
				>
					<box height={1} minHeight={1} flexShrink={0} flexDirection="row">
						<text flexShrink={0} fg={colors.textBright} attributes={1}>
							Subagents ({active().length} active)
						</text>
						<box flexGrow={1} />
						<Show when={targets().length > 0}>
							<text fg={colors.subtle} wrapMode="none">
								Ctrl+I · Ctrl+Down inspect
							</text>
						</Show>
					</box>
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
						<Show
							when={targets().length > 0}
							fallback={
								<text width="100%" height={1} fg={colors.muted}>
									No async subagents for this session
								</text>
							}
						>
							<For each={treeRows()}>
								{(row) => renderTarget(row.target, row.prefix)}
							</For>
						</Show>
					</scrollbox>
				</box>
			</Show>

			<Show when={hasTodos()}>
				<box
					id="todo-panel"
					height={todoHeight()}
					minHeight={todoHeight()}
					flexShrink={1}
				>
					<TodoPanel
						todos={todos()}
						height={todoHeight()}
						onOpenTodo={props.onOpenTodo}
					/>
				</box>
			</Show>
			<Show when={hasNotifications() && notificationHeight() > 0}>
				<box
					id="notification-panel"
					height={notificationHeight()}
					minHeight={notificationHeight()}
					flexShrink={1}
					border={["top"]}
					borderColor={colors.borderStrong}
					paddingTop={1}
				>
					<text height={1} fg={colors.textBright} attributes={1}>
						Notifications ({orderedNotifications().length})
					</text>
					<scrollbox
						flexGrow={1}
						minHeight={1}
						scrollY
						scrollX={false}
						viewportCulling={true}
					>
						<For each={orderedNotifications()}>
							{(record) => (
								<box
									height={1}
									minHeight={1}
									flexShrink={0}
									paddingLeft={1}
									border={["left"]}
									borderColor={notificationToneColor(record.tone)}
									onMouseDown={(event) => {
										event.preventDefault();
										event.stopPropagation();
										props.onOpenNotification?.(record.id);
									}}
								>
									<text
										height={1}
										width="100%"
										fg={record.read ? colors.subtle : colors.text}
										attributes={record.read ? 0 : 1}
										wrapMode="none"
									>
										{clip(
											`${notificationToneIcon(record.tone)} ${record.text}`,
										)}
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
