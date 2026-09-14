import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	defaultOpencodeUsageHistoryPath,
	fetchOpencodeUsage,
	parseOpencodeUsageResponse,
	readOpencodeCredential,
} from "../src/integrations/opencode-usage.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeAuth(contents: unknown): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-opencode-auth-"));
	roots.push(root);
	const file = path.join(root, "auth.json");
	fs.writeFileSync(file, JSON.stringify(contents));
	return file;
}

function windowBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		status: "ok",
		percent: 25,
		resetsAt: new Date(Date.now() + 120_000).toISOString(),
		...overrides,
	};
}

type FetchFunction = (
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
) => ReturnType<typeof fetch>;

function fakeFetch(implementation: FetchFunction): typeof fetch {
	return Object.assign(implementation, { preconnect: fetch.preconnect });
}

describe("readOpencodeCredential", () => {
	test("extracts an opencode-go api key", () => {
		const file = writeAuth({ "opencode-go": { type: "api_key", key: "go-key" } });
		expect(readOpencodeCredential(file)).toEqual({ key: "go-key" });
	});

	test("returns undefined when the auth file or credential is absent", () => {
		expect(readOpencodeCredential(path.join(os.tmpdir(), "does-not-exist.json"))).toBeUndefined();
		expect(readOpencodeCredential(writeAuth({ anthropic: { type: "api_key", key: "key" } }))).toBeUndefined();
	});

	test("rejects malformed credentials", () => {
		for (const entry of [
			{ type: "oauth", key: "key" },
			{ type: "api_key" },
			{ type: "api_key", key: "" },
			{ type: "api_key", key: "   " },
			{ type: "api_key", key: 42 },
			null,
		]) {
			expect(readOpencodeCredential(writeAuth({ "opencode-go": entry }))).toBeUndefined();
		}
	});
});

describe("parseOpencodeUsageResponse", () => {
	test("parses the captured live response in canonical order", () => {
		const usage = parseOpencodeUsageResponse({
			usage: {
				rolling: {
					status: "ok",
					percent: 1,
					resetsAt: "2026-09-14T01:31:01.540Z",
				},
				weekly: {
					status: "ok",
					percent: 1,
					resetsAt: "2026-09-14T00:00:00.540Z",
				},
				monthly: {
					status: "ok",
					percent: 61,
					resetsAt: "2026-09-26T22:15:08.540Z",
				},
			},
		});
		expect(usage?.windows.map(({ windowSeconds, usedPercent }) => ({ windowSeconds, usedPercent }))).toEqual([
			{ windowSeconds: 18_000, usedPercent: 1 },
			{ windowSeconds: 604_800, usedPercent: 1 },
			{ windowSeconds: 2_592_000, usedPercent: 61 },
		]);
		expect(usage?.windows.map(({ windowSeconds }) => windowSeconds)).toEqual([
			18_000,
			604_800,
			2_592_000,
		]);
		expect(usage?.windows[0]?.resetAt).toBe(Date.parse("2026-09-14T01:31:01.540Z") / 1000);
	});

	test("derives a countdown from the reset timestamp", () => {
		const resetsAt = new Date(Date.now() + 120_000).toISOString();
		const resetAt = Date.parse(resetsAt) / 1000;
		const usage = parseOpencodeUsageResponse({ usage: { rolling: windowBody({ resetsAt }) } });
		expect(usage?.windows[0]).toMatchObject({
			windowSeconds: 18_000,
			resetAt,
			resetAfterSeconds: Math.max(0, Math.ceil(resetAt - Date.now() / 1000)),
		});
	});

	test("ignores a missing window and unknown extra window", () => {
		const usage = parseOpencodeUsageResponse({
			usage: {
				weekly: windowBody({ percent: 40 }),
				unknown: windowBody({ percent: 90 }),
			},
		});
		expect(usage?.windows.map((window) => window.windowSeconds)).toEqual([604_800]);
	});

	test("drops windows with invalid status, percent, or reset timestamp", () => {
		const invalidWindows = [
			{ status: "unknown" },
			{ percent: -1 },
			{ percent: 101 },
			{ percent: Number.NaN },
			{ percent: "25" },
			{ resetsAt: undefined },
			{ resetsAt: 123 },
			{ resetsAt: "not-a-timestamp" },
		];
		for (const overrides of invalidWindows) {
			expect(parseOpencodeUsageResponse({ usage: { rolling: windowBody(overrides) } })).toBeUndefined();
		}
	});

	test("drops an unknown status while retaining valid windows", () => {
		const usage = parseOpencodeUsageResponse({
			usage: {
				rolling: windowBody({ status: "unknown" }),
				monthly: windowBody({ status: "rate-limited" }),
			},
		});
		expect(usage?.windows.map((window) => window.windowSeconds)).toEqual([2_592_000]);
	});

	test("rejects empty or non-object bodies", () => {
		for (const body of [null, undefined, [], {}, { usage: null }, { usage: {} }]) {
			expect(parseOpencodeUsageResponse(body)).toBeUndefined();
		}
	});
});

describe("fetchOpencodeUsage", () => {
	test("returns undefined without a stored credential", async () => {
		const usage = await fetchOpencodeUsage({
			authPath: path.join(os.tmpdir(), "does-not-exist.json"),
			fetchImpl: fakeFetch(async () => {
				throw new Error("should not be called");
			}),
		});
		expect(usage).toBeUndefined();
	});

	test("returns undefined on a non-ok response", async () => {
		const file = writeAuth({ "opencode-go": { type: "api_key", key: "go-key" } });
		const usage = await fetchOpencodeUsage({
			authPath: file,
			fetchImpl: fakeFetch(async () => new Response("unauthorized", { status: 401 })),
		});
		expect(usage).toBeUndefined();
	});

	test("returns undefined when fetch throws", async () => {
		const file = writeAuth({ "opencode-go": { type: "api_key", key: "go-key" } });
		const usage = await fetchOpencodeUsage({
			authPath: file,
			fetchImpl: fakeFetch(async () => {
				throw new Error("network down");
			}),
		});
		expect(usage).toBeUndefined();
	});

	test("sends the bearer token to the usage endpoint and parses windows", async () => {
		const file = writeAuth({ "opencode-go": { type: "api_key", key: "go-key" } });
		let capturedRequest: Request | undefined;
		const usage = await fetchOpencodeUsage({
			authPath: file,
			fetchImpl: fakeFetch(async (url, init) => {
				capturedRequest = new Request(url, init);
				return new Response(JSON.stringify({ usage: { rolling: windowBody(), monthly: windowBody({ percent: 61 }) } }), {
					status: 200,
				});
			}),
		});
		expect(capturedRequest?.url).toBe("https://opencode.ai/zen/go/v1/usage");
		expect(capturedRequest?.headers.get("Authorization")).toBe("Bearer go-key");
		expect(usage?.windows.map((window) => window.windowSeconds)).toEqual([18_000, 2_592_000]);
		expect(usage?.windows.map((window) => window.windowSeconds)).toEqual([18_000, 2_592_000]);
	});
});

describe("defaultOpencodeUsageHistoryPath", () => {
	test("uses the PiTTy state directory and provider-specific filename", () => {
		expect(defaultOpencodeUsageHistoryPath()).toMatch(/pitty[\\/]opencode-usage-history\.json$/);
	});
});
