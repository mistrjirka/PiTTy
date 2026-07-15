import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pauseSubagent, steerSubagent, stopSubagent } from "../src/subagents/control.ts";
import { listSubagentRuns, matchesSubagentSession, readSubagentRun, subagentTempRoot } from "../src/subagents/artifacts.ts";
import { readSubagentConversation, readSubagentTranscript } from "../src/subagents/transcript.ts";
import { subagentTargets, targetsForTool } from "../src/subagents/targets.ts";
import type { SubagentRun } from "../src/types.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function run(): SubagentRun {
  const asyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-oc-test-"));
  roots.push(asyncDir);
  return { runId: "run-1", asyncDir, mode: "single", state: "running", steps: [] };
}

describe("subagent controls", () => {
  test("uses the same uid-scoped temp root as pi-subagents", () => {
    if (process.getuid) expect(subagentTempRoot()).toBe(path.join(os.tmpdir(), `pi-subagents-uid-${process.getuid()}`));
  });

  test("parses pi-subagents v1 progress and cost fields", () => {
    const target = run();
    fs.writeFileSync(path.join(target.asyncDir, "status.json"), JSON.stringify({
      lifecycleArtifactVersion: 1,
      runId: "run-1",
      sessionId: "session-1",
      mode: "parallel",
      state: "running",
      startedAt: 1000,
      lastUpdate: 2000,
      currentStep: 1,
      chainStepCount: 2,
      currentTool: "bash",
      currentPath: "src/app.ts",
      turnCount: 4,
      toolCount: 7,
      totalTokens: { input: 100, output: 50, total: 150 },
      totalCost: { inputTokens: 100, outputTokens: 50, costUsd: 0.0123 },
      steps: [{ agent: "worker", status: "running", currentTool: "edit", turnCount: 2, toolCount: 3, tokens: { input: 40, output: 20, total: 60 } }],
    }));
    const parsed = readSubagentRun(target.asyncDir);
    expect(parsed?.totalTokens).toBe(150);
    expect(parsed?.totalCost).toBe(0.0123);
    expect(parsed?.steps[0]?.currentTool).toBe("edit");
    expect(parsed?.steps[0]?.tokens?.total).toBe(60);
  });


  test("matches restored runs whose artifact sessionId is the session file path", () => {
    const sessionFile = path.join(os.tmpdir(), "pi-session-test.jsonl");
    const restored: SubagentRun = {
      runId: "restored-1",
      asyncDir: path.join(os.tmpdir(), "restored-1"),
      sessionId: sessionFile,
      sessionFile,
      mode: "single",
      state: "running",
      steps: [],
    };
    expect(matchesSubagentSession(restored, { sessionId: "uuid-from-rpc", sessionFile })).toBe(true);
    expect(matchesSubagentSession(restored, { sessionId: "other", sessionFile: `${sessionFile}.other` })).toBe(false);
  });

  test("writes portable pause and stop requests", () => {
    const target = run();
    pauseSubagent(target);
    stopSubagent(target);
    expect(JSON.parse(fs.readFileSync(path.join(target.asyncDir, "control", "interrupt.json"), "utf8")).type).toBe("interrupt");
    expect(JSON.parse(fs.readFileSync(path.join(target.asyncDir, "control", "timeout.json"), "utf8")).type).toBe("timeout");
  });

  test("writes a steer request", () => {
    const target = run();
    steerSubagent(target, "focus on tests", 0);
    const dir = path.join(target.asyncDir, "control", "steer-requests");
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(dir, files[0]!), "utf8")).message).toBe("focus on tests");
  });

  test("sorts active restored runs before newer completed runs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-oc-runs-"));
    roots.push(root);
    const completed = path.join(root, "completed");
    const running = path.join(root, "running");
    fs.mkdirSync(completed);
    fs.mkdirSync(running);
    fs.writeFileSync(path.join(completed, "status.json"), JSON.stringify({ runId: "completed", mode: "single", state: "complete", lastUpdate: 2_000, steps: [] }));
    fs.writeFileSync(path.join(running, "status.json"), JSON.stringify({ runId: "running", mode: "single", state: "running", lastUpdate: 1_000, steps: [] }));
    expect(listSubagentRuns(undefined, root).map((item) => item.runId)).toEqual(["running", "completed"]);
  });


  test("splits parallel runs into stable per-child targets with active children first", () => {
    const target = run();
    target.mode = "parallel";
    target.steps = [
      { index: 0, agent: "reviewer", status: "completed", transcriptPath: "/tmp/reviewer.jsonl" },
      { index: 1, agent: "implementer", status: "running", sessionFile: "/tmp/implementer-session.jsonl", transcriptPath: "/tmp/implementer.jsonl" },
    ];
    const targets = subagentTargets([target]);
    expect(targets.map((item) => item.key)).toEqual(["run-1:1", "run-1:0"]);
    expect(targets[0]?.label).toBe("implementer #2");
    expect(targets[0]?.canSteer).toBe(true);
    expect(targets[1]?.canSteer).toBe(false);
  });

  test("reads a specifically selected parallel child transcript", () => {
    const target = run();
    target.mode = "parallel";
    const first = path.join(target.asyncDir, "first.jsonl");
    const second = path.join(target.asyncDir, "second.jsonl");
    fs.writeFileSync(first, JSON.stringify({ recordType: "message", role: "assistant", text: "first child", ts: 1 }));
    fs.writeFileSync(second, JSON.stringify({ recordType: "message", role: "assistant", text: "second child", ts: 2 }));
    target.steps = [
      { index: 0, agent: "first", status: "running", transcriptPath: first },
      { index: 1, agent: "second", status: "running", transcriptPath: second },
    ];
    const items = readSubagentConversation(target, 160, 1);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind === "assistant" ? items[0].text : "").toBe("second child");
  });

  test("maps a subagent tool result to each child in its run", () => {
    const target = run();
    target.mode = "parallel";
    target.steps = [
      { index: 0, agent: "one", status: "running" },
      { index: 1, agent: "two", status: "completed" },
    ];
    const tool = {
      kind: "tool" as const,
      id: "tool-1",
      toolCallId: "call-1",
      name: "subagent",
      args: {},
      output: "started",
      details: { runId: "run-1" },
      timestamp: Date.now(),
      status: "done" as const,
      isError: false,
    };
    expect(targetsForTool(tool, subagentTargets([target])).map((item) => item.label).sort()).toEqual(["one #1", "two #2"]);
  });

  test("reads the active subagent transcript", () => {
    const target = run();
    const transcriptPath = path.join(target.asyncDir, "transcript.jsonl");
    fs.writeFileSync(transcriptPath, [
      JSON.stringify({ recordType: "message", role: "assistant", text: "visible result", ts: 1 }),
      JSON.stringify({ recordType: "tool_start", toolName: "bash", argsPreview: "git status", ts: 2 }),
    ].join("\n"));
    target.transcriptPath = transcriptPath;
    const entries = readSubagentTranscript(target);
    expect(entries.map((entry) => entry.text)).toEqual(["visible result", "git status"]);
  });

  test("builds the same conversation model for subagent thinking and tools", () => {
    const target = run();
    const transcriptPath = path.join(target.asyncDir, "conversation.jsonl");
    fs.writeFileSync(transcriptPath, [
      JSON.stringify({
        recordType: "message",
        role: "assistant",
        ts: 10,
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "\u001b[38;2;34;211;238mThinking:\u001b[39m **Inspecting tests**" },
            { type: "text", text: "Found **two** failures." },
          ],
          stopReason: "toolUse",
        },
      }),
      JSON.stringify({ recordType: "tool_start", toolName: "bash", argsPreview: "bun test", ts: 20 }),
      JSON.stringify({ recordType: "tool_end", toolName: "bash", ts: 367 }),
      JSON.stringify({
        recordType: "message",
        role: "toolResult",
        text: "5 pass\n0 fail",
        ts: 368,
        message: { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "5 pass\n0 fail" }], isError: false },
      }),
    ].join("\n"));
    target.transcriptPath = transcriptPath;

    const items = readSubagentConversation(target);
    expect(items).toHaveLength(2);
    expect(items[0]?.kind).toBe("assistant");
    expect(items[0]?.kind === "assistant" ? items[0].thinking : "").toContain("Inspecting tests");
    expect(items[1]?.kind).toBe("tool");
    if (items[1]?.kind === "tool") {
      expect(items[1].name).toBe("bash");
      expect(items[1].args).toBe("bun test");
      expect(items[1].output).toBe("5 pass\n0 fail");
      expect(items[1].startedAt).toBe(20);
      expect(items[1].endedAt).toBe(367);
      expect(items[1].status).toBe("done");
    }
  });
});
