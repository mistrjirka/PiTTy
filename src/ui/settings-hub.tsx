import type { SelectRenderable, TextRenderable } from "@opentui/core";
import { createEffect, createMemo } from "solid-js";
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
      select.options = current.map((row) => ({
        name: row.label,
        description: row.busy()
          ? "Applying…"
          : (row.disabledReason() ?? row.summary()),
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
    <box
      position="absolute"
      left="15%"
      right="15%"
      top="12%"
      bottom={5}
      flexDirection="column"
      backgroundColor={colors.panelRaised}
      border
      borderColor={colors.borderStrong}
      padding={1}
      zIndex={150}
    >
      <box flexDirection="row">
        <text fg={colors.textBright} attributes={1}>
          Settings
        </text>
        <box flexGrow={1} />
        <text
          fg={colors.muted}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onClose();
          }}
        >
          × Close
        </text>
      </box>
      <text fg={colors.subtle}>↑/↓ choose · Enter open · Esc close</text>
      <select
        ref={(value) => {
          select = value;
        }}
        id="settings-sections"
        options={[]}
        selectedIndex={0}
        focused
        height={Math.min(12, Math.max(5, rows().length * 2))}
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
          const row = rows()[index];
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
      <text fg={colors.subtle}>Changes apply immediately.</text>
    </box>
  );
}
