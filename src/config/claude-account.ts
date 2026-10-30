/** Local PiTTY preference. Does not modify cswap, Claude login, or tokens. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ClaudeAccountChoice } from "../integrations/claude-swap.ts";

export function claudeAccountPreferencePath(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "pitty", "claude-usage-account.json");
}
export function readClaudeAccountPreference(file = claudeAccountPreferencePath()): ClaudeAccountChoice {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const choice = (data && typeof data === "object" ? (data as { account?: unknown }).account : undefined);
    return choice === "auto" || (typeof choice === "number" && Number.isSafeInteger(choice) && choice > 0) ? choice : "auto";
  } catch {
    return "auto";
  }
}
export function saveClaudeAccountPreference(choice: ClaudeAccountChoice, file = claudeAccountPreferencePath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ account: choice }) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch { /* Already renamed */ }
  }
}

/**
 * Resolve a pinned cswap account for a new Pi child process.
 * Never switch cswap globally. Missing inactive profiles fail closed.
 */
export function resolveClaudeLaunchConfig(
  choice: ClaudeAccountChoice,
  home = os.homedir(),
): { configDir?: string; error?: string } {
  if (choice === "auto") return {};
  try {
    const root = path.join(home, ".local", "share", "claude-swap");
    const state = JSON.parse(fs.readFileSync(path.join(root, "sequence.json"), "utf8")) as {
      activeAccountNumber?: number; accounts?: Record<string, unknown>;
    };
    if (!state.accounts?.[String(choice)]) return { error: `cswap slot ${choice} is no longer available` };
    if (choice === state.activeAccountNumber) {
      const active = path.join(home, ".claude");
      return fs.existsSync(path.join(active, ".credentials.json"))
        ? { configDir: active } : { error: `No active Claude credentials for cswap slot ${choice}` };
    }
    const sessions = path.join(root, "sessions");
    const candidates = fs.readdirSync(sessions).filter((name) => name.startsWith(`${choice}-`));
    const match = candidates.find((name) => fs.existsSync(path.join(sessions, name, ".credentials.json")));
    return match ? { configDir: path.join(sessions, match) } :
      { error: `cswap slot ${choice} has no initialized session. Run cswap run ${choice} first.` };
  } catch {
    return { error: "cswap account cannot be resolved" };
  }
}
