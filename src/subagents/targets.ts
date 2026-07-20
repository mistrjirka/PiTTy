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
  model?: string | undefined;
  thinking?: string | undefined;
  contextWindow?: number | undefined;
  toolCallId?: string | undefined;
};

function activeState(value: string | undefined): boolean {
  return value === "pending" || value === "running" || value === "queued" || value === "active" || value === "working";
}

function targetLabel(run: SubagentRun, step?: SubagentStep, requested?: RequestedMetadata): string {
  if (step) {
    const child = run.steps.length > 1 ? ` #${step.index + 1}` : "";
    const agent = step.agent || requested?.agent || run.agent || run.mode;
    const detail = step.label ?? step.phase ?? requested?.label;
    return detail ? `${agent}${child} · ${detail}` : `${agent}${child}`;
  }
  return run.agent ?? run.agents?.join(", ") ?? requested?.label ?? requested?.agent ?? run.mode;
}

type ForegroundEntry = {
  progress: Record<string, unknown>;
  result?: Record<string, unknown> | undefined;
};

type RequestedMetadata = {
  label?: string;
  agent?: string;
  model?: string;
  thinking?: string;
  contextWindow?: number;
};

function requestedChildren(args: unknown): RequestedMetadata[] {
  const root = record(args);
  if (!root) return [];
  const children: Record<string, unknown>[] = [];
  const tasks = Array.isArray(root.tasks) ? root.tasks : undefined;
  if (tasks) {
    for (const value of tasks) {
      const task = record(value);
      if (!task) continue;
      const count = typeof task.count === "number" && Number.isInteger(task.count) && task.count > 0 && task.count <= 100 ? task.count : 1;
      for (let index = 0; index < count; index++) children.push(task);
    }
  } else if (Array.isArray(root.chain)) {
    for (const value of root.chain) {
      const step = record(value);
      if (!step) continue;
      if (Array.isArray(step.parallel)) {
        for (const child of step.parallel) {
          const task = record(child);
          if (task) children.push(task);
        }
      } else {
        children.push(step);
      }
    }
  } else if (Array.isArray(root.parallel)) {
    for (const value of root.parallel) {
      const task = record(value);
      if (task) children.push(task);
    }
  } else {
    children.push(root);
  }
  return children.map((child) => ({
    ...(typeof child.label === "string" && child.label.trim() ? { label: child.label.trim() } : {}),
    ...(typeof child.agent === "string" && child.agent.trim() ? { agent: child.agent.trim() } : {}),
    ...(typeof child.model === "string" && child.model.trim() ? { model: child.model.trim() } : {}),
    ...(typeof child.thinking === "string" && child.thinking.trim() ? { thinking: child.thinking.trim() } : {}),
    ...(typeof child.contextWindow === "number" && Number.isFinite(child.contextWindow) ? { contextWindow: child.contextWindow } : {}),
  }));
}

function meaningfulResult(result: Record<string, unknown>): boolean {
  const stringFields = ["agent", "label", "status", "transcriptPath", "sessionFile", "model", "thinking"];
  for (const field of stringFields) {
    const value = result[field];
    if (typeof value === "string" && value.trim().length > 0) return true;
  }
  return ["exitCode", "contextWindow", "turnCount", "toolCount"].some((field) => typeof result[field] === "number" && Number.isFinite(result[field]));
}

function foregroundEntries(item: ToolItem): readonly ForegroundEntry[] {
  const details = record(item.details);
  const results = details?.results;
  if (Array.isArray(results)) {
    const entries = results.flatMap((value): ForegroundEntry[] => {
      const result = record(value);
      if (!result) return [];
      const nested = result.progress;
      const nestedRecord = record(nested);
      const hasProgress = Array.isArray(nested)
        ? nested.some((value) => {
          const progress = record(value);
          return progress !== undefined && Object.keys(progress).length > 0;
        })
        : nestedRecord !== undefined && Object.keys(nestedRecord).length > 0;
      if (!meaningfulResult(result) && !hasProgress) return [];
      if (Array.isArray(nested)) {
        const progress = nested.flatMap((progressValue): Record<string, unknown>[] => {
          const entry = record(progressValue);
          return entry ? [entry] : [];
        });
        return progress.length > 0 ? progress.map((entry) => ({ progress: entry, result })) : meaningfulResult(result) ? [{ progress: {}, result }] : [];
      }
      const progressRecord = record(nested);
      return progressRecord && Object.keys(progressRecord).length > 0 ? [{ progress: progressRecord, result }] : [{ progress: {}, result }];
    });
    if (entries.length > 0) return entries;
  }
  const directProgress = details?.progress;
  if (!Array.isArray(directProgress)) return [];
  return directProgress.flatMap((value): ForegroundEntry[] => {
    const progress = record(value);
    return progress && Object.keys(progress).length > 0 ? [{ progress }] : [];
  });
}

