/** Real Python bridge coverage. Uses offline fixtures and isolated agent/state directories.
 * Set PITTY_TEST_MANAGED_RUNTIME, PITTY_TEST_CODE_TOOL_EXTENSION and, for bash cases,
 * PITTY_TEST_BG_BASH_EXTENSION to the installed implementations under test.
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";

const executable = process.env.PITTY_TEST_MANAGED_RUNTIME;
const codeExtension = process.env.PITTY_TEST_CODE_TOOL_EXTENSION;
const backgroundExtension = process.env.PITTY_TEST_BG_BASH_EXTENSION;
const codeTest = executable && codeExtension ? test : test.skip;
const backgroundTest = executable && codeExtension && backgroundExtension ? test : test.skip;
const foregroundTimeoutSeconds = 60;

type Message = {
  role: string;
  toolName?: string;
  toolCallId?: string;
  content: string | Array<{ type: string; text?: string }>;
  details?: { status?: string; calls?: string[] };
  nestedCalls?: Array<{ toolCallId?: string; name?: string; toolName?: string; isError?: boolean }>;
};
type Event = {
  type: string;
  toolName?: string;
  toolCallId?: string;
  parentToolCallId?: string;
  isError?: boolean;
  id?: string;
  method?: string;
  title?: string;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: { task_id?: string; output?: string; exit_code?: number };
  };
};
type Snapshot = {
  foreground: number;
  foregroundStartedAt: number[];
  groups: number[];
  tasks: Array<{
    id: string; pid: number; state: string; startedAt: number;
    deadline?: number; toolCallId?: string; logPath: string;
  }>;
};

function messageText(message: Pick<Message, "content">): string {
  return typeof message.content === "string" ? message.content :
    message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
}
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeout = 15_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for " + label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(options: {
  foreground?: boolean;
  code?: string;
  denyApproval?: boolean;
  blockEdit?: boolean;
} = {}) {
  if (!executable || !existsSync(executable) || !codeExtension || !existsSync(codeExtension)) {
    throw new Error("The managed runtime and Python extension paths must exist.");
  }
  if (options.foreground && (!backgroundExtension || !existsSync(backgroundExtension))) {
    throw new Error("PITTY_TEST_BG_BASH_EXTENSION must point to pi-bg-bash/src/index.ts.");
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "pitty-real-code-test-"));
  const agentDirectory = path.join(directory, "agent");
  await mkdir(agentDirectory);
  await writeFile(path.join(agentDirectory, "settings.json"), JSON.stringify({
    defaultProvider: "pitty-code-fixture", defaultModel: "fixture", defaultThinkingLevel: "off",
    packages: [], compaction: { enabled: false }, retry: { enabled: false },
  }));
  const runtimeRoot = path.dirname(path.dirname(executable));
  const helper = pathToFileURL(path.join(runtimeRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "compat.js")).href;
  const provider = path.join(directory, "provider.mjs");
  await writeFile(provider, (await readFile(path.join(import.meta.dir, "fixtures", "real-code-tool-extension.mjs"), "utf8"))
    .replace('"@earendil-works/pi-ai/compat"', JSON.stringify(helper)));
  const python = path.join(directory, "python.mjs");
  await writeFile(python,
    "import { createPythonExtension } from " + JSON.stringify(pathToFileURL(codeExtension).href) + ";\n" +
    "export default createPythonExtension(" + JSON.stringify({
      root: directory, autoApprove: !options.denyApproval, toolStore: false,
    }) + ");\n");
  let code = options.code ?? "";
  if (options.foreground) {
    const script = path.join(directory, "command.mjs");
    await writeFile(script,
      await readFile(path.join(import.meta.dir, "fixtures", "managed-foreground-command.mjs"), "utf8") +
      '\nprocess.stdout.write("fixture command completed\\n");\n');
    const command = "node '" + script.split("'").join("'\\''") + "'";
    code = "print(bash(" + JSON.stringify(command) + ", timeout=" + foregroundTimeoutSeconds + "))";
  }
  const client = new PiRpcClient({
    cwd: directory, executable,
    args: [
      "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
      "--tools", "bash,read,write,edit,code",
      ...(backgroundExtension ? [
        "--extension", backgroundExtension,
        "--extension", path.resolve(import.meta.dir, "..", "src", "pi-extensions", "bg-input-promotion.mjs"),
      ] : []),
      "--extension", python, "--extension", provider,
      "--provider", "pitty-code-fixture", "--model", "fixture",
    ],
    env: {
      PI_CODING_AGENT_DIR: agentDirectory,
      PITTY_CODE_FIXTURE_DIR: directory, PITTY_CODE_FIXTURE_CODE: code,
      PITTY_CODE_FIXTURE_BLOCK_EDIT: options.blockEdit ? "1" : "0",
      PITTY_DISABLE_FORK_CODE_TOOL: "1", XDG_STATE_HOME: path.join(directory, "state"),
    },
    requestTimeoutMs: 15_000,
  });
  const events: Event[] = [];
  const uiErrors: unknown[] = [];
  client.onEvent((raw) => {
    const event = raw as unknown as Event;
    events.push(event);
    if (options.denyApproval && event.type === "extension_ui_request" && event.method === "select" && event.id) {
      void client.sendExtensionUiResponse({ type: "extension_ui_response", id: event.id, value: "Deny" })
        .catch((error: unknown) => uiErrors.push(error));
    }
  });
  const cleanup = async () => {
    await writeFile(path.join(directory, "command-release"), "");
    await client.stop();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await client.start();
    expect((await client.getState()).model?.provider).toBe("pitty-code-fixture");
  } catch (error) {
    await cleanup();
    throw error;
  }
  const messages = async () => await client.getMessages() as Message[];
  const result = async (): Promise<Message> => {
    await waitFor(async () => (await messages()).some((m) => m.role === "toolResult" && m.toolCallId === "fixture-code-1"), "Python result");
    return (await messages()).find((m) => m.role === "toolResult" && m.toolCallId === "fixture-code-1")!;
  };
  const snapshot = async (): Promise<Snapshot> => {
    await client.prompt("/code-fixture-snapshot");
    return JSON.parse(await readFile(path.join(directory, "background-snapshot.json"), "utf8")) as Snapshot;
  };
  return {
    client, directory, events, cleanup, messages, result, snapshot, uiErrors,
    start: () => client.prompt("run the fixture code", "steer", "start-code"),
    settled: () => waitFor(async () => !(await client.getState()).isStreaming, "agent settlement"),
    users: async () => (await messages()).filter((m) => m.role === "user").map(messageText),
  };
}

backgroundTest("real Python bash promotes one process and delivers input before its exit", async () => {
  const f = await fixture({ foreground: true });
  try {
    await f.start();
    await waitFor(() => existsSync(path.join(f.directory, "command-started")), "nested bash startup");
    const commandPid = Number(await readFile(path.join(f.directory, "command-started"), "utf8"));
    const before = await f.snapshot();
    expect(before.foreground).toBe(1);
    expect(before.foregroundStartedAt).toHaveLength(1);
    expect(before.groups).toHaveLength(1);
    expect(before.tasks).toEqual([]);
    expect((await f.client.getState()).isStreaming).toBe(true);

    await f.client.prompt("respond while Python bash runs", "steer", "during-code");
    await waitFor(async () => (await f.users()).includes("respond while Python bash runs"), "queued input before command exit");
    await f.settled();
    const after = await f.snapshot();
    expect(after.foreground).toBe(0);
    expect(after.tasks).toHaveLength(1);
    const task = after.tasks[0]!;
    expect(task.state).toBe("running");
    expect(task.pid).toBe(before.groups[0]!);
    expect(task.startedAt).toBe(before.foregroundStartedAt[0]!);
    expect(task.deadline).toBe(before.foregroundStartedAt[0]! + foregroundTimeoutSeconds * 1000);
    expect(task.toolCallId).toBe("fixture-code-1/1");
    expect(processAlive(commandPid)).toBe(true);
    expect(existsSync(path.join(f.directory, "command-completed"))).toBe(false);
    expect((await readFile(path.join(f.directory, "command-launches"), "utf8")).trim().split("\n")).toEqual([String(commandPid)]);
    expect((await f.client.getQueue()).messages).toEqual([]);

    const result = await f.result();
    expect(result.details?.status).toBe("ok");
    expect(result.details?.calls).toEqual(["bash"]);
    expect(messageText(result)).toContain("A new user message arrived:");
    expect(messageText(result)).not.toContain("The user pressed ctrl+shift+b");
    const nested = f.events.filter((e) => e.type === "tool_execution_end" && e.toolName === "bash");
    expect(nested).toHaveLength(1);
    expect(nested[0]?.parentToolCallId).toBe("fixture-code-1");
    expect(nested[0]?.toolCallId).toBe(task.toolCallId);
    const structured = nested[0]?.result?.structuredContent;
    expect(structured?.task_id).toBe(task.id);
    expect(structured?.output).toContain("fixture command running\n");
    expect(structured).not.toHaveProperty("exit_code");

    await writeFile(path.join(f.directory, "command-release"), "");
    await waitFor(() => existsSync(path.join(f.directory, "command-completed")), "same command completion");
    await waitFor(async () => (await readFile(task.logPath, "utf8")).includes("fixture command completed\n"), "continued background output");
    expect(Number(await readFile(path.join(f.directory, "command-completed"), "utf8"))).toBe(commandPid);
    expect((await readFile(path.join(f.directory, "command-launches"), "utf8")).trim().split("\n")).toEqual([String(commandPid)]);
    expect(await readFile(task.logPath, "utf8")).toContain("fixture command running\n");
  } finally {
    await f.cleanup();
  }
}, 45_000);

backgroundTest("real Python bash abort stops the foreground child without releasing its gate", async () => {
  const f = await fixture({ foreground: true });
  try {
    await f.start();
    await waitFor(() => existsSync(path.join(f.directory, "command-started")), "nested bash startup");
    const pid = Number(await readFile(path.join(f.directory, "command-started"), "utf8"));
    expect((await f.snapshot()).foreground).toBe(1);
    await f.client.abort();
    await waitFor(() => !processAlive(pid), "foreground child termination", 5_000);
    await f.settled();
    expect(existsSync(path.join(f.directory, "command-release"))).toBe(false);
    expect(existsSync(path.join(f.directory, "command-completed"))).toBe(false);
    expect((await f.snapshot()).foreground).toBe(0);
    expect((await f.snapshot()).tasks).toEqual([]);
    expect((await f.result()).details?.status).toBe("error");
    const nested = f.events.filter((e) => e.type === "tool_execution_end" && e.toolName === "bash");
    expect(nested).toHaveLength(1);
    expect(nested[0]?.parentToolCallId).toBe("fixture-code-1");
    expect(nested[0]?.isError).toBe(true);
  } finally {
    await f.cleanup();
  }
}, 30_000);

codeTest("real Python reads data and applies a derived edits array through native tools", async () => {
  const f = await fixture({ code: [
    "import json",
    'data = json.loads(read("input.json"))',
    'old = read("derived.txt")',
    'new = str(sum(data["values"])) + "\\n"',
    'print(edit("derived.txt", [{"oldText": old, "newText": new}]))',
    'print(read("derived.txt"))',
  ].join("\n") });
  try {
    await writeFile(path.join(f.directory, "input.json"), JSON.stringify({ values: [2, 5, 10] }));
    await writeFile(path.join(f.directory, "derived.txt"), "old\n");
    await f.start();
    const result = await f.result();
    await f.settled();
    expect(result.details?.status).toBe("ok");
    expect(result.details?.calls).toEqual(["read", "read", "edit", "read"]);
    expect(await readFile(path.join(f.directory, "derived.txt"), "utf8")).toBe("17\n");
    expect(messageText(result)).toContain("17");
    const nested = f.events.filter((e) => e.type === "tool_execution_end" && e.parentToolCallId === "fixture-code-1");
    expect(nested.map((e) => e.toolName)).toEqual(["read", "read", "edit", "read"]);
    expect(nested.every((e) => !e.isError)).toBe(true);
    expect(nested.map((e) => e.toolCallId)).toEqual([1, 2, 3, 4].map((n) => "fixture-code-1/" + n));
  } finally {
    await f.cleanup();
  }
}, 30_000);

codeTest("real Python nested edits obey native tool-call rejection", async () => {
  const f = await fixture({
    code: 'print(edit("derived.txt", [{"oldText": "old", "newText": "new"}]))',
    blockEdit: true,
  });
  try {
    await writeFile(path.join(f.directory, "derived.txt"), "old\n");
    await f.start();
    const result = await f.result();
    await f.settled();
    expect(result.details?.status).toBe("error");
    expect(messageText(result)).toContain("fixture denied nested edit");
    expect(await readFile(path.join(f.directory, "derived.txt"), "utf8")).toBe("old\n");
    const nested = f.events.filter((e) => e.type === "tool_execution_end" && e.toolName === "edit");
    expect(nested).toHaveLength(1);
    expect(nested[0]?.parentToolCallId).toBe("fixture-code-1");
    expect(nested[0]?.isError).toBe(true);
  } finally {
    await f.cleanup();
  }
}, 30_000);

codeTest("real Python approval denial prevents native edit dispatch", async () => {
  const f = await fixture({
    code: 'print(edit("derived.txt", [{"oldText": "old", "newText": "new"}]))',
    denyApproval: true,
  });
  try {
    await writeFile(path.join(f.directory, "derived.txt"), "old\n");
    await f.start();
    const result = await f.result();
    await f.settled();
    expect(f.uiErrors).toEqual([]);
    expect(f.events.some((e) => e.type === "extension_ui_request" && e.method === "select")).toBe(true);
    expect(result.details?.status).toBe("error");
    expect(messageText(result)).toContain("PermissionError");
    expect(await readFile(path.join(f.directory, "derived.txt"), "utf8")).toBe("old\n");
    expect(f.events.filter((e) => e.type === "tool_execution_start" && e.toolName === "edit")).toEqual([]);
    const hooks = (await readFile(path.join(f.directory, "tool-calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { toolName: string });
    expect(hooks.some((event) => event.toolName === "edit")).toBe(false);
  } finally {
    await f.cleanup();
  }
}, 30_000);
