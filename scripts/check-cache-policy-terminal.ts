#!/usr/bin/env bun
/** Real PiTTy keyboard/mouse smoke in an isolated tmux PTY. No provider/model calls. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dir, "..");
const output = path.resolve(process.argv[2] || path.join(root, "../validation/cache-policy-terminal"));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-cache-policy-"));
const home = path.join(temp, "home");
const config = path.join(temp, "config");
const fixtureBin = path.join(temp, "bin");
const stateHome = path.join(temp, "state");
const project = path.join(temp, "project");
const log = path.join(temp, "rpc.jsonl");
const control = path.join(temp, "control.json");
const socket = "pitty-policy-" + process.pid;
const session = "policy";
const work = path.join(home, ".local/share/claude-swap/sessions/1-work");
const ordinary = path.join(home, ".claude");
const oneRoundFile = path.join(home, ".pi/agent/one-round-compaction.json");
const extensionConfig = JSON.stringify({ model: "fixture/audit", thinkingLevel: "low",
  lanes: { audit: { model: "fixture/audit", thinkingLevel: "medium" }, execution: { model: "fixture/execution" } } }, null, 2);
for (const dir of [output, config, fixtureBin, stateHome, project, work, ordinary,
  path.dirname(oneRoundFile), path.join(config, "pitty"),
  path.join(home, ".pi/agent/npm/node_modules/pi-doppelclaude"),
  path.join(home, ".pi/agent/npm/node_modules/pi-one-round-compaction")]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(oneRoundFile, extensionConfig);
for (const dir of [work, ordinary]) fs.writeFileSync(path.join(dir, ".credentials.json"), "{}");
fs.writeFileSync(path.join(home, ".local/share/claude-swap/sequence.json"),
  JSON.stringify({ activeAccountNumber: 2, accounts: { 1: { alias: "work" }, 2: { alias: "home" } } }));
fs.writeFileSync(path.join(config, "pitty/claude-usage-account.json"), JSON.stringify({ account: 1 }));
fs.writeFileSync(control, "{}");
const accounts = { activeAccountNumber: 2, accounts: [
  { number: 1, alias: "work", usageStatus: "ok", usage: { fiveHour: { pct: 89 }, sevenDay: { pct: 11 } } },
  { number: 2, alias: "home", usageStatus: "ok", usage: { fiveHour: { pct: 0 }, sevenDay: { pct: 51 } } },
] };
fs.writeFileSync(path.join(fixtureBin, "cswap"), "#!/usr/bin/env node\nprocess.stdout.write(" +
  JSON.stringify(JSON.stringify(accounts) + "\n") + ");\n", { mode: 0o755 });

function tmux(...args: string[]): string {
  const result = spawnSync("tmux", ["-L", socket, ...args], { encoding: "utf8", timeout: 15000 });
  if (result.status !== 0) throw new Error(result.stderr || "tmux failed");
  return result.stdout;
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const frame = () => tmux("capture-pane", "-p", "-t", session);
const records = (): Array<Record<string, unknown>> => {
  try { return fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
  catch { return []; }
};
async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const until = Date.now() + 15000;
  while (Date.now() < until) { if (predicate()) return; await delay(100); }
  throw new Error(description + "\n" + frame());
}
async function visible(text: string): Promise<void> { await waitFor(() => frame().includes(text), "Missing terminal text: " + text); }
async function key(...keys: string[]): Promise<void> {
  for (const value of keys) { tmux("send-keys", "-t", session, value); await delay(180); }
}
async function click(text: string): Promise<void> {
  const lines = frame().split("\n");
  const y = lines.findIndex((line) => line.includes(text));
  assert.ok(y >= 0, "Missing click target: " + text);
  const x = lines[y]!.indexOf(text) + 1;
  tmux("send-keys", "-t", session, "-l", "\x1b[<0;" + x + ";" + (y + 1) + "M\x1b[<0;" + x + ";" + (y + 1) + "m");
  await delay(250);
}
async function capture(name: string, expected: string[] = []): Promise<void> {
  let captured = "";
  let stable = 0;
  await waitFor(() => {
    captured = frame();
    stable = expected.every((text) => captured.includes(text)) ? stable + 1 : 0;
    return stable >= 3;
  }, "Frame did not settle: " + name);
  fs.writeFileSync(path.join(output, name + ".txt"), captured);
  fs.writeFileSync(path.join(output, name + ".ansi"), tmux("capture-pane", "-e", "-p", "-t", session));
}
try {
  tmux("new-session", "-d", "-x", "140", "-y", "44", "-s", session,
    "env", "HOME=" + home, "XDG_CONFIG_HOME=" + config, "XDG_STATE_HOME=" + stateHome,
    "XDG_DATA_HOME=" + path.join(temp, "data"), "CODEX_HOME=" + path.join(temp, "codex"),
    "PI_CODING_AGENT_DIR=" + path.join(home, ".pi/agent"), "PI_PITTY_PROFILED_ROOT=" + path.join(temp, "profiled"),
    "CLAUDE_CONFIG_DIR=" + work, "MOCK_POLICY_LOG=" + log, "MOCK_POLICY_CONTROL=" + control,
    "PATH=" + fixtureBin + path.delimiter + (process.env.PATH || ""),
    path.join(root, "node_modules/.bin/bun"), "run", path.join(root, "src/index.tsx"),
    "--pi", path.join(root, "test/fixtures/cache-policy-rpc.mjs"), "--cwd", project, "--no-sidebar", "--no-logs");
  tmux("set-option", "-t", session, "status", "off");
  tmux("set-option", "-t", session, "window-size", "manual");
  await visible("claude(work) 5h 89%");
  await visible("7d 11%");
  await capture("01-work-account", ["claude(work) 5h 89%", "7d 11%"]);
  await click("Ask Pi anything");
  await delay(300);
  tmux("send-keys", "-t", session, "-l", "offline draft");
  await visible("offline draft");
  await waitFor(() => records().some((row) => row.type === "set_input_active" && row.active === true), "Typing veto was not sent");
  await key("C-c");
  await waitFor(() => records().some((row) => row.type === "set_input_active" && row.active === false), "Typing veto was not released");

  await key("C-x");
  await visible("Compaction");
  await click("Compaction");
  await visible("Compaction settings");
  await visible("Compact before expiry");
  await capture("02-default-policy", ["Cache-aware", "Compact before expiry"]);
  await click("Method");
  await visible("Compaction method");
  await capture("03-method-picker", ["Compaction method", "Two-model extension"]);
  await click("Two-model extension");
  await visible("Compaction settings");
  await visible("Thinking level");
  assert.ok(records().some((row) => row.type === "set_compaction_method" && row.method === "extension"));
  await capture("04-extension-selected", ["Two-model extension", "Thinking level"]);
  await click("Method");
  await visible("Compaction method");
  await click("Cache-aware");
  await visible("Compaction settings");
  for (const [label, mode] of [["Keep cache warm", "keep-warm"], ["Off", "off"], ["Compact before expiry", "compact"]]) {
    await click("Before cache expiry");
    await visible("Save a checkpoint");
    await click(label!);
    await visible("Compaction settings");
    assert.ok(records().some((row) => row.type === "set_cache_maintenance" && row.mode === mode));
    if (mode === "keep-warm") await capture("04b-warm-unavailable", ["This provider does not support safe cache warming"]);
  }
  assert.equal(fs.readFileSync(oneRoundFile, "utf8"), extensionConfig, "Policy changes modified extension model configuration");
  await key("Escape");
  await click("Claude account for new tabs");
  await visible("Current tab: work");
  await capture("05-account-picker", ["Current tab: work", "home (slot 2)"]);
  await click("home (slot 2)");
  await key("Escape");
  await visible("claude(work) 5h 89%");
  assert.equal(JSON.parse(fs.readFileSync(path.join(config, "pitty/claude-usage-account.json"), "utf8")).account, 2);
  // The tab strip's plus button creates a real second Pi RPC child.
  await click("+");
  await visible("claude(home) 5h 0%");
  await visible("7d 51%");
  const launches = records().filter((row) => row.type === "launch");
  assert.deepEqual(launches.map((row) => row.account), ["work", "home"]);
  assert.equal(launches[1]!.configDir, ordinary);
  await capture("06-new-tab-home", ["claude(home) 5h 0%", "7d 51%"]);

  fs.writeFileSync(control, JSON.stringify({ pushSequence: 1, home: { percent: 17, observedAt: Date.now() - 120000 } }));
  await visible("claude(home) 5h 17%");
  fs.writeFileSync(control, JSON.stringify({ pushSequence: 2, home: { status: "error" } }));
  await visible("stale 2m");
  await visible("5h 17%");
  await capture("07-stale-measurement", ["claude(home) 5h 17%", "stale 2m"]);
  fs.writeFileSync(control, JSON.stringify({ pushSequence: 3, home: { percent: null, resetAt: null } }));
  await visible("5h ?·?");
  await capture("08-unknown-window", ["claude(home) 5h ?\u00b7?"]);
  await click("New conversation");
  await visible("claude(work) 5h 89%");
  await capture("09-return-to-work", ["claude(work) 5h 89%", "7d 11%"]);
  fs.writeFileSync(path.join(output, "rpc-metadata.jsonl"), fs.readFileSync(log));
  console.log("PASS: real PTY profile selection, new-tab binding, both quota labels, live updates, stale/unknown states, method/policy setters, typing veto, unchanged extension configuration.");
  console.log("Terminal frames: " + output);
} catch (error) {
  try { await capture("failure"); fs.copyFileSync(log, path.join(output, "failure-rpc-metadata.jsonl")); } catch { /* Preserve the original failure. */ }
  throw error;
} finally {
  try { tmux("kill-server"); } catch { /* Startup may have failed. */ }
  fs.rmSync(temp, { recursive: true, force: true });
}
