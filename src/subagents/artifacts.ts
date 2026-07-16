import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SubagentRun, SubagentStep } from "../types.ts";

function sanitize(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "shared";
}

export function subagentTempRoot(): string {
  const getuid = process.getuid?.bind(process);
  if (getuid) return path.join(os.tmpdir(), `pi-subagents-uid-${getuid()}`);

  for (const key of ["USERNAME", "USER", "LOGNAME"] as const) {
    const value = process.env[key];
    if (value) return path.join(os.tmpdir(), `pi-subagents-user-${sanitize(value)}`);
  }

  try {
    const username = os.userInfo().username;
    if (username) return path.join(os.tmpdir(), `pi-subagents-user-${sanitize(username)}`);
  } catch {}

  const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
  if (home) return path.join(os.tmpdir(), `pi-subagents-home-${sanitize(home)}`);
  return path.join(os.tmpdir(), "pi-subagents-shared");
}

export function asyncRunsRoot(): string {
  return path.join(subagentTempRoot(), "async-subagent-runs");
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readSubagentRun(asyncDir: string): SubagentRun | undefined {
  const statusPath = path.join(asyncDir, "status.json");
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const runId = string(record.runId) ?? string(record.id) ?? path.basename(asyncDir);
  const stepsRaw = Array.isArray(record.steps) ? record.steps : [];
  const steps: SubagentStep[] = stepsRaw.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const step = entry as Record<string, unknown>;
    const agent = string(step.agent) ?? `step-${index + 1}`;
    const tokenRecord = step.tokens && typeof step.tokens === "object" && !Array.isArray(step.tokens)
      ? step.tokens as Record<string, unknown>
      : undefined;
    const tokens = tokenRecord
      ? {
          ...(number(tokenRecord.total) !== undefined ? { total: number(tokenRecord.total) } : {}),
          ...(number(tokenRecord.input) !== undefined ? { input: number(tokenRecord.input) } : {}),
          ...(number(tokenRecord.output) !== undefined ? { output: number(tokenRecord.output) } : {}),
        }
      : typeof step.tokens === "number" ? { total: number(step.tokens) } : undefined;
    return [{
      index: number(step.index) ?? index,
      agent,
      status: string(step.status) ?? "unknown",
      ...(string(step.phase) ? { phase: string(step.phase) } : {}),
      ...(string(step.label) ? { label: string(step.label) } : {}),
      ...(string(step.model) ? { model: string(step.model) } : {}),
      ...(string(step.thinking) ? { thinking: string(step.thinking) } : {}),
      ...(number(step.contextWindow) !== undefined ? { contextWindow: number(step.contextWindow) } : {}),
      ...(string(step.activityState) ? { activityState: string(step.activityState) } : {}),
      ...(number(step.lastActivityAt) !== undefined ? { lastActivityAt: number(step.lastActivityAt) } : {}),
      ...(string(step.currentTool) ? { currentTool: string(step.currentTool) } : {}),
      ...(number(step.currentToolStartedAt) !== undefined ? { currentToolStartedAt: number(step.currentToolStartedAt) } : {}),
      ...(string(step.currentPath) ? { currentPath: string(step.currentPath) } : {}),
      ...(string(step.currentToolArgs) ? { currentToolArgs: string(step.currentToolArgs) } : {}),
      ...(Array.isArray(step.recentOutput) ? { recentOutput: step.recentOutput.filter((value): value is string => typeof value === "string") } : {}),
      ...(string(step.transcriptPath) ? { transcriptPath: string(step.transcriptPath) } : {}),
      ...(string(step.transcriptError) ? { transcriptError: string(step.transcriptError) } : {}),
      ...(number(step.startedAt) !== undefined ? { startedAt: number(step.startedAt) } : {}),
      ...(number(step.endedAt) !== undefined ? { endedAt: number(step.endedAt) } : {}),
      ...(number(step.timeoutMs) !== undefined ? { timeoutMs: number(step.timeoutMs) } : {}),
      ...(number(step.deadlineAt) !== undefined ? { deadlineAt: number(step.deadlineAt) } : {}),
      ...(number(step.turnCount) !== undefined ? { turnCount: number(step.turnCount) } : {}),
      ...(number(step.toolCount) !== undefined ? { toolCount: number(step.toolCount) } : {}),
      ...(number(step.durationMs) !== undefined ? { durationMs: number(step.durationMs) } : {}),
      ...(tokens && Object.keys(tokens).length > 0 ? { tokens } : {}),
      ...(string(step.sessionFile) ? { sessionFile: string(step.sessionFile) } : {}),
      ...(string(step.error) ? { error: string(step.error) } : {}),
    }];
  });

  const totalTokensRecord = record.totalTokens && typeof record.totalTokens === "object" && !Array.isArray(record.totalTokens)
    ? record.totalTokens as Record<string, unknown>
    : undefined;
  const totalCostRecord = record.totalCost && typeof record.totalCost === "object" && !Array.isArray(record.totalCost)
    ? record.totalCost as Record<string, unknown>
    : undefined;

  return {
    runId,
    asyncDir,
    mode: string(record.mode) ?? "single",
    state: string(record.state) ?? "unknown",
    steps,
    ...(string(record.sessionId) ? { sessionId: string(record.sessionId) } : {}),
    ...(string(record.sessionFile) ? { sessionFile: string(record.sessionFile) } : {}),
    ...(number(record.startedAt) !== undefined ? { startedAt: number(record.startedAt) } : {}),
    ...(number(record.lastUpdate) !== undefined ? { lastUpdate: number(record.lastUpdate) } : {}),
    ...(number(record.endedAt) !== undefined ? { endedAt: number(record.endedAt) } : {}),
    ...(number(record.pid) !== undefined ? { pid: number(record.pid) } : {}),
    ...(string(record.cwd) ? { cwd: string(record.cwd) } : {}),
    ...(string(record.agent) ? { agent: string(record.agent) } : {}),
    ...(string(record.model) ? { model: string(record.model) } : {}),
    ...(string(record.thinking) ? { thinking: string(record.thinking) } : {}),
    ...(number(record.contextWindow) !== undefined ? { contextWindow: number(record.contextWindow) } : {}),
    ...(Array.isArray(record.agents) ? { agents: record.agents.filter((value): value is string => typeof value === "string") } : {}),
    ...(string(record.activityState) ? { activityState: string(record.activityState) } : {}),
    ...(number(record.lastActivityAt) !== undefined ? { lastActivityAt: number(record.lastActivityAt) } : {}),
    ...(string(record.currentTool) ? { currentTool: string(record.currentTool) } : {}),
    ...(number(record.currentToolStartedAt) !== undefined ? { currentToolStartedAt: number(record.currentToolStartedAt) } : {}),
    ...(string(record.currentPath) ? { currentPath: string(record.currentPath) } : {}),
    ...(string(record.transcriptPath) ? { transcriptPath: string(record.transcriptPath) } : {}),
    ...(string(record.transcriptError) ? { transcriptError: string(record.transcriptError) } : {}),
    ...(number(record.currentStep) !== undefined ? { currentStep: number(record.currentStep) } : {}),
    ...(number(record.chainStepCount) !== undefined ? { chainStepCount: number(record.chainStepCount) } : {}),
    ...(number(record.pendingAppends) !== undefined ? { pendingAppends: number(record.pendingAppends) } : {}),
    ...(number(record.turnCount) !== undefined ? { turnCount: number(record.turnCount) } : {}),
    ...(number(record.toolCount) !== undefined ? { toolCount: number(record.toolCount) } : {}),
    ...(number(record.steerCount) !== undefined ? { steerCount: number(record.steerCount) } : {}),
    ...(number(record.totalTokens) !== undefined ? { totalTokens: number(record.totalTokens) } : totalTokensRecord && number(totalTokensRecord.total) !== undefined ? { totalTokens: number(totalTokensRecord.total) } : {}),
    ...(number(record.totalCost) !== undefined ? { totalCost: number(record.totalCost) } : totalCostRecord && number(totalCostRecord.costUsd) !== undefined ? { totalCost: number(totalCostRecord.costUsd) } : {}),
    ...(number(record.timeoutMs) !== undefined ? { timeoutMs: number(record.timeoutMs) } : {}),
    ...(number(record.deadlineAt) !== undefined ? { deadlineAt: number(record.deadlineAt) } : {}),
    ...(typeof record.timedOut === "boolean" ? { timedOut: record.timedOut } : {}),
    ...(string(record.error) ? { error: string(record.error) } : {}),
  };
}

