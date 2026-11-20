/** Transcript virtualization and steering controls for the selected child. */
import type { TextareaRenderable } from "@opentui/core";
import { type Accessor, For, Show } from "solid-js";
import type {
	OwnedSubagentTargets,
	SubagentTarget,
} from "../subagents/targets.ts";
import type { ConversationItem, SubagentRun } from "../types.ts";
import { cleanTerminalText, MessageView } from "./message.tsx";
import type { SubagentInspectorProps } from "./subagent-inspector-types.ts";
import { colors } from "./theme.ts";
export interface InspectorTranscriptPaneProps {
	props: SubagentInspectorProps;
	target: Accessor<SubagentTarget>;
	run: Accessor<SubagentRun>;
	itemNow: (item: ConversationItem) => number | undefined;
	ownedChildren: Accessor<OwnedSubagentTargets>;
}
export function InspectorTranscriptPane({
	props,
	target,
	run,
	itemNow,
	ownedChildren,
}: InspectorTranscriptPaneProps) {
	// The child's first user message is the task its parent gave it; later
	// ones are steers. "you" would misattribute the task.
	const firstUserId = () => props.items.find((item) => item.kind === "user")?.id;
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
				<text fg={colors.subtle} wrapMode="none">
					{[
						"No transcript yet",
						run().toolCount !== undefined ? `${run().toolCount} tools` : "",
						run().turnCount !== undefined ? `${run().turnCount} turns` : "",
					]
						.filter(Boolean)
						.join(" · ")}
				</text>
			</Show>
			<For each={props.items}>
				{(item, index) => (
					<MessageView
						item={item}
						showThinking
						userLabel={
							item.kind === "user" && item.id === firstUserId() ? "task" : "steer"
						}
						compactBelow={
							item.kind === "tool" && props.items[index() + 1]?.kind === "tool"
						}
						subagentTargets={
							item.kind === "tool"
								? (ownedChildren().get(item.id) ?? [])
								: undefined
						}
						onInspectSubagentTarget={props.onInspectSubagentTarget}
						thinkingExpanded={() => props.thinkingExpanded?.(item.id) ?? false}
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
	/** Pause/stop shortcuts for this agent, right-aligned in the prompt box. */
	controlKeys: () => string;
}
export function InspectorSteerPanel({
	props,
	target,
	setSteerEditor,
	getSteerEditor,
	sendSteer,
	controlKeys,
}: InspectorSteerPanelProps) {
	const name = () => cleanTerminalText(target().label);
	return (
		<>
			<Show when={props.pendingSteers && props.pendingSteers.length > 0}>
				<box flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
					<For each={props.pendingSteers}>
						{(entry) => {
							const age = () => props.now - entry.submittedAt;
							return (
								<text fg={colors.yellow} wrapMode="word">
									{age() >= 120_000 ? "◷ still queued  " : "◷ queued  "}
									{entry.text}
								</text>
							);
						}}
					</For>
				</box>
			</Show>
			{/* Same shape as the main prompt box, so steering reads as typing to
			    this agent. A read-only agent keeps the box, dimmed, instead of
			    swapping in a sentence about why steering is hidden. */}
			<Show when={target().canSteer}>
				<box
					flexShrink={0}
					flexDirection="row"
					border
					borderStyle="rounded"
					borderColor={colors.purple}
					paddingLeft={1}
					paddingRight={1}
					minHeight={3}
					maxHeight={9}
				>
					<text fg={colors.purple} wrapMode="none" flexShrink={0}>
						{"› "}
					</text>
					<textarea
						id="subagent-inspector-steer"
						flexGrow={1}
						ref={(value) => {
							setSteerEditor(value);
						}}
						focused
						placeholder={`Steer ${name()}…`}
						wrapMode="word"
						backgroundColor={colors.background}
						focusedBackgroundColor={colors.background}
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
						minHeight={1}
						maxHeight={7}
						onContentChange={() =>
							props.onDraftChange?.(getSteerEditor()?.plainText ?? "")
						}
						onSubmit={sendSteer}
					/>
					<Show when={controlKeys()}>
						<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
							{`  ${controlKeys()}`}
						</text>
					</Show>
				</box>
			</Show>
			<Show when={!target().canSteer}>
				<box
					height={3}
					minHeight={3}
					flexShrink={0}
					flexDirection="row"
					border
					borderStyle="rounded"
					borderColor={colors.border}
					paddingLeft={1}
					paddingRight={1}
				>
					<text fg={colors.border} wrapMode="none" flexShrink={0}>
						{"› "}
					</text>
					<text fg={colors.subtle} wrapMode="none" flexShrink={1}>
						{`${name()} · ${target().active ? "no live session" : "finished"} · read only`}
					</text>
					<box flexGrow={1} />
					<Show when={controlKeys()}>
						<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
							{controlKeys()}
						</text>
					</Show>
				</box>
			</Show>
		</>
	);
}
