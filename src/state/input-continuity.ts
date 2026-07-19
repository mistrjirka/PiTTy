export type LocalQueuedMessage = {
  id: string;
  text: string;
};

export type PendingSteerEntry = {
  requestId: string;
  targetKey: string;
  runId: string;
  text: string;
  submittedAt: number;
  baselineSteerCount: number;
};

export type PendingSteerRunSnapshot = {
  runId: string;
  targetKey: string;
  steerCount?: number | undefined;
  active: boolean;
};

export function reconcilePendingSteers(
  entries: readonly PendingSteerEntry[],
  runs: readonly PendingSteerRunSnapshot[],
): PendingSteerEntry[] {
  const byRun = new Map<string, PendingSteerRunSnapshot>();
  const byTarget = new Map(runs.map((run) => [run.targetKey, run]));
  for (const run of runs) {
    const existing = byRun.get(run.runId);
    if (!existing || run.active || (run.steerCount ?? 0) > (existing.steerCount ?? 0)) {
      byRun.set(run.runId, {
        ...run,
        active: existing?.active === true || run.active,
        steerCount: Math.max(existing?.steerCount ?? 0, run.steerCount ?? 0),
      });
    }
  }
  const acknowledgements = new Map<string, number>();
  for (const run of byRun.values()) {
    if (run.steerCount !== undefined) {
      const runEntries = entries.filter((entry) => entry.runId === run.runId);
      const baseline = runEntries.length > 0 ? Math.min(...runEntries.map((entry) => entry.baselineSteerCount)) : run.steerCount;
      acknowledgements.set(run.runId, Math.max(0, run.steerCount - baseline));
    }
  }
  return entries.filter((entry) => {
    const run = byRun.get(entry.runId);
    const target = byTarget.get(entry.targetKey);
    if (!run || !target || !target.active) return false;
    const remaining = acknowledgements.get(entry.runId) ?? 0;
    if (remaining > 0 && run.steerCount !== undefined && run.steerCount > entry.baselineSteerCount) {
      acknowledgements.set(entry.runId, remaining - 1);
      return false;
    }
    return true;
  });
}

export type SessionDrafts = {
  main: string;
  subagents: Map<string, string>;
};

export type DraftState = Map<string, SessionDrafts>;

export type QueueDispatchSnapshot = {
  items: LocalQueuedMessage[];
  prompt: string;
};

export type DispatchGate = {
  inFlight: boolean;
  suppressNextSettled: boolean;
};

export type SettledDispatchDecision = "dispatch" | "suppressed" | "busy" | "empty";

export function markAbort(gate: DispatchGate): DispatchGate {
  return { ...gate, suppressNextSettled: true };
}

export function abortFailed(gate: DispatchGate): DispatchGate {
  return { ...gate, suppressNextSettled: false };
}

export function settledDispatchDecision(gate: DispatchGate, hasItems: boolean, streaming: boolean): SettledDispatchDecision {
  if (gate.inFlight || streaming) return "busy";
  if (gate.suppressNextSettled) return "suppressed";
  return hasItems ? "dispatch" : "empty";
}

export function createSessionDrafts(): SessionDrafts {
  return { main: "", subagents: new Map<string, string>() };
}

export function clearTargetDraft(drafts: SessionDrafts, targetKey: string): void {
  drafts.subagents.delete(targetKey);
}

export function sessionDrafts(state: DraftState, sessionId: string): SessionDrafts {
  const existing = state.get(sessionId);
  if (existing) return existing;
  const created = createSessionDrafts();
  state.set(sessionId, created);
  return created;
}

export function snapshotQueue(items: readonly LocalQueuedMessage[]): QueueDispatchSnapshot {
  const snapshot = [...items];
  return { items: snapshot, prompt: snapshot.map((item) => item.text.trim()).join("\n\n") };
}

export function restoreQueue(snapshot: readonly LocalQueuedMessage[], current: readonly LocalQueuedMessage[]): LocalQueuedMessage[] {
  return [...snapshot, ...current];
}
