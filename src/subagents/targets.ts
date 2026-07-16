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
  toolCallId?: string | undefined;
};

function activeState(value: string | undefined): boolean {
  return value === "pending" || value === "running" || value === "queued" || value === "active" || value === "working";
}

function targetLabel(run: SubagentRun, step?: SubagentStep): string {
  if (step) {
    const child = run.steps.length > 1 ? ` #${step.index + 1}` : "";
    const detail = step.label ?? step.phase;
    return detail ? `${step.agent}${child} · ${detail}` : `${step.agent}${child}`;
  }
  return run.agent ?? run.agents?.join(", ") ?? run.mode;
}

type ForegroundEntry = {
  progress: Record<string, unknown>;
  result?: Record<string, unknown> | undefined;
};

function foregroundEntries(item: ToolItem): readonly ForegroundEntry[] {
  const details = record(item.details);
  const results = details?.results;
  if (Array.isArray(results)) {
    const entries = results.flatMap((value): ForegroundEntry[] => {
      const result = record(value);
      if (!result) return [];
      const nested = result.progress;
      if (Array.isArray(nested)) {
        const progress = nested.flatMap((progressValue): Record<string, unknown>[] => {
          const entry = record(progressValue);
          return entry ? [entry] : [];
        });
        return progress.length > 0 ? progress.map((entry) => ({ progress: entry, result })) : [{ progress: {}, result }];
      }
      return [{ progress: record(nested) ?? {}, result }];
    });
    if (entries.length > 0) return entries;
  }
  const directProgress = details?.progress;
  if (!Array.isArray(directProgress)) return [];
  return directProgress.flatMap((value): ForegroundEntry[] => {
    const progress = record(value);
    return progress ? [{ progress }] : [];
  });
}

function foregroundTargets(item: ToolItem): SubagentTarget[] {
  if (!/subagent|delegate|agent/i.test(item.name)) return [];
  const parsed = foregroundEntries(item);
  const entries = parsed.length > 0 ? parsed : [{ progress: {} }];
  return entries.map(({ progress, result }, index) => {
    const exitCode = typeof result?.exitCode === "number" ? result.exitCode : undefined;
    const state = typeof progress.status === "string"
      ? progress.status
      : item.status === "done" && exitCode !== undefined
        ? exitCode === 0 ? "completed" : "failed"
        : item.status;
    const label = typeof progress.label === "string"
      ? progress.label
      : typeof progress.agent === "string"
        ? progress.agent
        : typeof result?.agent === "string" ? result.agent : "foreground subagent";
    const runId = `${item.toolCallId}:${index}`;
    const tokens = record(progress.tokens);
    const transcriptPath = typeof result?.transcriptPath === "string"
      ? result.transcriptPath
      : typeof progress.transcriptPath === "string" ? progress.transcriptPath : undefined;
    const sessionFile = typeof result?.sessionFile === "string"
      ? result.sessionFile
      : typeof progress.sessionFile === "string" ? progress.sessionFile : undefined;
    const run: SubagentRun = {
      runId,
      control: "foreground",
      mode: "foreground",
      state,
      agent: label,
      steps: [],
      startedAt: item.startedAt ?? item.timestamp,
      lastUpdate: item.endedAt ?? item.timestamp,
      currentTool: typeof progress.currentTool === "string" ? progress.currentTool : undefined,
      activityState: typeof progress.activityState === "string" ? progress.activityState : state,
      currentPath: typeof progress.currentPath === "string" ? progress.currentPath : undefined,
      transcriptPath,
      sessionFile,
      turnCount: typeof progress.turnCount === "number" ? progress.turnCount : undefined,
      toolCount: typeof progress.toolCount === "number" ? progress.toolCount : undefined,
      totalTokens: typeof progress.totalTokens === "number" ? progress.totalTokens : typeof tokens?.total === "number" ? tokens.total : undefined,
    };
    return {
      key: runId,
      run,
      label,
      state,
      active: activeState(state),
      canSteer: false,
      transcriptPath,
      sessionFile,
      startedAt: run.startedAt,
      lastUpdate: run.lastUpdate,
      stepIndex: index,
      toolCallId: item.toolCallId,
    };
  });
}

export function subagentTargets(runs: readonly SubagentRun[], tools: readonly ToolItem[] = []): SubagentTarget[] {
  const result: SubagentTarget[] = [];
  const asyncIds = new Set(runs.flatMap((run) => [run.runId, run.asyncId, run.asyncDir].filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
  for (const item of tools) {
    const details = record(item.details);
    const identifiers = [details?.runId, details?.asyncId, details?.asyncDir]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (!identifiers.some((identifier) => asyncIds.has(identifier))) result.push(...foregroundTargets(item));
  }
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

  const deduped = new Map<string, SubagentTarget>();
  for (const target of result) {
    const sessionIdentity = target.sessionFile?.trim();
    const identity = sessionIdentity ? `${target.stepIndex ?? "run"}:${sessionIdentity}` : undefined;
    if (!identity) {
      deduped.set(`${target.key}:unique`, target);
      continue;
    }
    const existing = deduped.get(identity);
    if (!existing || (target.active && !existing.active) ||
      (target.active === existing.active && (target.lastUpdate ?? target.startedAt ?? 0) > (existing.lastUpdate ?? existing.startedAt ?? 0))) {
      deduped.set(identity, target);
    }
  }
  return [...deduped.values()].sort((a, b) => {
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
  if (item.toolCallId) {
    const direct = targets.filter((target) => target.toolCallId === item.toolCallId);
    if (direct.length > 0) return direct;
  }

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
