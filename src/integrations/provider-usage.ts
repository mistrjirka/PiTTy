import type { ClaudeUsage } from "./doppelclaude-usage.ts";

/** Account-bound control data. Fetching it must not start an inference request. */
export type ProviderUsageSnapshot = {
	provider: string;
	sessionId?: string;
	status: "ok" | "stale" | "unavailable" | "error";
	accountId?: string;
	accountLabel?: string;
	profileSource?: string;
	configDir?: string;
	observedAt: number | null;
	limits: Array<{
		kind: string;
		label: string;
		percent: number | null;
		resetAt: number | null;
		scope?: string;
		active?: boolean;
		severity?: "normal" | "warning" | "critical";
	}>;
	source: string;
	error?: string;
};

export function claudeUsageFromProvider(
	snapshot: ProviderUsageSnapshot,
	now = Date.now(),
): ClaudeUsage | undefined {
	if (!Array.isArray(snapshot.limits) || snapshot.limits.length === 0) return;
	const limits = snapshot.limits.flatMap((limit) => {
		if (!limit || typeof limit.kind !== "string") return [];
		const percent = typeof limit.percent === "number" && Number.isFinite(limit.percent)
			? Math.min(1000, Math.max(0, limit.percent)) : null;
		const resetAt = typeof limit.resetAt === "number" && Number.isFinite(limit.resetAt) && limit.resetAt > 0
			? limit.resetAt : null;
		const severity = limit.severity === "normal" || limit.severity === "warning" || limit.severity === "critical"
			? limit.severity : undefined;
		return [{
			kind: limit.kind,
			label: typeof limit.label === "string" ? limit.label : limit.kind,
			percent, resetAt, active: limit.active === true,
			...(severity ? { severity } : {}),
		}];
	});
	if (!limits.length) return;
	const observedAt = typeof snapshot.observedAt === "number" &&
		Number.isFinite(snapshot.observedAt) && snapshot.observedAt > 0 && snapshot.observedAt <= now + 60_000
		? snapshot.observedAt : null;
	return {
		limits, observedAt,
		status: snapshot.status !== "ok" ? "stale" : observedAt === null ? "unknown" : "ok",
		...(snapshot.accountId ? { accountId: snapshot.accountId } : {}),
		...(snapshot.accountLabel ? { accountLabel: snapshot.accountLabel } : {}),
		...(snapshot.profileSource ? { profileSource: snapshot.profileSource } : {}),
		source: snapshot.source,
	};
}


export const PROVIDER_USAGE_STATUS_KEY = "doppelclaude.usage.v1";

export function parseProviderUsageSnapshot(value: unknown): ProviderUsageSnapshot | undefined {
	try {
		const source = typeof value === "string" ? JSON.parse(value) : value;
		if (!source || typeof source !== "object" || !Array.isArray(source.limits) ||
			typeof source.provider !== "string" || typeof source.source !== "string" ||
			!["ok", "stale", "unavailable", "error"].includes(source.status)) return;
		for (const key of ["accountId", "accountLabel", "profileSource", "configDir", "sessionId", "error"]) {
			if (source[key] !== undefined && typeof source[key] !== "string") return;
		}
		return source as ProviderUsageSnapshot;
	} catch {
		return undefined;
	}
}