function foregroundTargets(item: ToolItem): SubagentTarget[] {
  if (!/subagent|delegate|agent/i.test(item.name)) return [];
  const entries = foregroundEntries(item);
  const requested = requestedChildren(item.args);
  if (entries.length === 0) return [];
  return entries.map(({ progress, result }, index) => {
    const requestedMetadata = requested.length === entries.length ? requested[index] : requested.length === 1 ? requested[0] : undefined;
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
        : typeof result?.label === "string" ? result.label
          : typeof result?.agent === "string" ? result.agent
            : requestedMetadata?.label ?? requestedMetadata?.agent ?? "foreground subagent";
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
      lastUpdate: typeof progress.lastActivityAt === "number" ? progress.lastActivityAt : item.endedAt ?? item.timestamp,
      lastActivityAt: typeof progress.lastActivityAt === "number" ? progress.lastActivityAt : undefined,
      currentTool: typeof progress.currentTool === "string" ? progress.currentTool : undefined,
      activityState: typeof progress.activityState === "string" ? progress.activityState : state,
      currentPath: typeof progress.currentPath === "string" ? progress.currentPath : undefined,
      transcriptPath,
      sessionFile,
      turnCount: typeof progress.turnCount === "number" ? progress.turnCount : undefined,
      toolCount: typeof progress.toolCount === "number" ? progress.toolCount : undefined,
      totalTokens: typeof progress.totalTokens === "number" ? progress.totalTokens : typeof tokens?.total === "number" ? tokens.total : undefined,
      ...(typeof result?.model === "string" ? { model: result.model } : typeof progress.model === "string" ? { model: progress.model } : requestedMetadata?.model ? { model: requestedMetadata.model } : {}),
      ...(typeof result?.thinking === "string" ? { thinking: result.thinking } : typeof progress.thinking === "string" ? { thinking: progress.thinking } : requestedMetadata?.thinking ? { thinking: requestedMetadata.thinking } : {}),
      ...(typeof result?.contextWindow === "number" ? { contextWindow: result.contextWindow } : typeof progress.contextWindow === "number" ? { contextWindow: progress.contextWindow } : requestedMetadata?.contextWindow !== undefined ? { contextWindow: requestedMetadata.contextWindow } : {}),
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
      model: run.model,
      thinking: run.thinking,
      contextWindow: run.contextWindow,
    };
  });
}

