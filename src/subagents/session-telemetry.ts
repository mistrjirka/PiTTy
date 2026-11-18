import * as fs from "node:fs";
import { fileTailKey } from "./cache-key.ts";
import { readSessionTail } from "./session-tail.ts";

export type SessionTelemetrySnapshot = {
  window?: number;
  lastActivityAt?: number;
};

/**
 * Compatibility reader for agents predating event-owned status telemetry.
 * It skips oversized code-tool lines without parsing them. New agents send
 * counters and usage directly in status.json, so this reader is not used.
 */
export class SessionTelemetryService {
  private readonly cache = new Map<string, { key: string; snapshot: SessionTelemetrySnapshot }>();
  constructor(private readonly maxEntries = 128, private readonly maxBytes = 4 * 1024 * 1024) {}

  read(sessionPath: string | undefined): SessionTelemetrySnapshot {
    if (!sessionPath) return {};
    let stat: fs.Stats;
    try {
      stat = fs.statSync(sessionPath);
      if (!stat.isFile()) return {};
    } catch {
      return {};
    }
    const key = fileTailKey(stat, (length, position) => {
      const fd = fs.openSync(sessionPath, "r");
      try {
        const buffer = Buffer.alloc(length);
        const bytes = fs.readSync(fd, buffer, 0, length, position);
        return buffer.subarray(0, bytes).toString("utf8");
      } finally { fs.closeSync(fd); }
    });
    const cached = this.cache.get(sessionPath);
    if (cached?.key === key) return cached.snapshot;
    let window: number | undefined;
    try {
      const content = readSessionTail(sessionPath, this.maxBytes);
      for (const line of content.split("\n").reverse()) {
        // Tool results often contain 1-2 MiB opaque resume states. Never
        // parse them when all we need is the most recent assistant usage.
        if (!line.includes('"role":"assistant"') && !line.includes('"role": "assistant"')) continue;
        try {
          const row: unknown = JSON.parse(line);
          if (!row || typeof row !== "object" || Array.isArray(row)) continue;
          const message = (row as { message?: unknown }).message;
          if (!message || typeof message !== "object" || Array.isArray(message)) continue;
          const m = message as { role?: unknown; usage?: unknown };
          if (m.role !== "assistant" || !m.usage || typeof m.usage !== "object" || Array.isArray(m.usage)) continue;
          const usage = m.usage as { input?: unknown; cacheRead?: unknown; cacheWrite?: unknown };
          const valid = [usage.input, usage.cacheRead, usage.cacheWrite];
          if (valid.some((n) => n !== undefined && (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0))) continue;
          const total = valid.reduce<number>((sum, n) => sum + (typeof n === "number" ? n : 0), 0);
          if (total > 0 && Number.isSafeInteger(total)) { window = total; break; }
        } catch { /* Ignore malformed or interrupted rows. */ }
      }
    } catch { /* A concurrently removed session has no saved usage. */ }
    const snapshot = {
      ...(window !== undefined ? { window } : {}),
      lastActivityAt: stat.mtimeMs,
    };
    this.cache.delete(sessionPath);
    this.cache.set(sessionPath, { key, snapshot });
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return snapshot;
  }
}
