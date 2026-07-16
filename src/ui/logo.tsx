import { useTerminalDimensions } from "@opentui/solid";
import { For } from "solid-js";
import { colors } from "./theme.ts";

export type LogoProps = {
  compact?: boolean;
  wordmarkOnly?: boolean;
};

export const microLogo = "[> π <]";

export const compactLogoLines = [
  "▄███████                ███████▄",
  "███           ▄▄▄▄           ███",
  "███     ██▄  ▀████▀  ▄██     ███",
  "███      ▀██▄ ████ ▄██▀      ███",
  "███      ▄██▀ ████ ▀██▄      ███",
  "███     ██▀   ████▄  ▀██     ███",
  "███           ▀▀ ▀▀          ███",
  "▀███████                ███████▀",
] as const;

export const wideLogoLines = [
  "  ▄▄▄▄▄▄                         ▄▄▄▄▄▄",
  "█████████▀                     ▀█████████",
  "███                                   ███",
  "███       ▄▄▄    ███████    ▄▄▄       ███",
  "███       ▀███▄   ██▀██   ▄███▀       ███",
  "███         ▀███▄ ██ ██ ▄███▀         ███",
  "███         ▄███▀ ██ ██ ▀███▄         ███",
  "███       ▄███▀   ██ ██   ▀███▄       ███",
  "███       ▀▀▀     ██ ▀███   ▀▀▀       ███",
  "███                                   ███",
  "█████████▄                     ▄█████████",
  "  ▀▀▀▀▀▀                         ▀▀▀▀▀▀",
] as const;

const emergencyWideLogoLines = ["■────╮", "■────╯"] as const;
const emergencyCompactLogoLines = ["■───╮", "■───╯"] as const;

export function logoCellWidth(lines: readonly string[]): number {
  return Math.max(0, ...lines.map((line) => [...line].length));
}

function hasRoom(
  lines: readonly string[],
  dimensions: { width: number; height: number },
  reservedRows: number,
): boolean {
  return dimensions.width >= logoCellWidth(lines) + 4
    && dimensions.height >= lines.length + reservedRows;
}

/**
 * Responsive terminal rendering of PiTTy's asymmetric [> π <] mark.
 *
 * The large variants are pre-rasterized from the canonical vector artwork and
 * encoded with Unicode half blocks. The left π leg remains straight while the
 * right leg curls outward, and both chevrons keep equal clear space around π.
 */
export function Logo(props: LogoProps) {
  const dimensions = useTerminalDimensions();

  if (props.wordmarkOnly || dimensions().width < microLogo.length + 4) {
    return <text fg={colors.textBright} attributes={1}>PiTTy</text>;
  }

  // Preserve a two-row emergency mark at eight terminal rows or fewer. It is
  // only used where neither the dashboard raster nor the micro lockup fits.
  if (dimensions().height <= 8) {
    const lines = props.compact ? emergencyCompactLogoLines : emergencyWideLogoLines;
    return (
      <box flexDirection="column" alignItems="center">
        <For each={lines}>
          {(line) => <text fg={colors.accent} attributes={1} wrapMode="none">{line}</text>}
        </For>
        <text fg={colors.textBright} attributes={1}>PiTTy</text>
      </box>
    );
  }

  const wideFits = !props.compact && hasRoom(wideLogoLines, dimensions(), 12);
  const compactFits = hasRoom(compactLogoLines, dimensions(), 8);
  const lines = wideFits
    ? wideLogoLines
    : compactFits
      ? compactLogoLines
      : undefined;

  if (!lines) {
    return (
      <box flexDirection="column" alignItems="center">
        <text fg={colors.accent} attributes={1} wrapMode="none">{microLogo}</text>
        <text fg={colors.textBright} attributes={1}>PiTTy</text>
      </box>
    );
  }

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
