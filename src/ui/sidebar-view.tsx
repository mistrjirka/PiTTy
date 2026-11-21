import { type Accessor, createMemo, Show } from "solid-js";
import type { McpConfiguredSummary } from "../config/mcp-config.ts";
import type { BackgroundTask } from "../state/background-tasks.ts";
import type {
	McpStatusCounts,
	McpStatusSnapshot,
} from "../state/mcp-status.ts";
import { type SubagentTarget, subagentTargets } from "../subagents/targets.ts";
import { subagentTreeRows } from "../subagents/tree.ts";
import type { RequestPerformance } from "../tabs/request-metrics.ts";
import type {
	NotificationRecord,
	RpcSessionState,
	SessionStats,
	SubagentRun,
	ToolItem,
} from "../types.ts";
import {
	clip,
	formatTokens,
	isResidentTargetState,
	stateColor,
	stateIcon,
	targetToolActivity,
	targetUsageShort,
} from "./model-context.tsx";
import {
	formatLatency,
	latestModelSpeed,
	speedVerdictColor,
	speedVerdictText,
} from "./model-speed.ts";
import { formatDuration } from "./duration.ts";
import type { SidebarScope } from "./sidebar-scope.ts";
import { subagentElapsedMs } from "./subagent-format.ts";
import { SidebarActivityPanels } from "./sidebar-activity-panels.tsx";
import { resolvedMcpCounts, SidebarMcpRow } from "./sidebar-mcp.tsx";
import {
	allocateSidebarPanels,
	contextMeterCells,
	SIDEBAR_CONTENT_WIDTH,
} from "./sidebar-layout.ts";
import { SplitRow } from "./split-row.tsx";
import { spawnGroupSummary } from "./spawn-group.tsx";
import { colors } from "./theme.ts";

