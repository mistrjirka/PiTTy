import {
	type Accessor,
	createMemo,
	createSignal,
	onCleanup,
	Show,
} from "solid-js";
import type { McpConfiguredSummary } from "../config/mcp-config.ts";
import type { BackgroundTask } from "../state/background-tasks.ts";
import {
	connectedMcpServerNames,
	type McpStatusCounts,
	type McpStatusSnapshot,
	mcpEnabledCount,
} from "../state/mcp-status.ts";
import { type SubagentTarget, subagentTargets } from "../subagents/targets.ts";
import { subagentTreeRows } from "../subagents/tree.ts";
import type { RequestPerformance } from "../tabs/request-metrics.ts";
import { readModelPerformanceHistory, modelPerformanceStats, formatModelPerformanceStats } from "../tabs/model-performance-history.ts";
import {
	type RequestTiming,
	requestTimingStats,
} from "../tabs/request-timing.ts";
import type {
	NotificationRecord,
	RpcSessionState,
	SessionStats,
	SubagentRun,
	ToolItem,
} from "../types.ts";
import { appVersion } from "../version.ts";
import { formatDuration } from "./duration.ts";
import { MCP_HOVER_LIMIT, McpHoverCard } from "./mcp-hover-card.tsx";
import {
	clip,
	formatTokens,
	isResidentTargetState,
	ModelContextRows,
	stateColor,
	stateIcon,
	targetFreshness,
	targetToolActivity,
	targetToolUsage,
} from "./model-context.tsx";
import { SidebarActivityPanels } from "./sidebar-activity-panels.tsx";
import {
	allocateSidebarPanels,
	mcpSummaryColor,
	mcpSummaryText,
} from "./sidebar-layout.ts";
import { colors } from "./theme.ts";
import type { TodoViewItem } from "./todos.tsx";
export function Sidebar(props: {
	state?: RpcSessionState | undefined;
	stats?: SessionStats | undefined;
	lastRequestPerformance?: RequestPerformance | undefined;
	timingHistory?: RequestTiming[] | Accessor<RequestTiming[]> | undefined;
	runs: SubagentRun[] | Accessor<SubagentRun[]>;
	tools?: ToolItem[] | Accessor<ToolItem[]> | undefined;
	/** Reuse the main UI's current Pi-PID-scoped roster instead of re-discovering it. */
	targetSource?: Accessor<SubagentTarget[]> | undefined;
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
	backgroundTasks?: BackgroundTask[] | Accessor<BackgroundTask[]>;
	onOpenBackgroundTask?: (id: string) => void;
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
	const backgroundTasks = () =>
		typeof props.backgroundTasks === "function"
			? props.backgroundTasks()
			: (props.backgroundTasks ?? []);
	const notifications = () =>
		typeof props.notifications === "function"
			? props.notifications()
			: (props.notifications ?? []);
	const timingHistory = () =>
		typeof props.timingHistory === "function"
			? props.timingHistory()
			: (props.timingHistory ?? []);
	const mcpSnapshot = () =>
		typeof props.mcpStatus === "function" ? props.mcpStatus() : props.mcpStatus;
	const mcpFallbackCounts = () =>
		typeof props.mcpCounts === "function" ? props.mcpCounts() : props.mcpCounts;
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
	// The card floats left of the row with a small gap. Moving across that gap
	// emits out-then-over, so a short hide delay keeps the card readable while
	// the pointer travels between the row and the card.
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
	const mcpRows = () => (mcpCounts() || mcpConfigured() ? 1 : 0);
	const selectedModelTiming = createMemo(() => {
		const model = props.state?.model;
		if (!model?.provider || !model.id) return undefined;
		return requestTimingStats(timingHistory(), model.provider, model.id);
	});
	const currentRequestPerformance = createMemo(() => {
		const performance = props.lastRequestPerformance;
		const selected = props.state?.model;
		if (selected?.provider && selected.id) {
			const stats = modelPerformanceStats(readModelPerformanceHistory(), selected.provider, selected.id);
			if (stats) return { label: formatModelPerformanceStats(stats) };
		}
		if (!performance) return undefined;
		// A recent request from a previous model must not masquerade as the
		// current model's latency or throughput.
		if (
			selected?.provider &&
			selected.id &&
			(performance.provider !== selected.provider ||
				performance.modelId !== selected.id)
		)
			return undefined;
		return { label: "Last " + Math.round(performance.outputTokens / (performance.generationMs / 1000)) + " tok/s · TTFT " + (performance.ttftMs / 1000).toFixed(1) + "s" };
	});
	const timingRows = () => (selectedModelTiming() ? 2 : 0);
	const orderedNotifications = createMemo(() =>
		[...notifications()].sort((a, b) =>
			a.read !== b.read ? (a.read ? 1 : -1) : b.createdAt - a.createdAt,
		),
	);
	const hasNotifications = () => orderedNotifications().length > 0;
	const targets = createMemo(
		() =>
			props.targetSource?.() ??
			subagentTargets(
				runs(),
				tools(),
				props.contextWindowForModel
					? { contextWindowForModel: props.contextWindowForModel }
					: {},
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
	// When present, reserve a small bounded panel rather than stealing all
	// rows from subagents, todos and notifications on shorter terminals.
	const backgroundHeight = () => {
		const remaining = sidebarHeight() - fixedHeaderRows();
		if (!backgroundTasks().length || remaining < 6) return 0;
		return Math.min(
			7,
			2 + Math.max(1, Math.floor(remaining / 4)),
			backgroundTasks().length + 2,
		);
	};
	const availableBodyRows = () =>
		Math.max(0, sidebarHeight() - fixedHeaderRows() - backgroundHeight());
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
	const renderTarget = (target: SubagentTarget, prefix = "") => {
		const selected = () =>
			target.key === selectedKey() ||
			(!selectedKey() && target.key === treeRows()[0]?.target.key);
		// The usage line is empty when there is nothing to report (the state
		// word already appears in the row above); collapse the box instead of
		// leaving a blank third row. Both stay accessors so the reserved
		// height always follows the usage line instead of freezing at the
		// values captured when the row was created.
		const usage = () => targetToolUsage(target, props.now ?? Date.now());
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
			<Show when={currentRequestPerformance()}>
				{(performance) => (
					<text width="100%" height={1} fg={colors.subtle} wrapMode="none">
						{performance().label}
					</text>
				)}
			</Show>
			<Show when={selectedModelTiming()}>
				{(stats) => (
					<>
						<box height={1} />
						<text
							width="100%"
							height={1}
							fg={colors.textBright}
							attributes={1}
							wrapMode="none"
						>
							Timing
							{stats().medianToolDispatchMs !== undefined
								? ` · dispatch ${formatDuration(stats().medianToolDispatchMs)}`
								: ""}
						</text>
						<text width="100%" height={1} fg={colors.muted} wrapMode="none">
							Turn {formatDuration(stats().medianTurnMs)}
							{stats().medianToolExecutionMs !== undefined
								? ` · Tool ${formatDuration(stats().medianToolExecutionMs)}`
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
							<McpHoverCard
								names={configured().enabledNames}
								bullet="·"
								emptyText="no servers enabled"
								overflowText={`+${configured().enabledNames.length - MCP_HOVER_LIMIT} more`}
								note="Pi manages connections"
								onEnter={showMcpDetails}
								onLeave={scheduleMcpHide}
							/>
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
							<McpHoverCard
								names={mcpConnectedNames()}
								bullet={stateIcon("running")}
								emptyText={
									counts().connected > 0
										? `${counts().connected} connected (names unavailable)`
										: "none connected"
								}
								overflowText={`+${mcpConnectedNames().length - MCP_HOVER_LIMIT} more connected`}
								onEnter={showMcpDetails}
								onLeave={scheduleMcpHide}
							/>
						</Show>
					</box>
				)}
			</Show>
			<box height={1} />

			<SidebarActivityPanels
				backgroundHeight={backgroundHeight}
				backgroundTasks={backgroundTasks}
				now={now}
				onOpenBackgroundTask={props.onOpenBackgroundTask}
				hasSubagents={hasSubagents}
				subagentHeight={subagentHeight}
				targets={targets}
				active={active}
				treeRows={treeRows}
				renderTarget={renderTarget}
				hasTodos={hasTodos}
				todoHeight={todoHeight}
				todos={todos}
				onOpenTodo={props.onOpenTodo}
				hasNotifications={hasNotifications}
				notificationHeight={notificationHeight}
				orderedNotifications={orderedNotifications}
				onOpenNotification={props.onOpenNotification}
			/>
		</box>
	);
}
