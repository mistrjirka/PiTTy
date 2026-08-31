#!/usr/bin/env bun
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

type ScreenshotState = {
  name: "conversation" | "model-selector" | "blank-session" | "long-diff" | "tab-strip";
  expected: string[];
  keys?: string[];
  interaction?: "open-diff";
  scenario: string;
};

const outputDir = join(import.meta.dir, "..", "docs", "screenshots");
const columns = 120;
const rows = 36;
const surfaceWidth = 1200;
const surfaceHeight = 700;
const transientNotificationWaitMs = 7_500;
const expectedEmptyPrompt = "Ask Pi anything… (/help for commands)";
const executable = join(import.meta.dir, "mock-pi-rpc.mjs");
const states: ScreenshotState[] = [
  { name: "conversation", scenario: "rich", expected: ["Supervisor: release review complete", "ctrl+p models"] },
  { name: "model-selector", scenario: "model-selector", expected: ["Select model", "tok/s", "TTFT", "ready"], keys: ["C-p"] },
  { name: "blank-session", scenario: "empty", expected: ["Ask Pi anything", "ctrl+p models", "ready"] },
  { name: "long-diff", scenario: "long-diff", expected: ["ctrl+p models", "ready"], interaction: "open-diff" },
  { name: "tab-strip", scenario: "rich", expected: ["⑂", "+", "Mock Pi Session"] },
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
function hasValidEmptyPrompt(captured: string): boolean {
  const plain = captured.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  return plain.split("\n").filter((line) => line.trim() === expectedEmptyPrompt).length === 1;
}

mkdirSync(outputDir, { recursive: true });
const prerequisites: Array<[string, string[], string]> = [
  ["tmux", ["-V"], "tmux is required"],
  ["kitty", ["--version"], "kitty is required for native PNG capture"],
  ["xdotool", ["-v"], "xdotool is required for native PNG capture"],
  ["import", ["-version"], "ImageMagick import is required for native PNG capture"],
  ["identify", ["-version"], "ImageMagick identify is required"],
];
for (const [command, args, label] of prerequisites) requireTool(command, args, label);

const userId = process.getuid?.();
if (userId === undefined) throw new Error("native screenshot capture requires a Unix user id");
const temporaryDir = join(tmpdir(), `pitty-screenshot-${process.pid}`);
const performanceHome = join(temporaryDir, "state");
const homeDir = join(temporaryDir, "home");
const cleanupTemporaryDir = () => rmSync(temporaryDir, { recursive: true, force: true });
process.once("exit", cleanupTemporaryDir);
mkdirSync(join(performanceHome, "pitty"), { recursive: true });
mkdirSync(homeDir, { recursive: true });
const optionalPackageRoot = join(homeDir, ".pi", "agent", "npm", "node_modules");
for (const packagePath of ["pi-subagents", "@juicesharp/rpiv-todo", "pi-mcp-adapter", "pi-hermes-memory"]) {
  mkdirSync(join(optionalPackageRoot, packagePath), { recursive: true });
}
writeFileSync(join(performanceHome, "pitty", "model-performance-history.json"), JSON.stringify({
  "openai-codex\u0000gpt-5.6-sol": [
    { timestamp: Date.now(), ttftMs: 820, outputTokensPerSecond: 142 },
    { timestamp: Date.now() - 1000, ttftMs: 760, outputTokensPerSecond: 156 },
    { timestamp: Date.now() - 2000, ttftMs: 790, outputTokensPerSecond: 149 },
  ],
}));

for (const state of states) {
  const session = `pitty-screenshots-${process.pid}-${state.name}`;
  const socket = `pitty-shot-${process.pid}-${state.name}`;
  const tmuxSocketPath = join(process.env.TMUX_TMPDIR ?? "/tmp", `tmux-${userId}`, socket);
  const kittySocket = `/tmp/pitty-kitty-${process.pid}-${state.name}`;
  const kittyClass = `pitty-screenshot-${process.pid}-${state.name}`;
  let windowId: number | undefined;
  try {
    try { unlinkSync(tmuxSocketPath); } catch { /* no stale socket */ }
    const activeWindowResult = spawnSync("xdotool", ["getactivewindow"], { encoding: "utf8", timeout: 2_000 });
    const activeWindow = activeWindowResult.status === 0 ? activeWindowResult.stdout.trim() : "";
    const activeWindowPid = activeWindow
      ? spawnSync("xdotool", ["getwindowpid", activeWindow], { encoding: "utf8", timeout: 2_000 })
      : undefined;
    const canRestoreFocus = activeWindowPid?.status === 0 && activeWindowPid.stdout.trim().length > 0;
    runNativeCommand("tmux", ["-L", socket, "new-session", "-d", "-x", String(columns), "-y", String(rows), "-s", session, "env", `HOME=${homeDir}`, "MOCK_SCREENSHOT_RICH=1", `MOCK_SCREENSHOT_SCENARIO=${state.scenario}`, `XDG_STATE_HOME=${performanceHome}`, "bun", "run", "src/index.tsx", "--pi", executable], `unable to start production PiTTy for ${state.name}`);
    runNativeCommand("tmux", ["-L", socket, "set-option", "-t", session, "status", "off"], `unable to hide tmux chrome for ${state.name}`);
    runNativeCommand("kitty", ["--detach", `--listen-on=unix:${kittySocket}`, `--class=${kittyClass}`, "--start-as=hidden", "--override", "allow_remote_control=socket-only", "--override", "linux_display_server=x11", "--override", "font_size=8.2", "--override", "modify_font=cell_width 128%", "--override", "window_padding_width=0", "--override", "hide_window_decorations=yes", "--override", "initial_window_width=120c", "--override", "initial_window_height=36c", "--override", "background=#10131a", "--override", "foreground=#d8dee9", "--", "tmux", "-L", socket, "attach-session", "-t", session], `unable to launch native terminal for ${state.name}`);
    for (let attempt = 0; attempt < 40 && windowId === undefined; attempt++) {
      sleep(100);
      const found = spawnSync("xdotool", ["search", "--class", kittyClass], { encoding: "utf8", timeout: 2_000 });
      if (found.status === 0) {
        for (const candidate of found.stdout.trim().split("\n")) {
          const id = Number(candidate);
          const geometry = Number.isInteger(id) && id > 0 ? spawnSync("xdotool", ["getwindowgeometry", String(id)], { encoding: "utf8", timeout: 2_000 }) : undefined;
          if (geometry?.status === 0) { windowId = id; break; }
        }
      }
    }
    if (windowId === undefined) throw new Error(`native Kitty window was not discoverable for ${state.name}`);
    sleep(300);
    let resized = false;
    for (let attempt = 0; attempt < 40 && !resized; attempt++) {
      const geometry = spawnSync("xdotool", ["getwindowgeometry", String(windowId)], { encoding: "utf8", timeout: 2_000 });
      if (geometry.status === 0) {
        const result = spawnSync("xdotool", ["windowsize", String(windowId), String(surfaceWidth), String(surfaceHeight)], { encoding: "utf8", timeout: 2_000 });
        resized = result.status === 0;
      }
      if (!resized) sleep(100);
    }
    if (!resized) throw new Error(`unable to set native terminal size for ${state.name}: Kitty window disappeared`);
    runNativeCommand("xdotool", ["windowmove", String(windowId), "0", "0"], `unable to position native terminal for ${state.name}`);
    runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-d"], `unable to disable native terminal input for ${state.name}`);
    runNativeCommand("xdotool", ["windowmap", String(windowId)], `unable to map native terminal for ${state.name}`);
    if (canRestoreFocus) {
      runNativeCommand("xdotool", ["windowactivate", "--sync", activeWindow], `unable to restore active window for ${state.name}`);
      runNativeCommand("xdotool", ["windowfocus", activeWindow], `unable to focus restored window for ${state.name}`);
      const focusedWindow = runNativeCommand("xdotool", ["getactivewindow"], `unable to verify active window for ${state.name}`).stdout.trim();
      if (focusedWindow === String(windowId)) throw new Error(`native terminal retained focus for ${state.name}`);
    }
    let captured = runNativeCommand("tmux", ["-L", socket, "capture-pane", "-e", "-p", "-t", session], `unable to capture ${state.name}`).stdout;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (state.name === "blank-session"
        ? captured.includes("ready") && !captured.includes("Loading recent sessions")
        : state.keys ? captured.includes("ready") : state.expected.every((marker) => captured.includes(marker))) break;
      sleep(250);
      captured = runNativeCommand("tmux", ["-L", socket, "capture-pane", "-e", "-p", "-t", session], `unable to capture ${state.name}`).stdout;
    }
    if (state.keys) {
      runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-e"], `unable to enable native terminal input for ${state.name}`);
      runNativeCommand("tmux", ["-L", socket, "send-keys", "-t", session, ...state.keys], `unable to prepare ${state.name}`);
      runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-d"], `unable to disable native terminal input for ${state.name}`);
      sleep(1000);
      for (let attempt = 0; attempt < 30; attempt++) {
        sleep(150);
        captured = runNativeCommand("tmux", ["-L", socket, "capture-pane", "-e", "-p", "-t", session], `unable to capture ${state.name}`).stdout;
        if (state.expected.every((marker) => captured.includes(marker))) break;
        if (attempt === 10 && state.name === "model-selector" && !captured.includes("Select model")) {
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
        if (captured.includes("scroll diff") && captured.includes("wrapped transcript diff line")) {
          opened = true;
          break;
        }
      }
      if (!opened) throw new Error(`native diff did not open for ${state.name}`);
    }
    sleep(transientNotificationWaitMs);
    captured = runNativeCommand("tmux", ["-L", socket, "capture-pane", "-e", "-p", "-t", session], `unable to capture ${state.name} after settling`).stdout;
    const missing = state.expected.filter((marker) => !captured.includes(marker));
    const invalidPrompt = !hasValidEmptyPrompt(captured);
    if (missing.length || invalidPrompt || (state.name === "blank-session" && (captured.includes("Starting Pi runtime") || captured.includes("Loading recent sessions")))) throw new Error(`capture ${state.name} failed markers=${missing.join(",")} invalidPrompt=${invalidPrompt}`);
    const grid = runNativeCommand("tmux", ["-L", socket, "display-message", "-p", "-t", session, "#{pane_width}x#{pane_height}"], `unable to inspect terminal grid for ${state.name}`).stdout.trim();
    if (grid !== `${columns}x${rows}`) throw new Error(`native terminal grid is ${grid}, expected ${columns}x${rows}`);
    const ansi = captured.trimEnd() + "\n";
    writeFileSync(join(outputDir, `${state.name}.ansi`), ansi);
    writeFileSync(join(outputDir, `${state.name}.html`), `<!doctype html><meta charset="utf-8"><title>PiTTy ${state.name} ANSI diagnostic</title><style>body{background:#10131a;color:#d8dee9}pre{font:14px monospace;line-height:17px;white-space:pre}.red{color:#f66}.green{color:#6f6}.yellow{color:#ff6}.cyan{color:#6ff}.magenta{color:#f6f}.white{color:#fff}</style><pre>${ansiToHtml(ansi).replace(/[ 	]+(?=<\/span>|$)/gm, (spaces) => "&nbsp;".repeat(spaces.length))}</pre>`);
    const png = join(outputDir, `${state.name}.png`);
    runNativeCommand("import", ["-window", String(windowId), png], `unable to capture native PNG for ${state.name}`);
    const dimensions = runNativeCommand("identify", ["-format", "%w %h", png], `unable to inspect native PNG for ${state.name}`).stdout.trim().split(/\s+/).map(Number);
    if (dimensions[0] !== surfaceWidth || dimensions[1] !== surfaceHeight) throw new Error(`native PNG is ${dimensions[0]}x${dimensions[1]}, expected ${surfaceWidth}x${surfaceHeight}`);
  } finally {
    spawnSync("tmux", ["-L", socket, "kill-session", "-t", session], { encoding: "utf8" });
    if (windowId !== undefined) spawnSync("xdotool", ["windowclose", String(windowId)], { encoding: "utf8", timeout: 2_000 });
    sleep(500);
    try { unlinkSync(tmuxSocketPath); } catch { /* tmux may remove its socket */ }
    try { unlinkSync(kittySocket); } catch { /* kitty may remove its socket */ }
  }
}
cleanupTemporaryDir();
process.stdout.write(`Generated ${states.length} native terminal PNGs (${columns}x${rows} cells, ${surfaceWidth}x${surfaceHeight}, Kitty X11) in ${outputDir}\n`);
