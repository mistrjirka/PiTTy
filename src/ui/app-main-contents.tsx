import type { QueuedInputActions } from "../tabs/queued-input-actions.ts";
import { AppPromptDock } from "./app-prompt-dock.tsx";
/** Main terminal layout. App still owns the live session and RPC state. */
import type {
	ScrollBoxRenderable,
	TextareaRenderable,
	KeyEvent,
	MouseEvent,
	PasteEvent,
} from "@opentui/core";
import { Show, type Accessor, type Setter, type JSX } from "solid-js";
import type { TabManagerState } from "../tabs/manager.ts";
import type { ConversationTabRuntime } from "../tabs/runtime.ts";
import type { StartupPhase } from "../state/startup.ts";
import type { SessionChoice, SessionDiscoveryState } from "../sessions.ts";
import type {
	SessionDrafts,
	PendingSteerEntry,
	LocalQueuedMessage,
} from "../state/input-continuity.ts";
import type {
	ConversationItem,
	SubagentRun,
	ToolItem,
	Toast,
	NotificationRecord,
	RpcExtensionUIRequest,
	RpcSessionState,
	SessionStats,
} from "../types.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { SpawnGroup } from "./spawn-group.tsx";
import type {
	CompactionTelemetry,
	OneRoundProgress,
	OneRoundLaneTexts,
} from "../state/compaction-telemetry.ts";
import type { BackgroundTask } from "../state/background-tasks.ts";
import type { RequestPerformance } from "../tabs/request-metrics.ts";
import type { RequestTiming } from "../tabs/request-timing.ts";
import type { McpConfiguredSummary } from "../config/mcp-config.ts";
import type {
	McpStatusSnapshot,
	McpStatusCounts,
} from "../state/mcp-status.ts";
import type { TodoViewItem } from "./todos.tsx";
import type { CommandChoice } from "./command-suggestions.tsx";
import type { UsageFooterSegment } from "./usage-footer.ts";
import { colors } from "./theme.ts";
import { spinnerFrames } from "./spinner.ts";
import {
	inspectedTargetScrollY,
	SubagentInspector,
} from "./subagent-inspector.tsx";
import { TabStrip } from "./tab-strip.tsx";
import { TranscriptPane } from "./transcript-pane.tsx";
import { PromptComposer } from "./prompt-composer.tsx";
import { Sidebar } from "./sidebar.tsx";
import { AppFooter, ToastOverlay } from "./app-footer.tsx";

