import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SubagentRun } from "../types.ts";

function atomicJson(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function requireFileControl(run: SubagentRun): string {
  if (run.control === "foreground" || !run.asyncDir) throw new Error("Foreground subagents do not support file control.");
  return run.asyncDir;
}

export function pauseSubagent(run: SubagentRun): void {
  const target = path.join(requireFileControl(run), "control", "interrupt.json");
  atomicJson(target, { type: "interrupt", ts: Date.now(), source: "pitty" });
  if (run.pid && run.pid > 0 && process.platform !== "win32") {
    try {
      process.kill(run.pid, "SIGUSR2");
    } catch {
      // The file inbox is authoritative; the signal only lowers latency.
    }
  }
}

export function stopSubagent(run: SubagentRun): void {
  const target = path.join(requireFileControl(run), "control", "timeout.json");
  atomicJson(target, { type: "timeout", ts: Date.now(), source: "pitty", reason: "Stopped from PiTTy" });
}

export function steerSubagent(run: SubagentRun, message: string, targetIndex?: number): void {
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
  atomicJson(path.join(requireFileControl(run), "control", "steer-requests", filename), request);
}
