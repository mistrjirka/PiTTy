import type { KeyEvent, SelectRenderable, TextareaRenderable, TextRenderable } from "@opentui/core";
import { For, createEffect, createMemo, createSignal, untrack } from "solid-js";
import { createDynamic, useKeyboard } from "@opentui/solid";
import { createSearchableDialogFocus, handleSearchableDialogCancel } from "./searchable-dialog-focus.ts";
import { contrastWarnings } from "./theme-contrast.ts";
import { colors, getThemeRevision, type ThemePalette } from "./theme.ts";
import {
  isThemeColorToken,
  isThemePresetName,
  themeColorTokens,
  themePresetNames,
  themePresets,
  type ThemePresetName,
} from "./theme-presets.ts";

type DynamicBoolean = boolean | (() => boolean);
type DynamicText = string | (() => string | undefined);
type DynamicPreset = ThemePresetName | (() => ThemePresetName);
type DynamicOverrides = Partial<ThemePalette> | (() => Partial<ThemePalette>);

function readBoolean(value: DynamicBoolean): boolean {
  return typeof value === "function" ? value() : value;
}
function readText(value: DynamicText | undefined): string | undefined {
  return typeof value === "function" ? value() : value;
}
function readPreset(value: DynamicPreset): ThemePresetName {
  return typeof value === "function" ? value() : value;
}
function readOverrides(value: DynamicOverrides): Partial<ThemePalette> {
  return typeof value === "function" ? value() : value;
}

export type ThemePresetBrowserProps = {
  preset: DynamicPreset;
  busy: DynamicBoolean;
  error?: DynamicText;
  onPreset: (preset: ThemePresetName) => void;
  onCustomize: () => void;
  onCancel: () => void;
};

export function ThemePresetBrowser(props: ThemePresetBrowserProps) {
  let status: TextRenderable | undefined;
  const preset = () => readPreset(props.preset);
  const [selectedIndex, setSelectedIndex] = createSignal(themePresetNames.indexOf(preset()));
  const busy = () => readBoolean(props.busy);
  const error = () => readText(props.error);

  const updateStatus = () => {
    if (!status) return;
    status.content = busy() ? "Saving…" : (error() ?? "Changes apply immediately");
    status.fg = error() ? colors.red : busy() ? colors.yellow : colors.subtle;
  };
  createEffect(() => {
    if (!busy()) setSelectedIndex(themePresetNames.indexOf(preset()));
    updateStatus();
  });

  const activateSelected = () => {
    const preset = themePresetNames[selectedIndex()];
    if (preset && !busy()) props.onPreset(preset);
  };

  useKeyboard((event) => {
    if (event.eventType === "release") return;
    if (handleSearchableDialogCancel(event, props.onCancel)) return;
    if (busy()) return;
    if (event.name === "up" || event.name === "down") {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.name === "up" ? -1 : 1;
      setSelectedIndex((index) => (index + delta + themePresetNames.length) % themePresetNames.length);
      return;
    }
    if (event.name === "enter" || event.name === "return") {
      event.preventDefault();
      event.stopPropagation();
      activateSelected();
      return;
    }
    if (event.name === "c") {
      event.preventDefault();
      event.stopPropagation();
      props.onCustomize();
    }
  });

  const Contents = () => (
    <box
      position="absolute"
      left="12%"
      right="12%"
      top={1}
      bottom={1}
      flexDirection="column"
      backgroundColor={colors.panelRaised}
      border
      borderColor={colors.borderStrong}
      padding={1}
      zIndex={170}
    >
      <box flexDirection="row">
        <text fg={colors.textBright} attributes={1}>Theme presets</text>
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
      <text fg={colors.subtle}>↑/↓ choose · Enter apply · C customize colors · Esc back</text>
      <For each={[selectedIndex()]}>
        {() => <For each={themePresetNames}>
        {(name, index) => {
          const palette = themePresets[name];
          const selected = () => index() === selectedIndex();
          return (
            <box
              height={1}
              flexDirection="row"
              backgroundColor={selected() ? colors.selection : colors.panelRaised}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSelectedIndex(index());
                if (!busy()) props.onPreset(name);
              }}
            >
              <box width={4} backgroundColor={palette.background}><text fg={palette.text}> Aa </text></box>
              <text fg={palette.accent}> ● </text>
              <text fg={selected() ? colors.textBright : colors.text}>{selected() ? "▶ " : "  "}{name}</text>
              <box flexGrow={1} />
              <text fg={name === preset() ? colors.green : colors.subtle}>{name === preset() ? "active" : ""}</text>
            </box>
          );
        }}
        </For>}
      </For>
      <box flexDirection="row">
        <text
          fg={busy() ? colors.muted : colors.cyan}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!busy()) props.onCustomize();
          }}
        >Customize colors</text>
        <box flexGrow={1} />
        <text ref={(value) => { status = value; updateStatus(); }} fg={colors.subtle}>Changes apply immediately</text>
      </box>
    </box>
  );
  const EvenTheme = () => <Contents />;
  const OddTheme = () => <Contents />;
  return createDynamic(() => getThemeRevision() % 2 === 0 ? EvenTheme : OddTheme, {});
}

