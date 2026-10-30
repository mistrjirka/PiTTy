import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	defaultClaudeCredentialsPath,
	fetchDoppelclaudeUsage,
	parseDoppelclaudeUsage,
	readClaudeOauthCredential,
} from "../src/integrations/doppelclaude-usage.ts";
import { detectOptionalIntegrations } from "../src/integrations/detect.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeCredentials(oauth: unknown): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-claude-creds-"));
	roots.push(root);
	const file = path.join(root, ".credentials.json");
	fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: oauth }));
	return file;
}

const NOW = Date.parse("2026-10-30T12:00:00Z");

const body = {
	limits: [
		{ kind: "session", percent: 100, severity: "critical", resets_at: "2026-10-30T13:30:00+00:00", scope: null, is_active: true },
		{ kind: "weekly_all", percent: 51, severity: "normal", resets_at: "2026-11-05T02:00:00+00:00", scope: null, is_active: false },
	],
};

describe("claude credentials", () => {
	test("reads token, expiry and plan", () => {
		const file = writeCredentials({ accessToken: "tok", expiresAt: 5, subscriptionType: "pro", rateLimitTier: "default" });
		expect(readClaudeOauthCredential(file)).toEqual({ accessToken: "tok", expiresAt: 5, subscriptionType: "pro", rateLimitTier: "default" });
	});
	test("missing, invalid or tokenless credentials are undefined", () => {
		expect(readClaudeOauthCredential("/nonexistent/.credentials.json")).toBeUndefined();
		expect(readClaudeOauthCredential(writeCredentials({ accessToken: " " }))).toBeUndefined();
		const bad = writeCredentials({});
		fs.writeFileSync(bad, "{nope");
		expect(readClaudeOauthCredential(bad)).toBeUndefined();
	});
	test("honours CLAUDE_CONFIG_DIR", () => {
		expect(defaultClaudeCredentialsPath({ CLAUDE_CONFIG_DIR: "/x/y" })).toBe("/x/y/.credentials.json");
		expect(defaultClaudeCredentialsPath({})).toBe(path.join(os.homedir(), ".claude", ".credentials.json"));
	});
});

describe("parseDoppelclaudeUsage", () => {
	test("parses limits with severity, activity and reset", () => {
		const usage = parseDoppelclaudeUsage(body, NOW, "pro");
		expect(usage?.planType).toBe("pro");
		expect(usage?.limits).toEqual([
			{ kind: "session", label: "Session", percent: 100, severity: "critical", resetAt: Date.parse("2026-10-30T13:30:00+00:00"), active: true },
			{ kind: "weekly_all", label: "Week", percent: 51, severity: "normal", resetAt: Date.parse("2026-11-05T02:00:00+00:00"), active: false },
		]);
	});
	test("labels scoped weekly limits and unknown severity", () => {
		const usage = parseDoppelclaudeUsage(
			{ limits: [{ kind: "weekly_scoped", scope: "opus", percent: 10, severity: "bogus", resets_at: "x" }] },
			NOW,
		);
		expect(usage?.limits[0]).toMatchObject({ label: "Week · Opus", resetAt: NOW, active: false });
		expect(usage?.limits[0]?.severity).toBeUndefined();
	});
	test("falls back to five_hour/seven_day when limits missing or empty", () => {
		const legacy = {
			limits: [],
			five_hour: { utilization: 12.5, resets_at: "2026-10-30T15:00:00Z" },
			seven_day: { utilization: 40, resets_at: "2026-11-05T00:00:00Z" },
		};
		const usage = parseDoppelclaudeUsage(legacy, NOW);
		expect(usage?.limits.map((l) => [l.label, l.percent])).toEqual([["Session", 12.5], ["Week", 40]]);
	});
	test("rejects non-finite or malformed percentages", () => {
		expect(parseDoppelclaudeUsage({ limits: [{ kind: "session", percent: "5" }, { kind: "x", percent: null }] }, NOW)).toBeUndefined();
		expect(parseDoppelclaudeUsage({ five_hour: { utilization: Number.NaN } }, NOW)).toBeUndefined();
		expect(parseDoppelclaudeUsage(null, NOW)).toBeUndefined();
		expect(parseDoppelclaudeUsage({ limits: [{ kind: "session", percent: -5 }] }, NOW)?.limits[0]?.percent).toBe(0);
	});
});

describe("fetchDoppelclaudeUsage", () => {
	const stub = (status: number, payload: unknown = body) => {
		const calls: Array<{ url: unknown; init: RequestInit | undefined }> = [];
		const fetchImpl = (async (url: unknown, init?: RequestInit) => {
			calls.push({ url, init });
			return new Response(JSON.stringify(payload), { status });
		}) as unknown as typeof fetch;
		return { calls, fetchImpl };
	};

	test("fetches with bearer token and beta header", async () => {
		const file = writeCredentials({ accessToken: "tok", expiresAt: NOW + 60_000, subscriptionType: "pro" });
		const { calls, fetchImpl } = stub(200);
		const outcome = await fetchDoppelclaudeUsage({ credentialsPath: file, fetchImpl, now: () => NOW });
		expect(outcome.status).toBe("ok");
		expect(calls).toHaveLength(1);
		const headers = calls[0]?.init?.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer tok");
		expect(headers["anthropic-beta"]).toBe("oauth-2025-04-20");
	});
	test("expired token never calls fetch", async () => {
		const file = writeCredentials({ accessToken: "tok", expiresAt: NOW - 1 });
		const { calls, fetchImpl } = stub(200);
		expect(await fetchDoppelclaudeUsage({ credentialsPath: file, fetchImpl, now: () => NOW })).toEqual({ status: "expired" });
		expect(calls).toHaveLength(0);
	});
	test("missing credentials never call fetch", async () => {
		const { calls, fetchImpl } = stub(200);
		expect(await fetchDoppelclaudeUsage({ credentialsPath: "/nonexistent/c.json", fetchImpl })).toEqual({ status: "missing-credentials" });
		expect(calls).toHaveLength(0);
	});
	test("429 yields rate-limited, other errors http-error, without retry", async () => {
		const file = writeCredentials({ accessToken: "tok", expiresAt: NOW + 60_000 });
		const limited = stub(429, {});
		expect(await fetchDoppelclaudeUsage({ credentialsPath: file, fetchImpl: limited.fetchImpl, now: () => NOW })).toEqual({ status: "rate-limited" });
		expect(limited.calls).toHaveLength(1);
		const failed = stub(500, {});
		expect(await fetchDoppelclaudeUsage({ credentialsPath: file, fetchImpl: failed.fetchImpl, now: () => NOW })).toEqual({ status: "http-error", httpStatus: 500 });
	});
	test("network failure and unusable body yield error", async () => {
		const file = writeCredentials({ accessToken: "tok" });
		const boom = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
		expect(await fetchDoppelclaudeUsage({ credentialsPath: file, fetchImpl: boom })).toEqual({ status: "error" });
		expect((await fetchDoppelclaudeUsage({ credentialsPath: file, fetchImpl: stub(200, {}).fetchImpl })).status).toBe("error");
	});
});

describe("pi-doppelclaude detection", () => {
	test("detects the package from project settings", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-doppelclaude-"));
		roots.push(cwd);
		fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
		fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:pi-doppelclaude"] }));
		const result = detectOptionalIntegrations({ piExecutable: "definitely-not-a-real-pi-binary", cwd });
		expect(result.doppelclaude.installed).toBe(true);
		expect(result.doppelclaude.packageName).toBe("pi-doppelclaude");
	});
});
