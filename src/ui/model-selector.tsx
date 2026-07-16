import type { KeyEvent, SelectRenderable, TextareaRenderable } from "@opentui/core";
import { createMemo, createSignal, onMount } from "solid-js";
import { useKeyboard } from "@opentui/solid";
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

export function filterModelChoices(models: ModelChoice[], query: string): ModelChoice[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return models;
  return models.filter((model) => [model.provider, model.id, model.name ?? ""].some((value) => value.toLowerCase().includes(normalized)));
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

type ModelSelectorFocus = "search" | "list";

export function ModelSelectorDialog(props: {
  models: ModelChoice[];
  currentProvider?: string | undefined;
  currentModelId?: string | undefined;
  onSelect: (model: ModelChoice) => void;
  onCancel: () => void;
}) {
  let select: SelectRenderable | undefined;
  let search: TextareaRenderable | undefined;
  const [query, setQuery] = createSignal("");
  const [focusTarget, setFocusTarget] = createSignal<ModelSelectorFocus>("search");
  let activeFocus: ModelSelectorFocus = "search";
  const setActiveFocus = (next: ModelSelectorFocus) => {
    activeFocus = next;
    setFocusTarget(next);
  };
  const filteredModels = createMemo(() => filterModelChoices(props.models, query()));
  const options = createMemo(() => filteredModels().map((model) => {
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
  onMount(() => queueMicrotask(() => search?.focus()));
  const cancelOnEscape = (event: KeyEvent) => {
    if (event.name !== "escape") return;
    event.preventDefault();
    event.stopPropagation();
    props.onCancel();
  };

  const selectedIndex = createMemo(() => {
    const index = filteredModels().findIndex((model) => model.provider === props.currentProvider && model.id === props.currentModelId);
    return index >= 0 ? index : 0;
  });

  useKeyboard((event) => {
    if (event.eventType === "release") return;
    if (event.name === "escape") { event.preventDefault(); event.stopPropagation(); props.onCancel(); return; }
    if ((event.name === "down" || event.name === "up") && activeFocus === "search" && filteredModels().length) {
      event.preventDefault();
      event.stopPropagation();
      setActiveFocus("list");
      queueMicrotask(() => { if (activeFocus === "list") select?.focus(); });
      if (event.name === "up") select?.setSelectedIndex(Math.max(0, filteredModels().length - 1));
      return;
    }
    if (event.name === "enter" || event.name === "return") {
      const models = filteredModels();
      const model = models[activeFocus === "list" ? (select?.getSelectedIndex() ?? 0) : 0];
      if (model) {
        event.preventDefault();
        event.stopPropagation();
        props.onSelect(model);
      }
      return;
    }
    if (event.name !== "tab") return;
    event.preventDefault();
    event.stopPropagation();
    const next: ModelSelectorFocus = event.shift ? "search" : "list";
    setActiveFocus(next);
    if (next === "list") select?.focus();
    else search?.focus();
  });

  return (
    <box
      position="absolute"
      left="12%"
      right="12%"
      top="8%"
      bottom={5}
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
      <textarea
        ref={(value) => { search = value; }}
        focused={focusTarget() === "search"}
        height={1}
        minHeight={1}
        maxHeight={1}
        placeholder="Search provider, model id, or name…"
        backgroundColor={colors.panel}
        focusedBackgroundColor={colors.panel}
        textColor={colors.textBright}
        placeholderColor={colors.muted}
        onKeyDown={cancelOnEscape}
        onContentChange={() => {
          setQuery(search?.plainText ?? "");
          queueMicrotask(() => select?.setSelectedIndex(0));
        }}
      />
      <text fg={colors.subtle}>Tab list · Shift+Tab search · ↑/↓ move · Enter select · Esc close · {filteredModels().length} match{filteredModels().length === 1 ? "" : "es"}</text>
      {filteredModels().length === 0 ? <text fg={colors.yellow}>No matching models.</text> : <select
        ref={(value) => { select = value; }}
        options={options()}
        selectedIndex={selectedIndex()}
        focused={focusTarget() === "list"}
        height={Math.min(22, Math.max(5, options().length * 2))}
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
        onKeyDown={cancelOnEscape}
        onSelect={(_index, option) => {
          const model = option?.value;
          if (model && filteredModels().some((candidate) => candidate.provider === model.provider && candidate.id === model.id)) props.onSelect(model);
        }}
      />}
    </box>
  );
}