export type SubagentSessionIdentity = {
  sessionId?: string | undefined;
  sessionFile?: string | undefined;
};

function identityVariants(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const variants = new Set<string>([trimmed]);
  if (path.isAbsolute(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
    const resolved = path.resolve(trimmed);
    variants.add(resolved);
    try {
      variants.add(fs.realpathSync.native(resolved));
    } catch {}
  }
  return [...variants];
}

export function matchesSubagentSession(run: SubagentRun, identity?: string | SubagentSessionIdentity): boolean {
  if (!identity) return true;
  const current = typeof identity === "string" ? { sessionId: identity } : identity;
  const expected = new Set([
    ...identityVariants(current.sessionId),
    ...identityVariants(current.sessionFile),
  ]);
  if (expected.size === 0) return true;

  const actual = [
    ...identityVariants(run.sessionId),
    ...identityVariants(run.sessionFile),
  ];
  // Older artifacts may not carry either field; keep them visible rather than
  // hiding a potentially live detached run.
  if (actual.length === 0) return true;
  return actual.some((value) => expected.has(value));
}

export function listSubagentRuns(identity?: string | SubagentSessionIdentity, root = asyncRunsRoot()): SubagentRun[] {
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names
    .map((name) => readSubagentRun(path.join(root, name)))
    .filter((run): run is SubagentRun => Boolean(run))
    .filter((run) => matchesSubagentSession(run, identity))
    .sort((a, b) => {
      const startedDifference = (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER);
      return startedDifference || a.runId.localeCompare(b.runId);
    });
}
