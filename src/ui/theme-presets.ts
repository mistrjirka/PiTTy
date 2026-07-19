import type { ThemePalette, ThemePresetName } from "../theme/contracts.ts";
export { isThemeColorToken, isThemePresetName, themeColorTokens, themePresetNames } from "../theme/contracts.ts";
export type { ThemePresetName } from "../theme/contracts.ts";

const midnight: ThemePalette = {
  background: "#09090b", panel: "#111113", panelRaised: "#18181b", panelSoft: "#131316", border: "#27272a", borderStrong: "#3f3f46", text: "#e4e4e7", textBright: "#fafafa", muted: "#a1a1aa", subtle: "#71717a", accent: "#60a5fa", cyan: "#22d3ee", green: "#4ade80", yellow: "#facc15", orange: "#fb923c", red: "#f87171", purple: "#c084fc", thinkingBg: "#11111a", toolReadBg: "#0b1720", toolWriteBg: "#0d1b13", toolShellBg: "#20170b", toolAgentBg: "#1b1023", toolOtherBg: "#10151d", diffBg: "#0d1117", selection: "#334155",
};
type PresetSwatches = Pick<ThemePalette,
  | "background" | "panel" | "panelRaised" | "border" | "text" | "textBright" | "muted"
  | "accent" | "cyan" | "green" | "yellow" | "orange" | "red" | "purple" | "selection"
>;
const make = (swatches: PresetSwatches): ThemePalette => ({
  ...swatches,
  panelSoft: swatches.panel,
  borderStrong: swatches.border,
  subtle: swatches.muted,
  thinkingBg: swatches.panel,
  toolReadBg: swatches.panel,
  toolWriteBg: swatches.panel,
  toolShellBg: swatches.panel,
  toolAgentBg: swatches.panel,
  toolOtherBg: swatches.panel,
  diffBg: swatches.panel,
});

export const themePresets: Readonly<Record<ThemePresetName, ThemePalette>> = {
  "PiTTy Midnight": midnight,
  "Catppuccin Mocha": make({ background: "#1e1e2e", panel: "#181825", panelRaised: "#313244", border: "#45475a", text: "#cdd6f4", textBright: "#f5e0dc", muted: "#a6adc8", accent: "#89b4fa", cyan: "#89dceb", green: "#a6e3a1", yellow: "#f9e2af", orange: "#fab387", red: "#f38ba8", purple: "#cba6f7", selection: "#585b70" }),
  "Catppuccin Latte": make({ background: "#eff1f5", panel: "#e6e9ef", panelRaised: "#dce0e8", border: "#9ca0b0", text: "#4c4f69", textBright: "#1e1e2e", muted: "#5c5f77", accent: "#1e66f5", cyan: "#04a5e5", green: "#40a02b", yellow: "#df8e1d", orange: "#fe640b", red: "#d20f39", purple: "#8839ef", selection: "#bcc0cc" }),
  "Tokyo Night Storm": make({ background: "#1f2335", panel: "#1b1e2d", panelRaised: "#292e42", border: "#3b4261", text: "#c0caf5", textBright: "#c0caf5", muted: "#a9b1d6", accent: "#7aa2f7", cyan: "#7dcfff", green: "#9ece6a", yellow: "#e0af68", orange: "#ff9e64", red: "#f7768e", purple: "#9d7cd8", selection: "#414868" }),
  "Gruvbox Dark": make({ background: "#282828", panel: "#1d2021", panelRaised: "#3c3836", border: "#665c54", text: "#ebdbb2", textBright: "#fbf1c7", muted: "#bdae93", accent: "#83a598", cyan: "#8ec07c", green: "#b8bb26", yellow: "#fabd2f", orange: "#fe8019", red: "#fb4934", purple: "#d3869b", selection: "#504945" }),
  "Nord": make({ background: "#2e3440", panel: "#3b4252", panelRaised: "#434c5e", border: "#4c566a", text: "#d8dee9", textBright: "#eceff4", muted: "#d8dee9", accent: "#88c0d0", cyan: "#8fbcbb", green: "#a3be8c", yellow: "#ebcb8b", orange: "#d08770", red: "#bf616a", purple: "#b48ead", selection: "#4c566a" }),
  "Dracula": make({ background: "#282a36", panel: "#282a36", panelRaised: "#44475a", border: "#6272a4", text: "#f8f8f2", textBright: "#f8f8f2", muted: "#f8f8f2", accent: "#8be9fd", cyan: "#8be9fd", green: "#50fa7b", yellow: "#f1fa8c", orange: "#ffb86c", red: "#ff5555", purple: "#bd93f9", selection: "#44475a" }),
  "Rosé Pine Moon": make({ background: "#232136", panel: "#2a273f", panelRaised: "#393552", border: "#44415a", text: "#e0def4", textBright: "#e0def4", muted: "#e0def4", accent: "#c4a7e7", cyan: "#9ccfd8", green: "#3e8fb0", yellow: "#f6c177", orange: "#ea9a97", red: "#eb6f92", purple: "#c4a7e7", selection: "#44415a" }),
  "Kanagawa Wave": make({ background: "#1f1f28", panel: "#16161d", panelRaised: "#2a2a37", border: "#54546d", text: "#dcd7ba", textBright: "#dcd7ba", muted: "#c8c093", accent: "#7e9cd8", cyan: "#7fb4ca", green: "#98bb6c", yellow: "#e6c384", orange: "#ffa066", red: "#e46876", purple: "#957fb8", selection: "#363646" }),
  "Solarized Light": make({ background: "#fdf6e3", panel: "#fdf6e3", panelRaised: "#eee8d5", border: "#93a1a1", text: "#073642", textBright: "#002b36", muted: "#073642", accent: "#268bd2", cyan: "#2aa198", green: "#859900", yellow: "#b58900", orange: "#cb4b16", red: "#dc322f", purple: "#6c71c4", selection: "#93a1a1" }),
};
