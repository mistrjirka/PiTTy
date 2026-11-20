import type { SelectRenderable, TextRenderable } from "@opentui/core";
import { createEffect, createMemo } from "solid-js";
import { DialogFrame } from "./dialog-frame.tsx";
import { selectOptionIndexAtMouse } from "./select-mouse.ts";
import { colors } from "./theme.ts";

export type SettingsSectionDescriptor = {
  id: string;
  label: string;
  summary: () => string;
  disabledReason: () => string | undefined;
  busy: () => boolean;
  inlineError: () => string | undefined;
  open: () => void;
};
export type SettingsHubProps = {
  descriptors: () => SettingsSectionDescriptor[];
  selectedId: () => string;
  onSelected: (id: string) => void;
  onClose: () => void;
};

export function SettingsHub(props: SettingsHubProps) {
  let select: SelectRenderable | undefined;
  let errorText: TextRenderable | undefined;
  const rows = createMemo(() => props.descriptors());
  const selectedIndex = () =>
    Math.max(
      0,
      rows().findIndex((row) => row.id === props.selectedId()),
    );
  const activate = (row: SettingsSectionDescriptor | undefined) => {
    if (!row || row.disabledReason() || row.busy()) return;
    row.open();
  };
  createEffect(() => {
    const current = rows();
    if (select) {
      // One row per setting: label column, then its current value.
      select.options = current.map((row) => ({
        name: settingsRowText(
          row.label,
          row.busy() ? "Applying…" : (row.disabledReason() ?? row.summary()),
        ),
        description: "",
        value: row.id,
      }));
      select.selectedIndex = selectedIndex();
    }
    const errors = current.flatMap((row) => {
      const error = row.inlineError();
      return error ? [`${row.label}: ${error}`] : [];
    });
    if (errorText) errorText.content = errors.join("  ");
  });
  return (
    <DialogFrame title="Settings" hint="↑/↓ choose · enter open" onClose={props.onClose}>
      <select
        ref={(value) => {
          select = value;
        }}
        id="settings-sections"
        options={[]}
        selectedIndex={0}
        focused
        showDescription={false}
        height={Math.min(14, Math.max(3, rows().length))}
        backgroundColor={colors.panelRaised}
        focusedBackgroundColor={colors.panelRaised}
        textColor={colors.text}
        focusedTextColor={colors.textBright}
        selectedBackgroundColor={colors.selection}
        selectedTextColor={colors.textBright}
        onMouseDown={(event) => {
          if (!select) return;
          const index = selectOptionIndexAtMouse(select, event.y);
          const row = index === undefined ? undefined : rows()[index];
          if (!row) return;
          event.preventDefault();
          event.stopPropagation();
          props.onSelected(row.id);
          activate(row);
        }}
        onSelect={(_index, option) => {
          const id =
            typeof option?.value === "string" ? option.value : undefined;
          props.onSelected(id ?? "");
          activate(rows().find((row) => row.id === id));
        }}
      />
      <text
        ref={(value) => {
          errorText = value;
        }}
        fg={colors.red}
      />
    </DialogFrame>
  );
}

/** `Label` padded to a fixed column so values line up down the list. */
export function settingsRowText(label: string, value: string): string {
  const column = 24;
  return `${label.padEnd(column - 1)} ${value}`;
}
