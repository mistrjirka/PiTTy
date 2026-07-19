export type ThemeColor = string;
export type ThemePalette = {
  [K in "background" | "panel" | "panelRaised" | "panelSoft" | "border" | "borderStrong" | "text" | "textBright" | "muted" | "subtle" | "accent" | "cyan" | "green" | "yellow" | "orange" | "red" | "purple" | "thinkingBg" | "toolReadBg" | "toolWriteBg" | "toolShellBg" | "toolAgentBg" | "toolOtherBg" | "diffBg" | "selection"]: ThemeColor;
};
export type ThemeOverrides = Partial<ThemePalette>;
export const themePresetNames = [
  "PiTTy Midnight", "Catppuccin Mocha", "Catppuccin Latte", "Tokyo Night Storm", "Gruvbox Dark", "Nord", "Dracula", "Rosé Pine Moon", "Kanagawa Wave", "Solarized Light",
] as const;
export type ThemePresetName = (typeof themePresetNames)[number];
export const themeColorTokens = [
  "background", "panel", "panelRaised", "panelSoft", "border", "borderStrong", "text", "textBright", "muted", "subtle", "accent", "cyan", "green", "yellow", "orange", "red", "purple", "thinkingBg", "toolReadBg", "toolWriteBg", "toolShellBg", "toolAgentBg", "toolOtherBg", "diffBg", "selection",
] as const satisfies readonly (keyof ThemePalette)[];
export function isThemePresetName(value: string): value is ThemePresetName { return (themePresetNames as readonly string[]).includes(value); }
export function isThemeColorToken(value: string): value is keyof ThemePalette { return (themeColorTokens as readonly string[]).includes(value); }
