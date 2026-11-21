import os from "node:os";
import path from "node:path";
import { fetchCswapSnapshot, resolveCswapSlot, type CswapSnapshot } from "./claude-swap.ts";
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
	fetchSnapshot: () => Promise<CswapSnapshot | undefined>;
	fetchUsage: (options: { credentialsPath: string }) => Promise<ClaudeUsageOutcome>;
	now: () => number;
	home: string;
};
const defaultSources: ClaudeUsageSources = {
	fetchSnapshot: fetchCswapSnapshot,
	fetchUsage: fetchDoppelclaudeUsage,
	now: Date.now,
	home: os.homedir(),
};

/** The SDK query is authoritative. Older runtimes fall back only to this tab's profile. */
export async function readClaudeUsage(
	runtime: ClaudeUsageRuntime,
	sources: ClaudeUsageSources = defaultSources,
): Promise<ClaudeUsageReading> {
	try {
		const snapshot = await runtime.getProviderUsage();
		const usage = claudeUsageFromProvider(snapshot, sources.now());
		if (usage) return { usage, ...(snapshot.accountId ? { accountId: snapshot.accountId } : {}), pollAfterMs: 60_000 };
		// An identified query failure must not be relabelled with another source's account.
		if (snapshot.accountId || snapshot.status === "error" || snapshot.status === "stale") {
			return { hint: "usage unavailable", ...(snapshot.accountId ? { accountId: snapshot.accountId } : {}), pollAfterMs: 60_000 };
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!/(?:unknown|unsupported|not implemented).*command|command.*(?:unknown|unsupported|not implemented)/i.test(message))
			return { hint: "usage unavailable", pollAfterMs: 60_000 };
		// Only an explicitly unsupported older RPC falls back to this tab\'s profile.
	}
	const snapshot = await sources.fetchSnapshot();
	if (snapshot) {
		const slot = resolveCswapSlot("auto", snapshot, runtime.configDir, sources.home);
		const account = snapshot.accounts.find((candidate) => candidate.number === slot);
		const usage = account?.usage ?? account?.lastGood?.usage;
		if (usage) return { usage, snapshot, pollAfterMs: 5 * 60_000 };
	}
	const configDir = runtime.configDir || path.join(sources.home, ".claude");
	const outcome = await sources.fetchUsage({ credentialsPath: path.join(configDir, ".credentials.json") });
	if (outcome.status === "ok") return { usage: outcome.usage, ...(snapshot ? { snapshot } : {}), pollAfterMs: 5 * 60_000 };
	return {
		hint: "usage unavailable",
		...(snapshot ? { snapshot } : {}),
		pollAfterMs: outcome.status === "rate-limited" ? 5 * 60_000 : 60_000,
	};
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
			{
				const reading = this.keepPrevious(runtime.key, {
					...(usage ? { usage } : { hint: "usage unavailable" }),
					...(runtime.snapshot.accountId ? { accountId: runtime.snapshot.accountId } : {}),
					pollAfterMs: 60_000,
				});
				this.versions.set(runtime.key, (this.versions.get(runtime.key) ?? 0) + 1);
				this.cache.set(runtime.key, reading);
				this.publish(reading);
				this.schedule(60_000);
				return;
			}
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
