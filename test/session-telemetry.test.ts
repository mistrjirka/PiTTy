import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readSessionTail } from "../src/subagents/session-tail.ts";
import { SessionTelemetryService } from "../src/subagents/session-telemetry.ts";
import { targetToolUsage } from "../src/ui/model-context.tsx";
import type { SubagentTarget } from "../src/subagents/targets.ts";
import type { SubagentRun } from "../src/types.ts";

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function sessionFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-session-telemetry-"));
  temporary.push(dir);
  return path.join(dir, "session.jsonl");
}
function row(role: string, details: Record<string, unknown> = {}) {
  return JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message: { role, ...details } }) + "\n";
}
function target(run: Partial<SubagentRun>): SubagentTarget {
  const full: SubagentRun = { runId: "agent-test", mode: "profiled", state: "running", steps: [], ...run };
  return { key: "agent-test", label: "agent-test", run: full, state: full.state, active: true, canSteer: true };
}

describe("bounded child-session telemetry", () => {
  test("recovers usage after a 1.5 MiB opaque result without parsing the result", () => {
    const file = sessionFile();
    fs.writeFileSync(file, [
      row("assistant", { usage: { input: 100, cacheRead: 200, cacheWrite: 0 } }),
      row("toolResult", { toolName: "code", details: { state: "Z".repeat(1_500_000) } }),
    ].join(""));
    const reader = new SessionTelemetryService();
    expect(reader.read(file).window).toBe(300);
    expect(reader.read(file).window).toBe(300);
  });

  test("uses the newest assistant usage and invalidates the cache after appends", () => {
    const file = sessionFile();
    fs.writeFileSync(file, row("assistant", { usage: { input: 100, cacheRead: 1, cacheWrite: 0 } }));
    const reader = new SessionTelemetryService();
    expect(reader.read(file).window).toBe(101);
    fs.appendFileSync(file, row("assistant", { usage: { input: 200, cacheRead: 400, cacheWrite: 0 } }));
    expect(reader.read(file).window).toBe(600);
  });

  test("discards incomplete records at both ends of the bounded tail", () => {
    const file = sessionFile();
    fs.writeFileSync(file, "incomplete-previous-record\n" + row("assistant", { content: "middle" }) + "unfinished-last-record");
    const tail = readSessionTail(file, 150);
    expect(tail).toContain('"content":"middle"');
    expect(tail).not.toContain("incomplete-previous-record");
    expect(tail).not.toContain("unfinished-last-record");
  });

  test("labels an agent with recorded turns as active when token usage is missing", () => {
    expect(targetToolUsage(target({ turnCount: 7 }), 60_000)).toBe("7 turns · usage unavailable");
    expect(targetToolUsage(target({ turnCount: 0, startedAt: 1_000 }), 2_000)).toBe("starting…");
    expect(targetToolUsage(target({ startedAt: 1_000, lastActivityAt: 6_000 }), 8_000)).toBe("working · usage unavailable");
    expect(targetToolUsage(target({ startedAt: 1_000 }), 60_000)).toBe("working · usage unavailable");
    expect(targetToolUsage(target({ toolCount: 3, turnCount: 8 }), 60_000)).toBe("3 tools");
  });
});
