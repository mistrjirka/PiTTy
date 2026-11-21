/** Claude account selection and usage projection for the active Pi process. */
import os from "node:os";
import { type Accessor, type Setter } from "solid-js";
import type { ClaudeUsage } from "../integrations/doppelclaude-usage.ts";
import {
	resolveCswapSlot,
	type CswapSnapshot,
	type ClaudeAccountChoice,
} from "../integrations/claude-swap.ts";
import {
	resolveClaudeLaunchConfig,
	saveClaudeAccountPreference,
} from "../config/claude-account.ts";
import type { SettingsRoute } from "../ui/app-navigation.ts";
import type { Toast } from "../types.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

export interface ClaudeAccountPorts {
	activeTabId: Accessor<string>;
	activeRuntime: () => ConversationTabRuntime;
	cswapSnapshot: Accessor<CswapSnapshot | undefined>;
	claudeAccountChoice: Accessor<ClaudeAccountChoice>;
	setClaudeAccountChoice: Setter<ClaudeAccountChoice>;
	setClaudeUsage: Setter<ClaudeUsage | undefined>;
	setClaudeHint: Setter<string | undefined>;
	setSettingsRoute: Setter<SettingsRoute>;
	toast: (text: string, tone: Toast["tone"], durationMs?: number) => void;
}

export interface ClaudeAccountActions {
	claudeEffectiveSlot: () => number | undefined;
	applyCswapUsage: (snapshot: CswapSnapshot) => void;
	chooseClaudeAccount: (choice: ClaudeAccountChoice) => void;
}

export function createClaudeAccountActions(
	ports: ClaudeAccountPorts,
): ClaudeAccountActions {
	const claudeEffectiveSlot = () => {
		const snapshot = ports.cswapSnapshot();
		return snapshot
			? resolveCswapSlot(
					ports.claudeAccountChoice(),
					snapshot,
					ports.activeRuntime().client.getClaudeConfigDir(),
					os.homedir(),
				)
			: undefined;
	};
	const applyCswapUsage = (snapshot: CswapSnapshot): void => {
		const slot = claudeEffectiveSlot();
		const account = snapshot.accounts.find((item) => item.number === slot);
		if (account?.usage) {
			ports.setClaudeUsage(account.usage);
			ports.setClaudeHint(undefined);
		} else if (account?.lastGood) {
			// cswap keeps the last fetched usage when the account needs a
			// relogin; show it marked stale instead of claiming expiry. The
			// model itself can still work through Pi's own credentials.
			ports.setClaudeUsage({
				...account.lastGood.usage,
				staleAgeSeconds: account.lastGood.ageSeconds,
			});
			ports.setClaudeHint(undefined);
		} else {
			ports.setClaudeUsage(undefined);
			ports.setClaudeHint(account ? "usage unavailable" : undefined);
		}
	};
	const chooseClaudeAccount = (choice: ClaudeAccountChoice) => {
		try {
			const resolved = resolveClaudeLaunchConfig(choice);
			if (resolved.error) {
				ports.toast(resolved.error, "warning", 8000);
				return;
			}
			saveClaudeAccountPreference(choice);
			ports.setClaudeAccountChoice(choice);
			ports.setSettingsRoute("root");
			ports.toast(
				"Claude account selected for new tabs. Existing tabs keep their account.",
				"info",
				7000,
			);
		} catch (error) {
			ports.toast(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	};

	return { claudeEffectiveSlot, applyCswapUsage, chooseClaudeAccount };
}
