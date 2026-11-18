import { describe, expect, test } from "bun:test";
import { CompactionController } from "../src/tabs/compaction-controller.ts";
import {
  ONE_ROUND_PROGRESS_KEY, COMPACTION_STATUS_KEY,
} from "../src/state/compaction-telemetry.ts";
import type { ConversationTabRuntime } from "../src/tabs/runtime.ts";
import type { DiagnosticLogger } from "../src/diagnostics/logger.ts";
import type { PiEvent, RpcExtensionUIRequest } from "../src/types.ts";

function fixture() {
  const messages: string[] = [];
  const warnings: string[] = [];
  const rt = {
    id: "tab-1", compactionAttempt: 0,
    conversation: { items: [], isCompacting: false },
    onConversationChange: () => { messages.push("conversation"); },
    sessionStats: { contextUsage: { tokens: 90_000, contextWindow: 200_000, percent: 45 } },
  } as unknown as ConversationTabRuntime;
  const logger = { warn: (reason: string) => { warnings.push(reason); } } as unknown as DiagnosticLogger;
  const controller = new CompactionController((runtime) => runtime.onConversationChange(), logger);
  return { controller, rt, messages, warnings };
}
function status(key: string, value?: string): RpcExtensionUIRequest {
  return { type: "extension_ui_request", id: "fixture", method: "setStatus", statusKey: key, statusText: value } as RpcExtensionUIRequest;
}

describe("extracted compaction lifecycle controller", () => {
  test("tracks progress and clears it on an abort without affecting unrelated statuses", () => {
    const { controller, rt, messages } = fixture();
    controller.handleStart({ type: "compaction_start", reason: "manual" } as PiEvent, rt);
    expect(rt.compactionTelemetry?.tokensBefore).toBe(90_000);
    expect(rt.compactionAttempt).toBe(1);

    const stream = {
      v: 2, runId: "run-1", seq: 1, phase: "streaming", reason: "manual",
      elapsedMs: 100, retainedTurns: 1, estimatedRetainedTokens: 2000,
      keepRecentTokens: 12000, targetPostCompactTokens: 20000, effectiveRecentTokenBudget: 10000,
      boundaryMode: "whole-turn", lanes: {
        audit: { role: "audit", state: "streaming", chars: 5, delta: "hello" },
        execution: { role: "execution", state: "queued", chars: 0 },
      },
    };
    expect(controller.handleStatus(status(ONE_ROUND_PROGRESS_KEY, JSON.stringify(stream)), rt)).toBe(true);
    expect(rt.oneRoundLaneTexts?.audit).toBe("hello");
    expect(controller.handleStatus(status("mcp-other", "ignored"), rt)).toBe(false);
    controller.handleEnd({ type: "compaction_end", aborted: true } as PiEvent, rt);
    expect(rt.oneRoundProgress).toBeUndefined();
    expect(rt.oneRoundLaneTexts).toBeUndefined();
    expect(rt.compactionTelemetry).toBeUndefined();
    expect(messages.length).toBeGreaterThan(1);
  });

  test("warns once per tab for invalid own telemetry, without leaking to other statuses", () => {
    const { controller, rt, warnings } = fixture();
    controller.handleStatus(status(COMPACTION_STATUS_KEY, "invalid"), rt);
    controller.handleStatus(status(COMPACTION_STATUS_KEY, "invalid"), rt);
    expect(warnings).toEqual(["compaction.telemetry_invalid"]);
  });
});
