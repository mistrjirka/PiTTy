#!/usr/bin/env bun
// Generates native terminal screenshots of the subagent inspector with the
// pause / resume / stop control row, by driving a real file-backed subagent
// run through the production PiTTy surface. Each state builds a fixture run,
// launches PiTTy against the mock RPC, opens the inspector by clicking the
// sidebar row, asserts the expected control markers, and captures a PNG.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { asyncRunsRoot } from "../src/subagents/artifacts.ts";
import { CELL_HEIGHT, CELL_WIDTH, chromiumBinary, renderTerminalFramePng } from "./terminal-frame-png.ts";

type SubagentScreenshotState = {
  name: "subagent-running" | "subagent-paused";
  runState: "running" | "paused";
  expected: string[];
};

const outputDir = join(import.meta.dir, "..", "docs", "screenshots");
const columns = 140;
const rows = 44;
const surfaceWidth = columns * CELL_WIDTH;
const surfaceHeight = rows * CELL_HEIGHT;
const executable = join(import.meta.dir, "mock-pi-rpc.mjs");
// ANSI/SGR escape sequences are matched with named constants so the ESC byte
// (\u001b) and the trailing <\/span> replacement never appear as raw literals
// that are hard to read or parse inline.
const CSI_NON_SGR = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const SGR_SEQUENCE = /\x1b\[[0-9;]*m/g;
const SGR_EXACT = /^\x1b\[([0-9;]*)m$/;
const CSI_GROUP = /(\x1b\[[0-9;]*m)/g;
const NBSP_TRAILING = /[ \t]+(?=<\/span>|$|\n)/g;

const states: SubagentScreenshotState[] = [
  {
    name: "subagent-running",
    runState: "running",
    expected: ["⏸ pause", "⏹ stop", "ctrl+a pause  ctrl+shift+a stop"],
  },
  {
    name: "subagent-paused",
    runState: "paused",
    expected: ["▶ resume", "⏹ stop"],
  },
];

function runNativeCommand(command: string, args: string[], label: string) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 15_000 });
  if (result.error || result.status !== 0)
    throw new Error(`${label}: ${result.stderr || result.error?.message || `exit ${result.status}`}`);
  return result;
}

function sleep(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ansiToHtml(value: string): string {
  let color = "";
  let html = "";
  for (const part of value.split(CSI_GROUP)) {
    const match = SGR_EXACT.exec(part);
    if (match) {
      const codes = (match[1] ?? "").split(";");
      if (codes.includes("0")) color = "";
      else if (codes.includes("31")) color = "red";
      else if (codes.includes("32")) color = "green";
      else if (codes.includes("33")) color = "yellow";
      else if (codes.includes("35")) color = "magenta";
      else if (codes.includes("36")) color = "cyan";
      else if (codes.includes("37")) color = "white";
      continue;
    }
    html += color ? `<span class="${color}">${escapeHtml(part)}</span>` : escapeHtml(part);
  }
  return html.replace(NBSP_TRAILING, (spaces) => "&nbsp;".repeat(spaces.length));
}

function requireTool(command: string, args: string[], label: string): void {
  runNativeCommand(command, args, label);
}
function stripAnsi(value: string): string {
  return value.replace(CSI_NON_SGR, "").replace(SGR_SEQUENCE, "");
}

function writeRunFixture(root: string, runId: string, runState: "running" | "paused"): void {
  const asyncDir = join(root, runId);
  mkdirSync(asyncDir, { recursive: true });
  const now = Date.now();
  const activityState = runState === "paused" ? "paused" : "active_long_running";
  const status = {
    runId,
    mode: "single",
    state: runState,
    agent: "reviewer",
    sessionId: "mock-session",
    startedAt: now - 4000,
    lastUpdate: now,
    activityState,
    turnCount: 3,
    toolCount: 2,
    steps: [
      {
        index: 0,
        agent: "reviewer",
        status: runState === "paused" ? "paused" : "running",
        activityState,
        lastActivityAt: now,
        currentTool: "read",
        currentPath: "src/app.tsx",
        turnCount: 3,
        toolCount: 2,
      },
    ],
  };
  writeFileSync(join(asyncDir, "status.json"), JSON.stringify(status, null, 2));
}

// Locates the active subagent row in a captured pane and returns its 0-indexed
// row plus the column of the reviewer label so we can click it open.
function locateSubagentRow(captured: string): { row: number; column: number } | undefined {
  const lines = stripAnsi(captured).split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    // The agent row lives in the right sidebar; the transcript's tool row
    // also names the reviewer but toggles the call instead of opening it.
    const column = line.lastIndexOf("reviewer");
    if (column < columns - 40) continue;
    return { row: index, column };
  }
  return undefined;
}

function clickRow(socket: string, session: string, row: number, column: number): void {
  const mouseSequence = `${String.fromCharCode(27)}[<0;${column + 1};${row + 1}`;
  runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-e"], "enable pane input");
  runNativeCommand("tmux", ["-L", socket, "send-keys", "-t", session, "-l", `${mouseSequence}M`], "press inspector row");
  runNativeCommand("tmux", ["-L", socket, "send-keys", "-t", session, "-l", `${mouseSequence}m`], "release inspector row");
  runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-d"], "disable pane input");
}

function capturePane(socket: string, session: string): string {
  return runNativeCommand("tmux", ["-L", socket, "capture-pane", "-e", "-p", "-t", session], "capture pane").stdout;
}

