/** Poll optional provider usage without owning the Pi runtime or its UI. */
import { createEffect, type Setter } from "solid-js";
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
import type { ClaudeUsage } from "../integrations/doppelclaude-usage.ts";
import { fetchCswapSnapshot, type CswapSnapshot } from "../integrations/claude-swap.ts";
import { ClaudeUsageMonitor, type ClaudeUsageRuntime } from "../integrations/claude-usage-monitor.ts";
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
	claudeRuntime: () => ClaudeUsageRuntime | undefined;
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
	let cswapSnapshotTimer: ReturnType<typeof setInterval> | undefined;
	let codexUsageTimer: ReturnType<typeof setInterval> | undefined;
	let opencodeUsageTimer: ReturnType<typeof setInterval> | undefined;
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
	// Account discovery is independent of the active query's authoritative usage.
	// Otherwise a working SDK usage endpoint would leave the new-tab selector empty.
	const discoverClaudeAccounts = () => void fetchCswapSnapshot().then((snapshot) => {
		if (!disposed && snapshot) setCswapSnapshot(snapshot);
	});
	discoverClaudeAccounts();
	cswapSnapshotTimer = setInterval(discoverClaudeAccounts, 5 * 60_000);
	const claudeMonitor = new ClaudeUsageMonitor((reading) => {
		if (disposed) return;
		if (reading.snapshot) setCswapSnapshot(reading.snapshot);
		setClaudeUsage(reading.usage);
		setClaudeHint(reading.hint);
	});
	createEffect(() => {
		const runtime = ports.claudeRuntime();
		if (runtime) claudeMonitor.select(runtime);
		else claudeMonitor.clear();
	});

	return () => {
		disposed = true;
		if (cswapSnapshotTimer) clearInterval(cswapSnapshotTimer);
		if (codexUsageTimer) clearInterval(codexUsageTimer);
		if (opencodeUsageTimer) clearInterval(opencodeUsageTimer);
		claudeMonitor.dispose();
	};
}
