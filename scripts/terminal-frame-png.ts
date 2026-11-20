/**
 * Turns a `tmux capture-pane -e` frame into a PNG without any window.
 *
 * The screenshot scripts used to show the frame in a kitty window and grab it.
 * On Wayland the only grab available is the desktop portal's "active window",
 * which captured whatever the user had focused (a browser, another terminal)
 * and wrote it out as a README screenshot. tmux already holds the exact cells
 * and colours, so this renders them as a fixed grid of HTML cells and lets
 * headless Chromium screenshot that page off-screen. Nothing on the desktop is
 * read, focused or shown.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// DejaVu Sans Mono at 18px is 10.8px wide and 21px tall, so an 11x21 cell
// lets box-drawing glyphs join across rows, and it covers `◆`, `⑂` and braille.
export const CELL_WIDTH = 11;
export const CELL_HEIGHT = 21;
const DEFAULT_FG = "#d8dee9";
const DEFAULT_BG = "#10131a";
const FONT = `"DejaVu Sans Mono", "Noto Sans Mono", monospace`;

type Style = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
};

const BASIC = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5"];
const BRIGHT = ["#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"];

function xterm256(index: number): string {
  if (index < 8) return BASIC[index]!;
  if (index < 16) return BRIGHT[index - 8]!;
  if (index < 232) {
    const value = index - 16;
    const level = (step: number) => (step === 0 ? 0 : 55 + step * 40);
    const r = level(Math.floor(value / 36));
    const g = level(Math.floor(value / 6) % 6);
    const b = level(value % 6);
    return `rgb(${r},${g},${b})`;
  }
  const gray = 8 + (index - 232) * 10;
  return `rgb(${gray},${gray},${gray})`;
}

/** Applies one SGR parameter list; returns the new style. */
function applySgr(style: Style, raw: string): Style {
  const codes = raw === "" ? [0] : raw.split(";").map((part) => Number(part || 0));
  let next: Style = { ...style };
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index]!;
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) { next.bold = false; next.dim = false; }
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 27) next.inverse = false;
    else if (code >= 30 && code <= 37) next.fg = BASIC[code - 30];
    else if (code >= 90 && code <= 97) next.fg = BRIGHT[code - 90];
    else if (code === 39) delete next.fg;
    else if (code >= 40 && code <= 47) next.bg = BASIC[code - 40];
    else if (code >= 100 && code <= 107) next.bg = BRIGHT[code - 100];
    else if (code === 49) delete next.bg;
    else if (code === 38 || code === 48) {
      const mode = codes[index + 1];
      let color: string | undefined;
      if (mode === 2) {
        color = `rgb(${codes[index + 2] ?? 0},${codes[index + 3] ?? 0},${codes[index + 4] ?? 0})`;
        index += 4;
      } else if (mode === 5) {
        color = xterm256(codes[index + 2] ?? 0);
        index += 2;
      }
      if (color) {
        if (code === 38) next.fg = color;
        else next.bg = color;
      }
    }
  }
  return next;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cellStyle(style: Style): string {
  let fg = style.fg ?? DEFAULT_FG;
  let bg = style.bg;
  if (style.inverse) {
    const swap = bg ?? DEFAULT_BG;
    bg = fg;
    fg = swap;
  }
  return [
    `color:${fg}`,
    bg ? `background:${bg}` : "",
    style.bold ? "font-weight:700" : "",
    style.dim ? "opacity:.6" : "",
    style.italic ? "font-style:italic" : "",
    style.underline ? "text-decoration:underline" : "",
  ].filter(Boolean).join(";");
}

/**
 * One absolutely sized cell per terminal column, so a glyph the font draws
 * wider or narrower than a cell (braille spinners, `⑂`) can never shift the
 * rest of the row out of the grid tmux reported.
 */
export function terminalFrameHtml(ansi: string, columns: number, rows: number): string {
  const lines = ansi.replace(/\r/g, "").split("\n").slice(0, rows);
  const rowsHtml: string[] = [];
  for (const line of lines) {
    let style: Style = {};
    let column = 0;
    let html = "";
    // CSI sequences: SGR changes the style; anything else is dropped.
    const tokens = line.split(/(\x1b\[[0-9;?]*[ -/]*[@-~])/);
    for (const token of tokens) {
      if (token.startsWith("\x1b[")) {
        if (token.endsWith("m")) style = applySgr(style, token.slice(2, -1));
        continue;
      }
      for (const char of token) {
        if (column >= columns) break;
        // tmux leaves no placeholder after a wide glyph, so its width decides
        // how many cells it covers.
        const width = Math.max(1, Math.min(2, Bun.stringWidth(char)));
        html += `<span style="left:${column * CELL_WIDTH}px;width:${width * CELL_WIDTH}px;${cellStyle(style)}">${escapeHtml(char)}</span>`;
        column += width;
      }
    }
    rowsHtml.push(`<div class="r">${html}</div>`);
  }
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:${DEFAULT_BG};overflow:hidden}
.grid{width:${columns * CELL_WIDTH}px;height:${rows * CELL_HEIGHT}px;font:18px/${CELL_HEIGHT}px ${FONT}}
.r{position:relative;height:${CELL_HEIGHT}px;white-space:pre}
.r span{position:absolute;top:0;height:${CELL_HEIGHT}px;text-align:center;overflow:visible}
</style><div class="grid">${rowsHtml.join("")}</div>`;
}

export function chromiumBinary(): string {
  for (const candidate of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    if (spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 10_000 }).status === 0) return candidate;
  }
  throw new Error("headless Chromium is required to render screenshots (chromium or google-chrome)");
}

/** Renders the frame and verifies the PNG has the exact grid size. */
export function renderTerminalFramePng(ansi: string, png: string, columns: number, rows: number, chromium: string): void {
  const width = columns * CELL_WIDTH;
  const height = rows * CELL_HEIGHT;
  const dir = mkdtempSync(join(tmpdir(), "pitty-frame-"));
  try {
    const page = join(dir, "frame.html");
    writeFileSync(page, terminalFrameHtml(ansi, columns, rows));
    const result = spawnSync(chromium, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--user-data-dir=${join(dir, "profile")}`,
      `--window-size=${width},${height}`,
      `--screenshot=${png}`,
      `file://${page}`,
    ], { encoding: "utf8", timeout: 60_000 });
    if (result.status !== 0) throw new Error(`chromium failed: ${result.stderr || result.error?.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const size = spawnSync("identify", ["-format", "%w %h", png], { encoding: "utf8", timeout: 15_000 });
  if (size.status === 0 && size.stdout.trim() !== `${width} ${height}`) {
    throw new Error(`rendered PNG is ${size.stdout.trim()}, expected ${width} ${height}`);
  }
}