export type ThemeTokenEditorProps = {
  preset: DynamicPreset;
  overrides: DynamicOverrides;
  palette?: ThemePalette | (() => ThemePalette);
  busy: DynamicBoolean;
  error?: DynamicText;
  onToken: (token: keyof ThemePalette, value: string) => void;
  onReset: () => void;
  onCancel: () => void;
};

export function isThemeHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function filterThemeTokens(query: string): readonly (keyof ThemePalette)[] {
  const normalized = query.trim().toLowerCase();
  return normalized ? themeColorTokens.filter((token) => token.toLowerCase().includes(normalized)) : [...themeColorTokens];
}

export function ThemeTokenEditor(props: ThemeTokenEditorProps) {
  let search: TextareaRenderable | undefined;
  let tokenList: SelectRenderable | undefined;
  let field: TextareaRenderable | undefined;
  let status: TextRenderable | undefined;
  let selectedLabel: TextRenderable | undefined;
  let validationStatus: TextRenderable | undefined;
  const preset = () => readPreset(props.preset);
  const overrides = () => readOverrides(props.overrides);
  const [query, setQuery] = createSignal("");
  const [selectedToken, setSelectedToken] = createSignal<keyof ThemePalette>("background");
  const [rawValue, setRawValue] = createSignal(overrides().background ?? themePresets[preset()].background);
  const [validationError, setValidationError] = createSignal<string>();
  const [fieldFocused, setFieldFocused] = createSignal(false);
  const busy = () => readBoolean(props.busy);
  const error = () => readText(props.error);
  const livePalette = (): ThemePalette => typeof props.palette === "function" ? props.palette() : (props.palette ?? colors);
  let pendingValue: string | undefined;

  const filteredTokens = createMemo(() => filterThemeTokens(query()));
  const options = createMemo(() => filteredTokens().map((token) => ({ name: token, description: livePalette()[token], value: token })));
  const focus = createSearchableDialogFocus({
    getSearch: () => search,
    getList: () => tokenList,
    getListLength: () => filteredTokens().length,
  });
  const liveWarnings = createMemo(() => contrastWarnings(livePalette()));
  const warningSummary = createMemo(() => {
    const warnings = liveWarnings();
    const first = warnings[0];
    if (!first) return "Primary and secondary text contrast is at least 4.5:1.";
    const remaining = warnings.length - 1;
    return `${first.name} ${first.foreground}/${first.background}: ${first.ratio.toFixed(3)}:1${remaining ? ` · ${remaining} more` : ""}`;
  });

  const focusField = () => {
    setFieldFocused(true);
    queueMicrotask(() => field?.focus());
  };
  const selectToken = (token: keyof ThemePalette) => {
    setSelectedToken(token);
    const next = livePalette()[token];
    setRawValue(next);
    setValidationError(undefined);
    pendingValue = undefined;
    queueMicrotask(() => {
      if (field && field.plainText !== next) field.setText(next);
      focusField();
    });
  };
  const selectedListToken = (): keyof ThemePalette | undefined => {
    const token = filteredTokens()[tokenList?.getSelectedIndex() ?? 0];
    return token;
  };
  const applyValidRaw = () => {
    const value = rawValue();
    if (!isThemeHex(value)) {
      setValidationError("Enter a complete color in #RRGGBB form.");
      return;
    }
    setValidationError(undefined);
    const normalized = value.toUpperCase();
    if (!busy() && normalized !== livePalette()[selectedToken()].toUpperCase() && normalized !== pendingValue) {
      pendingValue = normalized;
      props.onToken(selectedToken(), normalized);
    }
  };

  const updateStatus = () => {
    if (!status) return;
    status.content = busy() ? "Saving…" : (error() ?? "Changes apply immediately");
    status.fg = error() ? colors.red : busy() ? colors.yellow : colors.subtle;
  };
  createEffect(() => {
    if (!busy()) pendingValue = undefined;
    updateStatus();
  });
  createEffect(() => {
    const nextOptions = options();
    if (tokenList) {
      tokenList.options = nextOptions;
      tokenList.setSelectedIndex(0);
    }
  });
  createEffect(() => {
    const token = selectedToken();
    const persistedValue = overrides()[token] ?? themePresets[preset()][token];
    if (!busy() && !error() && untrack(rawValue).toUpperCase() !== persistedValue.toUpperCase()) {
      setRawValue(persistedValue);
      setValidationError(undefined);
      if (field && field.plainText !== persistedValue) field.setText(persistedValue);
    }
  });
  const updateSelectedStatus = () => {
    const token = selectedToken();
    const validation = validationError();
    if (selectedLabel) selectedLabel.content = `${token} `;
    if (validationStatus) {
      validationStatus.content = validation ?? `Effective ${token}: ${livePalette()[token]}`;
      validationStatus.fg = validation ? colors.red : colors.subtle;
    }
  };
  createEffect(updateSelectedStatus);

  useKeyboard((event) => {
    if (event.eventType === "release") return;
    if (handleSearchableDialogCancel(event, props.onCancel)) return;
    if (event.name === "r" && event.ctrl && !fieldFocused() && !busy()) {
      event.preventDefault();
      event.stopPropagation();
      props.onReset();
      return;
    }
    if (fieldFocused()) {
      if (event.name === "tab") {
        event.preventDefault();
        event.stopPropagation();
        setFieldFocused(false);
        focus.focusSearch();
      }
      return;
    }
    if (focus.onKeyDown(event)) return;
    if (event.name === "enter" || event.name === "return") {
      const token = focus.activeFocus() === "list" ? selectedListToken() : filteredTokens()[0];
      if (token) {
        event.preventDefault();
        event.stopPropagation();
        selectToken(token);
      }
    }
  });

  const Contents = () => (
    <box
      position="absolute"
      left="12%"
      right="12%"
      top={1}
      bottom={1}
      flexDirection="column"
      backgroundColor={colors.panelRaised}
      border
      borderColor={colors.borderStrong}
      padding={1}
      zIndex={175}
    >
      <box flexDirection="row">
        <text fg={colors.textBright} attributes={1}>Custom theme colors</text>
        <box flexGrow={1} />
        <text
          fg={colors.cyan}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onCancel();
          }}
        >← Theme presets</text>
      </box>
      <text fg={colors.subtle}>Tab search/list · Enter edit · valid #RRGGBB applies immediately · Ctrl+R reset · Esc back</text>
      <textarea
        ref={(value) => { search = value; }}
        focused={focus.focusTarget() === "search" && !fieldFocused() && !busy()}
        height={1}
        minHeight={1}
        maxHeight={1}
        backgroundColor={colors.panel}
        focusedBackgroundColor={colors.panel}
        textColor={colors.textBright}
        placeholderColor={colors.muted}
        placeholder="Search semantic color tokens…"
        onKeyDown={(event: KeyEvent) => { handleSearchableDialogCancel(event, props.onCancel); }}
        onContentChange={() => {
          setQuery(search?.plainText ?? "");
          queueMicrotask(() => tokenList?.setSelectedIndex(0));
        }}
      />
      <select
        ref={(value) => { tokenList = value; }}
        options={options()}
        selectedIndex={0}
        focused={focus.focusTarget() === "list" && !fieldFocused() && !busy()}
        height={8}
        backgroundColor={colors.panelRaised}
        focusedBackgroundColor={colors.panelRaised}
        textColor={colors.text}
        focusedTextColor={colors.textBright}
        selectedBackgroundColor={colors.selection}
        selectedTextColor={colors.textBright}
        descriptionColor={colors.muted}
        selectedDescriptionColor={colors.text}
        onKeyDown={(event: KeyEvent) => { handleSearchableDialogCancel(event, props.onCancel); }}
        onSelect={(_index, option) => {
          if (typeof option?.value === "string" && isThemeColorToken(option.value)) selectToken(option.value);
        }}
      />
      <box flexDirection="row">
        <text ref={(value) => { selectedLabel = value; updateSelectedStatus(); }} fg={colors.muted}>background </text>
        <textarea
          id="theme-token-value"
          ref={(value) => { field = value; value.setText(rawValue()); }}
          focused={fieldFocused() && !busy()}
          height={1}
          minHeight={1}
          maxHeight={1}
          flexGrow={1}
          backgroundColor={colors.panel}
          focusedBackgroundColor={colors.panel}
          textColor={colors.textBright}
          placeholderColor={colors.muted}
          placeholder="#RRGGBB"
          onKeyDown={(event) => {
            if (event.name === "enter" || event.name === "return") {
              event.preventDefault();
              event.stopPropagation();
              applyValidRaw();
            }
          }}
          onContentChange={() => {
            const value = field?.plainText ?? "";
            setRawValue(value);
            if (!isThemeHex(value)) {
              setValidationError("Enter a complete color in #RRGGBB form.");
              return;
            }
            setValidationError(undefined);
            applyValidRaw();
          }}
        />
      </box>
      <text ref={(value) => { validationStatus = value; updateSelectedStatus(); }} fg={colors.subtle}>
        Effective background: {colors.background}
      </text>
      <text height={2} minHeight={2} fg={liveWarnings().length ? colors.yellow : colors.subtle} wrapMode="word">
        {warningSummary()}
      </text>
      <box flexDirection="row">
        <text
          fg={busy() ? colors.muted : colors.cyan}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!busy()) props.onReset();
          }}
        >Reset to {preset()}</text>
        <box flexGrow={1} />
        <text ref={(value) => { status = value; updateStatus(); }} fg={colors.subtle}>Changes apply immediately</text>
      </box>
    </box>
  );
  const EvenTheme = () => <Contents />;
  const OddTheme = () => <Contents />;
  return createDynamic(() => props.palette ? EvenTheme : getThemeRevision() % 2 === 0 ? EvenTheme : OddTheme, {});
}
