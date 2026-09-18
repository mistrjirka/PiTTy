import * as fs from "node:fs";
import * as path from "node:path";
import type { SubagentRun, ToolItem } from "../types.ts";
import { fileContentKey } from "./cache-key.ts";
import { PROFILED_RUNTIME_ROOT_PREFIX, profiledScanBase, safeProfiledControlDir } from "./profiled-paths.ts";

const RUNTIME = "profiled-subagents" as const;

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
  if (item.status === "streaming" || item.status === "pending") return text(details.state) ?? "running";
  if (item.status === "error") return "failed";
  return "completed";
}

function runtimeRoots(): string[] {
  // Scoped to profiledScanBase(): production scans os.tmpdir() as before,
  // while tests point PI_PITTY_PROFILED_ROOT at an isolated temp root so
  // the fallback scan below sees only that test's fixtures.
  const base = profiledScanBase();
  let names: string[];
  try {
    names = fs.readdirSync(base);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith(PROFILED_RUNTIME_ROOT_PREFIX))
    .map((name) => path.join(base, name))
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
  return safeProfiledControlDir(candidate);
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

/**
 * Locate the live event stream exactly like the status file: a regular
 * non-symlink file that is a DIRECT child of the validated control dir.
 * Returns undefined when the file is absent (e.g. after a Pi restart the
 * whole control dir — and the stream with it — is gone).
 */
function safeEventsPath(controlDir: string, candidate?: string): string | undefined {
  const base = safeControlDir(controlDir);
  if (!base) return undefined;
  const filePath = path.resolve(candidate ?? path.join(base, "events.jsonl"));
  const relative = path.relative(base, filePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  if (relative.includes(path.sep)) return undefined;
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

/** The extension updates status.json about every 200 ms; a heartbeat older than the max age means it is gone. */
export const PROFILED_HEARTBEAT_MAX_AGE_MS = 120_000;

/**
 * How long a `process.kill(pid, 0)` ownership probe stays cached. Well under
 * `PROFILED_HEARTBEAT_MAX_AGE_MS` so the heartbeat still bounds liveness;
 * pid reuse can only make the check briefly optimistic, never extend it.
 */
const PROFILED_OWNER_PID_CACHE_TTL_MS = 5_000;
const profiledOwnerPidCache = new Map<number, { alive: boolean; at: number }>();

/** Owning pid from a `<owning-pid>-<agent>-<random>` control directory name. */
function parseProfiledOwnerPid(controlDir: string | undefined): number | undefined {
  if (!controlDir) return undefined;
  const match = /^(\d+)-/.exec(path.basename(controlDir));
  if (!match) return undefined;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  return pid;
}

/**
 * Whether the process that owns a control directory still exists.
 * `ESRCH` means gone; `EPERM` means alive but owned by someone else.
 * Any failed check reads as not alive rather than throwing.
 */
function profiledOwnerPidAlive(pid: number): boolean {
  const cached = profiledOwnerPidCache.get(pid);
  const at = Date.now();
  if (cached && at - cached.at < PROFILED_OWNER_PID_CACHE_TTL_MS) return cached.alive;
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (error) {
    alive = (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
  profiledOwnerPidCache.set(pid, { alive, at });
  while (profiledOwnerPidCache.size > 256) {
    const oldest = profiledOwnerPidCache.keys().next().value;
    if (typeof oldest !== "number") break;
    profiledOwnerPidCache.delete(oldest);
  }
  return alive;
}

/**
 * A child cannot outlive the Pi process that spawned it, but its heartbeat
 * stays fresh for up to `PROFILED_HEARTBEAT_MAX_AGE_MS` after that process
 * dies. The control directory name carries the owning pid, so require it to
 * still exist. Directories without a pid segment carry no signal and fall
 * back to the heartbeat alone. This closes the window for children of a dead
 * Pi; it does not replace the heartbeat, which still bounds liveness.
 */
function profiledOwnerIsAlive(run: SubagentRun): boolean {
  const controlDir = run.controlDir ?? (run.statusPath ? path.dirname(run.statusPath) : undefined);
  const pid = parseProfiledOwnerPid(controlDir);
  if (pid === undefined) return true;
  return profiledOwnerPidAlive(pid);
}
const PROFILED_SESSION_TAIL_BYTES = 200 * 1024;
const PROFILED_NON_TERMINAL_STATES = ["running", "queued", "waiting", "idle"];

export type ProfiledSubagentOptions = {
  contextWindowForModel?: (model: string | undefined) => number | undefined;
};

type ProfiledSessionSnapshot = {
  window?: number;
  lastActivityAt?: number;
};

	type ProfiledSessionCacheEntry = {
	  key: string;
	  snapshot: ProfiledSessionSnapshot;
	};

	const profiledSessionCache = new Map<string, ProfiledSessionCacheEntry>();
	const MAX_PROFILED_SESSION_CACHE_ENTRIES = 128;

function profiledSessionSnapshot(sessionPath: string | undefined): ProfiledSessionSnapshot {
  if (!sessionPath) return {};
  let stat: fs.Stats;
  let content: string;
  try {
    stat = fs.statSync(sessionPath);
    if (!stat.isFile()) return {};
    const fd = fs.openSync(sessionPath, "r");
    try {
      const length = Math.min(stat.size, PROFILED_SESSION_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      const bytes = fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
      content = buffer.subarray(0, bytes).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return {};
  }
  const key = fileContentKey(stat, content);
  const cached = profiledSessionCache.get(sessionPath);
  if (cached && cached.key === key) return cached.snapshot;
  let window: number | undefined;
  let lastActivityAt: number | undefined = stat.mtimeMs;
  for (const line of content.split("\n").reverse()) {
    if (!line.trim()) continue;
    try {
      const value = record(JSON.parse(line));
      const timestamp = typeof value?.timestamp === "string"
        ? Date.parse(value.timestamp)
        : number(value?.ts);
      if (timestamp !== undefined && Number.isFinite(timestamp) && (lastActivityAt === undefined || timestamp > lastActivityAt)) lastActivityAt = timestamp;
      const message = record(value?.message);
      const usage = record(message?.usage);
      if (window !== undefined || message?.role !== "assistant" || !usage) continue;
      const input = number(usage.input) ?? 0;
      const cacheRead = number(usage.cacheRead) ?? 0;
      const cacheWrite = number(usage.cacheWrite) ?? 0;
      window = input + cacheRead + cacheWrite;
    } catch {
      // Ignore malformed or incomplete JSONL records.
    }
  }
  // Reverse order finds the newest assistant usage first; the full bounded scan still finds the newest timestamp.
  const snapshot = { ...(window !== undefined ? { window } : {}), ...(lastActivityAt !== undefined ? { lastActivityAt } : {}) };
  profiledSessionCache.delete(sessionPath);
  // Key on stat + content, not (mtimeMs, size): same-size rewrites inside one
  // mtime tick must not serve the previous snapshot.
  profiledSessionCache.set(sessionPath, { key: fileContentKey(stat, content), snapshot });
  while (profiledSessionCache.size > MAX_PROFILED_SESSION_CACHE_ENTRIES) {
    const oldest = profiledSessionCache.keys().next().value;
    if (typeof oldest !== "string") break;
    profiledSessionCache.delete(oldest);
  }
  return snapshot;
}

export function profiledRunIsLive(run: SubagentRun, now = Date.now()): boolean {
  if (!PROFILED_NON_TERMINAL_STATES.includes(run.state)) return false;
  let heartbeat: boolean;
  if (run.profiledStatusBacked) heartbeat = run.lastUpdate !== undefined && now - run.lastUpdate < PROFILED_HEARTBEAT_MAX_AGE_MS;
  else if (run.statusPath) {
    try {
      const stat = fs.statSync(run.statusPath);
      if (!stat.isFile()) return false;
      heartbeat = run.lastUpdate !== undefined && now - run.lastUpdate < PROFILED_HEARTBEAT_MAX_AGE_MS;
    } catch {
      return false;
    }
  } else {
    // A status-less run has no heartbeat: a frozen spawn-time `details.state`
    // alone must never read live. It may only claim liveness while its spawn
    // tool item is still in flight AND its own timestamp is fresh
    // (`lastUpdate` is `item.endedAt ?? item.timestamp`).
    heartbeat = run.profiledToolInFlight === true && run.lastUpdate !== undefined && now - run.lastUpdate < PROFILED_HEARTBEAT_MAX_AGE_MS;
  }
  if (!heartbeat) return false;
  return profiledOwnerIsAlive(run);
}

function statusDirectoriesAll(): Array<{ controlDir: string; status: ProfiledStatus }> {
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
      if (status) rows.push({ controlDir, status });
    }
  }
  return rows;
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

function runFromStatus(controlDir: string, status: ProfiledStatus, options: ProfiledSubagentOptions = {}): SubagentRun {
  const session = profiledSessionSnapshot(status.sessionPath);
  const contextWindow = options.contextWindowForModel?.(status.model);
  const eventsPath = safeEventsPath(controlDir);
  const run: SubagentRun = {
    runId: `profiled:${path.basename(controlDir)}`,
    control: "profiled",
    runtime: RUNTIME,
    controlDir,
    statusPath: path.join(controlDir, "status.json"),
    ...(eventsPath ? { eventsPath } : {}),
    profiledStatusBacked: true,
    treeId: status.treeId,
    parentAgentId: status.parentAgentId,
    agentId: status.agentId,
    profile: status.profile,
    label: status.label,
    mode: status.parentAgentId === "root" ? "profiled" : "nested",
    state: status.state,
    startedAt: status.startedAt,
    lastUpdate: status.updatedAt,
    lastActivityAt: session.lastActivityAt ?? status.updatedAt,
    activityState: status.state,
    agent: status.profile,
    model: status.model,
    thinking: status.thinking,
    ...(session.window !== undefined ? { tokens: { window: session.window } } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    sessionFile: status.sessionPath,
    steps: [],
  };
  return withUnresponsiveFallback(run);
}

/**
 * Only a NON-TERMINAL state that is not live may become `unresponsive`.
 * Terminal states (completed/failed/stopped/...) pass through untouched so a
 * successfully finished child is never relabelled as if it had died.
 * `activityState` follows `state` so the two cannot disagree.
 */
function withUnresponsiveFallback(run: SubagentRun): SubagentRun {
  if (PROFILED_NON_TERMINAL_STATES.includes(run.state) && !profiledRunIsLive(run)) {
    return { ...run, state: "unresponsive", activityState: "unresponsive" };
  }
  return run;
}

function runFromTool(item: ToolItem, details: Record<string, unknown>, options: ProfiledSubagentOptions = {}): SubagentRun | undefined {
  if (details.runtime !== RUNTIME) return undefined;
  const controlDirRaw = text(details.controlDir);
  const controlDir = controlDirRaw ? safeControlDir(controlDirRaw) : undefined;
  const status = controlDir ? parseStatus(controlDir, text(details.statusPath)) : undefined;
  if (status && controlDir) return runFromStatus(controlDir, status, options);

  const agentId = text(details.agentId);
  const treeId = text(details.treeId);
  if (!agentId || !treeId) return undefined;
  const profile = text(details.profile) ?? text(record(item.args)?.agent);
  const label = text(details.label) ?? profile ?? agentId ?? "agent";
  const parentAgentId = text(details.parentAgentId) ?? "root";
  const startedAt = number(details.startedAt) ?? item.startedAt ?? item.timestamp;
  const eventsPath = controlDir ? safeEventsPath(controlDir, text(details.eventsPath)) : undefined;
  const run: SubagentRun = {
    runId: controlDir ? `profiled:${path.basename(controlDir)}` : `profiled:${item.toolCallId}:${agentId}`,
    control: controlDir ? "profiled" : "foreground",
    runtime: RUNTIME,
    ...(controlDir ? { controlDir, ...(status ? { statusPath: text(details.statusPath) } : {}), ...(eventsPath ? { eventsPath } : {}) } : {}),
    treeId,
    parentAgentId,
    agentId,
    ...(profile ? { profile } : {}),
    label,
    mode: parentAgentId === "root" ? "profiled" : "nested",
    state: toolState(item, details),
    startedAt,
    lastUpdate: item.endedAt ?? item.timestamp,
    activityState: toolState(item, details),
    agent: profile ?? agentId ?? label,
    profiledToolInFlight: item.status === "streaming" || item.status === "pending",
    ...(() => {
      const session = profiledSessionSnapshot(text(details.sessionPath));
      return session.window !== undefined ? { tokens: { window: session.window } } : {};
    })(),
    ...(() => {
      const contextWindow = options.contextWindowForModel?.(text(details.model));
      return contextWindow !== undefined ? { contextWindow } : {};
    })(),
    model: text(details.model),
    thinking: text(details.thinking),
    sessionFile: text(details.sessionPath),
    steps: [],
  };
  // A frozen spawn-time `details.state` with no live heartbeat must not
  // keep reading `running`: the same unresponsive rule as status-backed runs.
  return withUnresponsiveFallback(run);
}

/**
 * Discover this fork's children from agent_spawn tool details, then use the
 * shared tree id to add nested descendants from their direct status records.
 */
export function profiledSubagentRunsFromTools(tools: readonly ToolItem[], options: ProfiledSubagentOptions = {}): SubagentRun[] {
  const seeds: SubagentRun[] = [];
  const treeIds = new Set<string>();
  for (const item of tools) {
    if (item.name !== "agent_spawn") continue;
    const details = record(item.details);
    if (!details || details.runtime !== RUNTIME) continue;
    const run = runFromTool(item, details, options);
    if (run) seeds.push(run);
    const treeId = text(details.treeId);
    if (treeId) treeIds.add(treeId);
  }
  const byRunId = new Map<string, SubagentRun>();
  for (const run of seeds) byRunId.set(run.runId, run);
  for (const { controlDir, status } of statusDirectoriesForTrees(treeIds)) {
    const run = runFromStatus(controlDir, status, options);
    byRunId.set(run.runId, run);
  }
  // Fallback discovery for restarted PiTTy / reloaded conversations without
  // matching spawn tools: surface finished runs from every runtime root under
  // the scan base (runtimeRoots() already scopes to PI_PITTY_PROFILED_ROOT).
  // Only non-live runs are added, so live/current runs never double and a
  // previous session's live child cannot read as live here. Transcripts load
  // through the same runFromStatus/sessionFile/eventsPath plumbing.
  // Same-run dedup is by control dir / runId only: the runId derives from the
  // control dir basename, so one control dir is one run even when an ancestor
  // and a nested grandchild share both treeId and agentId (the tree spans the
  // whole subtree). Never dedup on agentId/treeId: that merges distinct runs.
  const seenControlDirs = new Set<string>();
  for (const run of byRunId.values()) {
    if (run.controlDir) seenControlDirs.add(run.controlDir);
  }
  for (const { controlDir, status } of statusDirectoriesAll()) {
    const runId = `profiled:${path.basename(controlDir)}`;
    if (byRunId.has(runId) || seenControlDirs.has(controlDir)) continue;
    const run = runFromStatus(controlDir, status, options);
    // Finished/terminal only: withUnresponsiveFallback already mapped dead
    // non-terminal states to `unresponsive`, so this reuses existing state
    // words (finished/completed/failed/stopped/unresponsive) with no new
    // vocabulary. Liveness itself is untouched (profiledRunIsLive).
    if (profiledRunIsLive(run)) continue;
    byRunId.set(run.runId, run);
    seenControlDirs.add(controlDir);
  }
  return [...byRunId.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

export function isProfiledSubagentTool(item: ToolItem): boolean {
  return item.name === "agent_spawn" && record(item.details)?.runtime === RUNTIME;
}

/**
 * Single subagent-family tool rule shared by transcript tone (`toolVisual` in
 * `src/ui/message.tsx`), spawn grouping (`isSpawnToolItem` in
 * `src/ui/spawn-group.tsx`) and target ownership (`foregroundTargets` /
 * `subagentRunIdFromTool` in `src/subagents/targets.ts`). The three copies
 * drifted (`task_*` violet without ownership, `workflow_*` grouped without
 * the violet tone), so every site must use this one predicate.
 *
 * `subagent_supervisor` is deliberately excluded: it is the control-plane
 * tool for steering/answering child questions, it never spawns children, so
 * it must neither group nor own targets. (message.tsx still renders it with
 * the violet agent tone via its own explicit branch.)
 */
export function isSubagentFamilyToolName(name: string): boolean {
  const normalized = name.toLowerCase();
  if (normalized === "subagent_supervisor") return false;
  return /subagent|task|agent|delegate|workflow/.test(normalized);
}
