#!/usr/bin/env bun
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { PROFILED_RUNTIME_ROOT_PREFIX } from "../src/subagents/profiled-paths.ts";
import { CELL_HEIGHT, CELL_WIDTH, chromiumBinary, renderTerminalFramePng } from "./terminal-frame-png.ts";

type ScreenshotState = {
  name: "conversation" | "model-selector" | "blank-session" | "long-diff" | "tab-strip";
  expected: string[];
  keys?: string[];
  interaction?: "open-diff";
  scenario: string;
};

const outputDir = join(import.meta.dir, "..", "docs", "screenshots");
const columns = 140;
const rows = 44;
const surfaceWidth = columns * CELL_WIDTH;
const surfaceHeight = rows * CELL_HEIGHT;
const transientNotificationWaitMs = 7_500;
const expectedEmptyPrompt = "Ask Pi anything…";
const executable = join(import.meta.dir, "mock-pi-rpc.mjs");
const states: ScreenshotState[] = [
  { name: "conversation", scenario: "rich", expected: ["supervisor: release review complete", "◆ Main", "@yui · explore", "ctrl+p model"] },
  { name: "model-selector", scenario: "model-selector", expected: ["Model", "tok/s", "first token", "ready"], keys: ["C-p"] },
  { name: "blank-session", scenario: "empty", expected: ["Ask Pi anything", "ctrl+p model", "ready"] },
  { name: "long-diff", scenario: "long-diff", expected: ["ctrl+p model", "ready"], interaction: "open-diff" },
  { name: "tab-strip", scenario: "rich", expected: ["⑂", "+", "New conversation"] },
];

