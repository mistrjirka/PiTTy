import { colors } from "./theme.ts";

export type LogoProps = {
  compact?: boolean;
  wordmarkOnly?: boolean;
};

/** A terminal-safe PiTTy mark; the square endpoints remain distinct at small widths. */
export function Logo(props: LogoProps) {
  if (props.wordmarkOnly) {
    return <text fg={colors.textBright} attributes={1}>PiTTy</text>;
  }
  return (
    <box flexDirection="column" alignItems="center" paddingTop={props.compact ? 0 : 1} paddingBottom={props.compact ? 0 : 1}>
      <text fg={colors.accent} attributes={1}>{props.compact ? "■───╮" : "■────╮"}</text>
      <text fg={colors.accent} attributes={1}>{props.compact ? "■───╯" : "■────╯"}</text>
      <text fg={colors.textBright} attributes={1}>PiTTy</text>
    </box>
  );
}
