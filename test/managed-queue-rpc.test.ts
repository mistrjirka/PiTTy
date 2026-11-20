/** Real compiled fork coverage. Set PITTY_TEST_MANAGED_RUNTIME to its dist/cli.js. */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import type { PiEvent, RpcCommand } from "../src/types.ts";

const executable = process.env.PITTY_TEST_MANAGED_RUNTIME;
const managedTest = executable ? test : test.skip;
const backgroundExtension = process.env.PITTY_TEST_BG_BASH_EXTENSION;
const backgroundTest = executable && backgroundExtension ? test : test.skip;
const foregroundTimeoutSeconds = 60;
const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

class FixtureClient extends PiRpcClient {
  async rpc(command: RpcCommand): Promise<unknown> {
    return this.data(await this.request(command));
  }
}

type UserMessage = {
  role: "user";
  content: string | Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
};

function text(message: Pick<UserMessage, "content">): string {
  return typeof message.content === "string"
    ? message.content
    : message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for " + label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(options: { foreground?: boolean; compaction?: "manual" | "automatic" } = {}) {
  if (!executable || !existsSync(executable))
    throw new Error("PITTY_TEST_MANAGED_RUNTIME must point to an installed fork dist/cli.js.");
  const directory = await mkdtemp(path.join(os.tmpdir(), "pitty-managed-queue-"));
  const agentDirectory = path.join(directory, "agent");
  await mkdir(agentDirectory);
  await writeFile(path.join(agentDirectory, "settings.json"), JSON.stringify({
    defaultProvider: "pitty-queue-fixture",
    defaultModel: "fixture",
    defaultThinkingLevel: "off",
    packages: [],
    compaction: { enabled: options.compaction === "automatic", keepRecentTokens: 1, reserveTokens: options.compaction === "automatic" ? 100 : 1 },
    retry: { enabled: false },
  }));
  // Resolve the helper from the installed runtime, not PiTTy's older development dependency.
  const runtimeRoot = path.dirname(path.dirname(executable));
  const helper = pathToFileURL(path.join(runtimeRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "compat.js")).href;
  const source = (await readFile(path.join(import.meta.dir, "fixtures", "managed-queue-extension.mjs"), "utf8"))
    .replace('"@earendil-works/pi-ai/compat"', JSON.stringify(helper));
  const extension = path.join(directory, "extension.mjs");
  await writeFile(extension, source);
  let foregroundCommand: string | undefined;
  if (options.foreground) {
    if (!backgroundExtension || !existsSync(backgroundExtension))
      throw new Error("PITTY_TEST_BG_BASH_EXTENSION must point to pi-bg-bash/src/index.ts.");
    const script = path.join(directory, "command.mjs");
    await writeFile(script, await readFile(path.join(import.meta.dir, "fixtures", "managed-foreground-command.mjs")));
    foregroundCommand = "node '" + script.split("'").join("'\\''") + "'";
  }
  const client = new FixtureClient({
    cwd: directory,
    executable,
    args: [
      ...(options.compaction ? [] : ["--no-session"]), "--no-extensions", "--no-skills", "--no-prompt-templates",
      ...(options.foreground ? ["--tools", "bash", "--extension", backgroundExtension!, "--extension", path.resolve(import.meta.dir, "..", "src", "pi-extensions", "bg-input-promotion.mjs")] : ["--no-tools"]),
      "--extension", extension,
      ...(options.compaction ? ["--extension", path.join(import.meta.dir, "fixtures", "managed-compaction-fallback.mjs")] : []),
      "--provider", "pitty-queue-fixture", "--model", "fixture",
    ],
    env: {
      PI_CODING_AGENT_DIR: agentDirectory,
      PITTY_QUEUE_FIXTURE_DIR: directory,
      ...(options.compaction === "automatic" ? { PITTY_QUEUE_AUTOCOMPACT: "1" } : {}),
      PITTY_DISABLE_FORK_CODE_TOOL: "1",
      XDG_STATE_HOME: path.join(directory, "state"),
      ...(foregroundCommand ? {
        PITTY_QUEUE_FOREGROUND_COMMAND: foregroundCommand,
        PITTY_QUEUE_FOREGROUND_TIMEOUT_SECONDS: String(foregroundTimeoutSeconds),
      } : {}),
    },
    requestTimeoutMs: 15_000,
  });
  const events: PiEvent[] = [];
  client.onEvent((event) => events.push(event));
  const cleanup = async () => {
    if (options.foreground) await writeFile(path.join(directory, "command-release"), "");
    await client.stop();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await client.start();
    expect((await client.getState()).model?.provider).toBe("pitty-queue-fixture");
  } catch (error) {
    await cleanup();
    throw error;
  }
  const users = async (): Promise<UserMessage[]> => {
    const result = await client.rpc({ type: "get_messages" }) as { messages: Array<{ role: string }> };
    return result.messages.filter((message): message is UserMessage => message.role === "user");
  };
  const notifications = async () => {
    const result = await client.rpc({ type: "get_messages" }) as { messages: Array<{ role: string; customType?: string }> };
    return result.messages.filter((message) => message.role === "custom" && message.customType === "fixture-subagent-result");
  };
  return {
    client, directory, events, cleanup, users, notifications,
    hold: (name: string) => writeFile(path.join(directory, "hold-" + name), ""),
    release: (name: string) => rm(path.join(directory, "hold-" + name), { force: true }),
    started: (name: string) => waitFor(() => existsSync(path.join(directory, name + "-started")), name + " to start"),
    settled: () => waitFor(async () => !(await client.getState()).isStreaming, "agent to settle"),
  };
}

