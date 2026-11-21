import { describe, expect, test } from "bun:test";
import path from "node:path";
import { ClaudeUsageMonitor, readClaudeUsage, type ClaudeUsageReading, type ClaudeUsageRuntime, type ClaudeUsageSources } from "../src/integrations/claude-usage-monitor.ts";
import { parseCswapSnapshot } from "../src/integrations/claude-swap.ts";
import { claudeUsageFromProvider, parseProviderUsageSnapshot, type ProviderUsageSnapshot } from "../src/integrations/provider-usage.ts";
import { ExtensionStatusController } from "../src/tabs/extension-status-controller.ts";

const now = 1_795_260_000_000;
const snapshot = (accountId: string, percent = 3): ProviderUsageSnapshot => ({
	provider: "doppelclaude", status: "ok", accountId, accountLabel: accountId,
	observedAt: now, source: "sdk",
	limits: [
		{ kind: "session", label: "5h", percent, resetAt: now + 300_000 },
		{ kind: "weekly_all", label: "7d", percent: 61, resetAt: now + 86400_000 },
	],
});
const runtime = (key: string): ClaudeUsageRuntime => ({ key, getProviderUsage: async () => snapshot(key) });
const reading = (key: string): ClaudeUsageReading => ({ usage: claudeUsageFromProvider(snapshot(key), now)!, pollAfterMs: 60_000 });
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