export function Sidebar(props: {
	state?: RpcSessionState | undefined;
	stats?: SessionStats | undefined;
	lastRequestPerformance?: RequestPerformance | undefined;
	runs: SubagentRun[] | Accessor<SubagentRun[]>;
	tools?: ToolItem[] | Accessor<ToolItem[]> | undefined;
	/** Reuse the main UI's current Pi-PID-scoped roster instead of re-discovering it. */
	targetSource?: Accessor<SubagentTarget[]> | undefined;
	contextWindowForModel?: (model: string | undefined) => number | undefined;
	selectedTargetKey?: string | undefined;
	selectedRunId?: string | undefined;
	/** True while the subagent view is open: the tree highlights that agent, not Main. */
	inspecting?: boolean | undefined;
	/** Set while an agent is open: Context and Model describe that agent. */
	scope?: SidebarScope | undefined;
	now?: number | undefined;
	onSelectTarget?: ((targetKey: string) => void) | undefined;
	onInspectTarget?: ((targetKey: string) => void) | undefined;
	onShowMain?: (() => void) | undefined;
	onSelectRun?: ((runId: string) => void) | undefined;
	onInspectRun?: ((runId: string) => void) | undefined;
	subagentsAvailable?: boolean | undefined;
	mcpStatus?: Accessor<McpStatusSnapshot | undefined> | undefined;
	mcpCounts?: Accessor<McpStatusCounts | undefined> | undefined;
	mcpConfigured?: Accessor<McpConfiguredSummary | undefined> | undefined;
	backgroundTasks?: BackgroundTask[] | Accessor<BackgroundTask[]>;
	onOpenBackgroundTask?: (id: string) => void;
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
	const backgroundTasks = () =>
		typeof props.backgroundTasks === "function"
			? props.backgroundTasks()
			: (props.backgroundTasks ?? []);
	const notifications = () =>
		typeof props.notifications === "function"
			? props.notifications()
			: (props.notifications ?? []);
	const mcpCounts = () => resolvedMcpCounts(props);
	const mcpConfigured = () => props.mcpConfigured?.();
	const mcpRows = () => (mcpCounts() || mcpConfigured() ? 1 : 0);
	const context = () => props.stats?.contextUsage;
	const contextWindow = () =>
		props.scope
			? props.scope.limit
			: (context()?.contextWindow ?? props.state?.model?.contextWindow);
	const contextUsed = () =>
		props.scope ? props.scope.used : (context()?.tokens ?? undefined);
	const contextPercent = () => {
		if (!props.scope) return context()?.percent ?? undefined;
		const used = props.scope.used;
		const limit = props.scope.limit;
		return used === undefined || !limit ? undefined : (used / limit) * 100;
	};
	const scopeColor = () => (props.scope ? colors.purple : colors.accent);
	const modelText = () => {
		if (props.scope) return props.scope.model ?? "—";
		const model = props.state?.model;
		return model ? `${model.provider}/${model.id}` : "—";
	};
	const thinkingText = () =>
		props.scope ? props.scope.thinking : (props.state?.thinkingLevel ?? undefined);
	const contextLeft = () => {
		const window = contextWindow();
		const used = contextUsed();
		return window === undefined || used === undefined
			? undefined
			: Math.max(0, window - used);
	};
	const meter = () =>
		contextMeterCells(contextPercent(), SIDEBAR_CONTENT_WIDTH);
	// Speed of the latest reply, compared with this model's recorded median.
	// A reply from a previously selected model must not masquerade as the
	// current model's speed.
	// TODO: speed is measured for the main session only; agents have no
	// per-request timings yet, so the scoped view omits the speed rows.
	const speed = createMemo(() =>
		props.scope
			? undefined
			: latestModelSpeed(props.state?.model, props.lastRequestPerformance),
	);
	const speedRows = () =>
		(speed()?.current ? 1 : 0) + (speed()?.median ? 1 : 0);
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
	const selectedKey = () =>
		props.selectedTargetKey ??
		targets().find((target) => target.run.runId === props.selectedRunId)?.key;
	const sidebarHeight = () =>
		Math.max(
			1,
			(typeof props.height === "function" ? props.height() : props.height) ??
				40,
		);
	// The agents tree appears once there are agents to list. An empty panel
	// with a "no subagents" sentence was noise on every plain session.
	const hasSubagents = () =>
		props.subagentsAvailable !== false && targets().length > 0;
	// Context (3) + gap + Model (2) + speed + MCP + gap.
	const fixedHeaderRows = () => 3 + 1 + 2 + speedRows() + mcpRows() + 1;
	// When present, reserve a small bounded panel rather than stealing all
	// rows from agents and notices on shorter terminals.
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
			notifications: hasNotifications(),
		});
	const subagentHeight = () => panelAllocation().subagents;
	// Notices sit at the bottom and take only the rows they fill.
	const notificationHeight = () =>
		Math.min(
			panelAllocation().notifications,
			orderedNotifications().length + 1,
		);

	const treeRows = createMemo(() => subagentTreeRows(targets()));
	const agentSummary = () => spawnGroupSummary(targets());
	const renderTarget = (target: SubagentTarget, prefix = "") => {
		const selected = () =>
			props.inspecting === true && target.key === selectedKey();
		// Under the Main row every agent is indented; nested agents keep the
		// tree's own branch prefix after that indent.
		const lead = `  ${prefix}`;
		const detailLead = " ".repeat(lead.length + 2);
		const rows = () => (target.active ? 2 : 1);
		const usage = () => targetUsageShort(target);
		return (
			<box
				id={`subagent-${target.key}`}
				height={rows()}
				minHeight={rows()}
				flexShrink={0}
				flexDirection="column"
				backgroundColor={selected() ? colors.selection : "transparent"}
				onMouseDown={(event) => {
					event.preventDefault();
					event.stopPropagation();
					props.onSelectTarget?.(target.key);
					props.onSelectRun?.(target.run.runId);
					props.onInspectTarget?.(target.key);
					props.onInspectRun?.(target.run.runId);
				}}
			>
				<box height={1} flexDirection="row">
					<text fg={colors.borderStrong} wrapMode="none" flexShrink={0}>
						{lead}
					</text>
					<text fg={stateColor(target.state)} wrapMode="none" flexShrink={0}>
						{`${stateIcon(target.state)} `}
					</text>
					<text
						fg={selected() ? colors.textBright : colors.text}
						attributes={selected() ? 1 : 0}
						wrapMode="none"
						flexShrink={1}
					>
						{clip(target.label, SIDEBAR_CONTENT_WIDTH - lead.length - 8)}
					</text>
					<box flexGrow={1} minWidth={1} />
					<Show when={target.active && !isResidentTargetState(target.state)}>
						<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
							{/* Run time, as in the agent view header. The status file's
							    age is not a duration; a stale child reads `unresponsive`. */}
							{(() => {
								const ms = subagentElapsedMs(target, now());
								return ms === undefined ? "" : formatDuration(ms);
							})()}
						</text>
					</Show>
				</box>
				<Show when={target.active}>
					<box height={1} flexDirection="row">
						{/* clip() trims, so the indent lives in its own cell. */}
						<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
							{detailLead}
						</text>
						<text fg={colors.subtle} wrapMode="none" flexShrink={1}>
							{clip(
								targetToolActivity(target),
								SIDEBAR_CONTENT_WIDTH - detailLead.length - usage().length - 1,
							)}
						</text>
						<box flexGrow={1} minWidth={1} />
						<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
							{usage()}
						</text>
					</box>
				</Show>
			</box>
		);
	};
	const mainRow = () => (
		<box
			id="subagent-main"
			height={1}
			minHeight={1}
			flexShrink={0}
			flexDirection="row"
			backgroundColor={props.inspecting ? "transparent" : colors.selection}
			onMouseDown={(event) => {
				event.preventDefault();
				event.stopPropagation();
				props.onShowMain?.();
			}}
		>
			<text fg={colors.accent} wrapMode="none">
				{"◆ "}
			</text>
			<text
				fg={props.inspecting ? colors.text : colors.textBright}
				attributes={props.inspecting ? 0 : 1}
				wrapMode="none"
			>
				Main
			</text>
			<box flexGrow={1} />
			<Show when={props.inspecting}>
				<text fg={colors.subtle} wrapMode="none">
					esc
				</text>
			</Show>
		</box>
	);

	return (
		<box
			width={38}
			minWidth={38}
			height="100%"
			flexDirection="column"
			paddingLeft={2}
			paddingRight={1}
		>
			<box height={1} minHeight={1} flexShrink={0} flexDirection="row">
				<text fg={colors.muted} wrapMode="none">
					Context
				</text>
				<box flexGrow={1} minWidth={1} />
				<Show when={props.scope}>
					{(scope) => (
						<text fg={colors.purple} wrapMode="none">
							{`${clip(scope().label, 20)} `}
						</text>
					)}
				</Show>
				<Show when={contextPercent() !== undefined}>
					<text fg={colors.subtle} wrapMode="none">
						{`${Math.round(contextPercent() ?? 0)}%`}
					</text>
				</Show>
			</box>
			<box height={1} minHeight={1} flexShrink={0} flexDirection="row">
				{/* An empty <text> still takes a cell and would shift the track. */}
				<Show when={meter().filled}>
					<text fg={scopeColor()} wrapMode="none">
						{meter().filled}
					</text>
				</Show>
				<text fg={colors.border} wrapMode="none">
					{meter().empty}
				</text>
			</box>
			<SplitRow
				left={
					contextLeft() === undefined
						? "—"
						: `${formatTokens(contextLeft())} left`
				}
				right={
					contextUsed() === undefined && contextWindow() === undefined
						? undefined
						: `${formatTokens(contextUsed())} / ${formatTokens(contextWindow())}`
				}
			/>
			<box height={1} />
			{/* clip() also strips terminal escapes from child-reported text. */}
			<SplitRow
				left="Model"
				leftColor={colors.muted}
				right={thinkingText() ? `THINK ${clip(thinkingText()!.toUpperCase(), 16)}` : undefined}
				rightColor={colors.accent}
			/>
			<text height={1} fg={colors.text} wrapMode="none">
				{clip(modelText(), SIDEBAR_CONTENT_WIDTH)}
			</text>
			<Show when={speed()?.current}>
				{(current) => (
					<SplitRow
						// Both raw numbers stay visible; only the verdict on the
						// right uses the combined speed (see model-speed.ts).
						left={`${Math.round(current().tokensPerSecond)} tok/s · first ${formatLatency(current().ttftMs)}`}
						leftColor={speedVerdictColor(speed()?.verdict)}
						right={(() => {
							const verdict = speed()?.verdict;
							return verdict ? speedVerdictText(verdict) : undefined;
						})()}
						rightColor={speedVerdictColor(speed()?.verdict)}
					/>
				)}
			</Show>
			<Show when={speed()?.median}>
				{(median) => (
					<text height={1} fg={colors.subtle} wrapMode="none">
						{clip(
							`median ${Math.round(median().medianOutputTokensPerSecond)} tok/s · first ${formatLatency(median().medianTtftMs)}`,
							SIDEBAR_CONTENT_WIDTH,
						)}
					</text>
				)}
			</Show>
			<SidebarMcpRow
				mcpStatus={props.mcpStatus}
				mcpCounts={props.mcpCounts}
				mcpConfigured={props.mcpConfigured}
			/>
			<box height={1} />

			<SidebarActivityPanels
				backgroundHeight={backgroundHeight}
				backgroundTasks={backgroundTasks}
				now={now}
				onOpenBackgroundTask={props.onOpenBackgroundTask}
				hasSubagents={hasSubagents}
				subagentHeight={subagentHeight}
				agentSummary={agentSummary}
				mainRow={mainRow}
				treeRows={treeRows}
				renderTarget={renderTarget}
				hasNotifications={hasNotifications}
				notificationHeight={notificationHeight}
				orderedNotifications={orderedNotifications}
				onOpenNotification={props.onOpenNotification}
			/>
		</box>
	);
}