function captureState(state: SubagentScreenshotState, chromium: string): void {
  const userId = process.getuid?.();
  if (userId === undefined) throw new Error("native screenshot capture requires a Unix user id");
  const runsRoot = asyncRunsRoot();
  const runId = `pitty-screenshot-${process.pid}-${state.name}`;
  const fixtureDir = join(runsRoot, runId);
  const session = `pitty-subagent-${process.pid}-${state.name}`;
  const socket = `pitty-subagent-shot-${process.pid}-${state.name}`;
  const tmuxSocketPath = join(process.env.TMUX_TMPDIR ?? "/tmp", `tmux-${userId}`, socket);
  const temporaryDir = join(tmpdir(), `pitty-subagent-screenshot-${process.pid}`);
  const homeDir = join(temporaryDir, "home");
  const cleanup = () => rmSync(temporaryDir, { recursive: true, force: true });
  const cleanupFixture = () => rmSync(fixtureDir, { recursive: true, force: true });
  process.once("exit", cleanup);
  process.once("exit", cleanupFixture);

  try {
    // Subagent runs live under the real uid temp root (independent of HOME), so
    // the app discovers the fixture; the empty package dirs mark the optional
    // integrations installed, exactly as the main screenshot script does, so no
    // "optional packages not detected" notice ends up in a published image.
    cleanupFixture();
    writeRunFixture(runsRoot, runId, state.runState);
    rmSync(homeDir, { recursive: true, force: true });
    for (const packagePath of ["@mistrjirka/pi-subagent", "pi-one-round-compaction", "pi-subagents", "@juicesharp/rpiv-todo", "pi-mcp-adapter", "pi-hermes-memory"]) {
      mkdirSync(join(homeDir, ".pi", "agent", "npm", "node_modules", packagePath), { recursive: true });
    }

    try {
      rmSync(tmuxSocketPath);
    } catch {
      /* no stale socket */
    }
    runNativeCommand(
      "tmux",
      [
        "-L", socket, "new-session", "-d", "-x", String(columns), "-y", String(rows), "-s", session, "env",
        `HOME=${homeDir}`, "MOCK_SCREENSHOT_RICH=1", "MOCK_SCREENSHOT_SCENARIO=rich", "bun", "run",
        "src/index.tsx", "--pi", executable,
      ],
      `unable to start production PiTTy for ${state.name}`,
    );
    runNativeCommand("tmux", ["-L", socket, "set-option", "-t", session, "status", "off"], "hide tmux chrome");
    // Detached, the session keeps exactly the requested grid; nothing is shown on screen.
    runNativeCommand("tmux", ["-L", socket, "set-option", "-t", session, "window-size", "manual"], `pin the session grid for ${state.name}`);
    runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-d"], "disable pane input");

    // Wait for the sidebar subagent row, then click it to open the inspector.
    sleep(4_500);
    let captured = capturePane(socket, session);
    let located = locateSubagentRow(captured);
    for (let attempt = 0; attempt < 40 && !located; attempt++) {
      sleep(250);
      captured = capturePane(socket, session);
      located = locateSubagentRow(captured);
    }
    if (!located) throw new Error(`subagent row was not located for ${state.name}`);
    clickRow(socket, session, located.row, located.column);

    // Wait for the inspector control markers to appear.
    for (let attempt = 0; attempt < 40; attempt++) {
      sleep(200);
      captured = capturePane(socket, session);
      if (state.expected.every((marker) => captured.includes(marker))) break;
    }
    const missing = state.expected.filter((marker) => !captured.includes(marker));
    if (missing.length) {
      throw new Error(`capture ${state.name} failed markers=${missing.join(",")}`);
    }

    const grid = runNativeCommand("tmux", ["-L", socket, "display-message", "-p", "-t", session, "#{pane_width}x#{pane_height}"], "inspect grid").stdout.trim();
    if (grid !== `${columns}x${rows}`) throw new Error(`grid is ${grid}, expected ${columns}x${rows}`);

    const ansi = `${captured.trimEnd()}\n`;
    writeFileSync(join(outputDir, `${state.name}.ansi`), ansi);
    writeFileSync(
      join(outputDir, `${state.name}.html`),
      `<!doctype html><meta charset="utf-8"><title>PiTTy ${state.name} ANSI diagnostic</title><style>body{background:#10131a;color:#d8dee9}pre{font:14px monospace;line-height:17px;white-space:pre}.red{color:#f66}.green{color:#6f6}.yellow{color:#ff6}.cyan{color:#6ff}.magenta{color:#f6f}.white{color:#fff}</style><pre>${ansiToHtml(ansi)}</pre>`,
    );

    const png = join(outputDir, `${state.name}.png`);
    renderTerminalFramePng(ansi, png, columns, rows, chromium);
    process.stdout.write(`captured ${state.name}: ${surfaceWidth}x${surfaceHeight} with ${state.expected.length} control markers\n`);
  } finally {
    cleanupFixture();
    spawnSync("tmux", ["-L", socket, "kill-session", "-t", session], { encoding: "utf8" });
    sleep(500);
    try {
      rmSync(tmuxSocketPath);
    } catch {
      /* tmux may remove its socket */
    }
  }
}

function main(): void {
  mkdirSync(outputDir, { recursive: true });
  requireTool("tmux", ["-V"], "tmux is required");
  // PiTTy runs in an off-screen tmux terminal; headless Chromium only draws
  // tmux's recorded cells. No window opens and nothing on the desktop is read.
  const chromium = chromiumBinary();

  for (const state of states) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        captureState(state, chromium);
        break;
      } catch (error) {
        if (attempt === 1) throw error;
        console.error(`attempt ${attempt + 1} failed for ${state.name}: ${error instanceof Error ? error.message : String(error)}`);
        sleep(1_500);
      }
    }
  }
  process.stdout.write(`Generated ${states.length} subagent inspector PNGs (${columns}x${rows} cells, ${surfaceWidth}x${surfaceHeight}, headless Chromium) in ${outputDir}\n`);
}

main();
