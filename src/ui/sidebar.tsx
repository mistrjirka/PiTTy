import { For, Show, createMemo, type Accessor } from "solid-js";
import stripAnsi from "strip-ansi";
import type {
	RpcSessionState,
	SessionStats,
	SubagentRun,
	ToolItem,
	NotificationRecord,
} from "../types.ts";
import { subagentTargets, type SubagentTarget } from "../subagents/targets.ts";
import { formatDuration } from "./duration.ts";
import { colors } from "./theme.ts";
import { TodoPanel, type TodoViewItem } from "./todos.tsx";
import { appVersion } from "../version.ts";

const CONTENT_WIDTH = 36;

export type SidebarPanelVisibility = {
	subagents: boolean;
	todos: boolean;
	notifications: boolean;
};

export type SidebarPanelAllocation = {
	subagents: number;
	todos: number;
	notifications: number;
};

const PANEL_KEYS = ["subagents", "todos", "notifications"] as const;

const PANEL_WEIGHTS: SidebarPanelAllocation = {
	subagents: 50,
	todos: 30,
	notifications: 20,
};
const PANEL_FLOORS: SidebarPanelAllocation = {
	subagents: 2,
	todos: 4,
	notifications: 3,
};

export function allocateSidebarPanels(
	availableRows: number,
	visibility: SidebarPanelVisibility,
): SidebarPanelAllocation {
	const rows = Math.max(0, Math.floor(availableRows));
	const allocation: SidebarPanelAllocation = {
		subagents: 0,
		todos: 0,
		notifications: 0,
	};
	let visible = PANEL_KEYS.filter((panel) => visibility[panel]);
	if (
		visibility.subagents &&
		visibility.todos &&
		visibility.notifications &&
		rows < 11
	) {
		visible = visible.filter((panel) => panel !== "notifications");
	}
	const totalWeight = visible.reduce(
		(sum, panel) => sum + PANEL_WEIGHTS[panel],
		0,
	);
	if (!totalWeight) return allocation;
	const fractions = visible.map((panel) => ({
		panel,
		share: (rows * PANEL_WEIGHTS[panel]) / totalWeight,
	}));
	for (const entry of fractions)
		allocation[entry.panel] = Math.floor(entry.share);
	let remainder =
		rows - visible.reduce((sum, panel) => sum + allocation[panel], 0);
	for (const entry of fractions.sort((a, b) => (b.share % 1) - (a.share % 1))) {
		if (!remainder) break;
		allocation[entry.panel] += 1;
		remainder -= 1;
	}
	const floorTotal = visible.reduce(
		(sum, panel) => sum + PANEL_FLOORS[panel],
		0,
	);
	if (rows < floorTotal) {
		allocation.subagents = 0;
		allocation.todos = 0;
		allocation.notifications = 0;
		let remainingRows = rows;
		const priority = fractions.sort((a, b) => b.share - a.share);
		while (remainingRows > 0) {
			for (const entry of priority) {
				if (!remainingRows) break;
				allocation[entry.panel] += 1;
				remainingRows -= 1;
			}
		}
		return allocation;
	}
	for (const panel of visible) {
		let deficit = PANEL_FLOORS[panel] - allocation[panel];
		if (deficit <= 0) continue;
		allocation[panel] = PANEL_FLOORS[panel];
		for (const donor of visible) {
			const donated = Math.min(
				deficit,
				Math.max(0, allocation[donor] - PANEL_FLOORS[donor]),
			);
			allocation[donor] -= donated;
			deficit -= donated;
			if (deficit === 0) break;
		}
	}
	return allocation;
}

function formatTokens(value: number | undefined): string {
	if (value === undefined) return "—";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
	return String(value);
}

