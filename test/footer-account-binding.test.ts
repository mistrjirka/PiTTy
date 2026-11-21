import { expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { ClaudeUsage } from "../src/integrations/doppelclaude-usage.ts";
import type { CswapSnapshot } from "../src/integrations/claude-swap.ts";
import type { ConversationTabRuntime } from "../src/tabs/runtime.ts";
import { createFooterModel } from "../src/tabs/footer-model.ts";

const now = 1_795_260_000_000;
const snapshot: CswapSnapshot = { activeAccountNumber: 1, accounts: [
  { number: 1, label: "work", usageStatus: "ok" },
  { number: 2, label: "home", usageStatus: "ok" },
] };
const usage: ClaudeUsage = { source: "claude-sdk", status: "ok", observedAt: now,
  limits: [{ kind: "session", label: "5 hours", percent: 15, resetAt: now + 60_000, active: true }],
};
function footer(configDir?: string, providerLabel?: string): string {
  const runtime = { sessionState: { thinkingLevel: "high" }, client: {
    getClaudeConfigDir: () => configDir,
  } } as unknown as ConversationTabRuntime;
  return createFooterModel({
    forkingConversation: () => false, status: () => "ready", setStatus: () => {},
    streaming: () => false, activeRuntime: () => runtime, inspectSubagent: () => false,
    availableSubagentTargets: () => [], dimensions: () => ({ width: 180, height: 30 }),
    claudeUsage: () => ({ ...usage, ...(providerLabel ? { accountLabel: providerLabel } : {}) }),
    cswapSnapshot: () => snapshot, claudeEffectiveSlot: () => 2, claudeHint: () => undefined,
    codexUsage: () => undefined, codexUsageStats: () => ({}),
    opencodeUsage: () => undefined, opencodeUsageStats: () => ({}), clockNow: () => now,
  }).footerUsageSegments().map((part) => part.text).join(" ");
}

test("a saved home selection does not relabel an unknown current-tab account", () => {
  expect(footer()).toContain("claude 5h 15%");
  expect(footer()).not.toContain("(home)");
  expect(footer()).not.toContain("(work)");
});
test("the actual global Work tab remains Work even when Home is selected for new tabs", () => {
  expect(footer(path.join(os.homedir(), ".claude"))).toContain("claude(work)");
});
test("the live provider account label takes precedence over cswap", () => {
  expect(footer(path.join(os.homedir(), ".claude"), "home")).toContain("claude(home)");
});
