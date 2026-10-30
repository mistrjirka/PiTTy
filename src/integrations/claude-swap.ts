/**
 * Read-only cswap integration. Never switches accounts, writes credentials,
 * or starts a Claude process. Usage is obtained from cswap's public JSON CLI.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ClaudeUsage } from "./doppelclaude-usage.ts";

const execFileAsync = promisify(execFile);
export type CswapAccount = {
  number: number;
  label: string;
  usageStatus: string;
  usage?: ClaudeUsage;
};
export type CswapSnapshot = {
  activeAccountNumber?: number;
  accounts: CswapAccount[];
};
export type ClaudeAccountChoice = "auto" | number;

function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function windowLimit(
  value: unknown,
  kind: string,
  label: string,
  now: number,
): ClaudeUsage["limits"][number] | undefined {
  const entry = obj(value);
  if (!entry || typeof entry.pct !== "number" || !Number.isFinite(entry.pct)) return;
  const at = typeof entry.resetsAt === "string" ? Date.parse(entry.resetsAt) : NaN;
  return {
    kind, label,
    percent: Math.min(1000, Math.max(0, entry.pct)),
    resetAt: Number.isFinite(at) ? at : now,
    active: kind === "session",
  };
}

export function parseCswapSnapshot(value: unknown, now = Date.now()): CswapSnapshot | undefined {
  const source = obj(value);
  if (!source || !Array.isArray(source.accounts)) return;
  const accounts: CswapAccount[] = [];
  const seen = new Set<number>();
  for (const item of source.accounts) {
    const account = obj(item);
    if (!account) continue;
    const slot = account.number;
    if (typeof slot !== "number" || !Number.isSafeInteger(slot) || slot < 1 || seen.has(slot)) continue;
    seen.add(slot);
    const alias = typeof account.alias === "string" ? account.alias.trim().slice(0, 35) : "";
    const email = typeof account.email === "string" ? account.email.trim() : "";
    const label = alias || email || `Account ${slot}`;
    const rawUsage = obj(account.usage);
    const limits = [
      windowLimit(rawUsage?.fiveHour, "session", "Session", now),
      windowLimit(rawUsage?.sevenDay, "weekly_all", "Week", now),
    ].filter((limit): limit is ClaudeUsage["limits"][number] => limit !== undefined);
    accounts.push({
      number: slot,
      label,
      usageStatus: typeof account.usageStatus === "string" ? account.usageStatus : "unknown",
      ...(limits.length ? { usage: { limits } } : {}),
    });
  }
  if (!accounts.length) return;
  const active = source.activeAccountNumber;
  return {
    ...(typeof active === "number" && seen.has(active) ? { activeAccountNumber: active } : {}),
    accounts,
  };
}

/** Pi's actual process environment wins over cswap's globally active slot. */
export function resolveCswapSlot(
  choice: ClaudeAccountChoice,
  snapshot: CswapSnapshot,
  piConfigDir?: string,
  home?: string,
): number | undefined {
  if (choice !== "auto") return snapshot.accounts.some((a) => a.number === choice) ? choice : undefined;
  if (piConfigDir) {
    const base = path.basename(path.normalize(piConfigDir));
    const matched = /^(\d+)-/.exec(base);
    if (matched && path.basename(path.dirname(path.normalize(piConfigDir))) === "sessions") {
      const slot = Number(matched[1]);
      if (snapshot.accounts.some((a) => a.number === slot)) return slot;
    }
    // ~/.claude is the currently switched (global) cswap profile.
    if (home && path.normalize(piConfigDir) === path.join(home, ".claude"))
      return snapshot.activeAccountNumber;
  }
  return snapshot.activeAccountNumber;
}

export async function fetchCswapSnapshot(): Promise<CswapSnapshot | undefined> {
  try {
    const { stdout } = await execFileAsync("cswap", ["list", "--json"], {
      timeout: 8_000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    return parseCswapSnapshot(JSON.parse(stdout));
  } catch {
    return undefined;
  }
}
