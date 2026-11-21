import path from "node:path";
import type { CswapSnapshot } from "./claude-swap.ts";
import { fetchDoppelclaudeUsage, type ClaudeUsage, type ClaudeUsageOutcome } from "./doppelclaude-usage.ts";
import { claudeUsageFromProvider, type ProviderUsageSnapshot } from "./provider-usage.ts";

export type ClaudeUsageRuntime = {
	/** Includes the tab, session, model and profile, so one cannot borrow another's cache. */
	key: string;
	configDir?: string;
	activity?: number;
	snapshot?: ProviderUsageSnapshot;
	getProviderUsage: () => Promise<ProviderUsageSnapshot>;
};
export type ClaudeUsageReading = {
	accountId?: string;
	usage?: ClaudeUsage;
	hint?: string;
	snapshot?: CswapSnapshot;
	pollAfterMs: number;
};
export type ClaudeUsageSources = {
	fetchUsage: (options: { credentialsPath: string }) => Promise<ClaudeUsageOutcome>;
	now: () => number;
};
const defaultSources: ClaudeUsageSources = {
	fetchUsage: fetchDoppelclaudeUsage,
	now: Date.now,
};

/** Prefer live SDK usage, then a direct OAuth reading from the same Pi child profile. */
export async function readClaudeUsage(
	runtime: ClaudeUsageRuntime,
	sources: ClaudeUsageSources = defaultSources,
): Promise<ClaudeUsageReading> {
	// The live provider may have no active query while the main conversation is
	// idle. That means its usage snapshot is empty, not that Claude is logged out.
	// Fetch the same child process's OAuth usage instead. Never borrow cswap's
	// potentially stale last-good reading or another account's credentials.
	let nativeAccountId: string | undefined;
	try {
		const snapshot = await runtime.getProviderUsage();
		const usage = claudeUsageFromProvider(snapshot, sources.now());
		if (usage) return { usage, ...(snapshot.accountId ? { accountId: snapshot.accountId } : {}), pollAfterMs: 60_000 };
		nativeAccountId = snapshot.accountId;
	} catch {
		// Only a known tab-local profile may be used as fallback.
	}
	if (!runtime.configDir || !path.isAbsolute(runtime.configDir)) {
		return { hint: "usage unavailable", ...(nativeAccountId ? { accountId: nativeAccountId } : {}), pollAfterMs: 60_000 };
	}
	const outcome = await sources.fetchUsage({ credentialsPath: path.join(runtime.configDir, ".credentials.json") });
	if (outcome.status === "ok") {
		if (nativeAccountId && outcome.usage.accountId && nativeAccountId !== outcome.usage.accountId)
			return { hint: "usage unavailable", accountId: nativeAccountId, pollAfterMs: 60_000 };
		return { usage: outcome.usage, ...(nativeAccountId ? { accountId: nativeAccountId } : {}), pollAfterMs: 5 * 60_000 };
	}
	return { hint: "usage unavailable", ...(nativeAccountId ? { accountId: nativeAccountId } : {}),
		pollAfterMs: outcome.status === "rate-limited" ? 5 * 60_000 : 60_000 };
}

/** Coordinates account switches and overlapping reads without publishing another tab's result. */
export class ClaudeUsageMonitor {
	private runtime: ClaudeUsageRuntime | undefined;
	private readonly cache = new Map<string, ClaudeUsageReading>();
	private readonly pending = new Set<string>();
	private readonly versions = new Map<string, number>();
	private readonly lastAttempt = new Map<string, number>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;

	constructor(
		private readonly publish: (reading: ClaudeUsageReading) => void,
		private readonly read: (runtime: ClaudeUsageRuntime) => Promise<ClaudeUsageReading> = readClaudeUsage,
		private readonly now: () => number = Date.now,
	) {}

	select(runtime: ClaudeUsageRuntime): void {
		if (this.disposed) return;
		const changed = runtime.key !== this.runtime?.key;
		const activityChanged = runtime.activity !== this.runtime?.activity;
		const snapshotChanged = runtime.snapshot !== this.runtime?.snapshot;
		this.runtime = runtime;
		if (runtime.snapshot && snapshotChanged) {
			const usage = claudeUsageFromProvider(runtime.snapshot, this.now());
			const reading = this.keepPrevious(runtime.key, {
				...(usage ? { usage } : { hint: "usage unavailable" }),
				...(runtime.snapshot.accountId ? { accountId: runtime.snapshot.accountId } : {}),
				pollAfterMs: 60_000,
			});
			// Only a real provider measurement supersedes an in-flight direct OAuth read.
			// Empty push updates can arrive while the main SDK query is idle.
			if (usage) this.versions.set(runtime.key, (this.versions.get(runtime.key) ?? 0) + 1);
			this.cache.set(runtime.key, reading);
			this.publish(reading);
			this.schedule(usage ? 60_000 : Math.max(0, 60_000 - (this.now() - (this.lastAttempt.get(runtime.key) ?? 0))));
			return;
		}
		if (changed) {
			this.publish(this.cache.get(runtime.key) ?? { hint: "usage loading", pollAfterMs: 0 });
			this.schedule(0);
		} else if (activityChanged) {
			this.schedule(Math.max(0, 10_000 - (this.now() - (this.lastAttempt.get(runtime.key) ?? 0))));
		}
	}

	async refresh(): Promise<void> {
		const runtime = this.runtime;
		if (!runtime || this.disposed || this.pending.has(runtime.key)) return;
		const version = this.versions.get(runtime.key) ?? 0;
		this.pending.add(runtime.key);
		this.lastAttempt.set(runtime.key, this.now());
		let reading: ClaudeUsageReading;
		try {
			reading = await this.read(runtime);
		} catch {
			reading = { hint: "usage unavailable", pollAfterMs: 60_000 };
		}
		this.pending.delete(runtime.key);
		if (this.disposed) return;
		const previous = this.cache.get(runtime.key);
		if (previous && version !== (this.versions.get(runtime.key) ?? 0)) reading = previous;
		reading = this.keepPrevious(runtime.key, reading);
		this.cache.set(runtime.key, reading);
		if (this.runtime?.key !== runtime.key) return;
		this.publish(reading);
		// Check shortly after a known reset, without pretending it already reset to zero.
		const now = this.now();
		const resets = reading.usage?.limits
			.map((limit) => limit.resetAt)
			.filter((at): at is number => at !== null && at > now) ?? [];
		const delay = resets.length
			? Math.min(reading.pollAfterMs, Math.max(10_000, Math.min(...resets) - now + 1000))
			: reading.pollAfterMs;
		this.schedule(delay);
	}

	clear(): void {
		this.runtime = undefined;
		if (this.timer) clearTimeout(this.timer);
		this.publish({ pollAfterMs: 0 });
	}
	private keepPrevious(key: string, reading: ClaudeUsageReading): ClaudeUsageReading {
		const previous = this.cache.get(key);
		return !reading.usage && previous?.usage && (!reading.accountId || reading.accountId === previous.usage.accountId)
			? { ...reading, usage: { ...previous.usage, status: "stale" } }
			: reading;
	}
	dispose(): void {
		this.disposed = true;
		if (this.timer) clearTimeout(this.timer);
		this.cache.clear();
	}
	private schedule(delayMs: number): void {
		if (this.disposed) return;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.refresh(), delayMs);
		this.timer.unref?.();
	}
}
