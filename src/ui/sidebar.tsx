import { For, Show, createMemo, type Accessor } from "solid-js";
import type {
	RpcSessionState,
	SessionStats,
	SubagentRun,
	ToolItem,
	NotificationRecord,
} from "../types.ts";
import { subagentTargets, type SubagentTarget } from "../subagents/targets.ts";
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
	stateColor,
	stateIcon,
	targetFreshness,
	targetToolActivity,
	targetToolUsage,
} from "./model-context.tsx";
import { appVersion } from "../version.ts";
import {
	formatResetIn,
	formatWindowLabel,
	type CodexUsage,
} from "../integrations/codex-usage.ts";
import type { OpencodeUsage } from "../integrations/opencode-usage.ts";
import {
	formatRunoutIn,
	type UsageStats,
	type UsageWindow,
	type UsageWindows,
} from "../integrations/codex-usage-history.ts";

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

function usageWindowPaceLine(
	stats: UsageStats | undefined,
): string | undefined {
	if (
		stats?.ratePercentPerHour === undefined ||
		stats.rateSpanHours === undefined
	)
		return undefined;
	const perDay = stats.ratePercentPerHour * 24;
	if (Math.abs(perDay) < 0.1) return undefined;
	return `${perDay >= 0 ? "+" : ""}${perDay.toFixed(1)}%/day`;
}

function usageRowCount(
	usage: UsageWindows | undefined,
	stats: Record<number, UsageStats> | undefined,
): number {
	if (!usage?.windows.length) return 0;
	let rows = 2;
	for (const window of usage.windows) {
		rows += 1;
		const windowStats = stats?.[window.windowSeconds];
		if (windowStats?.runsOutBeforeReset || usageWindowPaceLine(windowStats)) rows += 1;
	}
	return rows;
}

type UsageWindowRowsProps = {
	windows: readonly UsageWindow[] | Accessor<readonly UsageWindow[] | undefined>;
	stats:
		| Record<number, UsageStats>
		| Accessor<Record<number, UsageStats> | undefined>
		| undefined;
};

function UsageWindowRows(props: UsageWindowRowsProps) {
	const windows = () =>
		typeof props.windows === "function" ? props.windows() : props.windows;
	const stats = () =>
		typeof props.stats === "function" ? props.stats() : props.stats;
	return (
		<For each={windows() ?? []}>
			{(window) => {
				const windowStats = () => stats()?.[window.windowSeconds];
				const detail = () => {
					const stats = windowStats();
					const parts: string[] = [];
					if (stats?.runsOutBeforeReset && stats.predictedRunoutAt !== undefined)
						parts.push(`⚠ runs out ${formatRunoutIn(stats.predictedRunoutAt)}`);
					const paceText = usageWindowPaceLine(stats);
					if (paceText) parts.push(paceText);
					return parts.length ? `  ${parts.join(" · ")}` : undefined;
				};
				return (
					<>
						<text width="100%" height={1} fg={colors.muted} wrapMode="none">
							{clip(
								`${formatWindowLabel(window.windowSeconds)} ${Math.round(window.usedPercent)}% · resets ${formatResetIn(window.resetAfterSeconds)}`,
							)}
						</text>
						<Show when={detail()}>
							<text
								width="100%"
								height={1}
								fg={windowStats()?.runsOutBeforeReset ? colors.yellow : colors.subtle}
								wrapMode="none"
							>
								{clip(detail()!)}
							</text>
						</Show>
					</>
				);
			}}
		</For>
	);
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

// `targetToolActivity`, `targetFreshness` and `targetToolUsage` live in
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
	notifications?:
		| NotificationRecord[]
		| Accessor<NotificationRecord[]>
		| undefined;
	codexUsage?: CodexUsage | Accessor<CodexUsage | undefined> | undefined;
	codexUsageStats?:
		| Record<number, UsageStats>
		| Accessor<Record<number, UsageStats> | undefined>
		| undefined;
	opencodeUsage?: OpencodeUsage | Accessor<OpencodeUsage | undefined> | undefined;
	opencodeUsageStats?:
		| Record<number, UsageStats>
		| Accessor<Record<number, UsageStats> | undefined>
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
	const codexUsage = () =>
		typeof props.codexUsage === "function"
			? props.codexUsage()
			: props.codexUsage;
	const codexUsageStats = () =>
		typeof props.codexUsageStats === "function"
			? props.codexUsageStats()
			: props.codexUsageStats;
	const opencodeUsage = () =>
		typeof props.opencodeUsage === "function"
			? props.opencodeUsage()
			: props.opencodeUsage;
	const opencodeUsageStats = () =>
		typeof props.opencodeUsageStats === "function"
			? props.opencodeUsageStats()
			: props.opencodeUsageStats;
	const timingHistory = () =>
		typeof props.timingHistory === "function"
			? props.timingHistory()
			: (props.timingHistory ?? []);
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
	const targets = () => subagentTargets(
		runs(),
		tools(),
		props.contextWindowForModel ? { contextWindowForModel: props.contextWindowForModel } : {},
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
	const codexRows = () => usageRowCount(codexUsage(), codexUsageStats());
	const opencodeRows = () => usageRowCount(opencodeUsage(), opencodeUsageStats());
	const fixedHeaderRows = () =>
		11 +
		timingRows() +
		codexRows() +
		opencodeRows() +
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
		// The usage line is empty when there is nothing to report (the state
		// word already appears in the row above); collapse the box instead of
		// leaving a blank third row.
		const usage = targetToolUsage(target);
		const rows = target.active ? (usage ? 3 : 2) : 1;
		return (
			<box
				id={`subagent-${target.key}`}
				height={rows}
				minHeight={rows}
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
							{clip(`${stateIcon(target.state)} ${target.label}`, 31)}
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
						{clip(`${stateIcon(target.state)} ${target.label}`, 31)}
					</text>
					<text width="100%" height={1} fg={colors.text} wrapMode="none">
						{clip(
							`${targetFreshness(target, now())} · ${targetToolActivity(target)}`,
							31,
						)}
					</text>
					<Show when={usage}>
						<text width="100%" height={1} fg={colors.subtle} wrapMode="none">
							{clip(usage, 31)}
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
			<Show when={codexUsage()?.windows.length}>
				<box height={1} />
				<text width="100%" height={1} fg={colors.textBright} attributes={1}>
					Codex
				</text>
				<UsageWindowRows
					windows={() => codexUsage()?.windows}
					stats={codexUsageStats}
				/>
			</Show>
			<Show when={opencodeUsage()?.windows.length}>
				<box height={1} />
				<text width="100%" height={1} fg={colors.textBright} attributes={1}>
					OpenCode Go
				</text>
				<UsageWindowRows
					windows={() => opencodeUsage()?.windows}
					stats={opencodeUsageStats}
				/>
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
