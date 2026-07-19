import { SyntaxStyle } from "@opentui/core";
import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { themeColorTokens, themePresetNames, themePresets, type ThemePresetName } from "./theme-presets.ts";
import type { ThemeColor, ThemeOverrides, ThemePalette } from "../theme/contracts.ts";
export type { ThemeColor, ThemeOverrides, ThemePalette, ThemePresetName } from "../theme/contracts.ts";
export type EffectiveTheme = {
  preset: ThemePresetName;
  overrides: ThemeOverrides;
  palette: ThemePalette;
};
export type ThemeRenderer = {
  setBackgroundColor: (color: string) => void;
};
export type ThemeControllerOptions = {
  isolated?: boolean;
  initialPalette?: ThemePalette;
};
export type ThemeController = {
  readonly colors: ThemePalette;
  readonly revision: () => number;
  readonly markdownStyle: SyntaxStyle;
  readonly thinkingMarkdownStyle: SyntaxStyle;
  apply: (theme: EffectiveTheme) => void;
  attachRenderer: (renderer: ThemeRenderer) => void;
};

const [colors, setColors] = createStore<ThemePalette>({ ...themePresets["PiTTy Midnight"] });
export { colors };

function createStyles(palette: ThemePalette, thinking: boolean): SyntaxStyle {
  const base = thinking ? palette.muted : palette.text;
  return SyntaxStyle.fromStyles({
    default: { fg: base },
    text: { fg: base },
    paragraph: { fg: base },
    heading: { fg: thinking ? palette.purple : palette.textBright, bold: true },
    "markup.heading": { fg: thinking ? palette.purple : palette.textBright, bold: true },
    "markup.bold": { fg: palette.textBright, bold: true },
    "markup.italic": { fg: base, italic: true },
    "markup.link": { fg: palette.cyan, underline: true },
    "markup.raw": { fg: palette.green },
    "markup.quote": { fg: palette.muted, italic: true },
    comment: { fg: palette.muted, italic: true },
    keyword: { fg: palette.purple },
    function: { fg: palette.accent },
    string: { fg: palette.green },
    number: { fg: palette.yellow },
    type: { fg: palette.cyan },
    operator: { fg: palette.purple },
    punctuation: { fg: palette.muted },
  });
}

const [globalRevision, setGlobalRevision] = createSignal(0);
let globalMainStyle = createStyles(colors, false);
let globalThinkingStyle = createStyles(colors, true);

export function getThemeRevision(): number { return globalRevision(); }
export function getThemeColorTokens(): readonly (keyof ThemePalette)[] { return themeColorTokens; }
export function getThemePresets(): readonly ThemePresetName[] { return themePresetNames; }
export function getMarkdownStyle(): SyntaxStyle { return globalMainStyle; }
export function getThinkingMarkdownStyle(): SyntaxStyle { return globalThinkingStyle; }

function samePalette(left: ThemePalette, right: ThemePalette): boolean {
  return themeColorTokens.every((token) => left[token] === right[token]);
}

export function createThemeController(options: ThemeControllerOptions = {}): ThemeController {
  const isolated = options.isolated === true;
  let currentPalette: ThemePalette = { ...(options.initialPalette ?? colors) };
  let controllerMainStyle = isolated ? createStyles(currentPalette, false) : globalMainStyle;
  let controllerThinkingStyle = isolated ? createStyles(currentPalette, true) : globalThinkingStyle;
  const [isolatedRevision, setIsolatedRevision] = createSignal(0);
  let renderer: ThemeRenderer | undefined;

  return {
    get colors() { return currentPalette; },
    revision: isolated ? isolatedRevision : getThemeRevision,
    get markdownStyle() { return controllerMainStyle; },
    get thinkingMarkdownStyle() { return controllerThinkingStyle; },
    attachRenderer(value: ThemeRenderer): void {
      renderer = value;
      renderer.setBackgroundColor(currentPalette.background);
    },
    apply(theme: EffectiveTheme): void {
      if (samePalette(currentPalette, theme.palette)) return;
      currentPalette = { ...theme.palette };
      controllerMainStyle = createStyles(currentPalette, false);
      controllerThinkingStyle = createStyles(currentPalette, true);
      renderer?.setBackgroundColor(currentPalette.background);
      if (isolated) {
        setIsolatedRevision((value) => value + 1);
        return;
      }
      setColors(reconcile(currentPalette));
      globalMainStyle = controllerMainStyle;
      globalThinkingStyle = controllerThinkingStyle;
      setGlobalRevision((value) => value + 1);
    },
  };
}

export function effectiveTheme(preset: ThemePresetName, overrides: ThemeOverrides = {}): EffectiveTheme {
  return {
    preset,
    overrides: { ...overrides },
    palette: { ...themePresets[preset], ...overrides },
  };
}
