/**
 * Detect probable lost prompt-cache reuse, not normal first requests.
 * This is a heuristic. A request's cached prefix can change legitimately.
 */
export type CacheUsage = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
};
export type CacheWarning = {
  provider: string;
  model: string;
  previousRead: number;
  currentRead: number;
  currentWrite: number;
};
type Snapshot = { provider: string; model: string; total: number; read: number };

export class CacheMissWatch {
  private last: Snapshot | undefined;
  private lastWarningAt = 0;

  observe(message: unknown, now = Date.now()): CacheWarning | undefined {
    if (!message || typeof message !== "object") return;
    const m = message as Record<string, unknown>;
    const usage = m.usage as Record<string, unknown> | undefined;
    if (m.role !== "assistant" || !usage) return;
    const provider = typeof m.provider === "string" ? m.provider : "";
    const model = typeof m.model === "string" ? m.model : "";
    const isClaude = /doppelclaude|claude/i.test(provider) || /claude/i.test(model);
    if (!isClaude) {
      this.last = undefined;
      return;
    }
    const input = usage.input;
    const read = usage.cacheRead;
    const write = usage.cacheWrite;
    if (![input, read, write].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) {
      this.last = undefined;
      return;
    }
    const current = {
      provider, model,
      total: (input as number) + (read as number) + (write as number),
      read: read as number,
    };
    const previous = this.last;
    this.last = current;
    if (!previous || previous.provider !== provider || previous.model !== model ||
      previous.read < 50_000 || (write as number) < 50_000 ||
      (read as number) >= previous.read * 0.6 ||
      current.total < previous.total * 0.8 ||
      current.total > previous.total * 1.35 ||
      now - this.lastWarningAt < 10 * 60_000) return;
    this.lastWarningAt = now;
    return {
      provider, model, previousRead: previous.read,
      currentRead: read as number, currentWrite: write as number,
    };
  }
}
