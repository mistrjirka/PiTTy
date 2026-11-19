/** Transcript virtualization and steering controls for the selected child. */
import type { TextareaRenderable } from "@opentui/core";
import { type Accessor, For, Show } from "solid-js";
import type {
	OwnedSubagentTargets,
	SubagentTarget,
} from "../subagents/targets.ts";
import type { ConversationItem, SubagentRun } from "../types.ts";
import { formatDuration } from "./duration.ts";
import { cleanTerminalText, MessageView } from "./message.tsx";
import type { SubagentInspectorProps } from "./subagent-inspector-types.ts";
import { colors } from "./theme.ts";
export interface InspectorTranscriptPaneProps {
	props: SubagentInspectorProps;
	target: Accessor<SubagentTarget>;
	run: Accessor<SubagentRun>;
	currentTool: () => string | undefined;
	toolElapsed: () => number | undefined;
	itemNow: (item: ConversationItem) => number | undefined;
	ownedChildren: Accessor<OwnedSubagentTargets>;
}
export function InspectorTranscriptPane({
	props,
	target,
	run,
	currentTool,
	toolElapsed,
	itemNow,
	ownedChildren,
}: InspectorTranscriptPaneProps) {
	return (
		<scrollbox
			id="subagent-inspector-transcript"
			ref={(value) => props.scrollRef?.(value)}
			flexGrow={1}
			minHeight={1}
			scrollY
			scrollX={false}
			stickyScroll
			// Finished runs pin to the top so the first thinking section is
			// on screen at open; live runs pin to the bottom so the stream
			// stays followed. Declarative (not an imperative scrollTo) because
			// the app's queued scrollTo races this mount and is lost on
			// first open, while the box itself always wins its own race.
			stickyStart={target().active ? "bottom" : "top"}
			viewportCulling={false}
			verticalScrollbarOptions={{ showArrows: false }}
		>
			<Show when={props.items.length === 0}>
				<text fg={colors.muted}>
					No transcript has been written for this subagent yet.
				</text>
				<Show when={props.target?.active}>
					<text fg={colors.cyan} wrapMode="none">
						{cleanTerminalText(
							`⚙${currentTool() ?? "working"}${toolElapsed() !== undefined ? ` ${formatDuration(toolElapsed())}` : ""}`,
						)}
						{run().toolCount !== undefined ? ` · ${run().toolCount} tools` : ""}
						{run().turnCount !== undefined ? ` · ${run().turnCount} turns` : ""}
					</text>
				</Show>
			</Show>
			<For each={props.items}>
				{(item) => (
					<MessageView
						item={item}
						showThinking
						subagentTargets={
							item.kind === "tool"
								? (ownedChildren().get(item.id) ?? [])
								: undefined
						}
						onInspectSubagentTarget={props.onInspectSubagentTarget}
						thinkingExpanded={() => props.thinkingExpanded?.(item.id) ?? true}
						onToggleThinking={() => props.onToggleThinking?.(item.id)}
						toolExpanded={
							item.kind === "tool"
								? (props.toolExpanded?.(item.id) ?? false)
								: false
						}
						{...(props.onToggleTool
							? { onToggleTool: props.onToggleTool }
							: {})}
						diffExpanded={
							item.kind === "tool"
								? (props.diffExpanded?.(item.id) ?? false)
								: false
						}
						{...(props.onToggleDiff
							? { onToggleDiff: props.onToggleDiff }
							: {})}
						{...(() => {
							const now = itemNow(item);
							return now === undefined ? {} : { now };
						})()}
					/>
				)}
			</For>
		</scrollbox>
	);
}
export interface InspectorSteerPanelProps {
	props: SubagentInspectorProps;
	target: Accessor<SubagentTarget>;
	setSteerEditor: (value: TextareaRenderable) => void;
	getSteerEditor: () => TextareaRenderable | undefined;
	sendSteer: () => void;
}
export function InspectorSteerPanel({
	props,
	target,
	setSteerEditor,
	getSteerEditor,
	sendSteer,
}: InspectorSteerPanelProps) {
	return (
		<>
			<Show when={props.pendingSteers && props.pendingSteers.length > 0}>
				<box
					flexShrink={0}
					flexDirection="column"
					paddingLeft={1}
					paddingRight={1}
					paddingTop={1}
				>
					<For each={props.pendingSteers}>
						{(entry) => {
							const age = () => props.now - entry.submittedAt;
							return (
								<text fg={colors.yellow} wrapMode="word">
									{age() >= 120_000
										? "Waiting (over 120s)"
										: "Queued for delivery"}{" "}
									· {entry.text} · Waiting for pi-subagents to pick this up
								</text>
							);
						}}
					</For>
				</box>
			</Show>
			<Show when={target().canSteer}>
				<box
					flexShrink={0}
					border={["top"]}
					borderColor={colors.purple}
					backgroundColor={colors.panel}
					paddingLeft={1}
					paddingRight={1}
					paddingTop={1}
					paddingBottom={1}
					minHeight={4}
					maxHeight={9}
				>
					<textarea
						id="subagent-inspector-steer"
						ref={(value) => {
							setSteerEditor(value);
						}}
						focused
						placeholder={`Steer ${cleanTerminalText(target().label)}…`}
						wrapMode="word"
						backgroundColor={colors.panel}
						focusedBackgroundColor={colors.panel}
						textColor={colors.textBright}
						focusedTextColor={colors.textBright}
						placeholderColor={colors.muted}
						selectionBg={colors.selection}
						keyBindings={[
							{ name: "return", action: "submit" },
							{ name: "enter", action: "submit" },
							{ name: "kpenter", action: "submit" },
							// Terminals lacking the Kitty keyboard protocol send a bare linefeed
							// for Shift+Enter, so treat unmodified linefeed as a newline.
							{ name: "linefeed", action: "newline" },
							{ name: "return", shift: true, action: "newline" },
							{ name: "enter", shift: true, action: "newline" },
							{ name: "kpenter", shift: true, action: "newline" },
							{ name: "linefeed", shift: true, action: "newline" },
						]}
						minHeight={2}
						maxHeight={7}
						onContentChange={() =>
							props.onDraftChange?.(getSteerEditor()?.plainText ?? "")
						}
						onSubmit={sendSteer}
					/>
				</box>
			</Show>
			<Show when={!target().canSteer}>
				<box
					height={3}
					minHeight={3}
					flexShrink={0}
					border={["top"]}
					borderColor={colors.borderStrong}
					paddingTop={1}
					paddingLeft={1}
				>
					<text fg={colors.subtle} wrapMode="none">
						Steering input hidden: this child is finished or has no live
						steerable Pi session.
					</text>
				</box>
			</Show>
		</>
	);
}