managedTest("managed RPC edits duplicate text by ID and atomically merges attachments", async () => {
  const f = await fixture();
  try {
    await f.hold("response");
    await f.client.prompt("start", "steer", "start");
    await f.started("response");
    await f.client.prompt("repeat", "steer", "first");
    await f.client.prompt("repeat", "steer", "second");
    const initial = await f.client.getQueue();
    expect(initial.messages.map((item) => item.id)).toEqual(["first", "second"]);
    const edited = await f.client.updateQueuedMessage("first", "edited", initial.revision);
    expect(edited.messages.map((item) => item.message)).toEqual(["edited", "repeat"]);
    await expect(f.client.removeQueuedMessage("second", initial.revision)).rejects.toThrow();
    expect((await f.client.getQueue()).messages).toEqual(edited.messages);
    await f.client.rpc({
      type: "prompt", message: "third", streamingBehavior: "steer", messageId: "third",
      images: [{ type: "image", data: tinyPng, mimeType: "image/png" }],
    });
    let queue = await f.client.getQueue();
    await expect(f.client.combineQueuedMessages(["first", "third"], queue.revision)).rejects.toThrow();
    expect((await f.client.getQueue()).messages).toEqual(queue.messages);
    queue = await f.client.combineQueuedMessages(["second", "third"], queue.revision);
    expect(queue.messages.map((item) => item.message)).toEqual(["edited", "repeat\n\nthird"]);
    queue = await f.client.removeQueuedMessage("first", queue.revision);
    expect(queue.messages.map((item) => item.id)).toEqual(["second"]);
    await f.release("response");
    await f.settled();
    const users = await f.users();
    expect(users.map(text)).toEqual(["start", "repeat\n\nthird"]);
    const merged = users[1]!;
    expect(Array.isArray(merged.content) && merged.content.filter((part) => part.type === "image")).toHaveLength(1);
    await expect(f.client.updateQueuedMessage("second", "too late")).rejects.toThrow();
    expect((await f.client.getQueue()).messages).toEqual([]);
  } finally {
    await f.cleanup();
  }
}, 45_000);

managedTest("managed RPC accepts and combines messages during manual compaction", async () => {
  const f = await fixture();
  try {
    await f.client.prompt("seed " + "context ".repeat(200));
    await f.settled();
    await f.hold("compaction");
    const compact = f.client.compact();
    await f.started("compaction");
    await f.client.prompt("during one", "steer", "during-one");
    await f.client.prompt("during two", "steer", "during-two");
    const queue = await f.client.getQueue();
    expect(queue.messages.map((item) => item.id)).toEqual(["during-one", "during-two"]);
    await f.client.combineQueuedMessages(["during-one", "during-two"], queue.revision);
    expect((await f.users()).map(text)).not.toContain("during one\n\nduring two");
    await f.release("compaction");
    await compact;
    await waitFor(async () => (await f.users()).some((message) => text(message) === "during one\n\nduring two"), "queued delivery");
    await f.settled();
    expect((await f.users()).filter((message) => text(message) === "during one\n\nduring two")).toHaveLength(1);
    expect((await f.client.getQueue()).messages).toEqual([]);
    expect(f.events.some((event) => event.type === "compaction_end")).toBe(true);
  } finally {
    await f.cleanup();
  }
}, 45_000);


