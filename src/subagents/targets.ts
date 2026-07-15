import type { SubagentRun, SubagentStep, ToolItem } from "../types.ts";

export type SubagentTarget = {
  key: string;
  run: SubagentRun;
  step?: SubagentStep | undefined;
  stepIndex?: number | undefined;
  label: string;
  state: string;
  active: boolean;
  canSteer: boolean;
  transcriptPath?: string | undefined;
  sessionFile?: string | undefined;
  startedAt?: number | undefined;
  lastUpdate?: number | undefined;
};

function activeState(value: string | undefined): boolean {
  return value === "running" || value === "queued" || value === "active" || value === "working";
}

function targetLabel(run: SubagentRun, step?: SubagentStep): string {
  if (step) {
    const child = run.steps.length > 1 ? ` #${step.index + 1}` : "";
    const detail = step.label ?? step.phase;
    return detail ? `${step.agent}${child} · ${detail}` : `${step.agent}${child}`;
  }
  return run.agent ?? run.agents?.join(", ") ?? run.mode;
}

export function subagentTargets(runs: readonly SubagentRun[]): SubagentTarget[] {
  const result: SubagentTarget[] = [];
  for (const run of runs) {
    if (run.steps.length > 0) {
      for (const step of run.steps) {
        const active = activeState(step.activityState) || activeState(step.status);
        const sessionFile = step.sessionFile ?? run.sessionFile;
        result.push({
          key: `${run.runId}:${step.index}`,
          run,
          step,
          stepIndex: step.index,
          label: targetLabel(run, step),
          state: step.status,
          active,
          // pi-subagents accepts file-backed steering for running and queued
          // indexed children. It does not require the child session file to
          // exist yet, so queued parallel children remain steerable.
          canSteer: active && Boolean(run.asyncDir),
          transcriptPath: step.transcriptPath ?? run.transcriptPath,
          sessionFile,
          startedAt: step.startedAt ?? run.startedAt,
          lastUpdate: step.lastActivityAt ?? run.lastUpdate ?? step.endedAt ?? run.endedAt,
        });
      }
      continue;
    }

    const active = activeState(run.activityState) || activeState(run.state);
    result.push({
      key: run.runId,
      run,
      label: targetLabel(run),
      state: run.state,
      active,
      canSteer: active && Boolean(run.asyncDir),
      transcriptPath: run.transcriptPath,
      sessionFile: run.sessionFile,
      startedAt: run.startedAt,
      lastUpdate: run.lastUpdate ?? run.endedAt,
    });
  }

  return result.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (b.lastUpdate ?? b.startedAt ?? 0) - (a.lastUpdate ?? a.startedAt ?? 0);
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function subagentRunIdFromTool(item: ToolItem): string | undefined {
  if (!/subagent|delegate|agent/i.test(item.name)) return undefined;
  const details = record(item.details);
  for (const key of ["runId", "asyncId", "id"] as const) {
    const value = details?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function targetsForTool(item: ToolItem, targets: readonly SubagentTarget[]): SubagentTarget[] {
  const runId = subagentRunIdFromTool(item);
  if (runId) return targets.filter((target) => target.run.runId === runId);

  // Older pi-subagents results sometimes omitted runId. Match a nearby run only
  // when there is a single unambiguous candidate; otherwise show no child rows
  // rather than attaching the wrong agents to a tool call.
  if (!/subagent|delegate|agent/i.test(item.name)) return [];
  const candidates = new Map<string, SubagentTarget[]>();
  for (const target of targets) {
    const startedAt = target.run.startedAt ?? target.startedAt;
    if (startedAt === undefined || Math.abs(startedAt - item.timestamp) > 120_000) continue;
    const group = candidates.get(target.run.runId) ?? [];
    group.push(target);
    candidates.set(target.run.runId, group);
  }
  return candidates.size === 1 ? [...candidates.values()][0] ?? [] : [];
}