describe("account-bound usage", () => {
	test("uses the actual SDK query and never polls another profile when it has limits", async () => {
		let fallback = 0;
		const sources: ClaudeUsageSources = {
			now: () => now,
			fetchUsage: async () => { fallback++; return { status: "missing-credentials" }; },
		};
		const result = await readClaudeUsage(runtime("work"), sources);
		expect(result.usage?.accountId).toBe("work");
		expect(result.usage?.limits.map((limit) => limit.percent)).toEqual([3, 61]);
		expect(fallback).toBe(0);
	});

	test("an empty native reading fetches the active tab's exact OAuth credentials", async () => {
		const paths: string[] = [];
		const result = await readClaudeUsage({
			key: "home", configDir: "/fixture/sessions/2-home",
			getProviderUsage: async () => ({ provider: "doppelclaude", status: "unavailable", observedAt: null, limits: [], source: "sdk" }),
		}, {
			now: () => now,
			fetchUsage: async ({ credentialsPath }) => {
				paths.push(credentialsPath);
				return { status: "ok", usage: reading("home").usage! };
			},
		});
		expect(paths).toEqual([path.join("/fixture/sessions/2-home", ".credentials.json")]);
		expect(result.usage?.accountId).toBe("home");
		expect(result.pollAfterMs).toBe(5 * 60_000);
	});

	test("unsupported older RPC still uses only the child account", async () => {
		const paths: string[] = [];
		const result = await readClaudeUsage({
			key: "work", configDir: "/fixture/profiles/work",
			getProviderUsage: async () => { throw new Error("Unknown command"); },
		}, {
			now: () => now,
			fetchUsage: async ({ credentialsPath }) => {
				paths.push(credentialsPath);
				return { status: "ok", usage: reading("work").usage! };
			},
		});
		expect(paths).toEqual([path.join("/fixture/profiles/work", ".credentials.json")]);
		expect(result.usage?.accountId).toBe("work");
	});

	test("a failed direct query never borrows another account's old percentages", async () => {
		let calls = 0;
		const result = await readClaudeUsage({ key: "tab-home", configDir: "/fixture/isolated-home",
			getProviderUsage: async () => ({ provider: "doppelclaude", status: "unavailable", observedAt: null, limits: [], source: "claude-sdk" }),
		}, { now: () => now,
			fetchUsage: async ({ credentialsPath }) => {
				calls++;
				expect(credentialsPath).toBe(path.join("/fixture/isolated-home", ".credentials.json"));
				return { status: "error" };
			},
		});
		expect(result.usage).toBeUndefined();
		expect(result.hint).toBe("usage unavailable");
		expect(calls).toBe(1);
	});

	test("a native account ID with no matching child directory never reads global credentials", async () => {
		const result = await readClaudeUsage({
			key: "work", getProviderUsage: async () => ({ ...snapshot("work"), status: "unavailable", limits: [] }),
		}, { now: () => now, fetchUsage: async () => { throw new Error("must not read default credentials"); } });
		expect(result.hint).toBe("usage unavailable");
		expect(result.usage).toBeUndefined();
	});

	test("rejects direct OAuth usage when its explicit account ID disagrees with the SDK", async () => {
		const result = await readClaudeUsage({ key: "home", configDir: "/fixture/home",
			getProviderUsage: async () => ({ ...snapshot("home"), status: "unavailable", limits: [] }),
		}, { now: () => now, fetchUsage: async () => ({ status: "ok", usage: reading("work").usage! }) });
		expect(result.usage).toBeUndefined();
		expect(result.accountId).toBe("home");
	});

	test("preserves unknown limits and reset times and rejects malformed envelopes", () => {
		const usage = claudeUsageFromProvider({ ...snapshot("work"), observedAt: null,
			limits: [{ kind: "session", label: "5h", percent: null, resetAt: null }] }, now);
		expect(usage?.limits[0]).toMatchObject({ percent: null, resetAt: null });
		expect(usage?.status).toBe("unknown");
		expect(parseProviderUsageSnapshot({ ...snapshot("work"), accountLabel: {} })).toBeUndefined();
	});

	test("an empty SDK push triggers same-profile OAuth polling immediately, not after one minute", async () => {
		const published: ClaudeUsageReading[] = [];
		let reads = 0;
		const monitor = new ClaudeUsageMonitor((value) => published.push(value), async () => {
			reads++;
			return reading("home");
		}, () => now);
		try {
			monitor.select({ ...runtime("home"), configDir: "/fixture/home", snapshot: {
				provider: "doppelclaude", source: "sdk", status: "unavailable", observedAt: null, limits: [],
			} });
			for (let i = 0; i < 50 && reads === 0; i++) await new Promise<void>((resolve) => setTimeout(resolve, 5));
			expect(reads).toBe(1);
			expect(published.at(-1)?.usage?.accountId).toBe("home");
		} finally { monitor.dispose(); }
	});

	test("an old tab's delayed read cannot overwrite the selected tab", async () => {
		const a = deferred<ClaudeUsageReading>();
		const published: ClaudeUsageReading[] = [];
		const monitor = new ClaudeUsageMonitor((value) => published.push(value),
			async (target) => target.key === "a" ? a.promise : reading("b"), () => now);
		try {
			monitor.select(runtime("a"));
			const first = monitor.refresh();
			monitor.select(runtime("b"));
			await monitor.refresh();
			a.resolve(reading("a"));
			await first;
			expect(published.at(-1)?.usage?.accountId).toBe("b");
			expect(published.filter((value) => value.usage?.accountId === "a")).toHaveLength(0);
		} finally { monitor.dispose(); }
	});

	test("failure marks the same account stale and keeps the original measurement time", async () => {
		let fail = false;
		const published: ClaudeUsageReading[] = [];
		const monitor = new ClaudeUsageMonitor((value) => published.push(value), async () =>
			fail ? { hint: "usage unavailable", pollAfterMs: 60_000 } : reading("work"), () => now);
		try {
			monitor.select(runtime("work"));
			await monitor.refresh();
			fail = true;
			await monitor.refresh();
			expect(published.at(-1)?.usage).toMatchObject({ accountId: "work", observedAt: now, status: "stale" });
		} finally { monitor.dispose(); }
	});

	test("a live push wins over a read started before that push", async () => {
		const pending = deferred<ClaudeUsageReading>();
		const published: ClaudeUsageReading[] = [];
		const monitor = new ClaudeUsageMonitor((value) => published.push(value), () => pending.promise, () => now);
		try {
			monitor.select(runtime("work"));
			const request = monitor.refresh();
			monitor.select({ ...runtime("work"), snapshot: snapshot("work", 100) });
			pending.resolve(reading("work"));
			await request;
			expect(published.at(-1)?.usage?.limits[0]?.percent).toBe(100);
		} finally { monitor.dispose(); }
	});

	test("a different account's failure cannot retain the previous account's numbers", async () => {
		let changed = false;
		const published: ClaudeUsageReading[] = [];
		const monitor = new ClaudeUsageMonitor((value) => published.push(value), async () =>
			changed ? { accountId: "new", hint: "usage unavailable", pollAfterMs: 60_000 } : reading("old"), () => now);
		try {
			monitor.select(runtime("tab"));
			await monitor.refresh();
			changed = true;
			await monitor.refresh();
			expect(published.at(-1)?.usage).toBeUndefined();
		} finally { monitor.dispose(); }
	});

	test("push status is consumed only by its tab and rejects a different session", () => {
		let changes = 0;
		const controller = new ExtensionStatusController(() => { changes++; });
		const target: import("../src/tabs/extension-status-controller.ts").ExtensionStatusRuntime = {
			id: "work", sessionState: { sessionId: "current" },
		};
		const event = (sessionId: string) => ({
			type: "extension_ui_request" as const, id: "usage", method: "setStatus" as const,
			statusKey: "doppelclaude.usage.v1", statusText: JSON.stringify({ ...snapshot("work"), sessionId }),
		});
		expect(controller.handle(event("old"), target)).toBe(true);
		expect(target.providerUsage).toBeUndefined();
		controller.handle(event("current"), target);
		expect(target.providerUsage?.accountId).toBe("work");
		expect(changes).toBe(1);
	});
	test("a current RPC failure does not substitute credentials from another source", async () => {
		let fallback = 0;
		const result = await readClaudeUsage({ ...runtime("work"),
			getProviderUsage: async () => { throw new Error("Timed out waiting for Pi response to get_provider_usage"); },
		}, { now: () => now,
			fetchUsage: async () => { fallback++; return { status: "missing-credentials" }; },
		});
		expect(result.hint).toBe("usage unavailable");
		expect(fallback).toBe(0);
	});
	test("a failed live push marks its own last measurement stale immediately", () => {
		const published: ClaudeUsageReading[] = [];
		const monitor = new ClaudeUsageMonitor((value) => published.push(value), undefined, () => now);
		try {
			monitor.select({ ...runtime("work"), snapshot: snapshot("work", 17) });
			monitor.select({ ...runtime("work"), snapshot: { ...snapshot("work"), status: "error", limits: [] } });
			expect(published.at(-1)?.usage).toMatchObject({ status: "stale", observedAt: now });
			expect(published.at(-1)?.usage?.limits[0]?.percent).toBe(17);
			monitor.clear();
			expect(published.at(-1)?.usage).toBeUndefined();
		} finally { monitor.dispose(); }
	});

});
