import { For, Show, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import type {
	RpcSessionState,
	SessionStats,
	SubagentRun,
	ToolItem,
	NotificationRecord,
} from "../types.ts";
import { subagentTargets, type SubagentTarget } from "../subagents/targets.ts";
import { subagentTreeRows } from "../subagents/tree.ts";
import { formatDuration } from "./duration.ts";
import type { RequestPerformance } from "../tabs/request-metrics.ts";
import {
	requestTimingStats,
	type RequestTiming,
} from "../tabs/request-timing.ts";
import { colors } from "./theme.ts";
import { TodoPanel, type TodoViewItem } from "./todos.tsx";
import {
	ModelContextRows,
	clip,
	formatTokens,
	isResidentTargetState,
	stateColor,
	stateIcon,
	targetFreshness,
	targetToolActivity,
	targetToolUsage,
} from "./model-context.tsx";
import { appVersion } from "../version.ts";
import {
	connectedMcpServerNames,
	mcpEnabledCount,
	type McpStatusCounts,
	type McpStatusSnapshot,
} from "../state/mcp-status.ts";
import type { McpConfiguredSummary } from "../config/mcp-config.ts";
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

function mcpSummaryText(counts: { enabled: number; connected: number }): string {
	return `🔌 MCP ${counts.connected}/${counts.enabled} connected`;
}

function mcpSummaryColor(
	counts: { enabled: number; connected: number },
	failed: boolean,
): string {
	if (failed) return colors.red;
	if (counts.enabled > 0 && counts.connected >= counts.enabled)
		return colors.green;
	if (counts.connected === 0) return colors.subtle;
	return colors.yellow;
}

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

function notificationToneColor(tone: NotificationRecord["tone"]): string {
	if (tone === "error") return colors.red;
	if (tone === "warning") return colors.yellow;
	if (tone === "success") return colors.green;
	return colors.borderStrong;
}

function notificationToneIcon(tone: NotificationRecord["tone"]): string {
	if (tone === "error") return "❌";
	if (tone === "warning") return "⚠️";
	if (tone === "success") return "✅";
	return "🔔";
}

// `targetToolActivity`, `targetFreshness`, `targetToolUsage` and
// `isResidentTargetState` live in
// `./model-context.tsx` so the sidebar, the grouped spawn card and the inline
// spawn block all render from the same helpers. Re-exported here so existing
// `sidebar.tsx` import sites keep working.
export { targetToolActivity, targetToolUsage } from "./model-context.tsx";

export function Sidebar(props: {
	state?: RpcSessionState | undefined;
	stats?: SessionStats | undefined;
	lastRequestPerformance?: RequestPerformance | undefined;
	timingHistory?: RequestTiming[] | Accessor<RequestTiming[]> | undefined;
	runs: SubagentRun[] | Accessor<SubagentRun[]>;
	tools?: ToolItem[] | Accessor<ToolItem[]> | undefined;
	contextWindowForModel?: (model: string | undefined) => number | undefined;
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
	mcpStatus?:
		| McpStatusSnapshot
		| Accessor<McpStatusSnapshot | undefined>
		| undefined;
	mcpCounts?:
		| McpStatusCounts
		| Accessor<McpStatusCounts | undefined>
		| undefined;
	mcpConfigured?:
		| McpConfiguredSummary
		| Accessor<McpConfiguredSummary | undefined>
		| undefined;
	notifications?:
		| NotificationRecord[]
		| Accessor<NotificationRecord[]>
		| undefined;
	onOpenNotification?: (recordId: string) => void;
	onOpenTodo?: (todo: TodoViewItem) => void;
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
	const timingHistory = () =>
		typeof props.timingHistory === "function"
			? props.timingHistory()
			: (props.timingHistory ?? []);
	const mcpSnapshot = () =>
		typeof props.mcpStatus === "function"
			? props.mcpStatus()
			: props.mcpStatus;
	const mcpFallbackCounts = () =>
		typeof props.mcpCounts === "function"
			? props.mcpCounts()
			: props.mcpCounts;
	const mcpConfigured = () =>
		typeof props.mcpConfigured === "function"
			? props.mcpConfigured()
			: props.mcpConfigured;
	const mcpCounts = () => {
		const snapshot = mcpSnapshot();
		if (snapshot)
			return {
				enabled: mcpEnabledCount(snapshot),
				connected: snapshot.connectedCount,
				disabled: snapshot.disabledCount,
			};
		return mcpFallbackCounts();
	};
	const [mcpHover, setMcpHover] = createSignal(false);
	// Moving from the summary row onto the revealed server rows crosses child
	// renderables, which emits out-then-over on the parent. A short hide delay
	// keeps the list readable while the pointer is still inside the block.
	let mcpHideTimer: ReturnType<typeof setTimeout> | undefined;
	const showMcpDetails = () => {
		if (mcpHideTimer !== undefined) {
			clearTimeout(mcpHideTimer);
			mcpHideTimer = undefined;
		}
		setMcpHover(true);
	};
	const scheduleMcpHide = () => {
		if (mcpHideTimer !== undefined) clearTimeout(mcpHideTimer);
		mcpHideTimer = setTimeout(() => {
			mcpHideTimer = undefined;
			setMcpHover(false);
		}, 250);
	};
	onCleanup(() => {
		if (mcpHideTimer !== undefined) clearTimeout(mcpHideTimer);
	});
	const mcpConnectedNames = createMemo(() => {
		const snapshot = mcpSnapshot();
		return snapshot ? connectedMcpServerNames(snapshot) : [];
	});
	const MCP_HOVER_LIMIT = 6;
	const mcpDetailRows = () => {
		if (!mcpCounts() || !mcpHover()) return 0;
		const names = mcpConnectedNames();
		if (names.length === 0) return 1;
		const shown = Math.min(names.length, MCP_HOVER_LIMIT);
		return shown + (names.length > shown ? 1 : 0);
	};
	const mcpConfiguredDetailRows = () => {
		const configured = mcpConfigured();
		if (!configured || mcpCounts() || !mcpHover()) return 0;
		const names = configured.enabledNames;
		if (names.length === 0) return 2;
		const shown = Math.min(names.length, MCP_HOVER_LIMIT);
		return shown + (names.length > shown ? 1 : 0) + 1;
	};
	const mcpRows = () =>
		mcpCounts()
			? 1 + mcpDetailRows()
			: mcpConfigured()
				? 1 + mcpConfiguredDetailRows()
				: 0;
	const selectedModelTiming = createMemo(() => {
		const model = props.state?.model;
		if (!model?.provider || !model.id) return undefined;
		return requestTimingStats(timingHistory(), model.provider, model.id);
	});
	const timingRows = () => (selectedModelTiming() ? 2 : 0);
	const orderedNotifications = createMemo(() =>
		[...notifications()].sort((a, b) =>
			a.read !== b.read ? (a.read ? 1 : -1) : b.createdAt - a.createdAt,
		),
	);
	const hasNotifications = () => orderedNotifications().length > 0;
	const targets = createMemo(() =>
		subagentTargets(
			runs(),
			tools(),
			props.contextWindowForModel ? { contextWindowForModel: props.contextWindowForModel } : {},
		),
	);
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
		timingRows() +
		(props.stats?.contextUsage?.percent !== undefined &&
		props.stats?.contextUsage?.percent !== null
			? 1
			: 0) +
		mcpRows();
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

	const treeRows = createMemo(() => subagentTreeRows(targets()));
	const renderTarget = (
		target: SubagentTarget,
		prefix = "",
	) => {
		const selected = () =>
			target.key === selectedKey() ||
			(!selectedKey() && target.key === treeRows()[0]?.target.key);
		// The usage line is empty when there is nothing to report (the state
		// word already appears in the row above); collapse the box instead of
		// leaving a blank third row. Both stay accessors so the reserved
		// height always follows the usage line instead of freezing at the
		// values captured when the row was created.
		const usage = () => targetToolUsage(target);
		const detailPrefix = () => " ".repeat(prefix.length);
		const rows = () => (target.active ? (usage() ? 3 : 2) : 1);
		return (
			<box
				id={`subagent-${target.key}`}
				height={rows()}
				minHeight={rows()}
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
							{clip(`${prefix}${stateIcon(target.state)} ${target.label}`, 31)}
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
						{clip(`${prefix}${stateIcon(target.state)} ${target.label}`, 31)}
					</text>
					<text width="100%" height={1} fg={colors.text} wrapMode="none">
						{clip(
							// A resident (`idle`) or parent-waiting (`waiting`) child is
							// live-but-idle: the status-file timestamp is not an age of
							// anything the user did, so the row names the state on its
							// own. Working rows keep the age (last activity).
							`${detailPrefix()}${
								isResidentTargetState(target.state)
									? targetToolActivity(target)
									: `${targetFreshness(target, now())} · ${targetToolActivity(target)}`
							}`,
							31,
						)}
					</text>
					<Show when={usage()}>
						<text width="100%" height={1} fg={colors.subtle} wrapMode="none">
							{clip(`${detailPrefix()}${usage()}`, 31)}
						</text>
					</Show>
				</Show>
			</box>
		);
	};

	return (
		<box
			width={38}
			minWidth={38}
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
			<ModelContextRows
				contextText={`${formatTokens(props.stats?.contextUsage?.tokens ?? undefined)} / ${formatTokens(props.stats?.contextUsage?.contextWindow ?? props.state?.model?.contextWindow)}`}
				percentUsed={props.stats?.contextUsage?.percent ?? undefined}
				modelText={
					props.state?.model
						? `${props.state.model.provider}/${props.state.model.id}`
						: "—"
				}
				thinkingText={props.state?.thinkingLevel ?? "—"}
			/>
			<box height={1} />
			<Show when={props.lastRequestPerformance}>
				{(performance) => (
					<text width="100%" height={1} fg={colors.subtle} wrapMode="none">
						TTFT {(performance().ttftMs / 1000).toFixed(1)}s · {Math.round(performance().outputTokens / (performance().generationMs / 1000))} tok/s
					</text>
				)}
			</Show>
			<Show when={selectedModelTiming()}>
				{(stats) => (
					<>
						<box height={1} />
						<text width="100%" height={1} fg={colors.textBright} attributes={1}>
							Timing
						</text>
						<text width="100%" height={1} fg={colors.muted} wrapMode="none">
							Turn {formatDuration(stats().medianTurnMs)}
							{stats().medianTurnPerToolMs !== undefined
								? ` · Tool ${formatDuration(stats().medianTurnPerToolMs)}`
								: ""}
						</text>
					</>
				)}
			</Show>
			<Show when={!mcpCounts() && mcpConfigured()}>
				{(configured) => (
					<box
						id="mcp-configured-status"
						flexDirection="column"
						flexShrink={0}
						onMouseOver={showMcpDetails}
						onMouseOut={scheduleMcpHide}
					>
						<text width="100%" height={1} fg={colors.subtle} wrapMode="none">
							{clip(
								`🔌 MCP ${configured().enabled} server${configured().enabled === 1 ? "" : "s"}${configured().disabled ? ` · ${configured().disabled} off` : ""}`,
								31,
							)}
						</text>
						<Show when={mcpHover()}>
							<For
								each={configured().enabledNames.slice(0, MCP_HOVER_LIMIT)}
							>
								{(name) => (
									<text
										width="100%"
										height={1}
										fg={colors.muted}
										wrapMode="none"
									>
										{clip(`  · ${name}`, 31)}
									</text>
								)}
							</For>
							<Show when={configured().enabledNames.length > MCP_HOVER_LIMIT}>
								<text
									width="100%"
									height={1}
									fg={colors.subtle}
									wrapMode="none"
								>
									{clip(
										`  +${configured().enabledNames.length - MCP_HOVER_LIMIT} more`,
										31,
									)}
								</text>
							</Show>
							<Show when={configured().enabledNames.length === 0}>
								<text
									width="100%"
									height={1}
									fg={colors.subtle}
									wrapMode="none"
								>
									{clip("  no servers enabled", 31)}
								</text>
							</Show>
							<text width="100%" height={1} fg={colors.subtle} wrapMode="none">
								{clip("  Pi manages connections", 31)}
							</text>
						</Show>
					</box>
				)}
			</Show>
			<Show when={mcpCounts()}>
				{(counts) => (
					<box
						id="mcp-status"
						flexDirection="column"
						flexShrink={0}
						onMouseOver={showMcpDetails}
						onMouseOut={scheduleMcpHide}
					>
						<text
							width="100%"
							height={1}
							fg={mcpSummaryColor(
								counts(),
								(mcpSnapshot()?.servers ?? []).some(
									(server) => server.status === "failed",
								),
							)}
							wrapMode="none"
						>
							{clip(mcpSummaryText(counts()), 31)}
						</text>
						<Show when={mcpHover()}>
							<Show
								when={mcpConnectedNames().length > 0}
								fallback={
									<text
										width="100%"
										height={1}
										fg={colors.subtle}
										wrapMode="none"
									>
										{clip(
											counts().connected > 0
												? `  ${counts().connected} connected (names unavailable)`
												: "  none connected",
											31,
										)}
									</text>
								}
							>
								<For each={mcpConnectedNames().slice(0, MCP_HOVER_LIMIT)}>
									{(name) => (
										<text
											width="100%"
											height={1}
											fg={colors.muted}
											wrapMode="none"
										>
											{clip(`  ${stateIcon("running")} ${name}`, 31)}
										</text>
									)}
								</For>
								<Show when={mcpConnectedNames().length > MCP_HOVER_LIMIT}>
									<text
										width="100%"
										height={1}
										fg={colors.subtle}
										wrapMode="none"
									>
										{clip(
											`  +${mcpConnectedNames().length - MCP_HOVER_LIMIT} more connected`,
											31,
										)}
									</text>
								</Show>
							</Show>
						</Show>
					</box>
				)}
			</Show>
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
				)
			}
		</box>
	);
}
