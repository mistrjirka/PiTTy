import type { KeyEvent, SelectRenderable, TextareaRenderable } from "@opentui/core";
import { createSignal, onMount } from "solid-js";

export type SearchableDialogFocus = "search" | "list";

export type SearchableDialogFocusOptions = {
  getSearch: () => TextareaRenderable | undefined;
  getList: () => SelectRenderable | undefined;
  getListLength: () => number;
};

export type SearchableDialogFocusController = {
  focusTarget: () => SearchableDialogFocus;
  activeFocus: () => SearchableDialogFocus;
  focusSearch: () => void;
  focusList: () => void;
  onKeyDown: (event: KeyEvent) => boolean;
};

export function handleSearchableDialogCancel(event: KeyEvent, onCancel: () => void): boolean {
  if (event.eventType === "release" || event.name !== "escape") return false;
  event.preventDefault();
  event.stopPropagation();
  onCancel();
  return true;
}

export function createSearchableDialogFocus(options: SearchableDialogFocusOptions): SearchableDialogFocusController {
  const [focusTarget, setFocusTarget] = createSignal<SearchableDialogFocus>("search");
  let active: SearchableDialogFocus = "search";
  const focusSearch = () => { active = "search"; setFocusTarget("search"); options.getSearch()?.focus(); };
  const focusList = () => {
    if (!options.getListLength()) return;
    active = "list";
    setFocusTarget("list");
    options.getList()?.focus();
  };
  onMount(() => queueMicrotask(focusSearch));
  return {
    focusTarget,
    activeFocus: () => active,
    focusSearch,
    focusList,
    onKeyDown: (event) => {
      if (event.eventType === "release") return false;
      if (event.name === "tab") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shift || active === "list") focusSearch();
        else focusList();
        return true;
      }
      if (active === "search" && (event.name === "down" || event.name === "up") && options.getListLength()) {
        event.preventDefault();
        event.stopPropagation();
        focusList();
        if (event.name === "up") options.getList()?.setSelectedIndex(Math.max(0, options.getListLength() - 1));
        return true;
      }
      return false;
    },
  };
}