for (const mode of ["manual", "automatic"] as const) {
  managedTest("managed RPC keeps " + mode + " compaction exclusive when a child notification wakes the agent", async () => {
    const f = await fixture({ compaction: mode });
    try {
      await f.hold("compaction");
      await f.client.prompt("seed " + "context ".repeat(200));
      let compact: Promise<unknown> | undefined;
      if (mode === "manual") {
        await f.settled();
        compact = f.client.compact();
        // Cleanup can stop this request after an earlier assertion fails.
        void compact.catch(() => {});
      }
      await f.started("compaction");
      const startIndex = f.events.findIndex((event) => event.type === "compaction_start");
      expect(startIndex).toBeGreaterThanOrEqual(0);
      await f.client.prompt("continue after compaction", "followUp", "continue");
      await f.client.prompt("/queue-fixture-notify");
      await f.client.getState();
      expect(f.events.slice(startIndex + 1).some((event) => event.type === "agent_start")).toBe(false);
      expect((await f.client.getQueue()).messages.map((item) => item.id)).toEqual(["continue"]);
      expect(await f.notifications()).toHaveLength(0);

      await f.release("compaction");
      if (compact) await compact;
      await waitFor(async () => (await f.users()).some((message) => text(message) === "continue after compaction"), "queued user input after compaction");
      await waitFor(async () => (await f.notifications()).length === 1, "child notification after compaction");
      await f.settled();
      const endIndex = f.events.findIndex((event, index) => index > startIndex && event.type === "compaction_end");
      expect(endIndex).toBeGreaterThan(startIndex);
      expect(f.events.slice(startIndex + 1, endIndex).some((event) => event.type === "agent_start")).toBe(false);
      expect(f.events.slice(endIndex + 1).some((event) => event.type === "agent_start")).toBe(true);
      expect((await f.users()).filter((message) => text(message) === "continue after compaction")).toHaveLength(1);
      expect(await f.notifications()).toHaveLength(1);
      expect((await f.client.getQueue()).messages).toEqual([]);
      expect(existsSync(path.join(f.directory, "fallback-compaction-called"))).toBe(false);

      const sessionFile = (await f.client.getState()).sessionFile;
      if (!sessionFile) throw new Error("The fixture must persist its isolated compaction record.");
      const entries: Array<{ type: string; summary?: string; details?: unknown }> =
        (await readFile(sessionFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(entries.filter((entry) => entry.type === "compaction")).toEqual([
        expect.objectContaining({ summary: "Fixture summary", details: { fixtureOwner: "primary" } }),
      ]);
      const contexts = await readFile(path.join(f.directory, "contexts.jsonl"), "utf8");
      expect(contexts).toContain("Fixture summary");
      expect(contexts).not.toContain("Fallback fixture summary");
    } finally {
      await f.cleanup();
    }
  }, 45_000);
}

managedTest("managed RPC preserves queued messages when compaction is aborted", async () => {
  const f = await fixture({ compaction: "manual" });
  try {
    await f.client.prompt("seed " + "context ".repeat(200));
    await f.settled();
    await f.hold("compaction");
    const compact = f.client.compact().then(() => "", (error: Error) => error.message);
    await f.started("compaction");
    await f.client.prompt("keep pending", "steer", "pending");
    const startIndex = f.events.findIndex((event) => event.type === "compaction_start");
    await f.client.prompt("/queue-fixture-notify");
    await f.client.abort();
    expect(await compact).toMatch(/cancel|abort/i);
    expect((await f.client.getState()).isStreaming).toBe(false);
    expect((await f.client.getQueue()).messages.map((item) => item.message)).toEqual(["keep pending"]);
    expect((await f.users()).map(text)).not.toContain("keep pending");
    expect(await f.notifications()).toHaveLength(0);
    expect(f.events.slice(startIndex + 1).some((event) => event.type === "agent_start")).toBe(false);
    await f.client.removeQueuedMessage("pending");
    expect((await f.client.getQueue()).messages).toEqual([]);
    await f.release("compaction");
    await f.client.prompt("resume after cancellation");
    await waitFor(async () => (await f.notifications()).length === 1, "preserved notification on the next turn");
    await f.settled();
    expect(await f.notifications()).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
}, 45_000);

managedTest("managed RPC retains pending input when manual compaction fails", async () => {
  const f = await fixture();
  try {
    await f.client.prompt("seed " + "context ".repeat(200));
    await f.settled();
    await f.hold("compaction");
    await writeFile(path.join(f.directory, "fail-compaction"), "");
    const compact = f.client.compact().then(() => "", (error: Error) => error.message);
    await f.started("compaction");
    await f.client.prompt("recover pending", "steer", "recover");
    await f.release("compaction");
    expect(await compact).toContain("fixture compaction failure");
    expect((await f.client.getState()).isStreaming).toBe(false);
    expect((await f.client.getQueue()).messages.map((item) => item.message)).toEqual(["recover pending"]);
    expect((await f.users()).map(text)).not.toContain("recover pending");
    await f.client.removeQueuedMessage("recover");
  } finally {
    await f.cleanup();
  }
}, 45_000);

managedTest("managed RPC serializes two initial prompts through asynchronous preflight", async () => {
  const f = await fixture();
  try {
    await f.hold("input");
    const first = f.client.prompt("slow-first", "steer", "slow-first");
    await f.started("input");
    const second = f.client.prompt("fast-second", "steer", "fast-second");
    await f.release("input");
    await Promise.all([first, second]);
    await waitFor(async () => (await f.users()).length === 2, "both user messages");
    await f.settled();
    expect((await f.users()).map(text)).toEqual(["slow-first", "fast-second"]);
    expect((await f.client.getQueue()).messages).toEqual([]);
  } finally {
    await f.cleanup();
  }
}, 45_000);

backgroundTest("managed RPC promotes the same pi-bg-bash process when accepted input arrives", async () => {
  const f = await fixture({ foreground: true });
  type BackgroundSnapshot = {
    foreground: number;
    foregroundStartedAt: number[];
    groups: number[];
    tasks: Array<{ id: string; pid: number; state: string; startedAt: number; deadline?: number; toolCallId?: string }>;
  };
  const snapshot = async (): Promise<BackgroundSnapshot> => {
    await f.client.prompt("/queue-fixture-snapshot");
    return JSON.parse(await readFile(path.join(f.directory, "background-snapshot.json"), "utf8")) as BackgroundSnapshot;
  };
  try {
    await f.client.prompt("start foreground", "steer", "start-foreground");
    await f.started("command");
    const commandPid = Number(await readFile(path.join(f.directory, "command-started"), "utf8"));
    const before = await snapshot();
    expect(before.foreground).toBe(1);
    expect(before.foregroundStartedAt).toHaveLength(1);
    expect(before.tasks).toEqual([]);
    expect(before.groups).toHaveLength(1);

    await expect(f.client.rpc({
      type: "prompt", message: "invalid input", streamingBehavior: "steer", messageId: "",
    })).rejects.toThrow("messageId");
    await f.client.prompt("handled input", "steer", "handled");
    expect(await snapshot()).toEqual(before);

    expect(before.foregroundStartedAt[0]).toBeLessThan(Date.now());
    await f.client.prompt("respond while the command runs", "steer", "while-foreground");
    await waitFor(async () => (await f.users()).some((message) => text(message) === "respond while the command runs"), "user delivery before command exit");
    await f.settled();
    const after = await snapshot();
    expect(after.foreground).toBe(0);
    expect(after.tasks).toHaveLength(1);
    expect(after.tasks[0]?.pid).toBe(before.groups[0]);
    expect(after.tasks[0]?.startedAt).toBe(before.foregroundStartedAt[0]);
    expect(after.tasks[0]?.deadline).toBe(before.foregroundStartedAt[0]! + foregroundTimeoutSeconds * 1000);
    expect(after.tasks[0]?.state).toBe("running");
    expect(after.tasks[0]?.id).toBeTruthy();
    expect(after.tasks[0]?.toolCallId).toBe("fixture-bash-1");
    const transcript = await f.client.rpc({ type: "get_messages" }) as {
      messages: Array<{ role: string; toolCallId?: string; content: UserMessage["content"] }>;
    };
    const result = transcript.messages.find((message) => message.role === "toolResult" && message.toolCallId === "fixture-bash-1");
    expect(result).toBeDefined();
    expect(text(result!)).toStartWith("A new user message arrived: ");
    expect(text(result!)).not.toContain("The user pressed ctrl+shift+b");
    // Session messages omit structuredContent. The RPC completion event carries it.
    const toolEvents = f.events.filter((event) => event.type === "tool_execution_end" && event.toolCallId === "fixture-bash-1") as Array<{
      result: { structuredContent?: { task_id?: string; output?: string; exit_code?: number } };
    }>;
    expect(toolEvents).toHaveLength(1);
    const structured = toolEvents[0]?.result.structuredContent;
    expect(structured?.task_id).toBe(after.tasks[0]?.id);
    expect(structured?.output).toContain("fixture command running\n");
    expect(structured).not.toHaveProperty("exit_code");
    expect(existsSync(path.join(f.directory, "command-completed"))).toBe(false);
    expect(Number(await readFile(path.join(f.directory, "command-started"), "utf8"))).toBe(commandPid);
    expect((await readFile(path.join(f.directory, "command-launches"), "utf8")).trim().split("\n")).toEqual([String(commandPid)]);

    await writeFile(path.join(f.directory, "command-release"), "");
    await waitFor(() => existsSync(path.join(f.directory, "command-completed")), "original command completion");
    expect(Number(await readFile(path.join(f.directory, "command-completed"), "utf8"))).toBe(commandPid);
  } finally {
    await f.cleanup();
  }
}, 45_000);