function runNativeCommand(command: string, args: string[], label: string) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 15_000 });
  if (result.error || result.status !== 0) throw new Error(`${label}: ${result.stderr || result.error?.message || `exit ${result.status}`}`);
  return result;
}
function sleep(ms: number): void { spawnSync("sleep", [String(ms / 1000)]); }
function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function ansiToHtml(value: string): string {
  let color = "";
  let html = "";
  for (const part of value.split(/(\x1b\[[0-9;]*m)/g)) {
    const match = /^\x1b\[([0-9;]*)m$/.exec(part);
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
  return html;
}
function requireTool(command: string, args: string[], label: string): void { runNativeCommand(command, args, label); }
/** Style codes can split a marker (`◆ ` then bold `Main`), so markers match visible text. */
function visible(captured: string): string {
  return captured.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}
function hasValidEmptyPrompt(captured: string): boolean {
  // The prompt is a rounded box: `│ › Ask Pi anything…   │`.
  return visible(captured).split("\n").filter((line) => line.replace(/[│›]/g, "").trim() === expectedEmptyPrompt).length === 1;
}

mkdirSync(outputDir, { recursive: true });
requireTool("tmux", ["-V"], "tmux is required");
// PiTTy runs in an off-screen tmux terminal. Headless Chromium only draws
// tmux's recorded cells into the PNG: no window opens and nothing on the
// desktop is captured.
const chromium = chromiumBinary();

const userId = process.getuid?.();
if (userId === undefined) throw new Error("native screenshot capture requires a Unix user id");
const temporaryDir = join(tmpdir(), `pitty-screenshot-${process.pid}`);
const performanceHome = join(temporaryDir, "state");
const homeDir = join(temporaryDir, "home");

// The sidebar's live children come from two places: the spawn tool results the
// mock serves (tree id + control directory) and these status records, whose
// heartbeat is what keeps each row reading as working. They are rewritten before
// every capture so a snapshot never shows an aged-out child.
const profiledRoot = join(tmpdir(), `${PROFILED_RUNTIME_ROOT_PREFIX}uid-${userId}-screenshot-${process.pid}`);
// The fixture derives its child ids and tree id from its own root name, and the
// mock derives the same ones from MOCK_SUBAGENT_ROOT. Two fixture roots must
// never collide on an id: the app merges runs by id, so a leftover root would
// silently replace this run's live children with its own stale copy.
const profiledSuffix = profiledRoot.split("/").pop() ?? "";
const profiledTreeId = `tree-screenshot-${profiledSuffix}`;
const profiledChildren = [
  { id: `spawn-yui-${profiledSuffix}`, agentId: "yui", profile: "explore", label: "map the release workflow", currentTool: "glob" },
  { id: `spawn-vic-${profiledSuffix}`, agentId: "vic", profile: "impl-check-contracts", label: "audit installer contracts", currentTool: "read" },
];
function writeProfiledFixtures(): void {
  for (const child of profiledChildren) {
    const controlDir = join(profiledRoot, child.id);
    mkdirSync(controlDir, { recursive: true });
    const now = Date.now();
    writeFileSync(join(controlDir, "status.json"), JSON.stringify({
      version: 1,
      runtime: "profiled-subagents",
      runId: child.id,
      agentId: child.agentId,
      profile: child.profile,
      label: child.label,
      treeId: profiledTreeId,
      parentAgentId: "root",
      state: "running",
      mode: "background",
      model: "gpt-5.6",
      sessionId: "mock-session",
      startedAt: now - 12_000,
      updatedAt: now,
      activityState: "active_long_running",
      turnCount: 2,
      toolCount: 1,
      steps: [{
        index: 0,
        agent: child.profile,
        status: "running",
        activityState: "active_long_running",
        lastActivityAt: now,
        currentTool: child.currentTool,
        ...(child.currentTool === "read" ? { currentPath: "src/app.tsx" } : {}),
        turnCount: 2,
        toolCount: 1,
      }],
    }, null, 2));
  }
}

const cleanupTemporaryDir = () => {
  rmSync(temporaryDir, { recursive: true, force: true });
  rmSync(profiledRoot, { recursive: true, force: true });
};
process.once("exit", cleanupTemporaryDir);
mkdirSync(join(performanceHome, "pitty"), { recursive: true });
mkdirSync(homeDir, { recursive: true });
const optionalPackageRoot = join(homeDir, ".pi", "agent", "npm", "node_modules");
for (const packagePath of ["@mistrjirka/pi-subagent", "pi-one-round-compaction", "pi-subagents", "@juicesharp/rpiv-todo", "pi-mcp-adapter", "pi-hermes-memory"]) {
  mkdirSync(join(optionalPackageRoot, packagePath), { recursive: true });
}
writeFileSync(join(performanceHome, "pitty", "model-performance-history.json"), JSON.stringify({
  "openai-codex\u0000gpt-5.6-sol": [
    { timestamp: Date.now(), ttftMs: 820, outputTokensPerSecond: 142, version: 3 },
    { timestamp: Date.now() - 1000, ttftMs: 760, outputTokensPerSecond: 156, version: 3 },
    { timestamp: Date.now() - 2000, ttftMs: 790, outputTokensPerSecond: 149, version: 3 },
  ],
}));

function captureState(state: ScreenshotState): void {
  writeProfiledFixtures();
  const session = `pitty-screenshots-${process.pid}-${state.name}`;
  const socket = `pitty-shot-${process.pid}-${state.name}`;
  const tmuxSocketPath = join(process.env.TMUX_TMPDIR ?? "/tmp", `tmux-${userId}`, socket);
  try {
    try { unlinkSync(tmuxSocketPath); } catch { /* no stale socket */ }
    runNativeCommand("tmux", ["-L", socket, "new-session", "-d", "-x", String(columns), "-y", String(rows), "-s", session, "env", `HOME=${homeDir}`, "MOCK_SCREENSHOT_RICH=1", `MOCK_SCREENSHOT_SCENARIO=${state.scenario}`, `XDG_STATE_HOME=${performanceHome}`, `MOCK_SUBAGENT_ROOT=${profiledRoot}`, "bun", "run", "src/index.tsx", "--pi", executable], `unable to start production PiTTy for ${state.name}`);
    runNativeCommand("tmux", ["-L", socket, "set-option", "-t", session, "status", "off"], `unable to hide tmux chrome for ${state.name}`);
    // Detached, the session keeps exactly the requested grid; nothing is shown on screen.
    runNativeCommand("tmux", ["-L", socket, "set-option", "-t", session, "window-size", "manual"], `unable to pin the session grid for ${state.name}`);
    runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-d"], `unable to disable native terminal input for ${state.name}`);
    let captured = runNativeCommand("tmux", ["-L", socket, "capture-pane", "-e", "-p", "-t", session], `unable to capture ${state.name}`).stdout;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (state.name === "blank-session"
        ? visible(captured).includes("ready") && !visible(captured).includes("Loading recent sessions")
        : state.keys ? visible(captured).includes("ready") : state.expected.every((marker) => visible(captured).includes(marker))) break;
      sleep(250);
      captured = runNativeCommand("tmux", ["-L", socket, "capture-pane", "-e", "-p", "-t", session], `unable to capture ${state.name}`).stdout;
    }
    if (state.keys) {
      runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-e"], `unable to enable native terminal input for ${state.name}`);
      // One key at a time: a key sent before its dialog has mounted is lost.
      for (const key of state.keys) {
        runNativeCommand("tmux", ["-L", socket, "send-keys", "-t", session, key], `unable to prepare ${state.name}`);
        sleep(400);
      }
      runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-d"], `unable to disable native terminal input for ${state.name}`);
      sleep(1000);
      for (let attempt = 0; attempt < 30; attempt++) {
        sleep(150);
        captured = runNativeCommand("tmux", ["-L", socket, "capture-pane", "-e", "-p", "-t", session], `unable to capture ${state.name}`).stdout;
        if (state.expected.every((marker) => visible(captured).includes(marker))) break;
        if (attempt === 10 && state.name === "model-selector" && !visible(captured).includes("tab list · ↑/↓ move")) {
          runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-e"], `unable to enable native terminal input for ${state.name}`);
          runNativeCommand("tmux", ["-L", socket, "send-keys", "-t", session, "C-p"], `unable to retry ${state.name}`);
          runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-d"], `unable to disable native terminal input for ${state.name}`);
        }
      }
    }
    if (state.interaction === "open-diff") {
      let plain = runNativeCommand("tmux", ["-L", socket, "capture-pane", "-p", "-t", session], `unable to locate diff control for ${state.name}`).stdout;
      for (let attempt = 0; attempt < 30 && !plain.includes("view diff"); attempt++) {
        sleep(150);
        plain = runNativeCommand("tmux", ["-L", socket, "capture-pane", "-p", "-t", session], `unable to capture ${state.name}`).stdout;
      }
      const lines = plain.split("\n");
      const label = lines.find((line) => line.includes("view diff"));
      if (!label) throw new Error(`unable to locate view diff control for ${state.name}`);
      const row = lines.indexOf(label);
      const column = label.indexOf("view diff");
      const mouseSequence = `${String.fromCharCode(27)}[<0;${column + 1};${row + 1}`;
      runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-e"], `unable to enable native terminal input for ${state.name}`);
      runNativeCommand("tmux", ["-L", socket, "send-keys", "-t", session, "-l", `${mouseSequence}M`], `unable to press diff control for ${state.name}`);
      runNativeCommand("tmux", ["-L", socket, "send-keys", "-t", session, "-l", `${mouseSequence}m`], `unable to release diff control for ${state.name}`);
      runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-d"], `unable to disable native terminal input for ${state.name}`);
      let opened = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        sleep(150);
        captured = runNativeCommand("tmux", ["-L", socket, "capture-pane", "-e", "-p", "-t", session], `unable to capture ${state.name}`).stdout;
        if (visible(captured).includes("scroll diff") && visible(captured).includes("wrapped transcript diff line")) {
          opened = true;
          break;
        }
      }
      if (!opened) throw new Error(`native diff did not open for ${state.name}`);
    }
    sleep(transientNotificationWaitMs);
    captured = runNativeCommand("tmux", ["-L", socket, "capture-pane", "-e", "-p", "-t", session], `unable to capture ${state.name} after settling`).stdout;
    const missing = state.expected.filter((marker) => !visible(captured).includes(marker));
    const invalidPrompt = !hasValidEmptyPrompt(captured);
    if (missing.length || invalidPrompt || (state.name === "blank-session" && (visible(captured).includes("Starting Pi runtime") || visible(captured).includes("Loading recent sessions")))) {
      writeFileSync(join(tmpdir(), `${state.name}.debug.ansi`), captured);
      throw new Error(`capture ${state.name} failed markers=${missing.join(",")} invalidPrompt=${invalidPrompt}`);
    }
    const grid = runNativeCommand("tmux", ["-L", socket, "display-message", "-p", "-t", session, "#{pane_width}x#{pane_height}"], `unable to inspect terminal grid for ${state.name}`).stdout.trim();
    if (grid !== `${columns}x${rows}`) throw new Error(`native terminal grid is ${grid}, expected ${columns}x${rows}`);
    const ansi = captured.trimEnd() + "\n";
    writeFileSync(join(outputDir, `${state.name}.ansi`), ansi);
    writeFileSync(join(outputDir, `${state.name}.html`), `<!doctype html><meta charset="utf-8"><title>PiTTy ${state.name} ANSI diagnostic</title><style>body{background:#10131a;color:#d8dee9}pre{font:14px monospace;line-height:17px;white-space:pre}.red{color:#f66}.green{color:#6f6}.yellow{color:#ff6}.cyan{color:#6ff}.magenta{color:#f6f}.white{color:#fff}</style><pre>${ansiToHtml(ansi).replace(/[ 	]+(?=<\/span>|$)/gm, (spaces) => "&nbsp;".repeat(spaces.length))}</pre>`);
    const png = join(outputDir, `${state.name}.png`);
    renderTerminalFramePng(ansi, png, columns, rows, chromium);
  } finally {
    spawnSync("tmux", ["-L", socket, "kill-session", "-t", session], { encoding: "utf8" });
    sleep(500);
    try { unlinkSync(tmuxSocketPath); } catch { /* tmux may remove its socket */ }
}
}
for (const state of states) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      captureState(state);
      break;
    } catch (error) {
      if (attempt === 1) throw error;
      sleep(1_500);
    }
  }
}

cleanupTemporaryDir();
process.stdout.write(`Generated ${states.length} native terminal PNGs (${columns}x${rows} cells, ${surfaceWidth}x${surfaceHeight}, headless Chromium) in ${outputDir}\n`);
