/** Poll optional provider usage without owning the Pi runtime or its UI. */
import type { Setter } from "solid-js";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import {
	fetchCodexUsage,
	readCodexCredential,
	type CodexUsage,
} from "../integrations/codex-usage.ts";
import {
	defaultOpencodeUsageHistoryPath,
	fetchOpencodeUsage,
	type OpencodeUsage,
} from "../integrations/opencode-usage.ts";
import {
	fetchDoppelclaudeUsage,
	type ClaudeUsage,
} from "../integrations/doppelclaude-usage.ts";
import {
	fetchCswapSnapshot,
	type CswapSnapshot,
} from "../integrations/claude-swap.ts";
import {
	computeUsageStats,
	loadUsageHistory,
	recordUsageSample,
	saveUsageHistory,
	defaultCodexUsageHistoryPath,
	type UsageHistory,
	type UsageStats,
	type UsageWindows,
} from "../integrations/codex-usage-history.ts";

export interface UsagePollingPorts {
	logger: Pick<DiagnosticLogger, "warn" | "info">;
	doppelclaudeInstalled: boolean;
	setCodexUsage: Setter<CodexUsage | undefined>;
	setCodexUsageStats: Setter<Record<number, UsageStats>>;
	setOpencodeUsage: Setter<OpencodeUsage | undefined>;
	setOpencodeUsageStats: Setter<Record<number, UsageStats>>;
	setCswapSnapshot: Setter<CswapSnapshot | undefined>;
	setClaudeUsage: Setter<ClaudeUsage | undefined>;
	setClaudeHint: Setter<string | undefined>;
	applyCswapUsage: (snapshot: CswapSnapshot) => void;
	claudeEffectiveSlot: () => number | undefined;
}

export function startUsagePolling(ports: UsagePollingPorts): () => void {
	let codexUsageTimer: ReturnType<typeof setInterval> | undefined;
	let opencodeUsageTimer: ReturnType<typeof setInterval> | undefined;
	let claudeUsageTimer: ReturnType<typeof setTimeout> | undefined;
	let codexUsageHistory: UsageHistory = loadUsageHistory(
		defaultCodexUsageHistoryPath(),
	);
	let opencodeUsageHistory: UsageHistory = loadUsageHistory(
		defaultOpencodeUsageHistoryPath(),
	);
	let disposed = false;
	const {
		setCodexUsage,
		setCodexUsageStats,
		setOpencodeUsage,
		setOpencodeUsageStats,
		setCswapSnapshot,
		setClaudeUsage,
		setClaudeHint,
	} = ports;
	const updateUsage = <T extends UsageWindows>(
		usage: T | undefined,
		setUsage: (value: T | undefined) => void,
		historyPath: string,
		history: UsageHistory,
		setStats: (value: Record<number, UsageStats>) => void,
	): UsageHistory => {
		setUsage(usage);
		if (!usage) return history;
		const now = Date.now();
		const nextHistory = recordUsageSample(
			loadUsageHistory(historyPath),
			usage,
			now,
		);
		saveUsageHistory(nextHistory, historyPath);
		const stats: Record<number, UsageStats> = {};
		for (const window of usage.windows) {
			stats[window.windowSeconds] = computeUsageStats(
				nextHistory[window.windowSeconds] ?? [],
				window,
				now,
			);
		}
		setStats(stats);
		return nextHistory;
	};
	const updateCodexUsage = (usage: CodexUsage | undefined) => {
		codexUsageHistory = updateUsage(
			usage,
			setCodexUsage,
			defaultCodexUsageHistoryPath(),
			codexUsageHistory,
			setCodexUsageStats,
		);
	};
	const pollCodex = () => {
		void fetchCodexUsage().then((usage) => {
			// A missing credential simply hides the segment; a failed fetch
			// with a credential present is worth one diagnostics line so a
			// vanishing codex segment can be told apart from width shedding.
			if (!usage && readCodexCredential())
				ports.logger.warn("codex_usage.fetch_failed", {});
			updateCodexUsage(usage);
		});
	};
	pollCodex();
	codexUsageTimer = setInterval(pollCodex, 5 * 60_000);
	const updateOpencodeUsage = (usage: OpencodeUsage | undefined) => {
		opencodeUsageHistory = updateUsage(
			usage,
			setOpencodeUsage,
			defaultOpencodeUsageHistoryPath(),
			opencodeUsageHistory,
			setOpencodeUsageStats,
		);
	};
	void fetchOpencodeUsage().then(updateOpencodeUsage);
	opencodeUsageTimer = setInterval(() => {
		void fetchOpencodeUsage().then(updateOpencodeUsage);
	}, 5 * 60_000);
	if (ports.doppelclaudeInstalled) {
		let claudeInFlight = false;

		const scheduleClaude = (delayMs: number) => {
			if (disposed) return;
			claudeUsageTimer = setTimeout(() => void pollClaude(), delayMs);
		};
		const pollClaude = async () => {
			if (claudeInFlight) return;
			claudeInFlight = true;
			// Match the Codex/OpenCode cadence; only back off when the endpoint
			// pushes back (it is aggressively rate limited upstream).
			let next = 5 * 60_000;
			try {
				const cswap = await fetchCswapSnapshot();
				if (cswap) {
					setCswapSnapshot(cswap);
					ports.applyCswapUsage(cswap);
					ports.logger.info("claude_usage.cswap", {
						accounts: cswap.accounts.length,
						selectedSlot: ports.claudeEffectiveSlot(),
					});
					return;
				}
				setCswapSnapshot(undefined);
				const outcome = await fetchDoppelclaudeUsage();
				ports.logger.info("claude_usage.fetch", {
					status: outcome.status,
					...(outcome.status === "ok"
						? { limits: outcome.usage.limits.length }
						: {}),
					...(outcome.status === "http-error"
						? { httpStatus: outcome.httpStatus }
						: {}),
				});
				if (outcome.status === "ok") {
					setClaudeUsage(outcome.usage);
					setClaudeHint(undefined);
				} else if (outcome.status === "expired") {
					setClaudeUsage(undefined);
					setClaudeHint("login expired (run Claude Code)");
				} else if (outcome.status === "missing-credentials") {
					setClaudeUsage(undefined);
					setClaudeHint(undefined);
				} else if (
					outcome.status === "rate-limited" ||
					outcome.status === "http-error"
				) {
					next = 30 * 60_000;
				}
			} finally {
				claudeInFlight = false;
				scheduleClaude(next);
			}
		};
		scheduleClaude(3_000);
	}

	return () => {
		disposed = true;
		if (codexUsageTimer) clearInterval(codexUsageTimer);
		if (opencodeUsageTimer) clearInterval(opencodeUsageTimer);
		if (claudeUsageTimer) clearTimeout(claudeUsageTimer);
	};
}
