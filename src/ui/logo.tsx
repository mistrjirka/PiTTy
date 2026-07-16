import { For } from "solid-js";
import { colors } from "./theme.ts";

export type LogoProps = {
  compact?: boolean;
  wordmarkOnly?: boolean;
};

/**
 * Terminal-cell-safe interpretation of the canonical PTY Tail artwork.
 *
 * Rounded box-drawing glyphs keep the mark light while the two square
 * endpoints remain visible at small sizes. Every glyph occupies one cell.
 */
export const wideLogoLines = [
  "■────╮",
  "     ╰───────╮",
  "             ╰──╮",
  "        ╭───────╯",
  "      ╭─╯",
  "      ╰╮",
  "■──────╯",
] as const;

export const compactLogoLines = [
  "■───╮",
  "    ╰───╮",
  "        ╰─╮",
  "    ╭────╯",
  "    ╰╮",
  "■────╯",
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
