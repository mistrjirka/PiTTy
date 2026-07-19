import { describe, expect, test } from "bun:test";
import { abortFailed, clearTargetDraft, markAbort, reconcilePendingSteers, restoreQueue, sessionDrafts, settledDispatchDecision, snapshotQueue, type DraftState, type PendingSteerEntry } from "../src/state/input-continuity.ts";
import type { LocalQueuedMessage } from "../src/ui/pending-input-panel.tsx";

describe("input continuity state", () => {
  test("keeps main and target drafts partitioned by session and target", () => {
    const state: DraftState = new Map();
    const first = sessionDrafts(state, "first");
    first.main = "unfinished";
    first.subagents.set("target-a", "steer a");
    expect(sessionDrafts(state, "first").main).toBe("unfinished");
    expect(sessionDrafts(state, "first").subagents.get("target-a")).toBe("steer a");
    clearTargetDraft(first, "target-a");
    expect(first.subagents.has("target-a")).toBe(false);
    first.subagents.set("target-a", "retained after failure");
    expect(first.subagents.get("target-a")).toBe("retained after failure");
    expect(sessionDrafts(state, "second").main).toBe("");
    expect(sessionDrafts(state, "second").subagents.has("target-a")).toBe(false);
  });

  test("settled dispatch suppresses abort boundaries and duplicate in-flight events", () => {
    const gate = markAbort({ inFlight: false, suppressNextSettled: false });
    expect(settledDispatchDecision(gate, true, false)).toBe("suppressed");
    expect(settledDispatchDecision({ inFlight: true, suppressNextSettled: false }, true, false)).toBe("busy");
    expect(settledDispatchDecision({ inFlight: false, suppressNextSettled: false }, true, false)).toBe("dispatch");
    expect(abortFailed(gate).suppressNextSettled).toBe(false);
  });

  test("acknowledges oldest pending entries from run-level steer counts", () => {
    const entries: PendingSteerEntry[] = [
      { requestId: "one", targetKey: "run:0", runId: "run", text: "first", submittedAt: 1, baselineSteerCount: 2 },
      { requestId: "two", targetKey: "run:1", runId: "run", text: "second", submittedAt: 2, baselineSteerCount: 2 },
    ];
    const retained = reconcilePendingSteers(entries, [{ runId: "run", targetKey: "run:0", steerCount: 3, active: true }, { runId: "run", targetKey: "run:1", steerCount: 3, active: true }]);
    expect(retained.map((entry) => entry.requestId)).toEqual(["two"]);
  });

  test("drops pending entries when their target is terminal or gone", () => {
    const entry: PendingSteerEntry = { requestId: "one", targetKey: "run:0", runId: "run", text: "first", submittedAt: 1, baselineSteerCount: 0 };
    expect(reconcilePendingSteers([entry], [{ runId: "run", targetKey: "run:0", steerCount: 0, active: false }])).toEqual([]);
    expect(reconcilePendingSteers([entry], [])).toEqual([]);
  });

  test("snapshots a FIFO batch and restores it ahead of arrivals", () => {
    const queued: LocalQueuedMessage[] = [
      { id: "one", text: " first " },
      { id: "two", text: "second" },
    ];
    const snapshot = snapshotQueue(queued);
    expect(snapshot.prompt).toBe("first\n\nsecond");
    expect(restoreQueue(snapshot.items, [{ id: "three", text: "later" }])).toEqual([...queued, { id: "three", text: "later" }]);
  });
});