export interface AppMainContentsProps {
	tabState: Accessor<TabManagerState>;
	activateTab: (id: string) => void;
	closeTab: (id: string) => void;
	createTab: (sessionFile?: string) => string | undefined;
	openForkPicker: () => Promise<void>;
	inspectSubagent: () => boolean;
	selectedSubagentTarget: Accessor<SubagentTarget | undefined>;
	inspectedTarget: Accessor<SubagentTarget | undefined>;
	inspectedTranscript: Accessor<ConversationItem[]>;
	clockNow: Accessor<number>;
	spinnerIndex: Accessor<number>;
	setSubagentScroll: (value: ScrollBoxRenderable) => void;
	getSubagentScroll: () => ScrollBoxRenderable | undefined;
	setScroll: (value: ScrollBoxRenderable) => void;
	closeSubagentInspector: () => void;
	requestPauseSubagent: () => void;
	requestResumeSubagent: () => void;
	requestStopSubagent: () => void;
	setSubagentSelectorOpen: Setter<boolean>;
	displaySubagentTargets: Accessor<SubagentTarget[]>;
	availableSubagentTargets: Accessor<SubagentTarget[]>;
	inspectSubagentTarget: (targetKey: string) => void;
	currentDrafts: () => SessionDrafts;
	touch: () => void;
	sendSubagentSteer: (message: string) => void;
	pendingSteers: Accessor<PendingSteerEntry[]>;
	thinkingIsExpanded: (id: string) => boolean;
	toggleThinkingItem: (id: string) => void;
	toolExpanded: (id: string) => boolean;
	toggleTool: (id: string) => void;
	diffExpanded: (id: string) => boolean;
	toggleDiff: (id: string) => void;
	updateScrollPosition: () => void;
	focusMainPrompt: () => void;
	startupPhase: Accessor<StartupPhase>;
	startupStartedAt: number;
	items: () => ConversationItem[];
	sessionDiscovery: Accessor<SessionDiscoveryState>;
	dimensions: Accessor<{ width: number; height: number }>;
	activeRuntime: () => ConversationTabRuntime;
	setSessionSelectorOpen: Setter<boolean>;
	switchToSession: (choice: SessionChoice) => Promise<void>;
	hiddenMessageCount: Accessor<number>;
	loadOlderMessages: () => void;
	visibleMessageIds: Accessor<string[]>;
	spawnGroupMemberIds: Accessor<Set<string>>;
	spawnGroupByFirstId: Accessor<Map<string, SpawnGroup>>;
	visibleItems: Accessor<ConversationItem[]>;
	renderItemEntry: (id: string) => JSX.Element | null;
	compactionView: Accessor<{
		telemetry: CompactionTelemetry | undefined;
		smartCompactProgress: string | undefined;
		oneRoundProgress: OneRoundProgress | undefined;
		laneTexts: OneRoundLaneTexts | undefined;
	}>;
	compactionExpanded: Accessor<boolean>;
	setCompactionExpanded: Setter<boolean>;
	backgroundTasks: () => BackgroundTask[];
	openBackgroundTask: (id: string) => void;
	showWorkingIndicator: Accessor<boolean>;
	showJumpLatest: Accessor<boolean>;
	scrollToBottom: () => void;
	queuedFollowUps: () => LocalQueuedMessage[];
	steeringQueue: Accessor<string[]>;
	followUpQueue: Accessor<string[]>;
	editQueuedFollowUp: (id: string) => void;
	pendingInput?: QueuedInputActions | undefined;
	commandSuggestions: Accessor<CommandChoice[]>;
	commandSuggestionIndex: Accessor<number>;
	insertSuggestedCommand: (choice: CommandChoice) => void;
	streaming: Accessor<boolean>;
	dialog: Accessor<RpcExtensionUIRequest | undefined>;
	backgroundSelection: Accessor<
		{ runtimeId: string; sessionId: string; id: string } | undefined
	>;
	modelSelectorOpen: Accessor<boolean>;
	sessionSelectorOpen: Accessor<boolean>;
	forkPickerOpen: Accessor<boolean>;
	promptMapOpen: Accessor<boolean>;
	subagentSelectorOpen: Accessor<boolean>;
	notificationDetailId: Accessor<string | undefined>;
	todoDetailId: Accessor<string | undefined>;
	promptValue: () => string;
	onPromptEditor: (value: TextareaRenderable) => void;
	handlePromptPaste: (event: PasteEvent) => void;
	handlePromptKeyDown: (event: KeyEvent) => void;
	onPromptMouseDown: (event: MouseEvent) => void;
	onPromptContentChange: () => void;
	onPromptCursorChange: () => void;
	submit: () => Promise<void>;
	visibleSidebar: Accessor<boolean>;
	sessionState: () => RpcSessionState | undefined;
	sessionStats: () => SessionStats | undefined;
	lastRequestPerformance: () => RequestPerformance | undefined;
	requestTimingHistory: () => RequestTiming[];
	runs: () => SubagentRun[];
	subagentTools: Accessor<ToolItem[]>;
	contextWindowForModel: (model: string | undefined) => number | undefined;
	selectedTargetKey: () => string | undefined;
	setSelectedTargetKey: (id: string | undefined) => void;
	todos: Accessor<TodoViewItem[]>;
	openTodo: (id: string) => void;
	subagentsAvailable: Accessor<boolean>;
	todosAvailable: Accessor<boolean>;
	mcpStatus: () => McpStatusSnapshot | undefined;
	mcpCounts: () => McpStatusCounts | undefined;
	mcpConfiguredSummary: () => McpConfiguredSummary | undefined;
	notificationHistory: Accessor<NotificationRecord[]>;
	openNotification: (id: string) => void;
	setInspectSubagent: (value: boolean) => void;
	footerStatusText: () => string;
	footerUsageSegments: () => UsageFooterSegment[];
	footerHintText: () => string;
	toasts: Accessor<Toast[]>;
}
export function AppMainContents(props: AppMainContentsProps) {
	return (
		<box
			width="100%"
			height="100%"
			flexDirection="column"
			backgroundColor={colors.background}
		>
			<TabStrip
				tabs={props.tabState().tabs}
				activeId={props.tabState().activeId}
				onActivate={props.activateTab}
				onClose={props.closeTab}
				onCreate={props.createTab}
				onOpenForkPicker={() => void props.openForkPicker()}
			/>
			<box flexGrow={1} minHeight={1} flexDirection="row">
				<box flexGrow={1} minWidth={0} flexDirection="column">
					<Show
						when={
							props.inspectSubagent()
								? props.selectedSubagentTarget()
								: undefined
						}
						fallback={null}
					>
						{(target) => (
							<SubagentInspector
								target={props.inspectedTarget()}
								items={props.inspectedTranscript()}
								now={props.clockNow()}
								spinner={spinnerFrames[props.spinnerIndex()] ?? "◐"}
								scrollRef={(value) => {
									props.setSubagentScroll(value);
								}}
								onClose={props.closeSubagentInspector}
								onPause={props.requestPauseSubagent}
								onResume={props.requestResumeSubagent}
								onStop={props.requestStopSubagent}
								onChooseTarget={() => props.setSubagentSelectorOpen(true)}
								targetCount={props.displaySubagentTargets().length}
								allTargets={props.availableSubagentTargets()}
								onInspectSubagentTarget={props.inspectSubagentTarget}
								draft={() =>
									props
										.currentDrafts()
										.subagents.get(props.inspectedTarget()!.key) ?? ""
								}
								onDraftChange={(text) => {
									props
										.currentDrafts()
										.subagents.set(props.inspectedTarget()!.key, text);
									props.touch();
								}}
								onSteer={props.sendSubagentSteer}
								pendingSteers={props
									.pendingSteers()
									.filter(
										(entry) => entry.targetKey === props.inspectedTarget()!.key,
									)}
								thinkingExpanded={props.thinkingIsExpanded}
								onToggleThinking={props.toggleThinkingItem}
								toolExpanded={props.toolExpanded}
								onToggleTool={props.toggleTool}
								diffExpanded={props.diffExpanded}
								onToggleDiff={props.toggleDiff}
							/>
						)}
					</Show>
					<Show when={!props.inspectSubagent()}>
						<TranscriptPane
							scrollRef={(value) => {
								props.setScroll(value);
							}}
							onScroll={() => queueMicrotask(props.updateScrollPosition)}
							onFocusPrompt={props.focusMainPrompt}
							startupPhase={props.startupPhase}
							startupStartedAt={props.startupStartedAt}
							now={props.clockNow}
							frame={props.spinnerIndex}
							itemCount={() => props.items().length}
							sessionDiscovery={props.sessionDiscovery}
							width={() => props.dimensions().width}
							height={() => props.dimensions().height}
							onSelectSession={(choice) => {
								if (props.activeRuntime().conversation.isStreaming)
									props.setSessionSelectorOpen(true);
								void props.switchToSession(choice);
							}}
							hiddenCount={props.hiddenMessageCount}
							loadOlder={props.loadOlderMessages}
							visibleMessageIds={props.visibleMessageIds}
							spawnGroupMemberIds={props.spawnGroupMemberIds}
							spawnGroupByFirstId={props.spawnGroupByFirstId}
							visibleItems={props.visibleItems}
							toolExpanded={props.toolExpanded}
							toggleTool={props.toggleTool}
							inspectTarget={props.inspectSubagentTarget}
							renderItem={props.renderItemEntry}
							compactionView={props.compactionView}
							compactionExpanded={props.compactionExpanded}
							onToggleCompaction={() =>
								props.setCompactionExpanded((value) => !value)
							}
							backgroundTasks={props.backgroundTasks}
							openBackgroundTask={props.openBackgroundTask}
							showWorkingIndicator={props.showWorkingIndicator}
						/>
					</Show>
					{/* Keep a fixed one-row slot so showing/hiding the jump control does
              not resize the transcript and leave stale terminal cells. */}
					<box
						height={1}
						minHeight={1}
						flexDirection="row"
						justifyContent="flex-end"
						paddingRight={2}
					>
						<Show when={props.showJumpLatest() && !props.inspectSubagent()}>
							<text
								fg={colors.cyan}
								attributes={1}
								onMouseDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									props.scrollToBottom();
								}}
							>
								↓ Latest message
							</text>
						</Show>
					</box>
					<AppPromptDock
						viewportRows={() => props.dimensions().height}
						enabled={() => !props.inspectSubagent()}
						queuedFollowUps={props.queuedFollowUps}
						steeringQueue={props.steeringQueue}
						followUpQueue={props.followUpQueue}
						editQueuedFollowUp={props.editQueuedFollowUp}
						pendingInput={props.pendingInput}
						commandSuggestions={props.commandSuggestions}
						commandSuggestionIndex={props.commandSuggestionIndex}
						insertSuggestedCommand={props.insertSuggestedCommand}
					>
						<Show when={!props.inspectSubagent()}>
							<PromptComposer
								streaming={props.streaming}
								focused={() =>
									props.startupPhase().kind === "ready" &&
									!props.dialog() &&
									!props.backgroundSelection() &&
									!props.modelSelectorOpen() &&
									!props.sessionSelectorOpen() &&
									!props.forkPickerOpen() &&
									!props.promptMapOpen() &&
									!props.subagentSelectorOpen() &&
									!props.notificationDetailId() &&
									!props.todoDetailId()
								}
								placeholder={() =>
									props.promptValue().length > 0
										? null
										: props.streaming()
											? "Enter queues the next step · Alt+Enter queues a follow-up · Alt+Up edits pending"
											: "Ask Pi anything… (/help for commands)"
								}
								onEditor={props.onPromptEditor}
								onPaste={props.handlePromptPaste}
								onKeyDown={props.handlePromptKeyDown}
								onMouseDown={props.onPromptMouseDown}
								onContentChange={props.onPromptContentChange}
								onCursorChange={props.onPromptCursorChange}
								onSubmit={() => void props.submit()}
							/>
						</Show>
					</AppPromptDock>
				</box>
				<Show when={props.visibleSidebar()}>
					<Sidebar
						state={props.sessionState()}
						stats={props.sessionStats()}
						lastRequestPerformance={props.lastRequestPerformance()}
						timingHistory={props.requestTimingHistory()}
						runs={props.runs}
						tools={props.subagentTools}
						targetSource={props.availableSubagentTargets}
						contextWindowForModel={props.contextWindowForModel}
						selectedTargetKey={props.selectedTargetKey()}
						now={props.clockNow()}
						onSelectTarget={props.setSelectedTargetKey}
						todos={props.todos}
						onOpenTodo={(todo) => props.openTodo(todo.id)}
						subagentsAvailable={props.subagentsAvailable()}
						todosAvailable={props.todosAvailable()}
						mcpStatus={props.mcpStatus}
						mcpCounts={props.mcpCounts}
						mcpConfigured={props.mcpConfiguredSummary}
						notifications={props.notificationHistory}
						backgroundTasks={props.backgroundTasks}
						onOpenBackgroundTask={props.openBackgroundTask}
						onOpenNotification={props.openNotification}
						height={() => props.dimensions().height - 1}
						onInspectTarget={(targetKey) => {
							props.setSelectedTargetKey(targetKey);
							props.setInspectSubagent(true);
							const target = props
								.availableSubagentTargets()
								.find((entry) => entry.key === targetKey);
							queueMicrotask(() =>
								props
									.getSubagentScroll()
									?.scrollTo(inspectedTargetScrollY(target)),
							);
						}}
					/>
				</Show>
			</box>
			<AppFooter
				streaming={props.streaming}
				statusText={props.footerStatusText}
				segments={props.footerUsageSegments}
				hintText={props.footerHintText}
			/>
			<ToastOverlay entries={props.toasts} />
		</box>
	);
}
