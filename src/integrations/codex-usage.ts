import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodexUsageWindow = {
	usedPercent: number;
	windowSeconds: number;
	resetAfterSeconds: number;
	resetAt: number;
};

export type CodexUsage = {
	planType?: string;
	windows: CodexUsageWindow[];
};

export type CodexCredential = { access: string; accountId: string };

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function defaultAuthPath(): string {
	return path.join(os.homedir(), ".pi", "agent", "auth.json");
}

/**
 * Reads the OpenAI Codex (ChatGPT Plus/Pro) OAuth credential that Pi stores
 * after `/login`, if present. Returns undefined for any other auth method
 * (API key, other providers) or if Pi has never logged in with Codex.
 */
export function readCodexCredential(
	authPath: string = defaultAuthPath(),
): CodexCredential | undefined {
	try {
		const raw = JSON.parse(fs.readFileSync(authPath, "utf8"));
		const entry = record(record(raw)?.["openai-codex"]);
		if (!entry || entry.type !== "oauth") return undefined;
		const access = entry.access;
		const accountId = entry.accountId;
		if (typeof access !== "string" || !access.trim()) return undefined;
		if (typeof accountId !== "string" || !accountId.trim()) return undefined;
		return { access, accountId };
	} catch {
		return undefined;
	}
}

function parseWindow(value: unknown): CodexUsageWindow | undefined {
	const source = record(value);
	if (!source) return undefined;
	const usedPercent = source.used_percent;
	const windowSeconds = source.limit_window_seconds;
	const resetAfterSeconds = source.reset_after_seconds;
	const resetAt = source.reset_at;
	if (
		typeof usedPercent !== "number" ||
		typeof windowSeconds !== "number" ||
		typeof resetAfterSeconds !== "number" ||
		typeof resetAt !== "number"
	)
		return undefined;
	return { usedPercent, windowSeconds, resetAfterSeconds, resetAt };
}

/**
 * Parses the (undocumented) ChatGPT backend usage payload used by Codex CLI
 * itself. Plans without a short rolling window omit `secondary_window`
 * entirely (it's `null`), so only windows that are actually present are
 * returned - callers should not assume a fixed 5h/weekly pair.
 */
export function parseCodexUsageResponse(body: unknown): CodexUsage | undefined {
	const source = record(body);
	const rateLimit = record(source?.rate_limit);
	if (!rateLimit) return undefined;
	const windows = [
		parseWindow(rateLimit.primary_window),
		parseWindow(rateLimit.secondary_window),
	].filter((window): window is CodexUsageWindow => window !== undefined);
	if (windows.length === 0) return undefined;
	const planType = typeof source?.plan_type === "string" ? source.plan_type : undefined;
	return { ...(planType ? { planType } : {}), windows };
}

export type FetchCodexUsageOptions = {
	authPath?: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
};

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

/**
 * Fetches the current Codex account rate-limit usage using the same private
 * endpoint the Codex CLI's own status line queries. Returns undefined on any
 * failure (no credential, expired token, network error, unexpected shape) so
 * callers can hide the feature entirely rather than surface an error state.
 */
export async function fetchCodexUsage(
	options: FetchCodexUsageOptions = {},
): Promise<CodexUsage | undefined> {
	const credential = readCodexCredential(options.authPath);
	if (!credential) return undefined;
	const fetchImpl = options.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
	try {
		const response = await fetchImpl(CODEX_USAGE_URL, {
			headers: {
				Authorization: `Bearer ${credential.access}`,
				"ChatGPT-Account-ID": credential.accountId,
			},
			signal: controller.signal,
		});
		if (!response.ok) return undefined;
		return parseCodexUsageResponse(await response.json());
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

/** Formats a window duration like `604800` seconds as a short label, `7d`. */
export function formatWindowLabel(windowSeconds: number): string {
	if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return "—";
	const minutes = windowSeconds / 60;
	if (minutes < 60) return `${Math.round(minutes)}m`;
	const hours = minutes / 60;
	if (hours < 24) return `${Math.round(hours)}h`;
	return `${Math.round(hours / 24)}d`;
}

/** Formats a reset countdown like `449024` seconds as `5d 4h`. */
export function formatResetIn(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "now";
	const totalMinutes = Math.floor(seconds / 60);
	const days = Math.floor(totalMinutes / (60 * 24));
	const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}
