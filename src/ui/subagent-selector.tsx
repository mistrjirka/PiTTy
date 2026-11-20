import type { SelectRenderable } from "@opentui/core";
import { createMemo } from "solid-js";
import type { SubagentTarget } from "../subagents/targets.ts";
import { subagentTreeRows } from "../subagents/tree.ts";
import { formatDuration } from "./duration.ts";
import { DialogFrame } from "./dialog-frame.tsx";
import { friendlyTargetState, stateIcon } from "./model-context.tsx";
import { subagentElapsedMs } from "./subagent-format.ts";
import { colors } from "./theme.ts";

/** `working · 49s`: the same state words and glyphs as the sidebar tree. */
function stateText(target: SubagentTarget): string {
  const ms = subagentElapsedMs(target, Date.now());
  const elapsed = ms === undefined ? "" : formatDuration(ms);
  return [friendlyTargetState(target.state), elapsed].filter(Boolean).join(" · ");
}

export function subagentSelectorOptions(targets: readonly SubagentTarget[]) {
  return subagentTreeRows(targets).map((row) => {
    const name = `${row.prefix}${stateIcon(row.target.state)} ${row.target.label}`;
    return {
      // One row per agent: name column, then state.
      name: `${name.padEnd(44)} ${stateText(row.target)}`,
      description: "",
      value: row.target,
    };
  });
}

export function SubagentSelectorDialog(props: {
  targets: SubagentTarget[];
  selectedKey?: string | undefined;
  onSelect: (target: SubagentTarget) => void;
  onCancel: () => void;
}) {
  let select: SelectRenderable | undefined;
  const options = createMemo(() => subagentSelectorOptions(props.targets));
  const selectedIndex = createMemo(() => {
    const index = props.targets.findIndex((target) => target.key === props.selectedKey);
    return index >= 0 ? index : 0;
  });
  const activeCount = createMemo(() => props.targets.filter((target) => target.active).length);

  return (
    <DialogFrame
      title="Agents"
      summary={`${activeCount()} active · ${props.targets.length - activeCount()} finished`}
      hint="↑/↓ move · enter open"
      zIndex={170}
      onClose={props.onCancel}
    >
      <select
        ref={(value) => { select = value; }}
        options={options()}
        selectedIndex={selectedIndex()}
        focused
        height={Math.min(22, Math.max(3, options().length))}
        showDescription={false}
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
    </DialogFrame>
  );
}
