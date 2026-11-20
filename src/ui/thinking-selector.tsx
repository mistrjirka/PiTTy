import type { SelectRenderable, TextRenderable } from "@opentui/core";
import { Show, createEffect, createMemo, createSignal } from "solid-js";
import type { ThinkingLevel } from "../rpc/pi-rpc-client.ts";
import { DialogFrame } from "./dialog-frame.tsx";
import { selectOptionIndexAtMouse } from "./select-mouse.ts";
import { colors } from "./theme.ts";
import {
  EXTENSION_THINKING_LEVELS,
  type ExtensionThinkingLevel,
} from "../config/extension-models.ts";
import type { ModelChoice } from "./model-selector.ts";

export const THINKING_LEVELS: ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

// Extended levels require an explicit non-null thinkingLevelMap entry to be
// offered; standard levels through `high` are supported by provider default
// when the map omits them.
const EXTENDED_THINKING_LEVELS: ReadonlySet<ThinkingLevel> = new Set([
  "xhigh",
  "max",
]);

export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

/**
 * Levels the extension can pass to this model. `off` is always allowed; the
 * extension skips reasoning entirely for it. Unknown models keep every level
 * because PiTTy has no capability data for them.
 */
export function compatibleThinkingLevels(
  model: Pick<ModelChoice, "reasoning" | "thinkingLevelMap"> | undefined,
): ExtensionThinkingLevel[] {
  if (!model) return [...EXTENSION_THINKING_LEVELS];
  if (model.reasoning === false) return ["off"];
  const map = model.thinkingLevelMap;
  return EXTENSION_THINKING_LEVELS.filter((level) => {
    // The extension skips reasoning for "off", but a model that explicitly
    // maps it to null (e.g. openai-codex/gpt-6.1-sol) rejects it, so only
    // offer it when it is not excluded.
    if (level === "off") return map?.["off"] !== null;
    if (map) {
      const entry = map[level];
      if (entry === null) return false;
      if (entry !== undefined) return true;
    }
    return level !== "xhigh" && level !== "max";
  });
}

export function visibleThinkingLevels(
  reasoning: boolean | undefined,
  map: ThinkingLevelMap | undefined,
): ThinkingLevel[] {
  if (reasoning === false) return [];
  if (!map) {
    return THINKING_LEVELS.filter(
      (level) => !EXTENDED_THINKING_LEVELS.has(level),
    );
  }
  return THINKING_LEVELS.filter((level) => {
    const entry = map[level];
    if (entry === null) return false;
    if (entry !== undefined) return true;
    return !EXTENDED_THINKING_LEVELS.has(level);
  });
}

export function ThinkingSelector(props: {
  current: string | undefined;
  levels?: readonly string[];
  busy?: boolean;
  error?: string;
  context?: string | undefined;
  /** Where Esc returns to; defaults to Settings. */
  backLabel?: string | undefined;
  onSelect: (level: string) => void;
  onCancel: () => void;
}) {
  let select: SelectRenderable | undefined;
  let status: TextRenderable | undefined;
  const levels = createMemo(() =>
    props.levels && props.levels.length > 0 ? props.levels : THINKING_LEVELS,
  );
  const [index, setIndex] = createSignal(
    Math.max(0, levels().indexOf(props.current ?? "medium")),
  );
  const resolve = (value: unknown): string | undefined =>
    levels().find((level) => level === value);
  createEffect(() => {
    setIndex(Math.max(0, levels().indexOf(props.current ?? "medium")));
  });
  createEffect(() => {
    if (select) select.options = levels().map((level) => ({
      name: level,
      description: "",
      value: level,
    }));
    if (select) select.selectedIndex = index();
    if (status)
      status.content = props.busy
        ? "Applying…"
        : (props.error ?? "");
  });
  const choose = (level: string | undefined) => {
    if (level && !props.busy) {
      setIndex(levels().indexOf(level));
      props.onSelect(level);
    }
  };
  return (
    <DialogFrame
      title="Thinking effort"
      hint="↑/↓ move · enter select"
      width="narrow"
      closeLabel={props.backLabel ?? "esc ‹ settings"}
      zIndex={160}
      onClose={props.onCancel}
    >
      <Show when={props.context}>
        <text fg={colors.subtle} wrapMode="none">
          {props.context}
        </text>
      </Show>
      <select
        ref={(value) => {
          select = value;
        }}
        options={levels().map((level) => ({
          name: level,
          description: "",
          value: level,
        }))}
        selectedIndex={0}
        focused
        showDescription={false}
        height={Math.max(3, levels().length)}
        backgroundColor={colors.panelRaised}
        focusedBackgroundColor={colors.panelRaised}
        textColor={colors.text}
        focusedTextColor={colors.textBright}
        selectedBackgroundColor={colors.selection}
        selectedTextColor={colors.textBright}
        onMouseDown={(event) => {
          if (!select) return;
          const index = selectOptionIndexAtMouse(select, event.y);
          const level = index === undefined ? undefined : levels()[index];
          if (!level) return;
          event.preventDefault();
          event.stopPropagation();
          choose(level);
        }}
        onSelect={(_i, option) => choose(resolve(option?.value))}
      />
      {/* Busy and error state only; the keys live in the hint row. */}
      <text
        ref={(value) => {
          status = value;
        }}
        fg={props.error ? colors.red : colors.subtle}
        wrapMode="word"
      />
    </DialogFrame>
  );
}
