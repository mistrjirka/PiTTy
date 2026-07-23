import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	fetchCodexUsage,
	formatResetIn,
	formatWindowLabel,
	parseCodexUsageResponse,
	readCodexCredential,
} from "../src/integrations/codex-usage.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeAuth(contents: unknown): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-codex-auth-"));
	roots.push(root);
	const file = path.join(root, "auth.json");
	fs.writeFileSync(file, JSON.stringify(contents));
	return file;
}

describe("readCodexCredential", () => {
	test("returns undefined when the auth file is missing", () => {
		expect(readCodexCredential(path.join(os.tmpdir(), "does-not-exist.json"))).toBeUndefined();
	});

	test("returns undefined when there is no openai-codex entry", () => {
		const file = writeAuth({ anthropic: { type: "api_key", key: "sk-ant" } });
		expect(readCodexCredential(file)).toBeUndefined();
	});

	test("returns undefined for non-oauth openai-codex entries", () => {
		const file = writeAuth({ "openai-codex": { type: "api_key", key: "sk-x" } });
		expect(readCodexCredential(file)).toBeUndefined();
	});

	test("extracts access token and account id from a stored oauth credential", () => {
		const file = writeAuth({
			"openai-codex": {
				type: "oauth",
				access: "access-token",
				refresh: "refresh-token",
				expires: 123,
				accountId: "user-abc",
			},
		});
		expect(readCodexCredential(file)).toEqual({
			access: "access-token",
			accountId: "user-abc",
		});
	});

	test("returns undefined when accountId is missing", () => {
		const file = writeAuth({ "openai-codex": { type: "oauth", access: "token" } });
		expect(readCodexCredential(file)).toBeUndefined();
	});
});

describe("parseCodexUsageResponse", () => {
	test("returns undefined when rate_limit is missing", () => {
		expect(parseCodexUsageResponse({})).toBeUndefined();
	});

	test("parses a single weekly window without a 5h secondary window", () => {
		const usage = parseCodexUsageResponse({
			plan_type: "prolite",
			rate_limit: {
				allowed: true,
				primary_window: {
					used_percent: 43,
					limit_window_seconds: 604_800,
					reset_after_seconds: 449_024,
					reset_at: 1_785_258_182,
				},
				secondary_window: null,
			},
		});
		expect(usage).toEqual({
			planType: "prolite",
			windows: [
				{
					usedPercent: 43,
					windowSeconds: 604_800,
					resetAfterSeconds: 449_024,
					resetAt: 1_785_258_182,
				},
			],
		});
	});

	test("parses both windows when present", () => {
		const usage = parseCodexUsageResponse({
			rate_limit: {
				primary_window: {
					used_percent: 10,
					limit_window_seconds: 18_000,
					reset_after_seconds: 9_000,
					reset_at: 1,
				},
				secondary_window: {
					used_percent: 20,
					limit_window_seconds: 604_800,
					reset_after_seconds: 400_000,
					reset_at: 2,
				},
			},
		});
		expect(usage?.windows).toHaveLength(2);
	});
});

describe("fetchCodexUsage", () => {
	test("returns undefined without a stored credential", async () => {
		const usage = await fetchCodexUsage({
			authPath: path.join(os.tmpdir(), "does-not-exist.json"),
			fetchImpl: (() => {
				throw new Error("should not be called");
			}) as unknown as typeof fetch,
		});
		expect(usage).toBeUndefined();
	});

	test("returns undefined when the request fails", async () => {
		const file = writeAuth({
			"openai-codex": { type: "oauth", access: "token", accountId: "user-abc" },
		});
		const usage = await fetchCodexUsage({
			authPath: file,
			fetchImpl: (async () => {
				throw new Error("network down");
			}) as unknown as typeof fetch,
		});
		expect(usage).toBeUndefined();
	});

	test("returns undefined on a non-ok response", async () => {
		const file = writeAuth({
			"openai-codex": { type: "oauth", access: "token", accountId: "user-abc" },
		});
		const usage = await fetchCodexUsage({
			authPath: file,
			fetchImpl: (async () =>
				new Response("unauthorized", { status: 401 })) as unknown as typeof fetch,
		});
		expect(usage).toBeUndefined();
	});

	test("sends the bearer token and account id header and parses the body", async () => {
		const file = writeAuth({
			"openai-codex": { type: "oauth", access: "token-xyz", accountId: "user-abc" },
		});
		let capturedRequest: Request | undefined;
		const usage = await fetchCodexUsage({
			authPath: file,
			fetchImpl: (async (url: string, init?: RequestInit) => {
				capturedRequest = new Request(url, init);
				return new Response(
					JSON.stringify({
						plan_type: "prolite",
						rate_limit: {
							primary_window: {
								used_percent: 43,
								limit_window_seconds: 604_800,
								reset_after_seconds: 449_024,
								reset_at: 1,
							},
							secondary_window: null,
						},
					}),
					{ status: 200 },
				);
			}) as unknown as typeof fetch,
		});
		expect(usage?.windows[0]?.usedPercent).toBe(43);
		expect(capturedRequest?.headers.get("Authorization")).toBe("Bearer token-xyz");
		expect(capturedRequest?.headers.get("ChatGPT-Account-ID")).toBe("user-abc");
	});
});

describe("formatWindowLabel", () => {
	test("formats sub-hour windows in minutes", () => {
		expect(formatWindowLabel(1_800)).toBe("30m");
	});
	test("formats sub-day windows in hours", () => {
		expect(formatWindowLabel(18_000)).toBe("5h");
	});
	test("formats multi-day windows in days", () => {
		expect(formatWindowLabel(604_800)).toBe("7d");
	});
});

describe("formatResetIn", () => {
	test("formats a multi-day countdown", () => {
		expect(formatResetIn(449_024)).toBe("5d 4h");
	});
	test("formats an hour-scale countdown", () => {
		expect(formatResetIn(5_400)).toBe("1h 30m");
	});
	test("formats a near-immediate countdown", () => {
		expect(formatResetIn(30)).toBe("0m");
	});
	test("treats zero or negative as now", () => {
		expect(formatResetIn(0)).toBe("now");
	});
});
