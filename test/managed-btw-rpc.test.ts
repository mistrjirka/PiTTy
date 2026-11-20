/** Actual managed Pi + actual BTW extension, with an offline native provider. */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import { managedRuntimeReady } from "../scripts/founders-setup.mjs";
import {
  ExtensionWidgetController,
  type ExtensionWidgetRuntime,
} from "../src/tabs/extension-widget-controller.ts";

const executable = process.env.PITTY_TEST_MANAGED_RUNTIME;
const btwExtension = process.env.PITTY_TEST_BTW_EXTENSION;
const run = executable && btwExtension ? test : test.skip;

type StoredMessage = { role: string; content: unknown };
type RecordedRequest = {
  kind: string; number: number; messages: unknown[];
  sessionId?: string; disableContinuation?: boolean;
};

class FixtureClient extends PiRpcClient {
  async rawMessages(): Promise<StoredMessage[]> {
    return this.data<{ messages: StoredMessage[] }>(
      await this.request({ type: "get_messages" }),
    ).messages;
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for " + label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture() {
  if (!executable || !existsSync(executable) || !btwExtension || !existsSync(btwExtension))
    throw new Error("Set PITTY_TEST_MANAGED_RUNTIME and PITTY_TEST_BTW_EXTENSION to built runtime and extension paths.");
  const directory = await mkdtemp(path.join(os.tmpdir(), "pitty-managed-btw-"));
  const agentDirectory = path.join(directory, "agent");
  await mkdir(agentDirectory);
  await writeFile(path.join(agentDirectory, "settings.json"), JSON.stringify({
    defaultProvider: "pitty-btw-fixture", defaultModel: "fixture",
    defaultThinkingLevel: "off", packages: [],
    compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 1 },
    retry: { enabled: false },
  }));
  const runtimeRoot = path.dirname(path.dirname(executable));
  const helper = pathToFileURL(path.join(
    runtimeRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "index.js",
  )).href;
  const source = (await readFile(path.join(import.meta.dir, "fixtures", "managed-btw-extension.mjs"), "utf8"))
    .replace('"@earendil-works/pi-ai"', JSON.stringify(helper));
  const providerExtension = path.join(directory, "provider.mjs");
  await writeFile(providerExtension, source);
  const client = new FixtureClient({
    cwd: directory, executable,
    args: [
      "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-tools",
      "--extension", providerExtension, "--extension", btwExtension,
      "--provider", "pitty-btw-fixture", "--model", "fixture",
    ],
    env: {
      PI_CODING_AGENT_DIR: agentDirectory,
      PITTY_BTW_FIXTURE_DIR: directory,
      PITTY_DISABLE_FORK_CODE_TOOL: "1",
      XDG_STATE_HOME: path.join(directory, "state"),
    },
    requestTimeoutMs: 15_000,
  });
  const widgets: ExtensionWidgetRuntime = { id: "btw-fixture" };
  const controller = new ExtensionWidgetController(() => {});
  client.onEvent((event) => controller.handle(event, widgets));
  const cleanup = async () => {
    await client.stop();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await client.start();
    expect((await client.getState()).model?.provider).toBe("pitty-btw-fixture");
    expect((await client.getCommands()).some((command) => command.name === "btw")).toBe(true);
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {
    client, directory, widgets, cleanup,
    hold: (name: string) => writeFile(path.join(directory, "hold-" + name), ""),
    release: (name: string) => rm(path.join(directory, "hold-" + name), { force: true }),
    started: (name: string) => waitFor(() => existsSync(path.join(directory, name + "-started")), name + " start"),
    settled: () => waitFor(async () => !(await client.getState()).isStreaming, "main completion"),
    text: () => [...widgets.extensionWidgets?.values() ?? []].flatMap((widget) => widget.lines).join("\n"),
    requests: async (): Promise<RecordedRequest[]> => (await readFile(path.join(directory, "requests.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as RecordedRequest),
  };
}

run("founders readiness recognizes the actual runtime with side-question support", () => {
  const appRoot = path.resolve(path.dirname(executable!), "../../..");
  expect(managedRuntimeReady(appRoot)).toBe(true);
});

run("managed BTW acknowledges while main is held, cancels independently, and leaves history unchanged", async () => {
  const f = await fixture();
  try {
    await f.hold("main");
    await f.client.prompt("Main work", "steer");
    await f.started("main");
    const before = await f.client.rawMessages();
    // Completion of this RPC while the main gate is closed proves it does not await generation.
    await f.client.prompt("/btw Explain this work", "steer");
    await waitFor(() => f.text().includes("SIDE ANSWER 1"), "side answer");
    expect((await f.client.getState()).isStreaming).toBe(true);
    expect(await f.client.rawMessages()).toEqual(before);
    expect((await f.client.getQueue()).messages).toEqual([]);
    const requests = await f.requests();
    const main = requests.find((item) => item.kind === "main")!;
    const aside = requests.find((item) => item.kind === "aside")!;
    expect(aside.messages.slice(0, -1)).toEqual(main.messages);
    expect(aside.sessionId).toBe(main.sessionId);
    expect(aside.disableContinuation).toBe(true);

    await f.hold("aside");
    await f.client.prompt("/btw Cancel this question", "steer");
    await waitFor(async () => (await f.requests()).filter((item) => item.kind === "aside").length === 2, "second side request");
    await f.client.prompt("/btw cancel", "steer");
    await waitFor(() => existsSync(path.join(f.directory, "aside-aborted")), "aside cancellation");
    expect(existsSync(path.join(f.directory, "main-aborted"))).toBe(false);
    expect((await f.client.getState()).isStreaming).toBe(true);
    expect(await f.client.rawMessages()).toEqual(before);
    await f.client.prompt("/btw clear", "steer");
    await waitFor(() => f.widgets.extensionWidgets?.size === 0, "widget hidden");
    await f.client.prompt("/btw show", "steer");
    await waitFor(() => (f.widgets.extensionWidgets?.size ?? 0) > 0, "widget reopened");

    await f.release("main");
    await f.settled();
    const messages = await f.client.rawMessages();
    expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(JSON.stringify(messages)).not.toContain("SIDE ANSWER");
    expect(JSON.stringify(messages)).not.toContain("Cancel this question");
  } finally {
    await f.cleanup();
  }
}, 45_000);

run("managed BTW answers during compaction without entering its queue or transcript", async () => {
  const f = await fixture();
  try {
    await f.client.prompt("Seed context " + "synthetic ".repeat(200));
    await f.settled();
    await f.hold("compaction");
    let compacted = false;
    const compact = f.client.compact().finally(() => { compacted = true; });
    await f.started("compaction");
    const before = await f.client.rawMessages();
    await f.client.prompt("/btw What is the current task?", "steer");
    await waitFor(() => f.text().includes("SIDE ANSWER 1"), "side answer during compaction");
    expect(compacted).toBe(false);
    expect(await f.client.rawMessages()).toEqual(before);
    expect((await f.client.getQueue()).messages).toEqual([]);
    await f.release("compaction");
    await compact;
    expect(JSON.stringify(await f.client.rawMessages())).not.toContain("SIDE ANSWER");
  } finally {
    await f.cleanup();
  }
}, 45_000);
