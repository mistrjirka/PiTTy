/** Display-only transcript window. Session changes and message state stay in App. */
import type { ScrollBoxRenderable } from "@opentui/core";
import { For, Show, type Accessor, type JSX } from "solid-js";
import type { ConversationItem } from "../types.ts";
import type { StartupPhase } from "../state/startup.ts";
import type { SessionChoice, SessionDiscoveryState } from "../sessions.ts";
import type {
	CompactionTelemetry,
	OneRoundProgress,
	OneRoundLaneTexts,
} from "../state/compaction-telemetry.ts";
import type { BackgroundTask } from "../state/background-tasks.ts";
import { CompactionPanel } from "./compaction-panel.tsx";
import { EmptyDashboard } from "./empty-dashboard.tsx";
import { StartupPanel } from "./startup-panel.tsx";
import { SpawnGroupCard, type SpawnGroup } from "./spawn-group.tsx";
import { spinnerFrames } from "./spinner.ts";
import { colors } from "./theme.ts";

export type TranscriptPaneProps = {
	scrollRef: (scroll: ScrollBoxRenderable) => void;
	onScroll: () => void;
	onFocusPrompt: () => void;
	startupPhase: Accessor<StartupPhase>;
	startupStartedAt: number;
	now: Accessor<number>;
	frame: Accessor<number>;
	itemCount: () => number;
	sessionDiscovery: Accessor<SessionDiscoveryState>;
	width: () => number;
	height: () => number;
	onSelectSession: (choice: SessionChoice) => void;
	hiddenCount: Accessor<number>;
	loadOlder: () => void;
	visibleMessageIds: Accessor<string[]>;
	spawnGroupMemberIds: Accessor<Set<string>>;
	spawnGroupByFirstId: Accessor<Map<string, SpawnGroup>>;
	visibleItems: Accessor<ConversationItem[]>;
	toolExpanded: (id: string) => boolean;
	toggleTool: (id: string) => void;
	inspectTarget: (id: string) => void;
	renderItem: (id: string) => JSX.Element;
	compactionView: Accessor<{
		telemetry: CompactionTelemetry | undefined;
		smartCompactProgress: string | undefined;
		oneRoundProgress: OneRoundProgress | undefined;
		laneTexts: OneRoundLaneTexts | undefined;
	}>;
	compactionExpanded: Accessor<boolean>;
	onToggleCompaction: () => void;
	backgroundTasks: () => readonly BackgroundTask[];
	openBackgroundTask: (id: string) => void;
	showWorkingIndicator: Accessor<boolean>;
};

export function TranscriptPane(props: TranscriptPaneProps) {
	return (
		<scrollbox
			ref={props.scrollRef}
			flexGrow={1}
			minHeight={1}
			scrollY
			scrollX={false}
			stickyScroll
			stickyStart="bottom"
			viewportCulling
			paddingLeft={2}
			paddingRight={2}
			verticalScrollbarOptions={{
				showArrows: false,
				trackOptions: {
					foregroundColor: colors.borderStrong,
					backgroundColor: colors.background,
				},
			}}
			onMouseScroll={props.onScroll}
			onMouseDown={props.onFocusPrompt}
		>
			<Show when={props.startupPhase().kind !== "ready"}>
				<StartupPanel
					phase={props.startupPhase()}
					elapsedMs={props.now() - props.startupStartedAt}
					spinner={spinnerFrames[props.frame()] ?? "◐"}
				/>
			</Show>
			<Show
				when={props.startupPhase().kind === "ready" && props.itemCount() === 0}
			>
				<EmptyDashboard
					sessionState={props.sessionDiscovery()}
					width={props.width()}
					height={props.height()}
					onSelectSession={(choice) => {
						props.onSelectSession(choice);
					}}
				/>
			</Show>
			<Show when={props.hiddenCount() > 0}>
				<box
					id="load-older-messages"
					height={2}
					minHeight={2}
					flexShrink={0}
					justifyContent="center"
					alignItems="center"
					marginBottom={1}
					backgroundColor={colors.panelSoft}
					border={["bottom"]}
					borderColor={colors.borderStrong}
					onMouseDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
						props.loadOlder();
					}}
				>
					<text fg={colors.cyan} attributes={1} wrapMode="none">
						↑ Load older messages · {props.hiddenCount()} hidden
					</text>
				</box>
			</Show>
			<For each={props.visibleMessageIds()}>
				{(itemId) => {
					// Non-first group members render inside their group card.
					if (props.spawnGroupMemberIds().has(itemId)) return null;
					const group = props.spawnGroupByFirstId().get(itemId);
					if (group) {
						const memberTools = group.memberIds.map((memberId) =>
							props
								.visibleItems()
								.find((candidate) => candidate.id === memberId),
						);
						const live = memberTools.some(
							(member) =>
								member?.kind === "tool" &&
								(member.status === "streaming" || member.status === "pending"),
						);
						return (
							<SpawnGroupCard
								group={group}
								expanded={props.toolExpanded(group.id)}
								now={
									live || group.targets.some((target) => target.active)
										? props.now()
										: Math.max(
												0,
												...memberTools.map((member) =>
													member?.kind === "tool"
														? (member.endedAt ??
															member.startedAt ??
															member.timestamp ??
															0)
														: 0,
												),
											)
								}
								onToggle={props.toggleTool}
								onInspectSubagentTarget={props.inspectTarget}
								renderMember={(memberId) => props.renderItem(memberId)}
							/>
						);
					}
					return props.renderItem(itemId);
				}}
			</For>
			<Show when={props.compactionView().telemetry?.phase === "preparing"}>
				<CompactionPanel
					telemetry={props.compactionView().telemetry!}
					now={props.now()}
					spinner={spinnerFrames[props.frame()] ?? "◐"}
					frame={props.frame()}
					smartCompactProgress={props.compactionView().smartCompactProgress}
					oneRoundProgress={props.compactionView().oneRoundProgress}
					laneTexts={props.compactionView().laneTexts}
					expanded={props.compactionExpanded}
					viewportHeight={props.height()}
					backgroundTasks={props.backgroundTasks}
					onOpenBackgroundTask={props.openBackgroundTask}
					onToggle={props.onToggleCompaction}
				/>
			</Show>
			<Show when={props.showWorkingIndicator()}>
				<box
					paddingLeft={1}
					paddingTop={1}
					paddingBottom={1}
					marginBottom={1}
					border={["left"]}
					borderColor={colors.green}
				>
					<text fg={colors.green} attributes={1}>
						{spinnerFrames[props.frame()] ?? "◐"} Working…
					</text>
				</box>
			</Show>
		</scrollbox>
	);
}
