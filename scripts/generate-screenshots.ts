#!/usr/bin/env bun
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { PROFILED_RUNTIME_ROOT_PREFIX } from "../src/subagents/profiled-paths.ts";

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
const surfaceWidth = 1400;
const surfaceHeight = 1028;
const transientNotificationWaitMs = 7_500;
const expectedEmptyPrompt = "Ask Pi anything… (/help for commands)";
const executable = join(import.meta.dir, "mock-pi-rpc.mjs");
/**
 * A Wayland compositor only captures windows it renders itself, and an XWayland
 * terminal's contents come back blank. So on a Wayland session the capture
 * terminal runs natively and the frame comes from the desktop portal; on X11
 * nothing changes.
 */
const waylandNative = Boolean(process.env.WAYLAND_DISPLAY);
const states: ScreenshotState[] = [
  { name: "conversation", scenario: "rich", expected: ["supervisor: release review complete", "Subagents (2 active)", "@yui · explore", "ctrl+p models"] },
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
/**
 * A captured TUI frame carries text and colour, so it has real variance; an
 * unpainted or half-painted window does not.
 */
const minimumFrameStandardDeviation = 2_000;
function pngStandardDeviation(png: string): number {
  const result = spawnSync("identify", ["-format", "%[standard-deviation]", png], { encoding: "utf8", timeout: 15_000 });
  return result.status === 0 ? Number(result.stdout.trim()) : 0;
}
/**
 * Capture the terminal to `png`. ImageMagick reads a window's own contents and is
 * the X11 path. A Wayland compositor owns window size, placement and visibility,
 * so there the frame comes from the desktop portal's active-window grab, cropped
 * to the capture surface. Both paths are validated: a window that has not painted
 * is retried, and an empty grab fails, because an empty image must never be
 * written out as a screenshot.
 */
function captureNativePng(windowId: number | undefined, png: string, label: string): void {
  if (windowId !== undefined) {
    spawnSync("import", ["-window", String(windowId), png], { encoding: "utf8", timeout: 20_000 });
    if (pngStandardDeviation(png) >= minimumFrameStandardDeviation) return;
  }
  let failure = "no capture attempt was made";
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) sleep(1_500);
    const viaPortal = spawnSync("spectacle", ["-b", "-n", "-a", "-o", png], { encoding: "utf8", timeout: 60_000 });
    if (viaPortal.status !== 0) {
      failure = viaPortal.stderr.trim() || `spectacle exit ${viaPortal.status}`;
      continue;
    }
    spawnSync("magick", [png, "-crop", `${surfaceWidth}x${surfaceHeight}+0+0`, "+repage", png], { encoding: "utf8", timeout: 30_000 });
    if (pngStandardDeviation(png) >= minimumFrameStandardDeviation) return;
    failure = `the captured frame is empty (standard deviation ${pngStandardDeviation(png)})`;
  }
  throw new Error(`${label}: ${failure}`);
}
function hasValidEmptyPrompt(captured: string): boolean {
  const plain = captured.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  return plain.split("\n").filter((line) => line.trim() === expectedEmptyPrompt).length === 1;
}

mkdirSync(outputDir, { recursive: true });
const prerequisites: Array<[string, string[], string]> = [
  ["tmux", ["-V"], "tmux is required"],
  ["kitty", ["--version"], "kitty is required for native PNG capture"],
  ["xdotool", ["-v"], "xdotool is required for native PNG capture"],
  ["identify", ["-version"], "ImageMagick identify is required"],
];
for (const [command, args, label] of prerequisites) requireTool(command, args, label);
// ImageMagick captures X11 windows; spectacle captures the active Wayland window.
const hasCapture = (command: string) =>
  ["--version", "-version"].some((flag) => spawnSync(command, [flag], { encoding: "utf8", timeout: 5_000 }).status === 0);
if (!hasCapture("import") && !hasCapture("spectacle")) {
  throw new Error("native PNG capture requires ImageMagick import (X11) or spectacle (Wayland)");
}

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
    { timestamp: Date.now(), ttftMs: 820, outputTokensPerSecond: 142 },
    { timestamp: Date.now() - 1000, ttftMs: 760, outputTokensPerSecond: 156 },
    { timestamp: Date.now() - 2000, ttftMs: 790, outputTokensPerSecond: 149 },
  ],
}));

