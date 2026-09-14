import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultAuthPath } from "./codex-usage.ts";

/**
 * Opencode usage windows deliberately mirror the Codex usage-window shape
 * (`usedPercent` + `windowSeconds` + `resetAt` epoch), so the shared history,
 * pace, and runout helpers are reused instead of duplicating that logic.
 */
export type OpencodeUsageWindow = {
	windowSeconds: number;
	usedPercent: number;
	resetAfterSeconds: number;
	resetAt: number;
};

export type OpencodeUsage = {
	windows: OpencodeUsageWindow[];
};

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function readOpencodeCredential(
	authPath: string = defaultAuthPath(),
): { key: string } | undefined {
	try {
		const raw = JSON.parse(fs.readFileSync(authPath, "utf8"));
		const entry = record(record(raw)?.["opencode-go"]);
		if (!entry || entry.type !== "api_key") return undefined;
		const key = entry.key;
		if (typeof key !== "string" || !key.trim()) return undefined;
		return { key };
	} catch {
		return undefined;
	}
}

const WINDOW_DEFINITIONS = [
	{ key: "rolling", windowSeconds: 18_000 },
	{ key: "weekly", windowSeconds: 604_800 },
	{ key: "monthly", windowSeconds: 2_592_000 },
] as const;

function parseWindow(
	value: unknown,
	definition: (typeof WINDOW_DEFINITIONS)[number],
): OpencodeUsageWindow | undefined {
	const source = record(value);
	if (!source) return undefined;
	const status = source.status;
	const usedPercent = source.percent;
	const resetsAt = source.resetsAt;
	// Validate status as a payload-contract gate; it is not stored in the window state.
	if (
		(status !== "ok" && status !== "rate-limited") ||
		typeof usedPercent !== "number" ||
		!Number.isFinite(usedPercent) ||
		usedPercent < 0 ||
		usedPercent > 100 ||
		typeof resetsAt !== "string"
	)
		return undefined;
	const resetAtMs = Date.parse(resetsAt);
	if (!Number.isFinite(resetAtMs)) return undefined;
	const resetAt = resetAtMs / 1000;
	return {
		windowSeconds: definition.windowSeconds,
		usedPercent,
		resetAfterSeconds: Math.max(0, Math.ceil(resetAt - Date.now() / 1000)),
		resetAt,
	};
}

export function parseOpencodeUsageResponse(
	body: unknown,
): OpencodeUsage | undefined {
	const source = record(body);
	const usage = record(source?.usage);
	if (!usage) return undefined;
	const windows = WINDOW_DEFINITIONS.map((definition) =>
		parseWindow(usage[definition.key], definition),
	).filter((window): window is OpencodeUsageWindow => window !== undefined);
	return windows.length > 0 ? { windows } : undefined;
}

export type FetchOpencodeUsageOptions = {
	authPath?: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
};

const OPENCODE_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

export async function fetchOpencodeUsage(
	options: FetchOpencodeUsageOptions = {},
): Promise<OpencodeUsage | undefined> {
	const credential = readOpencodeCredential(options.authPath);
	if (!credential) return undefined;
	const fetchImpl = options.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
	try {
		const response = await fetchImpl(OPENCODE_USAGE_URL, {
			headers: { Authorization: `Bearer ${credential.key}` },
			signal: controller.signal,
		});
		if (!response.ok) return undefined;
		return parseOpencodeUsageResponse(await response.json());
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

export function defaultOpencodeUsageHistoryPath(): string {
	const stateHome = process.env.XDG_STATE_HOME?.trim();
	const base = stateHome
		? path.join(stateHome, "pitty")
		: path.join(os.homedir(), ".local", "state", "pitty");
	return path.join(base, "opencode-usage-history.json");
}

