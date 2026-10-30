import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ClaudeLimitSeverity = "normal" | "warning" | "critical";

export type ClaudeLimit = {
	kind: string;
	label: string;
	percent: number;
	severity?: ClaudeLimitSeverity;
	resetAt: number;
	active: boolean;
};

export type ClaudeUsage = {
	planType?: string;
	limits: ClaudeLimit[];
};

export type ClaudeOauthCredential = {
	accessToken: string;
	expiresAt?: number;
	subscriptionType?: string;
	rateLimitTier?: string;
};

export type ClaudeUsageOutcome =
	| { status: "ok"; usage: ClaudeUsage }
	| { status: "missing-credentials" }
	| { status: "expired" }
	| { status: "rate-limited" }
	| { status: "http-error"; httpStatus: number }
	| { status: "error" };

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Claude Code keeps its OAuth credentials in `$CLAUDE_CONFIG_DIR` or `~/.claude`. */
export function defaultClaudeCredentialsPath(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const configured = env.CLAUDE_CONFIG_DIR?.trim();
	return path.join(
		configured ? configured : path.join(os.homedir(), ".claude"),
		".credentials.json",
	);
}

/**
 * Reads (never writes or refreshes) the Claude Code subscription OAuth
 * credential. Claude Code owns this token and its refresh flow.
 */
export function readClaudeOauthCredential(
	credentialsPath: string = defaultClaudeCredentialsPath(),
): ClaudeOauthCredential | undefined {
	try {
		const raw = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
		const entry = record(record(raw)?.claudeAiOauth);
		if (!entry) return undefined;
		const accessToken = entry.accessToken;
		if (typeof accessToken !== "string" || !accessToken.trim()) return undefined;
		const expiresAt = entry.expiresAt;
		const subscriptionType = entry.subscriptionType;
		const rateLimitTier = entry.rateLimitTier;
		return {
			accessToken,
			...(typeof expiresAt === "number" && Number.isFinite(expiresAt)
				? { expiresAt }
				: {}),
			...(typeof subscriptionType === "string" && subscriptionType
				? { subscriptionType }
				: {}),
			...(typeof rateLimitTier === "string" && rateLimitTier
				? { rateLimitTier }
				: {}),
		};
	} catch {
		return undefined;
	}
}

function titleCase(value: string): string {
	return value
		.replace(/[_-]+/g, " ")
		.trim()
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

function limitLabel(kind: string, scope: unknown): string {
	const scopeName =
		typeof scope === "string" && scope.trim() ? titleCase(scope) : undefined;
	if (kind === "session") return "Session";
	if (kind === "weekly_all") return "Week";
	if (kind.startsWith("weekly")) {
		const suffix = scopeName ?? titleCase(kind.replace(/^weekly_?/, ""));
		return suffix ? `Week · ${suffix}` : "Week";
	}
	return scopeName ? `${titleCase(kind)} · ${scopeName}` : titleCase(kind);
}

function parsePercent(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.min(Math.max(value, 0), 1000);
}

function parseResetAt(value: unknown, now: number): number {
	if (typeof value === "string") {
		const time = Date.parse(value);
		if (Number.isFinite(time)) return time;
	}
	return now;
}

function parseSeverity(value: unknown): ClaudeLimitSeverity | undefined {
	return value === "normal" || value === "warning" || value === "critical"
		? value
		: undefined;
}

function parseLimitsArray(value: unknown[], now: number): ClaudeLimit[] {
	const limits: ClaudeLimit[] = [];
	for (const item of value) {
		const source = record(item);
		if (!source || typeof source.kind !== "string" || !source.kind) continue;
		const percent = parsePercent(source.percent);
		if (percent === undefined) continue;
		const severity = parseSeverity(source.severity);
		limits.push({
			kind: source.kind,
			label: limitLabel(source.kind, source.scope),
			percent,
			...(severity ? { severity } : {}),
			resetAt: parseResetAt(source.resets_at, now),
			active: source.is_active === true,
		});
	}
	return limits;
}

function parseLegacyWindow(
	kind: string,
	label: string,
	value: unknown,
	now: number,
): ClaudeLimit | undefined {
	const source = record(value);
	if (!source) return undefined;
	const percent = parsePercent(source.utilization);
	if (percent === undefined) return undefined;
	return {
		kind,
		label,
		percent,
		resetAt: parseResetAt(source.resets_at, now),
		active: false,
	};
}

/**
 * Normalizes Anthropic's `oauth/usage` payload. Prefers the ordered `limits`
 * array and falls back to `five_hour`/`seven_day`. Returns undefined if no
 * usable limit is present.
 */
export function parseDoppelclaudeUsage(
	body: unknown,
	now: number,
	planType?: string,
): ClaudeUsage | undefined {
	const source = record(body);
	if (!source) return undefined;
	let limits = Array.isArray(source.limits)
		? parseLimitsArray(source.limits, now)
		: [];
	if (limits.length === 0) {
		limits = [
			parseLegacyWindow("session", "Session", source.five_hour, now),
			parseLegacyWindow("weekly_all", "Week", source.seven_day, now),
		].filter((limit): limit is ClaudeLimit => limit !== undefined);
	}
	if (limits.length === 0) return undefined;
	return { ...(planType ? { planType } : {}), limits };
}

export type FetchDoppelclaudeUsageOptions = {
	credentialsPath?: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	now?: () => number;
};

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

/**
 * Fetches subscription limits once, without retries. An expired token is
 * reported as `expired` without any network call; the token is never refreshed.
 */
export async function fetchDoppelclaudeUsage(
	options: FetchDoppelclaudeUsageOptions = {},
): Promise<ClaudeUsageOutcome> {
	const credential = readClaudeOauthCredential(options.credentialsPath);
	if (!credential) return { status: "missing-credentials" };
	const now = (options.now ?? Date.now)();
	if (credential.expiresAt !== undefined && credential.expiresAt <= now)
		return { status: "expired" };
	const fetchImpl = options.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
	try {
		const response = await fetchImpl(CLAUDE_USAGE_URL, {
			headers: {
				Authorization: `Bearer ${credential.accessToken}`,
				"anthropic-beta": "oauth-2025-04-20",
				Accept: "application/json",
			},
			signal: controller.signal,
		});
		if (response.status === 429) return { status: "rate-limited" };
		if (!response.ok)
			return { status: "http-error", httpStatus: response.status };
		const usage = parseDoppelclaudeUsage(
			await response.json(),
			now,
			credential.subscriptionType,
		);
		return usage ? { status: "ok", usage } : { status: "error" };
	} catch {
		return { status: "error" };
	} finally {
		clearTimeout(timer);
	}
}
