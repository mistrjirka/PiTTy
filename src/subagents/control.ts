import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { asyncRunsRoot } from "./artifacts.ts";
import type { SubagentRun } from "../types.ts";

type FileControlTarget = {
  base: string;
  target: string;
};

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function assertSafeDirectoryPath(base: string, directory: string, allowMissingTail: boolean): void {
  const relative = path.relative(base, directory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("File-control path is outside the Pi subagent run.");
  }
  let current = base;
  for (const segment of relative.split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error) {
      if (allowMissingTail && isMissingPath(error)) return;
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("File-control path is not a regular directory.");
    }
  }
}

function atomicJson(target: string, value: unknown, base: string): void {
  const directory = path.dirname(target);
  assertSafeDirectoryPath(base, directory, true);
  fs.mkdirSync(directory, { recursive: true });
  assertSafeDirectoryPath(base, directory, false);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

export type SteerRequestIdentity = {
  requestId: string;
  submittedAt: number;
  baselineSteerCount: number;
};

function requireFileControl(run: SubagentRun): string {
  if (run.control === "foreground") throw new Error("Foreground subagents are read-only; file control is unsupported.");
  if (!run.asyncDir) throw new Error("File-control directory is missing.");
  const root = path.resolve(asyncRunsRoot());
  const candidate = path.resolve(run.asyncDir);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("File-control directory is outside the Pi subagent run root.");
  }
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(candidate);
  } catch (error) {
    if (isMissingPath(error)) throw new Error("File-control directory is missing.");
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("File-control directory is not a regular directory.");
  }
  let resolvedRoot: string;
  let resolvedCandidate: string;
  try {
    resolvedRoot = fs.realpathSync(root);
    resolvedCandidate = fs.realpathSync(candidate);
  } catch (error) {
    if (isMissingPath(error)) throw new Error("File-control directory is missing.");
    throw error;
  }
  if (resolvedCandidate === resolvedRoot || !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("File-control directory is outside the Pi subagent run root.");
  }
  return candidate;
}

function fileControlTarget(run: SubagentRun, ...parts: string[]): FileControlTarget {
  const base = requireFileControl(run);
  return { base, target: path.join(base, "control", ...parts) };
}

export function pauseSubagent(run: SubagentRun): void {
  const { base, target } = fileControlTarget(run, "interrupt.json");
  atomicJson(target, { type: "interrupt", ts: Date.now(), source: "pitty" }, base);
  if (run.pid && run.pid > 0 && process.platform !== "win32") {
    try {
      process.kill(run.pid, "SIGUSR2");
    } catch {
      // The file inbox is authoritative; the signal only lowers latency.
    }
  }
}

export function stopSubagent(run: SubagentRun): void {
  const { base, target } = fileControlTarget(run, "timeout.json");
  atomicJson(target, { type: "timeout", ts: Date.now(), source: "pitty", reason: "Stopped from PiTTy" }, base);
}

export function resumeSubagent(run: SubagentRun): void {
  const { base, target } = fileControlTarget(run, "interrupt.json");
  assertSafeDirectoryPath(base, path.dirname(target), true);
  try {
    fs.rmSync(target, { force: true });
  } catch (error) {
    throw new Error(`Failed to resume subagent: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function steerSubagent(run: SubagentRun, message: string, targetIndex?: number): SteerRequestIdentity {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("A steering message is required.");
  const request = {
    type: "steer",
    id: randomUUID(),
    ts: Date.now(),
    message: trimmed,
    source: "pitty",
    ...(targetIndex !== undefined ? { targetIndex } : {}),
  };
  const filename = `${String(request.ts).padStart(13, "0")}-${Buffer.from(request.id).toString("base64url")}.json`;
  const { base, target } = fileControlTarget(run, "steer-requests", filename);
  atomicJson(target, request, base);
  return { requestId: request.id, submittedAt: request.ts, baselineSteerCount: run.steerCount ?? 0 };
}
