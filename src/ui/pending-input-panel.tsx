import { For, Show } from "solid-js";
import type { LocalQueuedMessage } from "../state/input-continuity.ts";
export type { LocalQueuedMessage } from "../state/input-continuity.ts";
import { colors } from "./theme.ts";

export type PendingInputPanelProps = {
  queuedFollowUps: readonly LocalQueuedMessage[];
  steering: readonly string[];
  followUps: readonly string[];
  onEditQueuedFollowUp: (messageId: string) => void;
};

export function PendingInputPanel(props: PendingInputPanelProps) {
  return (
    <box
      flexDirection="column"
      maxHeight={9}
      minHeight={5}
      flexShrink={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={colors.panelSoft}
      border={["top"]}
      borderColor={colors.borderStrong}
    >
      <text fg={colors.yellow} attributes={1}>Pending input</text>
      <scrollbox
        flexGrow={1}
        height={4}
        minHeight={1}
        maxHeight={4}
        focusable={false}
        scrollY
        scrollX={false}
        viewportCulling={true}
        verticalScrollbarOptions={{ showArrows: false, trackOptions: { foregroundColor: colors.borderStrong, backgroundColor: colors.background } }}
        onMouseScroll={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <For each={props.queuedFollowUps}>{(item, index) => <box flexDirection="row" onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); props.onEditQueuedFollowUp(item.id); }}><text fg={colors.text} selectable wrapMode="word">  {index() + 1}. editable later: {item.text}</text><box flexGrow={1} /><text fg={colors.cyan}>click to edit</text></box>}</For>
        <Show when={props.steering.length || props.followUps.length}><text fg={colors.subtle}>Already sent to Pi</text></Show>
        <For each={props.steering}>{(text) => <text fg={colors.muted} selectable wrapMode="word">  steering: {text}</text>}</For>
        <For each={props.followUps}>{(text) => <text fg={colors.muted} selectable wrapMode="word">  follow-up: {text}</text>}</For>
      </scrollbox>
      <Show when={props.queuedFollowUps.length}><text fg={colors.subtle}>Alt+Up edits the last editable local follow-up.</text></Show>
    </box>
  );
}
