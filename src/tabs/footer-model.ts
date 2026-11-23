/** Footer status, usage budgets and current-session hints. */
import os from "node:os";
import type { Accessor } from "solid-js";
import { resolveCswapSlot, type CswapSnapshot } from "../integrations/claude-swap.ts";
import type { CodexUsage } from "../integrations/codex-usage.ts";
import type { UsageStats } from "../integrations/codex-usage-history.ts";
import type { ClaudeUsage } from "../integrations/doppelclaude-usage.ts";
import type { OpencodeUsage } from "../integrations/opencode-usage.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import { footerHintTiers, footerVersionReservedWidth, selectFooterHint, thinkingFooterText } from "../ui/footer-hints.ts";
import { cleanInline, clip } from "../ui/model-context.tsx";
import {
	USAGE_FOOTER_SEPARATOR,
	type UsageFooterSegment,
	usageFooterSegments,
	usageFooterWidth,
} from "../ui/usage-footer.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

export interface FooterModelPorts {
	forkingConversation: () => boolean;
	status: Accessor<string>;
	setStatus: (value: string) => void;
	streaming: () => boolean;
	activeRuntime: () => ConversationTabRuntime;
	inspectSubagent: () => boolean;
	availableSubagentTargets: () => SubagentTarget[];
	dimensions: () => { width: number; height: number };
	claudeUsage: Accessor<ClaudeUsage | undefined>;
	cswapSnapshot: Accessor<CswapSnapshot | undefined>;
	claudeEffectiveSlot: () => number | undefined;
	claudeHint: Accessor<string | undefined>;
	codexUsage: Accessor<CodexUsage | undefined>;
	codexUsageStats: Accessor<Record<number, UsageStats>>;
	opencodeUsage: Accessor<OpencodeUsage | undefined>;
	opencodeUsageStats: Accessor<Record<number, UsageStats>>;
	clockNow: Accessor<number>;
}

export interface FooterModel {
	setExtensionStatus: (value: string) => void;
	footerStatusText: () => string;
	footerHintText: () => string;
	footerUsageSegments: () => UsageFooterSegment[];
}

export function createFooterModel(ports: FooterModelPorts): FooterModel {
	const displayStatus = () => {
		if (ports.forkingConversation()) return "forking conversation…";
		const current = ports.status();
		if (current !== "forking conversation…") return current;
		return ports.streaming() ? "working" : "ready";
	};
	// Extension and stderr status text is untrusted: adapters style it with
	// ANSI colors and some extensions send multi-line payloads. The footer is
	// a single row, so clean it before display (and before width math).
	const sanitizeStatusText = (value: string): string =>
		clip(cleanInline(value), 80);
	const setExtensionStatus = (value: string): void => {
		const clean = sanitizeStatusText(value);
		if (clean) ports.setStatus(clean);
	};
	const footerStatusText = () =>
		`● ${displayStatus()}${ports.activeRuntime().smartCompactProgress ? ` · ${ports.activeRuntime().smartCompactProgress}` : ""}`;
	const thinkingWidth = () => {
		const text = thinkingFooterText(ports.activeRuntime().sessionState?.thinkingLevel);
		return text ? USAGE_FOOTER_SEPARATOR.length + text.length : 0;
	};
	const currentClaudeLabel = () => {
		const accountLabel = ports.claudeUsage()?.accountLabel;
		if (accountLabel) return accountLabel;
		// Only attribute a cswap alias when the actual tab's launch directory maps
		// to that account. A saved preference applies to NEW tabs, not this one.
		const dir = ports.activeRuntime().client.getClaudeConfigDir();
		const snapshot = ports.cswapSnapshot();
		if (!dir || !snapshot) return undefined;
		const slot = resolveCswapSlot("auto", snapshot, dir, os.homedir());
		return snapshot.accounts.find((account) => account.number === slot)?.label;
	};
	const footerMinHintLength = () =>
		footerHintTiers(
			ports.inspectSubagent(),
			ports.availableSubagentTargets().length,
		)[0]?.length ?? 0;
	const footerHintText = () =>
		selectFooterHint(
			Math.max(0, ports.dimensions().width - footerVersionReservedWidth),
			footerStatusText().length + thinkingWidth(),
			usageFooterWidth(footerUsageSegments()),
			ports.inspectSubagent(),
			ports.availableSubagentTargets().length,
		);
	const footerUsageSegments = () =>
		usageFooterSegments({
			claudeUsage: ports.claudeUsage(),
			claudeAccountLabel: currentClaudeLabel(),
			claudeHint: ports.claudeHint(),
			codexUsage: ports.codexUsage(),
			codexUsageStats: ports.codexUsageStats(),
			opencodeUsage: ports.opencodeUsage(),
			opencodeUsageStats: ports.opencodeUsageStats(),
			now: ports.clockNow(),
			// Reserve room for the running version before allocating usage and hints.
			// Budget against the shortest hints so usage wins over verbosity;
			// the hint picker then upgrades verbosity with whatever is left.
			width: Math.max(
				0,
				ports.dimensions().width -
					footerVersionReservedWidth -
					2 -
					footerStatusText().length -
					thinkingWidth() -
					footerMinHintLength() -
					USAGE_FOOTER_SEPARATOR.length -
					2,
			),
		});

	return {
		setExtensionStatus,
		footerStatusText,
		footerHintText,
		footerUsageSegments,
	};
}
