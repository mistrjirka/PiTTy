import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseCswapSnapshot,
  resolveCswapSlot,
} from "../src/integrations/claude-swap.ts";
import {
  claudeAccountPreferencePath,
  readClaudeAccountPreference,
  saveClaudeAccountPreference,
  resolveClaudeLaunchConfig,
} from "../src/config/claude-account.ts";

const now = Date.parse("2026-10-30T12:00:00Z");
const source = {
  activeAccountNumber: 2,
  accounts: [
    { number: 1, alias: "work", email: "work@example.com", usageStatus: "ok",
      usage: { fiveHour: { pct: 89, resetsAt: "2026-10-30T13:30:00Z" },
        sevenDay: { pct: 11, resetsAt: "2026-11-04T06:59:59Z" } } },
    { number: 2, alias: "home", email: "home@example.com", usageStatus: "ok",
      usage: { fiveHour: { pct: 0 }, sevenDay: { pct: 51, resetsAt: "2026-11-05T02:00:00Z" } } },
  ],
};

describe("cswap account selection", () => {
  const snapshot = parseCswapSnapshot(source, now)!;
  test("parses accounts and limits without copying credentials", () => {
    expect(snapshot.activeAccountNumber).toBe(2);
    expect(snapshot.accounts.map((a) => a.label)).toEqual(["work", "home"]);
    expect(snapshot.accounts[0]?.usage?.limits.map((limit) => limit.percent)).toEqual([89, 11]);
    expect(snapshot.accounts[0]?.usage?.limits[0]?.resetAt).toBe(Date.parse("2026-10-30T13:30:00Z"));
    expect(JSON.stringify(snapshot)).not.toContain("@example.com");
  });
  test("default follows Pi subprocess profile, not globally active cswap account", () => {
    const home = "/home/jirka";
    const work = "/home/jirka/.local/share/claude-swap/sessions/1-svitil_deveon.ai";
    expect(resolveCswapSlot("auto", snapshot, work, home)).toBe(1);
    expect(resolveCswapSlot("auto", snapshot, path.join(home, ".claude"), home)).toBe(2);
    expect(resolveCswapSlot("auto", snapshot, undefined, home)).toBe(2);
    expect(resolveCswapSlot(2, snapshot, work, home)).toBe(2);
  });
  test("rejects malformed account entries and invalid choices", () => {
    expect(parseCswapSnapshot({ accounts: [{ number: 0 }, { number: "1" }] })).toBeUndefined();
    expect(resolveCswapSlot(99, snapshot)).toBeUndefined();
  });
  test("new Pi processes use the chosen cswap account without modifying the global login", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-cswap-launch-"));
    try {
      const dir = path.join(root, ".local", "share", "claude-swap");
      fs.mkdirSync(path.join(dir, "sessions", "1-work_test"), { recursive: true });
      fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(dir, "sequence.json"), JSON.stringify({ activeAccountNumber: 2, accounts: { "1": {}, "2": {} } }));
      fs.writeFileSync(path.join(dir, "sessions", "1-work_test", ".credentials.json"), "{}");
      fs.writeFileSync(path.join(root, ".claude", ".credentials.json"), "{}");
      expect(resolveClaudeLaunchConfig("auto", root)).toEqual({});
      expect(resolveClaudeLaunchConfig(1, root)).toEqual({ configDir: path.join(dir, "sessions", "1-work_test") });
      expect(resolveClaudeLaunchConfig(2, root)).toEqual({ configDir: path.join(root, ".claude") });
      expect(resolveClaudeLaunchConfig(99, root).error).toContain("no longer available");
      fs.unlinkSync(path.join(dir, "sessions", "1-work_test", ".credentials.json"));
      expect(resolveClaudeLaunchConfig(1, root).error).toContain("no initialized session");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test("selection persists without writing cswap settings", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-cswap-"));
    try {
      const file = path.join(root, "prefs.json");
      expect(readClaudeAccountPreference(file)).toBe("auto");
      saveClaudeAccountPreference(1, file);
      expect(readClaudeAccountPreference(file)).toBe(1);
      saveClaudeAccountPreference("auto", file);
      expect(readClaudeAccountPreference(file)).toBe("auto");
      expect(fs.statSync(file).mode & 0o077).toBe(0);
      expect(claudeAccountPreferencePath({ XDG_CONFIG_HOME: root }, "/not-used")).toBe(path.join(root, "pitty", "claude-usage-account.json"));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
