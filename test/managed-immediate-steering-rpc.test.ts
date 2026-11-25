/** Runs the bundled agent and Python tool against an offline provider. */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import type { PiEvent, RpcCommand } from "../src/types.ts";

const executable = process.env.PITTY_TEST_MANAGED_RUNTIME;
const integrationTest = executable ? test : test.skip;
type Message = {
  role: string; toolCallId?: string; stopReason?: string; errorMessage?: string;
  content: string | Array<{ type: string; text?: string }>;
  nestedCalls?: { calls: Array<{ id: string; name: string; status: string; arguments?: Record<string, unknown> }> };
};
class FixtureClient extends PiRpcClient {
  async rpc(command: RpcCommand): Promise<unknown> {
    return this.data(await this.request(command));
  }
}
function text(message: Message): string {
  return typeof message.content === "string" ? message.content
    : message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
}
async function waitFor(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for " + label);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function fixture(options: { code?: boolean } = {}) {
  if (!executable || !existsSync(executable)) throw new Error("PITTY_TEST_MANAGED_RUNTIME must exist.");
  const directory = await mkdtemp(path.join(os.tmpdir(), "pitty-immediate-steering-"));
  const agentDirectory = path.join(directory, "agent");
  await mkdir(agentDirectory);
  await writeFile(path.join(agentDirectory, "settings.json"), JSON.stringify({
    defaultProvider: "pitty-steering-fixture", defaultModel: "fixture", defaultThinkingLevel: "off",
    packages: [], compaction: { enabled: false }, retry: { enabled: false },
  }));
  const runtime = path.dirname(path.dirname(executable));
  const ai = pathToFileURL(path.join(runtime, "node_modules", "@earendil-works", "pi-ai", "dist", "compat.js")).href;
  const typebox = pathToFileURL(createRequire(path.join(runtime, "package.json")).resolve("typebox")).href;
  const provider = path.join(directory, "provider.mjs");
  await writeFile(provider, (await readFile(path.join(import.meta.dir, "fixtures", "managed-steering-extension.mjs"), "utf8"))
    .replace('"@earendil-works/pi-ai/compat"', JSON.stringify(ai)).replace('"typebox"', JSON.stringify(typebox)));
  const codeExtension = path.join(path.dirname(runtime), "pi-code-tool", "dist", "pi", "extension.js");
  const client = new FixtureClient({
    cwd: directory, executable,
    args: ["--no-extensions", "--no-skills", "--no-prompt-templates",
      "--tools", options.code ? "code,read,write" : "read",
      "--extension", provider, ...(options.code ? ["--extension", codeExtension] : []),
      "--provider", "pitty-steering-fixture", "--model", "fixture"],
    env: { PI_CODING_AGENT_DIR: agentDirectory, PI_OFFLINE: "1", PITTY_DISABLE_FORK_CODE_TOOL: "1",
      PITTY_STEERING_FIXTURE_DIR: directory, XDG_STATE_HOME: path.join(directory, "state") },
    requestTimeoutMs: 10_000,
  });
  const events: PiEvent[] = [];
  client.onEvent((event) => events.push(event));
  const cleanup = async () => { await client.stop(); await rm(directory, { recursive: true, force: true }); };
  try { await client.start(); await client.getState(); } catch (error) { await cleanup(); throw error; }
  return {
    client, directory, events, cleanup,
    hold: (name: string) => writeFile(path.join(directory, "hold-" + name), ""),
    release: (name: string) => rm(path.join(directory, "hold-" + name), { force: true }),
    marker: (name: string) => existsSync(path.join(directory, name)),
    started: (name: string) => waitFor(() => existsSync(path.join(directory, name + "-started")), name),
    settled: () => waitFor(async () => !(await client.getState()).isStreaming, "agent completion"),
    async messages() { return (await client.rpc({ type: "get_messages" }) as { messages: Message[] }).messages; },
  };
}

integrationTest("accepted steering preempts a held model response and preserves queued input exactly once", async () => {
  const f = await fixture();
  try {
    await f.hold("request-1");
    await f.client.prompt("initial task", "steer", "initial");
    await f.started("request-1");
    await expect(f.client.rpc({ type: "prompt", message: "invalid", streamingBehavior: "steer", messageId: "" }))
      .rejects.toThrow("messageId");
    await f.client.prompt("handled input", "steer", "handled");
    await f.client.prompt("later follow-up", "followUp", "follow-up");
    await f.client.prompt("/steering-fixture-notify");
    await f.client.getState();
    expect(f.marker("request-1-aborted")).toBe(false);
    expect(f.marker("request-2-started")).toBe(false);

    const started = performance.now();
    await f.client.prompt("use the existing implementation", "steer", "correction");
    await f.started("request-2");
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(2_000);
    await f.settled();
    expect(f.marker("request-1-aborted")).toBe(true);
    expect(f.marker("hold-request-1")).toBe(true);
    const messages = await f.messages();
    expect(messages.filter((message) => message.role === "user").map(text))
      .toEqual(["initial task", "use the existing implementation", "later follow-up"]);
    expect((await f.client.getQueue()).messages).toEqual([]);
    expect(f.events.filter((event) => event.type === "agent_start")).toHaveLength(1);
    expect(f.events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(messages.filter((message) => message.role === "assistant" && message.stopReason === "error")).toEqual([]);
    console.log("Immediate steering offline latency: " + Math.round(elapsed) + " ms");
  } finally { await f.cleanup(); }
}, 30_000);

type CodeEnd = {
  type: "tool_execution_end";
  toolCallId: string;
  isError: boolean;
  result: {
    content: Array<{ type: "text"; text: string }>;
    details: {
      status: string;
      cell?: { id: string; status: string };
      output?: { id: string; bytes: number; storedBytes: number };
    };
  };
};
function codeResult(events: PiEvent[], id: string): CodeEnd {
  const result = events.find((event) => event.type === "tool_execution_end" && event.toolCallId === id);
  if (!result) throw new Error("Missing code completion: " + id);
  return result as CodeEnd;
}
async function nextCode(directory: string, id: string, args: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(directory, "next-response.json"), JSON.stringify({
    stopReason: "toolUse", content: [{ type: "toolCall", id, name: "code", arguments: args }],
  }));
}

