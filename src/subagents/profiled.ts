import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SubagentRun, ToolItem } from "../types.ts";

const RUNTIME = "profiled-subagents" as const;
const ROOT_PREFIX = "pi-profiled-subagents-";

type ProfiledStatus = {
  version: 1;
  runtime: typeof RUNTIME;
  agentId: string;
  profile: string;
  treeId: string;
  parentAgentId: string;
  label: string;
  state: string;
  startedAt: number;
  updatedAt: number;
  sessionPath?: string;
  model?: string;
  thinking?: string;
  waitingForParent?: boolean;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toolState(item: ToolItem, details: Record<string, unknown>): string {
  const direct = text(details.state);
  if (direct) return direct;
  if (item.status === "streaming" || item.status === "pending") return "running";
  if (item.status === "error") return "failed";
  return "completed";
}

function runtimeRoots(): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(os.tmpdir());
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith(ROOT_PREFIX))
    .map((name) => path.join(os.tmpdir(), name))
    .filter((candidate) => {
      try {
        const stat = fs.lstatSync(candidate);
        return stat.isDirectory() && !stat.isSymbolicLink();
      } catch {
        return false;
      }
    });
}

function safeControlDir(candidate: string): string | undefined {
  const resolved = path.resolve(candidate);
  const tmp = path.resolve(os.tmpdir());
  const relative = path.relative(tmp, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  const first = relative.split(path.sep)[0] ?? "";
  if (!first.startsWith(ROOT_PREFIX)) return undefined;
  try {
    const real = fs.realpathSync(resolved);
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink() || real !== resolved) return undefined;
  } catch {
    return undefined;
  }
  return resolved;
}

function safeStatusPath(controlDir: string, candidate?: string): string | undefined {
  const base = safeControlDir(controlDir);
  if (!base) return undefined;
  const filePath = path.resolve(candidate ?? path.join(base, "status.json"));
  const relative = path.relative(base, filePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
  } catch {
    return undefined;
  }
  return filePath;
}

function parseStatus(controlDir: string, statusPath?: string): ProfiledStatus | undefined {
  const safe = safeStatusPath(controlDir, statusPath);
  if (!safe) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(safe, "utf8"));
  } catch {
    return undefined;
  }
  const value = record(raw);
  if (!value || value.version !== 1 || value.runtime !== RUNTIME) return undefined;
  const agentId = text(value.agentId);
  const profile = text(value.profile);
  const treeId = text(value.treeId);
  const parentAgentId = text(value.parentAgentId);
  const label = text(value.label);
  const state = text(value.state);
  const startedAt = number(value.startedAt);
  const updatedAt = number(value.updatedAt);
  if (!agentId || !profile || !treeId || !parentAgentId || !label || !state || startedAt === undefined || updatedAt === undefined) return undefined;
  return {
    version: 1,
    runtime: RUNTIME,
    agentId,
    profile,
    treeId,
    parentAgentId,
    label,
    state,
    startedAt,
    updatedAt,
    ...(text(value.sessionPath) ? { sessionPath: text(value.sessionPath)! } : {}),
    ...(text(value.model) ? { model: text(value.model)! } : {}),
    ...(text(value.thinking) ? { thinking: text(value.thinking)! } : {}),
    ...(value.waitingForParent === true ? { waitingForParent: true } : {}),
  };
}

function statusDirectoriesForTrees(treeIds: ReadonlySet<string>): Array<{ controlDir: string; status: ProfiledStatus }> {
  if (treeIds.size === 0) return [];
  const rows: Array<{ controlDir: string; status: ProfiledStatus }> = [];
  for (const root of runtimeRoots()) {
    let names: string[];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const controlDir = safeControlDir(path.join(root, name));
      if (!controlDir) continue;
      const status = parseStatus(controlDir);
      if (status && treeIds.has(status.treeId)) rows.push({ controlDir, status });
    }
  }
  return rows;
}

function runFromStatus(controlDir: string, status: ProfiledStatus): SubagentRun {
  return {
    runId: `profiled:${path.basename(controlDir)}`,
    control: "profiled",
    runtime: RUNTIME,
    controlDir,
    statusPath: path.join(controlDir, "status.json"),
    treeId: status.treeId,
    parentAgentId: status.parentAgentId,
    agentId: status.agentId,
    profile: status.profile,
    label: status.label,
    mode: status.parentAgentId === "root" ? "profiled" : "nested",
    state: status.state,
    startedAt: status.startedAt,
    lastUpdate: status.updatedAt,
    activityState: status.state,
    agent: status.profile,
    model: status.model,
    thinking: status.thinking,
    sessionFile: status.sessionPath,
    steps: [],
  };
}

function runFromTool(item: ToolItem, details: Record<string, unknown>): SubagentRun | undefined {
  if (details.runtime !== RUNTIME) return undefined;
  const controlDirRaw = text(details.controlDir);
  const controlDir = controlDirRaw ? safeControlDir(controlDirRaw) : undefined;
  const status = controlDir ? parseStatus(controlDir, text(details.statusPath)) : undefined;
  if (status && controlDir) return runFromStatus(controlDir, status);

  const agentId = text(details.agentId);
  const treeId = text(details.treeId);
  if (!agentId || !treeId) return undefined;
  const profile = text(details.profile) ?? text(record(item.args)?.agent) ?? "agent";
  const label = text(details.label) ?? profile;
  const parentAgentId = text(details.parentAgentId) ?? "root";
  const startedAt = number(details.startedAt) ?? item.startedAt ?? item.timestamp;
  return {
    runId: controlDir ? `profiled:${path.basename(controlDir)}` : `profiled:${item.toolCallId}:${agentId}`,
    control: controlDir ? "profiled" : "foreground",
    runtime: RUNTIME,
    ...(controlDir ? { controlDir, statusPath: text(details.statusPath) } : {}),
    treeId,
    parentAgentId,
    agentId,
    profile,
    label,
    mode: parentAgentId === "root" ? "profiled" : "nested",
    state: toolState(item, details),
    startedAt,
    lastUpdate: item.endedAt ?? item.timestamp,
    activityState: toolState(item, details),
    agent: profile,
    model: text(details.model),
    thinking: text(details.thinking),
    sessionFile: text(details.sessionPath),
    steps: [],
  };
}

/**
 * Discover this fork's children from agent_spawn tool details, then use the
 * shared tree id to add nested descendants from their direct status records.
 */
export function profiledSubagentRunsFromTools(tools: readonly ToolItem[]): SubagentRun[] {
  const seeds: SubagentRun[] = [];
  const treeIds = new Set<string>();
  for (const item of tools) {
    if (item.name !== "agent_spawn") continue;
    const details = record(item.details);
    if (!details || details.runtime !== RUNTIME) continue;
    const run = runFromTool(item, details);
    if (run) seeds.push(run);
    const treeId = text(details.treeId);
    if (treeId) treeIds.add(treeId);
  }
  if (treeIds.size === 0) return [];

  const byRunId = new Map<string, SubagentRun>();
  for (const run of seeds) byRunId.set(run.runId, run);
  for (const { controlDir, status } of statusDirectoriesForTrees(treeIds)) {
    const run = runFromStatus(controlDir, status);
    byRunId.set(run.runId, run);
  }
  return [...byRunId.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

export function isProfiledSubagentTool(item: ToolItem): boolean {
  return item.name === "agent_spawn" && record(item.details)?.runtime === RUNTIME;
}