export function subagentTargets(runs: readonly SubagentRun[], tools: readonly ToolItem[] = []): SubagentTarget[] {
  const result: SubagentTarget[] = [];
  const requestedByArtifactId = new Map<string, RequestedMetadata[]>();
  const asyncIds = new Set(runs.flatMap((run) => [run.runId, run.asyncId, run.asyncDir].filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
  for (const item of tools) {
    const details = record(item.details);
    const identifiers = [details?.runId, details?.asyncId, details?.asyncDir]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const requested = requestedChildren(item.args);
    for (const identifier of identifiers) {
      if (requested.length > 0) requestedByArtifactId.set(identifier, requested);
    }
  }
  for (const item of tools) {
    const details = record(item.details);
    const identifiers = [details?.runId, details?.asyncId, details?.asyncDir]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (!identifiers.some((identifier) => asyncIds.has(identifier))) result.push(...foregroundTargets(item));
  }
  for (const run of runs) {
    const requested = [run.runId, run.asyncId, run.asyncDir]
      .map((identifier) => identifier ? requestedByArtifactId.get(identifier) : undefined)
      .find((metadata): metadata is RequestedMetadata[] => metadata !== undefined);
    if (run.steps.length > 0) {
      for (const step of run.steps) {
        const requestedMetadata = requested && (requested.length === run.steps.length ? requested[step.index] : requested.length === 1 ? requested[0] : undefined);
        const active = activeState(step.activityState) || activeState(step.status);
        const sessionFile = step.sessionFile ?? run.sessionFile;
        result.push({
          key: `${run.runId}:${step.index}`,
          run,
          step,
          stepIndex: step.index,
          label: targetLabel(run, step, requestedMetadata),
          state: step.status,
          active,
          // pi-subagents accepts file-backed steering for running and queued
          // indexed children. It does not require the child session file to
          // exist yet, so queued parallel children remain steerable.
          canSteer: active && Boolean(run.asyncDir),
          transcriptPath: step.transcriptPath ?? run.transcriptPath,
          sessionFile,
          startedAt: step.startedAt ?? run.startedAt,
          lastUpdate: step.lastActivityAt ?? run.lastActivityAt ?? run.lastUpdate ?? step.endedAt ?? run.endedAt,
          model: step.model ?? run.model ?? requestedMetadata?.model,
          thinking: step.thinking ?? run.thinking ?? requestedMetadata?.thinking,
          contextWindow: step.contextWindow ?? run.contextWindow ?? requestedMetadata?.contextWindow,
        });
      }
      continue;
    }

    const active = activeState(run.activityState) || activeState(run.state);
    result.push({
      key: run.runId,
      run,
      label: targetLabel(run, undefined, requested?.length === 1 ? requested[0] : undefined),
      state: run.state,
      active,
      canSteer: active && Boolean(run.asyncDir),
      transcriptPath: run.transcriptPath,
      sessionFile: run.sessionFile,
      startedAt: run.startedAt,
      lastUpdate: run.lastActivityAt ?? run.lastUpdate ?? run.endedAt,
      model: run.model ?? (requested?.length === 1 ? requested[0]?.model : undefined),
      thinking: run.thinking ?? (requested?.length === 1 ? requested[0]?.thinking : undefined),
      contextWindow: run.contextWindow ?? (requested?.length === 1 ? requested[0]?.contextWindow : undefined),
    });
  }

  const deduped = new Map<string, SubagentTarget>();
  for (const target of result) {
    const identity = subagentTargetIdentity(target);
    const existing = deduped.get(identity);
    if (!existing || (target.active && !existing.active) ||
      (target.active === existing.active && (target.lastUpdate ?? target.startedAt ?? 0) > (existing.lastUpdate ?? existing.startedAt ?? 0))) {
      deduped.set(identity, target);
    }
  }
  return [...deduped.values()].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const runStart = (a.run.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.run.startedAt ?? Number.MAX_SAFE_INTEGER);
    if (runStart) return runStart;
    const runIdentity = a.run.runId.localeCompare(b.run.runId);
    if (runIdentity) return runIdentity;
    const stepIndex = (a.stepIndex ?? -1) - (b.stepIndex ?? -1);
    return stepIndex || a.key.localeCompare(b.key);
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

export function reconcileSubagentSelection(
  previousKey: string | undefined,
  previousTargets: readonly SubagentTarget[],
  nextTargets: readonly SubagentTarget[],
): string | undefined {
  if (previousKey && nextTargets.some((target) => target.key === previousKey)) return previousKey;
  const previous = previousTargets.find((target) => target.key === previousKey);
  if (previous?.run.control === "foreground" && previous.sessionFile && previous.stepIndex !== undefined) {
    const matches = nextTargets.filter((target) =>
      target.active && target.canSteer && target.sessionFile === previous.sessionFile && target.stepIndex === previous.stepIndex,
    );
    if (matches.length === 1) return matches[0]?.key;
  }
  return nextTargets[0]?.key;
}

export function subagentTargetIdentity(target: SubagentTarget): string {
  const sessionFile = target.sessionFile?.trim();
  return sessionFile
    ? `session:${target.stepIndex ?? "run"}:${sessionFile}`
    : `key:${target.key}`;
}

export type OwnedSubagentTargets = ReadonlyMap<string, SubagentTarget[]>;

export function ownedSubagentTargetsForItems(
  items: readonly ToolItem[],
  targets: readonly SubagentTarget[],
): OwnedSubagentTargets {
  const owners = new Map<string, string>();
  const assigned = new Map<string, SubagentTarget[]>();
  for (const item of items) {
    for (const target of targetsForTool(item, targets)) {
      const identity = subagentTargetIdentity(target);
      const ownerId = owners.get(identity);
      if (ownerId && ownerId !== item.id) {
        const ownedTargets = assigned.get(ownerId);
        const targetIndex = ownedTargets?.findIndex(
          (candidate) => subagentTargetIdentity(candidate) === identity,
        ) ?? -1;
        if (ownedTargets && targetIndex >= 0) ownedTargets[targetIndex] = target;
        continue;
      }
      if (!ownerId) owners.set(identity, item.id);
      const owner = owners.get(identity) ?? item.id;
      const ownedTargets = assigned.get(owner) ?? [];
      if (!ownedTargets.some((candidate) => subagentTargetIdentity(candidate) === identity)) {
        ownedTargets.push(target);
      }
      assigned.set(owner, ownedTargets);
    }
  }
  return assigned;
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