integrationTest("steering yields a live Python call, resumes once, and restores saved output after restart", async () => {
  const f = await fixture({ code: true });
  try {
    await f.hold("tool-first");
    await nextCode(f.directory, "code-run", {
      code: 'counter: int = 40\nfirst = write("first", "written once")\nsecond = read("second")\ncounter += 1\nprint(first)\nprint(second)\nprint(counter)',
    });
    await f.client.prompt("run the script", "steer", "code-initial");
    await f.started("tool-first");
    const started = performance.now();
    const beforeCorrection = f.events.length;
    await f.client.prompt("respond now while that call is running", "steer", "code-correction");
    await waitFor(() => f.events.slice(beforeCorrection).some((event) => event.type === "message_end"
      && event.message && typeof event.message === "object"
      && (event.message as Message).role === "assistant"
      && text(event.message as Message) === "Fixture completed."), "correction acknowledgement");
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(2_000);
    const yielded = codeResult(f.events, "code-run");
    expect(yielded.isError).toBe(false);
    expect(yielded.result.details.status).toBe("running");
    const cell = yielded.result.details.cell?.id;
    expect(cell).toBeTruthy();
    expect(f.marker("tool-first-completed")).toBe(false);
    expect((await f.client.getState()).isStreaming).toBe(true);
    expect(f.events.filter((event) => event.type === "agent_settled")).toHaveLength(0);
    expect(f.marker("tool-second-started")).toBe(false);
    expect((await f.messages()).filter((message) => message.role === "user" &&
      text(message) === "respond now while that call is running")).toHaveLength(1);

    await f.release("tool-first");
    await waitFor(() => f.marker("tool-first-completed"), "original call completion");
    await f.settled();
    const finishedMessage = (await f.messages()).find((message) => message.toolCallId === "code-run");
    expect(finishedMessage?.nestedCalls?.calls).toEqual([
      expect.objectContaining({ name: "write", status: "ok", arguments: { path: "first", content: "written once" } }),
    ]);
    expect(text(finishedMessage!)).toContain("[paused]");
    const completions = f.events.filter((event) => event.type === "entry_appended"
      && event.entry && typeof event.entry === "object"
      && (event.entry as { type?: string }).type === "tool_completion");
    expect(completions).toHaveLength(1);
    await nextCode(f.directory, "code-wait", { wait: cell });
    await f.client.prompt("collect the paused script", "steer", "code-collect");
    await f.settled();
    const paused = codeResult(f.events, "code-wait");
    expect(paused.result.details.status).toBe("ok");
    expect(paused.result.content[0]?.text).toContain("[historical]");
    expect(paused.result.details.cell?.id).toBe(cell);
    expect(f.marker("tool-second-started")).toBe(false);
    expect(await readFile(path.join(f.directory, "first"), "utf8")).toBe("written once");
    const collectedMessage = (await f.messages()).find((message) => message.toolCallId === "code-wait");
    expect(collectedMessage?.nestedCalls).toBeUndefined();

    await nextCode(f.directory, "code-resume", { resume: true });
    await f.client.prompt("continue the original script", "steer", "code-resume-input");
    await f.settled();
    const resumed = codeResult(f.events, "code-resume");
    expect(resumed.result.details.status).toBe("ok");
    expect(resumed.result.content[0]?.text).toContain("completed first");
    expect(resumed.result.content[0]?.text).toContain("completed second");
    expect(resumed.result.content[0]?.text).toContain("41");
    expect((await readFile(path.join(f.directory, "calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line)))
      .toEqual([{ label: "first" }, { label: "second" }]);

    await nextCode(f.directory, "code-large", { code: 'print("begin\\n" + "x" * 100000 + "\\nlast")' });
    await f.client.prompt("produce the large result", "steer", "code-large-input");
    await f.settled();
    const large = codeResult(f.events, "code-large").result;
    expect(large.details.status).toBe("ok");
    expect(Buffer.byteLength(large.content[0]!.text)).toBeLessThan(8192);
    expect(large.content[0]!.text).toContain("begin");
    expect(large.content[0]!.text).toContain("last");
    const output = large.details.output;
    expect(output?.bytes).toBeGreaterThan(100000);
    expect(output?.storedBytes).toBe(output?.bytes);

    await f.client.restart();
    await f.client.getState();
    await nextCode(f.directory, "code-output-page", { output: output!.id, offset: output!.bytes - 32 });
    await f.client.prompt("read the saved ending", "steer", "code-page-input");
    await f.settled();
    expect(codeResult(f.events, "code-output-page").result.content[0]!.text).toContain("last");
    await nextCode(f.directory, "code-state", { code: "print(counter)" });
    await f.client.prompt("read the restored variable", "steer", "code-state-input");
    await f.settled();
    expect(codeResult(f.events, "code-state").result.content[0]!.text).toBe("41\n");
    expect((await readFile(path.join(f.directory, "calls.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
    console.log("Python foreground yield offline latency: " + Math.round(elapsed) + " ms");
  } finally { await f.cleanup(); }
}, 45_000);
