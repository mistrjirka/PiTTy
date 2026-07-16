import type { SelectRenderable } from "@opentui/core";
import { createMemo } from "solid-js";
import type { SubagentTarget } from "../subagents/targets.ts";
import { formatDuration } from "./duration.ts";
import { colors } from "./theme.ts";

function description(target: SubagentTarget): string {
  const elapsed = target.startedAt ? formatDuration((target.run.endedAt ?? Date.now()) - target.startedAt) : "";
  const group = target.active ? "ACTIVE" : "FINISHED";
  return [group, target.state, target.run.mode, elapsed].filter(Boolean).join(" · ");
}

export function SubagentSelectorDialog(props: {
  targets: SubagentTarget[];
  selectedKey?: string | undefined;
  onSelect: (target: SubagentTarget) => void;
  onCancel: () => void;
}) {
  let select: SelectRenderable | undefined;
  const options = createMemo(() => props.targets.map((target) => ({
    name: `${target.active ? "●" : "○"} ${target.label}`,
    description: description(target),
    value: target,
  })));
  const selectedIndex = createMemo(() => {
    const index = props.targets.findIndex((target) => target.key === props.selectedKey);
    return index >= 0 ? index : 0;
  });
  const activeCount = createMemo(() => props.targets.filter((target) => target.active).length);

  return (
    <box
      position="absolute"
      left="14%"
      right="14%"
      top="10%"
      maxHeight="80%"
      flexDirection="column"
      backgroundColor={colors.panelRaised}
      border
      borderColor={colors.borderStrong}
      padding={1}
      zIndex={170}
    >
      <box flexDirection="row">
        <text fg={colors.textBright} attributes={1}>Select subagent</text>
        <box flexGrow={1} />
        <text fg={colors.muted}>{activeCount()} active · {props.targets.length - activeCount()} finished</text>
        <text
          fg={colors.cyan}
          marginLeft={2}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onCancel();
          }}
        >× Close</text>
      </box>
      <text fg={colors.subtle}>Active first · stable within group · ↑/↓ move · Enter select · Esc close</text>
      <select
        ref={(value) => { select = value; }}
        options={options()}
        selectedIndex={selectedIndex()}
        focused
        height={Math.min(22, Math.max(5, options().length))}
        backgroundColor={colors.panelRaised}
        focusedBackgroundColor={colors.panelRaised}
        textColor={colors.text}
        focusedTextColor={colors.text}
        selectedBackgroundColor={colors.selection}
        selectedTextColor={colors.textBright}
        descriptionColor={colors.muted}
        selectedDescriptionColor={colors.text}
        showScrollIndicator
        wrapSelection
        onSelect={(_index, option) => {
          const target = option?.value as SubagentTarget | undefined;
          if (target) props.onSelect(target);
        }}
      />
    </box>
  );
}
