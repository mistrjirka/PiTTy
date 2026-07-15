import type { SelectRenderable } from "@opentui/core";
import { createMemo } from "solid-js";
import { colors } from "./theme.ts";

export type PromptMapEntry = {
  id: string;
  text: string;
  timestamp: number;
};

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function label(value: string, max = 120): string {
  const text = oneLine(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function PromptMapDialog(props: {
  entries: PromptMapEntry[];
  onSelect: (entry: PromptMapEntry) => void;
  onCancel: () => void;
}) {
  let select: SelectRenderable | undefined;
  const options = createMemo(() => props.entries.map((entry, index) => ({
    name: `${String(index + 1).padStart(2, "0")}  ${label(entry.text)}`,
    description: new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    value: entry,
  })));

  return (
    <box
      position="absolute"
      left="8%"
      right="8%"
      top="7%"
      maxHeight="86%"
      flexDirection="column"
      backgroundColor={colors.panelRaised}
      border
      borderColor={colors.borderStrong}
      padding={1}
      zIndex={150}
    >
      <box flexDirection="row">
        <text fg={colors.textBright} attributes={1}>Your requests</text>
        <text fg={colors.subtle}>  {props.entries.length}</text>
        <box flexGrow={1} />
        <text
          fg={colors.muted}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onCancel();
          }}
        >× Close</text>
      </box>
      <text fg={colors.subtle}>↑/↓ move · Enter jump · Esc close</text>
      <select
        ref={(value) => { select = value; }}
        options={options()}
        selectedIndex={Math.max(0, options().length - 1)}
        focused
        height={Math.min(24, Math.max(5, options().length))}
        backgroundColor={colors.panelRaised}
        focusedBackgroundColor={colors.panelRaised}
        textColor={colors.text}
        focusedTextColor={colors.text}
        selectedBackgroundColor={colors.selection}
        selectedTextColor={colors.textBright}
        descriptionColor={colors.subtle}
        selectedDescriptionColor={colors.text}
        showScrollIndicator
        wrapSelection
        onSelect={(_index, option) => {
          const entry = option?.value as PromptMapEntry | undefined;
          if (entry) props.onSelect(entry);
        }}
      />
    </box>
  );
}
