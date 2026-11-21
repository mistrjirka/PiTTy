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

/** Only use ~/.claude when its reported account identity matches the requested slot. */
function globalProfileMatches(home: string, account: unknown): boolean {
  try {
    if (!account || typeof account !== "object") return false;
    const expected = account as Record<string, unknown>;
    const raw = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8")) as { oauthAccount?: Record<string, unknown> };
    const active = raw.oauthAccount;
    if (!active || !fs.existsSync(path.join(home, ".claude", ".credentials.json"))) return false;
    const identifiers = [
      [expected.uuid, active.accountUuid],
      [expected.email, active.emailAddress],
      [expected.organizationUuid, active.organizationUuid],
    ] as const;
    let verified = false;
    for (const [wanted, actual] of identifiers) {
      if (typeof wanted !== "string" || !wanted.trim() || typeof actual !== "string" || !actual.trim()) continue;
      if (wanted.trim().toLowerCase() !== actual.trim().toLowerCase()) return false;
      verified = true;
    }
    return verified;
  } catch {
    return false;
  }
}

/**
 * Resolve a pinned cswap account for a new Pi child process.
 * Never trust sequence.activeAccountNumber: it can disagree with ~/.claude.
 * Never switch cswap globally. Missing isolated profiles fail closed.
 */
export function resolveClaudeLaunchConfig(
  choice: ClaudeAccountChoice,
  home = os.homedir(),
): { configDir?: string; error?: string } {
  if (choice === "auto") return {};
  try {
    const root = path.join(home, ".local", "share", "claude-swap");
    const state = JSON.parse(fs.readFileSync(path.join(root, "sequence.json"), "utf8")) as {
      accounts?: Record<string, unknown>;
    };
    const account = state.accounts?.[String(choice)];
    if (!account) return { error: `cswap slot ${choice} is no longer available` };
    if (globalProfileMatches(home, account)) return { configDir: path.join(home, ".claude") };
    const sessions = path.join(root, "sessions");
    const candidates = fs.readdirSync(sessions).filter((name) => name.startsWith(`${choice}-`));
    const match = candidates.find((name) => fs.existsSync(path.join(sessions, name, ".credentials.json")));
    return match ? { configDir: path.join(sessions, match) } :
      { error: `cswap slot ${choice} has no initialized session. Run cswap run ${choice} first.` };
  } catch {
    return { error: "cswap account cannot be resolved" };
  }
}

/** Resolve each new process separately so a saved selection affects later tabs. */
export function claudeLaunchEnvironment(
  choice = readClaudeAccountPreference(),
  home = os.homedir(),
): NodeJS.ProcessEnv | undefined {
  const resolved = resolveClaudeLaunchConfig(choice, home);
  if (resolved.error) throw new Error(resolved.error);
  return resolved.configDir ? { CLAUDE_CONFIG_DIR: resolved.configDir } : undefined;
}
