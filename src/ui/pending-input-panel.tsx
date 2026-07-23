import { For, Show } from "solid-js";
import type { LocalQueuedMessage } from "../state/input-continuity.ts";
export type { LocalQueuedMessage } from "../state/input-continuity.ts";
import { colors } from "./theme.ts";

function clip(value: string, width = 72): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= width ? normalized : `${normalized.slice(0, width - 1)}…`;
}

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
      height={9}
      maxHeight={9}
      minHeight={9}
      flexShrink={0}
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
        <For each={props.queuedFollowUps}>{(item, index) => <box height={1} minHeight={1} flexShrink={0} flexDirection="row" onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); props.onEditQueuedFollowUp(item.id); }}><text height={1} fg={colors.text} selectable wrapMode="none">  {index() + 1}. editable later: {clip(item.text)}</text><box flexGrow={1} /><text height={1} fg={colors.cyan} wrapMode="none">click to edit</text></box>}</For>
        <Show when={props.steering.length || props.followUps.length}><text height={1} minHeight={1} flexShrink={0} fg={colors.subtle} wrapMode="none">Already sent to Pi</text></Show>
        <For each={props.steering}>{(text) => <text height={1} minHeight={1} flexShrink={0} fg={colors.muted} selectable wrapMode="none">  steering: {clip(text)}</text>}</For>
        <For each={props.followUps}>{(text) => <text height={1} minHeight={1} flexShrink={0} fg={colors.muted} selectable wrapMode="none">  follow-up: {clip(text)}</text>}</For>
      </scrollbox>
      <Show when={props.queuedFollowUps.length}><text fg={colors.subtle}>Alt+Up edits the last editable local follow-up.</text></Show>
    </box>
  );
}
