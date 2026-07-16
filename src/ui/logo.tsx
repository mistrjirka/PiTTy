import { For } from "solid-js";
import { colors } from "./theme.ts";

export type LogoProps = {
  compact?: boolean;
  wordmarkOnly?: boolean;
};

/**
 * Portable terminal-cell interpretation of the original PTY Tail mock.
 *
 * The double horizontal glyph represents the mock's paired strokes while
 * Braille cells approximate its dotted bends and flowing lower tail. Exact
 * vector rendering remains available to documentation; this component avoids
 * terminal-specific image protocols and keeps every character one cell wide.
 */
export const wideLogoLines = [
  "■ ═══════════════════⠒⠒⣄",
  "                        ⠈⢆",
  "                          ⢸",
  "                        ⢀⠎",
  "        ⡠⠔⠒══════════════",
  "      ⢠⠋",
  "     ⡎",
  "     ⠱⡀",
  "       ⠱⡀",
  "         ⠱⡀",
  "           ⠑⢄",
  "■ ═════════⠒⠒⠉",
] as const;

export const compactLogoLines = [
  "■ ═══════════⠒⣄",
  "                ⢸",
  "       ⡠⠒══════",
  "     ⢠⠋",
  "      ⠱⡀",
  "        ⠱⡀",
  "          ⠑⢄",
  "■ ══════⠒⠉",
] as const;

export function Logo(props: LogoProps) {
  if (props.wordmarkOnly) {
    return <text fg={colors.textBright} attributes={1}>PiTTy</text>;
  }

  const lines = props.compact ? compactLogoLines : wideLogoLines;
  return (
    <box flexDirection="column" alignItems="center">
      <box flexDirection="column">
        <For each={lines}>
          {(line) => <text fg={colors.accent} wrapMode="none">{line}</text>}
        </For>
      </box>
      <text fg={colors.textBright} attributes={1}>PiTTy</text>
    </box>
  );
}
