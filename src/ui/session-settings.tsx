import type {
  SelectRenderable,
  TextareaRenderable,
  TextRenderable,
} from "@opentui/core";
import { createEffect, createSignal } from "solid-js";
import { DialogFrame } from "./dialog-frame.tsx";
import { selectOptionIndexAtMouse } from "./select-mouse.ts";
import { settingsRowText } from "./settings-hub.tsx";
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
    <DialogFrame
      title="Session"
      summary={props.name || "Unnamed"}
      width="narrow"
      closeLabel="esc ‹ settings"
      zIndex={160}
      onClose={props.onCancel}
    >
      <select
        ref={(value) => {
          select = value;
        }}
        options={[
          {
            name: settingsRowText(
              "Switch / resume",
              props.switchDisabledReason ?? "Browse sessions",
            ),
            description: "",
            value: "switch",
          },
          {
            name: settingsRowText("Rename", props.name || "Unnamed"),
            description: "",
            value: "rename",
          },
        ]}
        selectedIndex={0}
        focused
        showDescription={false}
        height={3}
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
          const index = selectOptionIndexAtMouse(select, event.y);
          if (index === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          activate(index);
        }}
        onSelect={(index) => activate(index)}
      />
    </DialogFrame>
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
            : "enter save"));
      status.fg = error ? colors.red : busy ? colors.yellow : !value().trim() ? colors.yellow : colors.subtle;
    }
  });
  return (
    <DialogFrame
      title="Rename session"
      width="narrow"
      closeLabel="esc ‹ session"
      zIndex={170}
      onClose={props.onCancel}
    >
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
    </DialogFrame>
  );
}
