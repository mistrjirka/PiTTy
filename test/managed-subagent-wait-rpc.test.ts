/** Real managed Pi + real pi-subagent processes, with an offline file-gated provider. */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import type { RpcCommand } from "../src/types.ts";

const executable = process.env.PITTY_TEST_MANAGED_RUNTIME;
const subagentExtension = process.env.PITTY_TEST_SUBAGENT_EXTENSION;
const integrationTest = executable && subagentExtension ? test : test.skip;

type Message = {
  role: string;
  toolCallId?: string;
  content: string | Array<{ type: string; text?: string }>;
};
type ToolEvent = {
  type: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    details?: { agentId?: string; state?: string; statusPath?: string; interruptedByUser?: boolean };
  };
};
class FixtureClient extends PiRpcClient {
  async rpc(command: RpcCommand): Promise<unknown> {
    return this.data(await this.request(command));
  }
}
function text(message: Pick<Message, "content">): string {
  return typeof message.content === "string" ? message.content
    : message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
}
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function waitFor(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for " + label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function records<T>(file: string): Promise<T[]> {
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

async function fixture(options: { codeChild?: boolean } = {}) {
  if (!executable || !existsSync(executable) || !subagentExtension || !existsSync(subagentExtension)) {
    throw new Error("PITTY_TEST_MANAGED_RUNTIME and PITTY_TEST_SUBAGENT_EXTENSION must point to existing implementations.");
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "pitty-subagent-wait-"));
  const runtimeRoot = path.dirname(path.dirname(executable));
  const codeExtension = path.join(path.dirname(runtimeRoot), "pi-code-tool", "dist", "pi", "extension.js");
  const agentDirectory = path.join(directory, "agent");
  const binDirectory = path.join(directory, "bin");
  const tempDirectory = path.join(directory, "tmp");
  await mkdir(path.join(agentDirectory, "agents"), { recursive: true });
  await mkdir(binDirectory);
  await mkdir(tempDirectory);
  await writeFile(path.join(agentDirectory, "settings.json"), JSON.stringify({
    defaultProvider: "pitty-subagent-fixture", defaultModel: "fixture", defaultThinkingLevel: "off",
    packages: [], compaction: { enabled: false }, retry: { enabled: false },
    // Managed children load the normal user configuration rather than the
    // fixture PATH shim. Give both paths the same offline provider.
    extensions: [subagentExtension, path.join(directory, "provider.mjs"), ...(options.codeChild ? [codeExtension] : [])],
    subagentProfiles: { builtinAgents: "none" },
  }));
  await writeFile(path.join(agentDirectory, "agents", "fixture-child.md"),
    "---\nname: fixture-child\ndescription: Offline wait fixture\nallowed_subagents: []\n---\nWait for the fixture gate.\n");

  const helper = pathToFileURL(path.join(runtimeRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "compat.js")).href;
  const provider = path.join(directory, "provider.mjs");
  await writeFile(provider, (await readFile(path.join(import.meta.dir, "fixtures", "managed-subagent-wait-extension.mjs"), "utf8"))
    .replace('"@earendil-works/pi-ai/compat"', JSON.stringify(helper))
    .replace('"typebox"', JSON.stringify(pathToFileURL(createRequire(path.join(runtimeRoot, "package.json")).resolve("typebox")).href)));

  // AgentProcess deliberately launches "pi" through PATH. Keep its real process
  // transport, but point this fixture's child at the same fork and isolated provider.
  await writeFile(path.join(binDirectory, "pi"), [
    "#!/bin/sh",
    ...(options.codeChild ? ['set -- --tools code,read,write --extension "$PITTY_SUBAGENT_TEST_CODE_EXTENSION" "$@"'] : []),
    'exec node "$PITTY_SUBAGENT_TEST_RUNTIME" --no-extensions --no-skills --no-prompt-templates --no-tools --extension "$PITTY_SUBAGENT_TEST_EXTENSION" --extension "$PITTY_SUBAGENT_TEST_PROVIDER" "$@"',
    "",
  ].join("\n"), { mode: 0o755 });
  const client = new FixtureClient({
    cwd: directory, executable,
    args: [
      "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--tools", "agent_spawn,agent_wait,agent_send,agent_inspect",
      "--extension", subagentExtension, "--extension", provider,
      "--provider", "pitty-subagent-fixture", "--model", "fixture",
    ],
    env: {
      PI_CODING_AGENT_DIR: agentDirectory,
      PI_OFFLINE: "1",
      PI_SUBAGENT_AGENT_ID: "", PI_SUBAGENT_PROFILE: "", PI_SUBAGENT_ALLOWED_SUBAGENTS: "[]",
      PI_SUBAGENT_ANCESTOR_IDS: "", PI_SUBAGENT_TREE_ID: path.basename(directory),
      PI_SUBAGENT_SESSION_DIR: path.join(directory, "subagent-sessions"),
      PATH: binDirectory + path.delimiter + (process.env.PATH ?? ""),
      TMPDIR: tempDirectory, XDG_STATE_HOME: path.join(directory, "state"),
      PITTY_SUBAGENT_FIXTURE_DIR: directory,
      PITTY_SUBAGENT_TEST_RUNTIME: executable,
      PITTY_SUBAGENT_TEST_EXTENSION: subagentExtension,
      PITTY_SUBAGENT_TEST_PROVIDER: provider,
      PITTY_SUBAGENT_TEST_CODE_EXTENSION: codeExtension,
      PITTY_SUBAGENT_CODE_CHILD: options.codeChild ? "1" : "",
      PITTY_DISABLE_FORK_CODE_TOOL: "1",
    },
    requestTimeoutMs: 15_000,
  });
  const events: ToolEvent[] = [];
  client.onEvent((event) => events.push(event as ToolEvent));
  const cleanup = async () => {
    await writeFile(path.join(directory, "child-release"), "");
    await client.stop();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await client.start();
    expect((await client.getState()).model?.provider).toBe("pitty-subagent-fixture");
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {
    client, directory, events, cleanup,
    async messages() {
      return (await client.rpc({ type: "get_messages" }) as { messages: Message[] }).messages;
    },
    started: (id: string) => waitFor(() => events.some((event) =>
      event.type === "tool_execution_update" && event.toolCallId === id), id + " active wait"),
    ended: (id: string) => events.filter((event) => event.type === "tool_execution_end" && event.toolCallId === id),
    settled: () => waitFor(async () => !(await client.getState()).isStreaming, "parent to settle"),
  };
}

integrationTest("accepted input releases a real agent_wait while its original child keeps running", async () => {
  const f = await fixture();
  try {
    await f.client.prompt("Spawn the fixture child and wait", "steer", "initial");
    await f.started("fixture-wait-1");
    await waitFor(() => existsSync(path.join(f.directory, "child-started.json")), "real child provider");
    const child = JSON.parse(await readFile(path.join(f.directory, "child-started.json"), "utf8")) as {
      pid: number; agentId: string;
    };
    const spawn = f.ended("fixture-spawn-1")[0];
    expect(spawn?.isError).toBe(false);
    expect(spawn?.result?.details?.agentId).toBe(child.agentId);
    const statusPath = spawn?.result?.details?.statusPath;
    expect(statusPath).toBeTruthy();
    const childStatus = async () => JSON.parse(await readFile(statusPath!, "utf8")) as { state: string };
    await waitFor(async () => (await childStatus()).state === "running", "running child status");
    expect(processAlive(child.pid)).toBe(true);

    await expect(f.client.rpc({
      type: "prompt", message: "invalid input", streamingBehavior: "steer", messageId: "",
    })).rejects.toThrow("messageId");
    await f.client.prompt("handled input", "steer", "handled");
    expect((await f.client.getQueue()).messages).toEqual([]);
    expect(f.ended("fixture-wait-1")).toHaveLength(0);

    // Rejected or handled input never releases the wait.
    expect(f.ended("fixture-wait-1")).toHaveLength(0);
    expect((await f.client.getState()).isStreaming).toBe(true);
    expect((await childStatus()).state).toBe("running");

    const userText = "Respond now while the original child keeps running";
    await f.client.prompt(userText, "steer", "accepted-steer");
    await waitFor(() => f.ended("fixture-wait-1").length === 1, "interrupted wait result");
    await f.settled();
    const waitResult = f.ended("fixture-wait-1")[0]!;
    expect(waitResult.isError).toBe(false);
    expect(waitResult.result?.details).toEqual({
      agentId: child.agentId, state: "running", interruptedByUser: true,
    });
    expect(text({ content: waitResult.result?.content ?? [] })).toContain("new user input arrived");
    expect((await f.messages()).filter((message) => message.role === "user" && text(message) === userText)).toHaveLength(1);
    const contexts = await records<Message[]>(path.join(f.directory, "parent-contexts.jsonl"));
    const received = contexts.find((messages) => messages.some((message) => message.role === "user" && text(message) === userText));
    expect(received).toBeDefined();
    expect(received?.some((message) => message.role === "toolResult" && message.toolCallId === "fixture-wait-1"
      && text(message).includes("new user input arrived"))).toBe(true);
    const accepted = await records<{ messageId: string; mode: string }>(path.join(f.directory, "accepted-inputs.jsonl"));
    expect(accepted.filter((event) => event.messageId === "accepted-steer")).toHaveLength(1);
    expect(accepted.some((event) => event.messageId === "handled" || event.messageId === "")).toBe(false);
    expect((await childStatus()).state).toBe("running");
    expect(processAlive(child.pid)).toBe(true);
    expect(existsSync(path.join(f.directory, "child-completed"))).toBe(false);
    expect(existsSync(path.join(f.directory, "child-exited"))).toBe(false);
    expect(await records(path.join(f.directory, "child-launches.jsonl"))).toEqual([child]);

    // A later wait must not inherit the previous input interruption.
    await writeFile(path.join(f.directory, "next-wait.json"), JSON.stringify({ agentId: child.agentId }));
    await f.client.prompt("Wait again for the same child", "steer", "later-wait");
    await f.started("fixture-wait-2");
    expect((await f.client.getState()).isStreaming).toBe(true);
    expect(f.ended("fixture-wait-2")).toHaveLength(0);
    expect(processAlive(child.pid)).toBe(true);
    await writeFile(path.join(f.directory, "child-release"), "");
    await waitFor(() => f.ended("fixture-wait-2").length === 1, "original child completion");
    await f.settled();
    const completedWait = f.ended("fixture-wait-2")[0]!;
    expect(completedWait.isError).toBe(false);
    expect(completedWait.result?.details?.interruptedByUser).toBeUndefined();
    expect(completedWait.result?.details?.state).toBe("completed");
    expect(text({ content: completedWait.result?.content ?? [] })).toContain("Original child completed");
    expect(Number(await readFile(path.join(f.directory, "child-completed"), "utf8"))).toBe(child.pid);
    await waitFor(() => !processAlive(child.pid), "child process cleanup");
    expect(await records(path.join(f.directory, "child-launches.jsonl"))).toEqual([child]);
  } catch (error) {
    const diagnostics = { toolResults: f.events.filter((event) => event.type === "tool_execution_end"),
      messages: await f.messages().catch(() => []) };
    throw new Error(String(error) + "\n" + JSON.stringify(diagnostics).slice(0, 12_000), { cause: error });
  } finally {
    await f.cleanup();
  }
}, 60_000);

integrationTest("accepted follow-up releases a real agent_wait without stopping the child", async () => {
  const f = await fixture();
  try {
    await f.client.prompt("Spawn child then wait", "steer", "first");
    await f.started("fixture-wait-1");
    await waitFor(() => existsSync(path.join(f.directory, "child-started.json")), "child started");
    const child = JSON.parse(await readFile(path.join(f.directory, "child-started.json"), "utf8")) as {
      pid: number; agentId: string;
    };
    expect(processAlive(child.pid)).toBe(true);
    await f.client.prompt("A real follow-up should interrupt wait", "followUp", "wake-followup");
    await waitFor(() => f.ended("fixture-wait-1").length === 1, "follow-up interrupted wait");
    const result = f.ended("fixture-wait-1")[0]!;
    expect(result.isError).toBe(false);
    expect(result.result?.details?.interruptedByUser).toBe(true);
    expect(result.result?.details?.agentId).toBe(child.agentId);
    expect(processAlive(child.pid)).toBe(true);
    const launches = await records(path.join(f.directory, "child-launches.jsonl"));
    expect(launches).toHaveLength(1);
    await f.settled();
    const accepted = await records<{ messageId: string; mode: string }>(path.join(f.directory, "accepted-inputs.jsonl"));
    expect(accepted.filter((event) => event.messageId === "wake-followup").map((event) => event.mode)).toEqual(["followUp"]);
    expect((await f.messages()).filter((message) => message.role === "user"
      && text(message) === "A real follow-up should interrupt wait")).toHaveLength(1);
    expect(processAlive(child.pid)).toBe(true);
  } finally {
    await f.cleanup();
  }
}, 60_000);

integrationTest("a steered child stays alive until its detached write is saved and reported", async () => {
  const f = await fixture({ codeChild: true });
  try {
    await f.client.prompt("Spawn the child that writes a file", "steer", "code-child-start");
    await f.started("fixture-wait-1");
    await waitFor(() => existsSync(path.join(f.directory, "child-host-started")), "child host call");
    const child = JSON.parse(await readFile(path.join(f.directory, "child-started.json"), "utf8")) as {
      pid: number; agentId: string;
    };
    const statusPath = f.ended("fixture-spawn-1")[0]?.result?.details?.statusPath;
    expect(statusPath).toBeTruthy();
    const status = async () => JSON.parse(await readFile(statusPath!, "utf8")) as { state: string };
    await writeFile(path.join(f.directory, "next-action.json"), JSON.stringify({
      type: "toolCall", id: "steer-child", name: "agent_send",
      arguments: { to: child.agentId, message: "Acknowledge this correction immediately. Do not resume the script." },
    }));
    await f.client.prompt("Send that correction to the child", "steer", "correct-code-child");
    await waitFor(() => existsSync(path.join(f.directory, "child-correction-answered")), "child acknowledgement");
    await f.settled();
    expect((await status()).state).toBe("running");
    expect(processAlive(child.pid)).toBe(true);
    expect(existsSync(path.join(f.directory, "child-host-completed"))).toBe(false);
    expect(existsSync(path.join(f.directory, "child-exited"))).toBe(false);

    await writeFile(path.join(f.directory, "child-release"), "");
    await waitFor(() => existsSync(path.join(f.directory, "child-host-completed")), "original write completion");
    await waitFor(async () => (await status()).state === "completed", "child safe settlement");
    await waitFor(() => !processAlive(child.pid), "child cleanup after completion");
    expect(await readFile(path.join(f.directory, "late-edit.txt"), "utf8")).toBe("written exactly once");
    expect(existsSync(path.join(f.directory, "unexpected-resume"))).toBe(false);
    const sessionFile = await readFile(path.join(f.directory, "child-session-path"), "utf8");
    const completed = (await records<{ type: string; toolCallId: string; result: {
      details: { status: string }; nestedCalls: {
        calls: Array<{ name: string; status: string; arguments: { path: string } }>;
      };
    } }>(sessionFile)).filter((entry) => entry.type === "tool_completion");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.toolCallId).toBe("child-code");
    expect(completed[0]?.result.details.status).toBe("suspended");
    expect(completed[0]?.result.nestedCalls.calls).toEqual([
      expect.objectContaining({ name: "write", status: "ok", arguments: {
        path: "late-edit.txt", content: "written exactly once",
      } }),
    ]);

    await writeFile(path.join(f.directory, "next-action.json"), JSON.stringify({
      type: "toolCall", id: "inspect-finished-child", name: "agent_inspect", arguments: { agent_id: child.agentId },
    }));
    await f.client.prompt("Inspect the completed child", "steer", "inspect-code-child");
    await waitFor(() => f.ended("inspect-finished-child").length === 1, "final child inspection");
    await f.settled();
    const inspection = text({ content: f.ended("inspect-finished-child")[0]?.result?.content ?? [] });
    expect(inspection).toContain("late-edit.txt");
    expect(inspection).toContain("completed");
    expect(await records(path.join(f.directory, "child-launches.jsonl"))).toEqual([child]);
  } catch (error) {
    const childContexts = (await records<Message[]>(path.join(f.directory, "child-contexts.jsonl")))
      .map((messages) => messages.map((message) => ({ role: message.role, toolCallId: message.toolCallId, text: text(message).slice(0, 1200) })));
    throw new Error(String(error) + "\n" + JSON.stringify({ childContexts,
      parentTools: f.events.filter((event) => event.type === "tool_execution_end") }).slice(0, 12000), { cause: error });
  } finally { await f.cleanup(); }
}, 60_000);