function captureState(state: ScreenshotState): void {
  writeProfiledFixtures();
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
    runNativeCommand("tmux", ["-L", socket, "new-session", "-d", "-x", String(columns), "-y", String(rows), "-s", session, "env", `HOME=${homeDir}`, "MOCK_SCREENSHOT_RICH=1", `MOCK_SCREENSHOT_SCENARIO=${state.scenario}`, `XDG_STATE_HOME=${performanceHome}`, `MOCK_SUBAGENT_ROOT=${profiledRoot}`, "bun", "run", "src/index.tsx", "--pi", executable], `unable to start production PiTTy for ${state.name}`);
    runNativeCommand("tmux", ["-L", socket, "set-option", "-t", session, "status", "off"], `unable to hide tmux chrome for ${state.name}`);
    runNativeCommand("kitty", ["--detach", `--listen-on=unix:${kittySocket}`, `--class=${kittyClass}`,
      // A hidden window is invisible to a compositor capture, so only the X11
      // path starts hidden and maps itself afterwards.
      ...(waylandNative ? [] : ["--start-as=hidden"]),
      "--override", "allow_remote_control=socket-only",
      ...(waylandNative ? [] : ["--override", "linux_display_server=x11"]),
      "--override", "font_family=Noto Sans Mono", "--override", "font_size=10", "--override", "window_padding_width=0", "--override", "hide_window_decorations=yes", "--override", "initial_window_width=140c", "--override", "initial_window_height=44c", "--override", "background=#10131a", "--override", "foreground=#d8dee9", "--", "tmux", "-L", socket, "attach-session", "-t", session], `unable to launch native terminal for ${state.name}`);
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
    if (windowId === undefined) {
      // A native Wayland terminal has no X11 window to size, place or map: the
      // compositor owns all three. Pin the session grid instead, so the app still
      // renders the capture surface's cells in the window's top-left region, and
      // let the portal capture keep that region.
      runNativeCommand("tmux", ["-L", socket, "set-option", "-t", session, "window-size", "manual"], `unable to pin the session grid for ${state.name}`);
      runNativeCommand("tmux", ["-L", socket, "resize-window", "-t", session, "-x", String(columns), "-y", String(rows)], `unable to size the session grid for ${state.name}`);
      sleep(500);
    } else {
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
      if (!resized) {
        const diag = spawnSync("tmux", ["-L", socket, "list-sessions"], { encoding: "utf8" });
        const pane = spawnSync("tmux", ["-L", socket, "capture-pane", "-p", "-t", session], { encoding: "utf8" });
        const windows = spawnSync("xdotool", ["search", "--class", kittyClass], { encoding: "utf8" });
        writeFileSync(join(tmpdir(), `${state.name}.resize-failure.txt`), `windowId=${windowId}\nlist-sessions:\n${diag.stdout}${diag.stderr}\npane:\n${pane.stdout}${pane.stderr}\nsearch:\n${windows.stdout}${windows.stderr}\n`);
        throw new Error(`unable to set native terminal size for ${state.name}: Kitty window disappeared`);
      }
      runNativeCommand("xdotool", ["windowmove", String(windowId), "0", "0"], `unable to position native terminal for ${state.name}`);
      runNativeCommand("xdotool", ["windowmap", String(windowId)], `unable to map native terminal for ${state.name}`);
    }
    runNativeCommand("tmux", ["-L", socket, "select-pane", "-t", session, "-d"], `unable to disable native terminal input for ${state.name}`);
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
    if (missing.length || invalidPrompt || (state.name === "blank-session" && (captured.includes("Starting Pi runtime") || captured.includes("Loading recent sessions")))) {
      writeFileSync(join(tmpdir(), `${state.name}.debug.ansi`), captured);
      throw new Error(`capture ${state.name} failed markers=${missing.join(",")} invalidPrompt=${invalidPrompt}`);
    }
    const grid = runNativeCommand("tmux", ["-L", socket, "display-message", "-p", "-t", session, "#{pane_width}x#{pane_height}"], `unable to inspect terminal grid for ${state.name}`).stdout.trim();
    if (grid !== `${columns}x${rows}`) throw new Error(`native terminal grid is ${grid}, expected ${columns}x${rows}`);
    const ansi = captured.trimEnd() + "\n";
    writeFileSync(join(outputDir, `${state.name}.ansi`), ansi);
    writeFileSync(join(outputDir, `${state.name}.html`), `<!doctype html><meta charset="utf-8"><title>PiTTy ${state.name} ANSI diagnostic</title><style>body{background:#10131a;color:#d8dee9}pre{font:14px monospace;line-height:17px;white-space:pre}.red{color:#f66}.green{color:#6f6}.yellow{color:#ff6}.cyan{color:#6ff}.magenta{color:#f6f}.white{color:#fff}</style><pre>${ansiToHtml(ansi).replace(/[ 	]+(?=<\/span>|$)/gm, (spaces) => "&nbsp;".repeat(spaces.length))}</pre>`);
    const png = join(outputDir, `${state.name}.png`);
    // ImageMagick's X capture reads the window's own contents. There is no
    // fallback: a screen grab under a Wayland compositor returns the desktop,
    // and grabbing the XWayland window itself returns an empty frame.
    // ImageMagick for an X11 window, the desktop portal for a Wayland one.
    captureNativePng(windowId, png, `unable to capture native PNG for ${state.name}`);
    const dimensions = runNativeCommand("identify", ["-format", "%w %h", png], `unable to inspect native PNG for ${state.name}`).stdout.trim().split(/\s+/).map(Number);
    if (dimensions[0] !== surfaceWidth || dimensions[1] !== surfaceHeight) throw new Error(`native PNG is ${dimensions[0]}x${dimensions[1]}, expected ${surfaceWidth}x${surfaceHeight}`);
    // Restoring the previous window happens last: the portal reads the active
    // window, so the terminal has to stay active until the frame is taken.
    if (canRestoreFocus) {
      runNativeCommand("xdotool", ["windowactivate", "--sync", activeWindow], `unable to restore active window for ${state.name}`);
      runNativeCommand("xdotool", ["windowfocus", activeWindow], `unable to focus restored window for ${state.name}`);
      const focusedWindow = runNativeCommand("xdotool", ["getactivewindow"], `unable to verify active window for ${state.name}`).stdout.trim();
      if (focusedWindow === String(windowId)) throw new Error(`native terminal retained focus for ${state.name}`);
    }
  } finally {
    spawnSync("tmux", ["-L", socket, "kill-session", "-t", session], { encoding: "utf8" });
    if (windowId !== undefined) spawnSync("xdotool", ["windowclose", String(windowId)], { encoding: "utf8", timeout: 2_000 });
    sleep(500);
    try { unlinkSync(tmuxSocketPath); } catch { /* tmux may remove its socket */ }
    try { unlinkSync(kittySocket); } catch { /* kitty may remove its socket */ }
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
process.stdout.write(`Generated ${states.length} native terminal PNGs (${columns}x${rows} cells, ${surfaceWidth}x${surfaceHeight}, Kitty X11) in ${outputDir}\n`);
