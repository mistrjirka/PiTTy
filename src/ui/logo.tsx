import { For } from "solid-js";
import { colors } from "./theme.ts";

export type LogoProps = {
  compact?: boolean;
  wordmarkOnly?: boolean;
};

/**
 * Terminal-cell-safe interpretation of the canonical PTY Tail artwork.
 *
 * Rounded box-drawing glyphs preserve the open loop and flowing lower tail
 * without relying on image protocols or wide block runs. The two square
 * endpoints remain visually distinct and every glyph occupies one cell.
 */
export const wideLogoLines = [
  "■────╮",
  "     ╰────────╮",
  "              │",
  "       ╭──────╯",
  "      ╭╯",
  "      ╰──╮",
  "■────────╯",
] as const;

export const compactLogoLines = [
  "■───╮",
  "    ╰────╮",
  "         │",
  "    ╭────╯",
  "    ╰─╮",
  "■─────╯",
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
