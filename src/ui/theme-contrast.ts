import type { ThemePalette } from "./theme.ts";

export type ContrastPair = {
  name: string;
  foreground: keyof ThemePalette;
  background: keyof ThemePalette;
};
export type ContrastWarning = ContrastPair & { ratio: number };

export const contrastPairs: readonly ContrastPair[] = [
  { name: "primary text", foreground: "text", background: "background" },
  { name: "primary panel text", foreground: "text", background: "panel" },
  { name: "primary raised-panel text", foreground: "text", background: "panelRaised" },
  { name: "bright text", foreground: "textBright", background: "background" },
  { name: "bright panel text", foreground: "textBright", background: "panel" },
  { name: "bright raised-panel text", foreground: "textBright", background: "panelRaised" },
  { name: "secondary text", foreground: "muted", background: "background" },
  { name: "secondary raised-panel text", foreground: "muted", background: "panelRaised" },
  { name: "thinking text", foreground: "muted", background: "thinkingBg" },
  { name: "read-tool text", foreground: "muted", background: "toolReadBg" },
  { name: "write-tool text", foreground: "muted", background: "toolWriteBg" },
  { name: "shell-tool text", foreground: "muted", background: "toolShellBg" },
  { name: "agent-tool text", foreground: "muted", background: "toolAgentBg" },
  { name: "other-tool text", foreground: "muted", background: "toolOtherBg" },
  { name: "diff text", foreground: "text", background: "diffBg" },
  { name: "selected text", foreground: "textBright", background: "selection" },
];

function linearChannel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(value: string): number {
  const red = linearChannel(Number.parseInt(value.slice(1, 3), 16));
  const green = linearChannel(Number.parseInt(value.slice(3, 5), 16));
  const blue = linearChannel(Number.parseInt(value.slice(5, 7), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

export function contrastWarnings(palette: ThemePalette): ContrastWarning[] {
  return contrastPairs.flatMap((pair) => {
    const ratio = contrastRatio(palette[pair.foreground], palette[pair.background]);
    return ratio < 4.5 ? [{ ...pair, ratio }] : [];
  });
}
