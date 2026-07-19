import type { KeyEvent, SelectRenderable, TextareaRenderable } from "@opentui/core";
import { createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { filterSessionChoices, type SessionChoice, type SessionDiscoveryState } from "../sessions.ts";
import { colors } from "./theme.ts";
import { createSearchableDialogFocus, handleSearchableDialogCancel } from "./searchable-dialog-focus.ts";

export type SessionSelectorProps = {
  state: SessionDiscoveryState;
  switching?: boolean;
  streaming?: boolean;
  confirmation?: "streaming" | "queued" | undefined;
  queuedCount?: number;
  pending?: SessionChoice | undefined;
  onSelect: (choice: SessionChoice) => void;
  onCancel: () => void;
  onConfirm?: () => void;
  onDecline?: () => void;
  onRetry?: () => void;
};

export function SessionSelector(props: SessionSelectorProps) {
  let search: TextareaRenderable | undefined;
  let select: SelectRenderable | undefined;
  const [query, setQuery] = createSignal("");
  const choices = createMemo(() => props.state.kind === "success" ? filterSessionChoices(props.state.choices, query()) : []);
  const options = createMemo(() => choices().map((choice) => ({
    name: choice.name,
    description: `${choice.modified.toLocaleString()} · ${choice.messageCount} messages`,
    value: choice,
  })));

  const focus = createSearchableDialogFocus({ getSearch: () => search, getList: () => select, getListLength: () => choices().length });
  const cancelOnEscape = (event: KeyEvent) => { handleSearchableDialogCancel(event, props.onCancel); };
  useKeyboard((event) => {
    if (event.eventType === "release") return;
    if (handleSearchableDialogCancel(event, props.onCancel)) return;
    if (props.pending) {
      if (event.name === "n") {
        event.preventDefault();
        event.stopPropagation();
        props.onDecline?.();
      } else if (event.name === "enter" || event.name === "return" || event.name === "y") {
        event.preventDefault();
        event.stopPropagation();
        props.onConfirm?.();
      }
      return;
    }
    if (focus.onKeyDown(event)) return;
    if ((event.name === "enter" || event.name === "return") && focus.activeFocus() === "search") {
      const choice = choices()[0];
      if (choice) {
        event.preventDefault();
        event.stopPropagation();
        props.onSelect(choice);
      }
    }
  });

  return (
    <box position="absolute" left="12%" right="12%" top="8%" bottom={5} flexDirection="column" backgroundColor={colors.panelRaised} border borderColor={colors.borderStrong} padding={1} zIndex={150}>
      <box flexDirection="row"><text fg={colors.textBright} attributes={1}>Resume session</text><box flexGrow={1} /><text fg={colors.muted} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); props.onCancel(); }}>× Close</text></box>
      {props.pending ? <box flexDirection="column"><text fg={props.streaming ? colors.yellow : colors.green}>{props.confirmation === "queued" ? `Discard ${props.queuedCount ?? 0} local queued message${props.queuedCount === 1 ? "" : "s"} and switch to “${props.pending.name}”?` : props.streaming ? `Pi is streaming. Switch to “${props.pending.name}”?` : `Pi has settled. Switch to “${props.pending.name}”?`}</text><text fg={colors.subtle}>Enter/Y confirm · N decline · Esc close</text></box> : null}
      <textarea ref={(value) => { search = value; }} focused={focus.focusTarget() === "search" && !props.pending} height={1} minHeight={1} maxHeight={1} placeholder="Search sessions…" backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} textColor={colors.textBright} placeholderColor={colors.muted} onKeyDown={cancelOnEscape} onContentChange={() => { setQuery(search?.plainText ?? ""); queueMicrotask(() => select?.setSelectedIndex(0)); }} />
      <text fg={colors.subtle}>Tab list · ↑/↓ move · Enter select · Esc close</text>
      {props.switching ? <text fg={colors.muted}>Switching session…</text> : props.state.kind === "loading" ? <text fg={colors.muted}>Loading sessions…{props.state.progress ? ` ${props.state.progress.loaded}/${props.state.progress.total}` : ""}</text> : props.state.kind === "error" ? <box flexDirection="column"><text fg={colors.red}>Unable to discover sessions: {props.state.error}</text>{props.onRetry ? <text fg={colors.yellow} onMouseDown={(event) => { event.preventDefault(); props.onRetry?.(); }}>Retry</text> : null}</box> : choices().length === 0 ? <text fg={colors.yellow}>No resumable sessions in this directory.</text> : <select ref={(value) => { select = value; }} options={options()} selectedIndex={0} focused={focus.focusTarget() === "list" && !props.pending} height={Math.min(18, Math.max(5, options().length * 2))} backgroundColor={colors.panelRaised} focusedBackgroundColor={colors.panelRaised} textColor={colors.text} focusedTextColor={colors.text} selectedBackgroundColor={colors.selection} selectedTextColor={colors.textBright} descriptionColor={colors.muted} selectedDescriptionColor={colors.text} showScrollIndicator wrapSelection onKeyDown={cancelOnEscape} onSelect={(_index, option) => { if (option?.value) props.onSelect(option.value); }} />}
    </box>
  );
}