function cleanInline(value: string): string {
	return stripAnsi(value)
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function clip(value: string, width = CONTENT_WIDTH): string {
	const clean = cleanInline(value);
	if (clean.length <= width) return clean;
	return `${clean.slice(0, Math.max(1, width - 1))}…`;
}

function notificationToneColor(tone: NotificationRecord["tone"]): string {
	if (tone === "error") return colors.red;
	if (tone === "warning") return colors.yellow;
	if (tone === "success") return colors.green;
	return colors.borderStrong;
}

function stateColor(state: string): string {
	if (["running", "active", "working"].includes(state)) return colors.green;
	if (["queued", "paused", "needs_attention"].includes(state))
		return colors.yellow;
	if (["failed", "error", "timed_out"].includes(state)) return colors.red;
	return colors.borderStrong;
}

function targetTokens(target: SubagentTarget): number | undefined {
	return (
		target.step?.tokens?.total ??
		(target.run.steps.length <= 1 ? target.run.totalTokens : undefined)
	);
}

function targetActivity(target: SubagentTarget, now: number): string {
	const tool = target.step?.currentTool ?? target.run.currentTool;
	const startedAt =
		target.step?.currentToolStartedAt ?? target.run.currentToolStartedAt;
	const elapsed = startedAt ? ` ${formatDuration(now - startedAt)}` : "";
	const path = target.step?.currentPath ?? target.run.currentPath;
	const activity =
		tool || path
			? `${tool ?? "working"}${elapsed}${path ? ` · ${path}` : ""}`
			: "click to inspect";
	const lastUpdate = target.lastUpdate;
	const freshness =
		lastUpdate === undefined
			? "last activity unknown"
			: `last activity ${formatDuration(Math.max(0, now - lastUpdate))} ago`;
	return `${activity} · ${freshness}`;
}

export function Sidebar(props: {
	state?: RpcSessionState | undefined;
	stats?: SessionStats | undefined;
	runs: SubagentRun[] | Accessor<SubagentRun[]>;
	tools?: ToolItem[] | Accessor<ToolItem[]> | undefined;
	selectedTargetKey?: string | undefined;
	selectedRunId?: string | undefined;
	now?: number | undefined;
	onSelectTarget?: ((targetKey: string) => void) | undefined;
	onInspectTarget?: ((targetKey: string) => void) | undefined;
	onSelectRun?: ((runId: string) => void) | undefined;
	onInspectRun?: ((runId: string) => void) | undefined;
	todos?: TodoViewItem[] | Accessor<TodoViewItem[]> | undefined;
	subagentsAvailable?: boolean | undefined;
	todosAvailable?: boolean | undefined;
	notifications?:
		| NotificationRecord[]
		| Accessor<NotificationRecord[]>
		| undefined;
	onOpenNotification?: (recordId: string) => void;
	height?: number | Accessor<number> | undefined;
}) {
	const now = () => props.now ?? Date.now();
	const runs = () =>
		typeof props.runs === "function" ? props.runs() : props.runs;
	const tools = () =>
		typeof props.tools === "function" ? props.tools() : (props.tools ?? []);
	const todos = () =>
		typeof props.todos === "function" ? props.todos() : (props.todos ?? []);
	const notifications = () =>
		typeof props.notifications === "function"
			? props.notifications()
			: (props.notifications ?? []);
	const orderedNotifications = createMemo(() =>
		[...notifications()].sort((a, b) =>
			a.read !== b.read ? (a.read ? 1 : -1) : b.createdAt - a.createdAt,
		),
	);
	const hasNotifications = () => orderedNotifications().length > 0;
	const targets = () => subagentTargets(runs(), tools());
	const active = () => targets().filter((target) => target.active);
	const selectedKey = () =>
		props.selectedTargetKey ??
		targets().find((target) => target.run.runId === props.selectedRunId)?.key;
	const sidebarHeight = () =>
		Math.max(
			1,
			(typeof props.height === "function" ? props.height() : props.height) ??
				40,
		);
	const hasSubagents = () => props.subagentsAvailable !== false;
	const hasTodos = () => props.todosAvailable !== false && todos().length > 0;
	const fixedHeaderRows = () =>
		11 +
		(props.stats?.contextUsage?.percent !== undefined &&
		props.stats?.contextUsage?.percent !== null
			? 1
			: 0);
	const availableBodyRows = () =>
		Math.max(0, sidebarHeight() - fixedHeaderRows());
	const panelAllocation = () =>
		allocateSidebarPanels(availableBodyRows(), {
			subagents: hasSubagents(),
			todos: hasTodos(),
			notifications: hasNotifications(),
		});
	const subagentHeight = () => panelAllocation().subagents;
	const todoHeight = () => panelAllocation().todos;
	const notificationHeight = () => panelAllocation().notifications;

	const renderTarget = (target: SubagentTarget) => {
		const selected = () =>
			target.key === selectedKey() ||
			(!selectedKey() && target === targets()[0]);
		return (
			<box
				id={`subagent-${target.key}`}
				height={target.active ? 3 : 1}
				minHeight={target.active ? 3 : 1}
				flexShrink={0}
				flexDirection="column"
				paddingLeft={1}
				border={["left"]}
				borderColor={stateColor(target.state)}
				onMouseDown={(event) => {
					event.preventDefault();
					event.stopPropagation();
					props.onSelectTarget?.(target.key);
					props.onSelectRun?.(target.run.runId);
					props.onInspectTarget?.(target.key);
					props.onInspectRun?.(target.run.runId);
				}}
			>
				<Show
					when={target.active}
					fallback={
						<text
							width="100%"
							height={1}
							fg={selected() ? colors.textBright : colors.text}
							attributes={selected() ? 1 : 0}
							wrapMode="none"
						>
							{clip(`${target.label} · ${target.state}`, 31)}
						</text>
					}
				>
					<text
						width="100%"
						height={1}
						fg={selected() ? colors.textBright : colors.text}
						attributes={selected() ? 1 : 0}
						wrapMode="none"
					>
						{clip(target.label, 31)}
					</text>
					<text width="100%" height={1} fg={colors.muted} wrapMode="none">
						{clip(
							`${target.state} · ${target.step?.turnCount ?? target.run.turnCount ?? 0}t/${target.step?.toolCount ?? target.run.toolCount ?? 0} tools · ${formatTokens(targetTokens(target))} tok`,
							31,
						)}
					</text>
					<text width="100%" height={1} fg={colors.subtle} wrapMode="none">
						{clip(targetActivity(target, now()), 31)}
					</text>
				</Show>
			</box>
		);
	};

	return (
		<box
			width={42}
			minWidth={42}
			height="100%"
			flexDirection="column"
			paddingLeft={2}
			paddingRight={1}
		>
			<text width="100%" height={1} fg={colors.textBright} attributes={1}>
				Session
			</text>
			<text width="100%" height={1} fg={colors.muted} wrapMode="none">
				{clip(
					props.state?.sessionName ?? props.state?.sessionId ?? "starting…",
				)}
			</text>
			<text width="100%" height={1} fg={colors.subtle} wrapMode="none">
				PiTTy v{appVersion}
			</text>
			<box height={1} />
			<text width="100%" height={1} fg={colors.textBright} attributes={1}>
				Context
			</text>
			<text width="100%" height={1} fg={colors.muted} wrapMode="none">
				{clip(
					`${formatTokens(props.stats?.contextUsage?.tokens ?? undefined)} / ${formatTokens(props.stats?.contextUsage?.contextWindow ?? props.state?.model?.contextWindow)}`,
				)}
			</text>
			<Show
				when={
					props.stats?.contextUsage?.percent !== undefined &&
					props.stats?.contextUsage?.percent !== null
				}
			>
				<text width="100%" height={1} fg={colors.muted}>
					{Math.round(props.stats?.contextUsage?.percent ?? 0)}% used
				</text>
			</Show>
			<box height={1} />
			<text width="100%" height={1} fg={colors.textBright} attributes={1}>
				Model
			</text>
			<text width="100%" height={1} fg={colors.muted} wrapMode="none">
				{clip(
					props.state?.model
						? `${props.state.model.provider}/${props.state.model.id}`
						: "—",
				)}
			</text>
			<text width="100%" height={1} fg={colors.muted}>
				Thinking: {clip(props.state?.thinkingLevel ?? "—")}
			</text>
			<box height={1} />

			{
				// OpenTUI's runtime supports accessor children, but its BoxProps type
				// currently omits them. The accessor keeps layout reactive without
				// rebuilding the sidebar on a timer.
				// @ts-expect-error Accessor children are supported by the JSX runtime.
				() => (
					<>
						<Show when={hasSubagents()}>
							<box
								id="subagent-panel"
								height={subagentHeight()}
								minHeight={subagentHeight()}
								flexShrink={1}
								flexDirection="column"
							>
								<box
									height={1}
									minHeight={1}
									flexShrink={0}
									flexDirection="row"
								>
									<text fg={colors.textBright} attributes={1}>
										Subagents ({active().length} active)
									</text>
									<box flexGrow={1} />
									<Show when={targets().length > 0}>
										<text fg={colors.subtle}>
											Ctrl+I · Ctrl+Down inspect
											{targets().length > 1 ? " · Ctrl+←/→ cycle" : ""}
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
										<For each={targets()}>{renderTarget}</For>
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
								<TodoPanel todos={todos()} height={todoHeight()} />
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
													{clip(record.text)}
												</text>
											</box>
										)}
									</For>
								</scrollbox>
							</box>
						</Show>
					</>
				)
			}
		</box>
	);
}
