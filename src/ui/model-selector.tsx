import type { SelectRenderable } from "@opentui/core";
import { createMemo } from "solid-js";
import { colors } from "./theme.ts";

export type ModelChoice = {
  provider: string;
  id: string;
  name?: string | undefined;
  contextWindow?: number | undefined;
};

function positiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

export function formatContextWindow(value: number | undefined): string {
  if (!value) return "";
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1).replace(/\.0$/, "")}M ctx`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1).replace(/\.0$/, "")}k ctx`;
  }
  return `${value} ctx`;
}

export function normalizeModelChoices(values: unknown[]): ModelChoice[] {
  const seen = new Set<string>();
  const models: ModelChoice[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (typeof record.provider !== "string" || typeof record.id !== "string") continue;
    const provider = record.provider.trim();
    const id = record.id.trim();
    if (!provider || !id) continue;
    const key = `${provider}\u0000${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const contextWindow = positiveNumber(record.contextWindow) ?? positiveNumber(record.context_window);
    models.push({
      provider,
      id,
      ...(typeof record.name === "string" && record.name.trim() ? { name: record.name.trim() } : {}),
      ...(contextWindow ? { contextWindow } : {}),
    });
  }
  return models.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
}

export function ModelSelectorDialog(props: {
  models: ModelChoice[];
  currentProvider?: string | undefined;
  currentModelId?: string | undefined;
  onSelect: (model: ModelChoice) => void;
  onCancel: () => void;
}) {
  let select: SelectRenderable | undefined;
  const options = createMemo(() => props.models.map((model) => {
    const details = [
      formatContextWindow(model.contextWindow),
      model.name && model.name !== model.id ? model.name : "",
    ].filter(Boolean);
    return {
      name: `${model.provider}/${model.id}`,
      description: details.join(" · "),
      value: model,
    };
  }));
  const selectedIndex = createMemo(() => {
    const index = props.models.findIndex((model) => model.provider === props.currentProvider && model.id === props.currentModelId);
    return index >= 0 ? index : 0;
  });

  return (
    <box
      position="absolute"
      left="12%"
      right="12%"
      top="8%"
      maxHeight="84%"
      flexDirection="column"
      backgroundColor={colors.panelRaised}
      border
      borderColor={colors.borderStrong}
      padding={1}
      zIndex={150}
    >
      <box flexDirection="row">
        <text fg={colors.textBright} attributes={1}>Select model</text>
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
      <text fg={colors.subtle}>↑/↓ move · Enter select · Esc close</text>
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
          const model = option?.value as ModelChoice | undefined;
          if (model) props.onSelect(model);
        }}
      />
    </box>
  );
}
