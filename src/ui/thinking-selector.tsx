import type { SelectRenderable, TextRenderable } from "@opentui/core";
import { createEffect, createSignal } from "solid-js";
import type { ThinkingLevel } from "../rpc/pi-rpc-client.ts";
import { colors } from "./theme.ts";

export const THINKING_LEVELS: ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
export function ThinkingSelector(props: {
  current: ThinkingLevel | undefined;
  busy?: boolean;
  error?: string;
  onSelect: (level: ThinkingLevel) => void;
  onCancel: () => void;
}) {
  let select: SelectRenderable | undefined;
  let status: TextRenderable | undefined;
  const [index, setIndex] = createSignal(
    Math.max(0, THINKING_LEVELS.indexOf(props.current ?? "medium")),
  );
  const resolve = (value: unknown): ThinkingLevel | undefined =>
    THINKING_LEVELS.find((level) => level === value);
  createEffect(() => {
    setIndex(Math.max(0, THINKING_LEVELS.indexOf(props.current ?? "medium")));
  });
  createEffect(() => {
    if (select) select.selectedIndex = index();
    if (status)
      status.content = props.busy
        ? "Applying…"
        : (props.error ?? "Enter select · Esc back");
  });
  const choose = (level: ThinkingLevel | undefined) => {
    if (level && !props.busy) {
      setIndex(THINKING_LEVELS.indexOf(level));
      props.onSelect(level);
    }
  };
  return (
    <box
      position="absolute"
      left="25%"
      right="25%"
      top={2}
      bottom={4}
      flexDirection="column"
      backgroundColor={colors.panelRaised}
      border
      borderColor={colors.borderStrong}
      padding={1}
      zIndex={160}
    >
      <box flexDirection="row">
        <text fg={colors.textBright} attributes={1}>Thinking effort</text>
        <box flexGrow={1} />
        <text
          fg={colors.cyan}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onCancel();
          }}
        >← Settings</text>
      </box>
      <text
        ref={(value) => {
          status = value;
        }}
        fg={props.error ? colors.red : colors.subtle}
      >
        Enter select · Esc back
      </text>
      <select
        ref={(value) => {
          select = value;
        }}
        options={THINKING_LEVELS.map((level) => ({
          name: level,
          description: "",
          value: level,
        }))}
        selectedIndex={0}
        focused
        height={12}
        backgroundColor={colors.panelRaised}
        focusedBackgroundColor={colors.panelRaised}
        textColor={colors.text}
        focusedTextColor={colors.textBright}
        selectedBackgroundColor={colors.selection}
        selectedTextColor={colors.textBright}
        onMouseDown={(event) => {
          if (!select) return;
          const level = THINKING_LEVELS[Math.floor((event.y - select.screenY) / 2)];
          if (!level) return;
          event.preventDefault();
          event.stopPropagation();
          choose(level);
        }}
        onSelect={(_i, option) => choose(resolve(option?.value))}
      />
    </box>
  );
}
