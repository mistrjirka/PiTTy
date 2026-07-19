import type {
  SelectRenderable,
  TextareaRenderable,
  TextRenderable,
} from "@opentui/core";
import { createEffect, createSignal } from "solid-js";
import { colors } from "./theme.ts";

export function SessionSettings(props: {
  name: string;
  switchDisabledReason?: string;
  onSwitch: () => void;
  onRename: () => void;
  onCancel: () => void;
}) {
  let select: SelectRenderable | undefined;
  const activate = (index: number) => {
    if (index === 0 && !props.switchDisabledReason) props.onSwitch();
    else if (index === 1) props.onRename();
  };
  return (
    <box
      position="absolute"
      left="20%"
      right="20%"
      top="20%"
      bottom={8}
      flexDirection="column"
      backgroundColor={colors.panelRaised}
      border
      borderColor={colors.borderStrong}
      padding={1}
      zIndex={160}
    >
      <box flexDirection="row">
        <text fg={colors.textBright} attributes={1}>Session</text>
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
      <text fg={colors.subtle}>
        Current: {props.name || "Unnamed"} · Esc back
      </text>
      <select
        ref={(value) => {
          select = value;
        }}
        options={[
          {
            name: "Switch / resume",
            description:
              props.switchDisabledReason ?? "Browse existing sessions",
            value: "switch",
          },
          {
            name: "Rename current session",
            description: "Set the displayed session name",
            value: "rename",
          },
        ]}
        selectedIndex={0}
        focused
        height={6}
        backgroundColor={colors.panelRaised}
        focusedBackgroundColor={colors.panelRaised}
        textColor={colors.text}
        focusedTextColor={colors.textBright}
        selectedBackgroundColor={colors.selection}
        selectedTextColor={colors.textBright}
        descriptionColor={colors.muted}
        selectedDescriptionColor={colors.text}
        onMouseDown={(event) => {
          if (!select) return;
          const index = Math.floor((event.y - select.screenY) / 2);
          event.preventDefault();
          event.stopPropagation();
          activate(index);
        }}
        onSelect={(index) => activate(index)}
      />
    </box>
  );
}

type DynamicText = string | (() => string | undefined);
function readDynamic(value: DynamicText | undefined): string | undefined {
  return typeof value === "function" ? value() : value;
}
export function SessionRename(props: {
  initialName: string;
  busy?: boolean | (() => boolean);
  error?: DynamicText;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  let input: TextareaRenderable | undefined;
  let status: TextRenderable | undefined;
  const [value, setValue] = createSignal(props.initialName);
  const confirm = () => {
    const name = value().trim();
    if (
      name &&
      !(typeof props.busy === "function" ? props.busy() : props.busy === true)
    )
      props.onConfirm(name);
  };
  createEffect(() => {
    const busy =
      typeof props.busy === "function" ? props.busy() : props.busy === true;
    const error = readDynamic(props.error);
    if (
      input &&
      input.plainText !== props.initialName &&
      value() === props.initialName
    )
      input.setText(props.initialName);
    if (status) {
      status.content = busy
        ? "Applying…"
        : (error ??
          (!value().trim()
            ? "Name cannot be empty."
            : "Enter confirm · Esc cancel"));
      status.fg = error ? colors.red : busy ? colors.yellow : !value().trim() ? colors.yellow : colors.subtle;
    }
  });
  return (
    <box
      position="absolute"
      left="20%"
      right="20%"
      top="25%"
      bottom={10}
      flexDirection="column"
      backgroundColor={colors.panelRaised}
      border
      borderColor={colors.borderStrong}
      padding={1}
      zIndex={170}
    >
      <box flexDirection="row">
        <text fg={colors.textBright} attributes={1}>Rename session</text>
        <box flexGrow={1} />
        <text
          fg={colors.cyan}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onCancel();
          }}
        >← Session</text>
      </box>
      <textarea
        id="settings-session-rename"
        ref={(element) => {
          input = element;
          input.setText(props.initialName);
        }}
        focused
        height={1}
        minHeight={1}
        maxHeight={1}
        textColor={colors.textBright}
        backgroundColor={colors.panel}
        placeholder="Session name"
        onKeyDown={(event) => {
          if (event.name === "enter" || event.name === "return") {
            event.preventDefault();
            event.stopPropagation();
            confirm();
          }
        }}
        onContentChange={() => setValue(input?.plainText ?? "")}
      />
      <text
        ref={(element) => {
          status = element;
        }}
        fg={colors.subtle}
      />
    </box>
  );
}
