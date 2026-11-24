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
import { gzipSync, gunzipSync } from "node:zlib";
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
  options?: string[];
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: { task_id?: string; output?: string; exit_code?: number };
  };
};
type ApprovalChoice = "approve" | "deny" | "suspend";
type CodeArguments = { code?: string; reset?: boolean; resume?: boolean };

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
  managedDefault?: boolean;
  denyApproval?: boolean;
  blockEdit?: boolean;
  scripted?: boolean;
  persistent?: boolean;
  approvals?: ApprovalChoice[];
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
  await writeFile(python, options.managedDefault
    ? "export { default } from " + JSON.stringify(pathToFileURL(codeExtension).href) + ";\n"
    : "import { createPythonExtension } from " + JSON.stringify(pathToFileURL(codeExtension).href) + ";\n" +
    "export default createPythonExtension(" + JSON.stringify({
      root: directory, autoApprove: !(options.denyApproval || options.approvals), toolStore: false,
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
      ...(options.persistent ? ["--session", path.join(directory, "session.jsonl")] : ["--no-session"]),
      "--no-extensions", "--no-skills", "--no-prompt-templates",
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
      PITTY_CODE_FIXTURE_SCRIPTED: options.scripted ? "1" : "0",
      PITTY_CODE_FIXTURE_BLOCK_EDIT: options.blockEdit ? "1" : "0",
      PITTY_DISABLE_FORK_CODE_TOOL: "1", XDG_STATE_HOME: path.join(directory, "state"),
    },
    requestTimeoutMs: 15_000,
  });
  const events: Event[] = [];
  const uiErrors: unknown[] = [];
  let approvals = [...(options.approvals ?? [])];
  client.onEvent((raw) => {
    const event = raw as unknown as Event;
    events.push(event);
    if ((options.denyApproval || options.approvals) && event.type === "extension_ui_request" && event.method === "select" && event.id) {
      const choice = options.denyApproval ? "deny" : approvals.shift() ?? "deny";
      // Use the real option returned by the extension, including its suspension label.
      const value = event.options?.[{ approve: 0, deny: 1, suspend: 2 }[choice]];
      if (!value) uiErrors.push(new Error("Missing approval option: " + choice));
      void client.sendExtensionUiResponse(value
        ? { type: "extension_ui_response", id: event.id, value }
        : { type: "extension_ui_response", id: event.id, cancelled: true })
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
  const result = async (id = "fixture-code-1"): Promise<Message> => {
    await waitFor(async () => (await messages()).some((m) => m.role === "toolResult" && m.toolCallId === id), "Python result " + id);
    return (await messages()).find((m) => m.role === "toolResult" && m.toolCallId === id)!;
  };
  const settled = () => waitFor(async () => !(await client.getState()).isStreaming, "agent settlement");
  let nextCode = 0;
  const runCode = async (args: CodeArguments): Promise<Message> => {
    if (!options.scripted) throw new Error("runCode requires the scripted fixture.");
    await settled();
    const id = "fixture-script-" + ++nextCode;
    await writeFile(path.join(directory, "next-code.json"), JSON.stringify({ id, arguments: args }));
    await client.prompt("run " + id);
    const output = await result(id);
    await settled();
    return output;
  };
  const snapshot = async (): Promise<Snapshot> => {
    await client.prompt("/code-fixture-snapshot");
    return JSON.parse(await readFile(path.join(directory, "background-snapshot.json"), "utf8")) as Snapshot;
  };
  return {
    client, directory, events, cleanup, messages, result, snapshot, uiErrors, runCode,
    setApprovals: (choices: ApprovalChoice[]) => { approvals = [...choices]; },
    start: () => client.prompt("run the fixture code", "steer", "start-code"),
    settled,
    users: async () => (await messages()).filter((m) => m.role === "user").map(messageText),
  };
}

codeTest("managed code default executes bash without any RPC UI response", async () => {
  const f = await fixture({ managedDefault: true, code: 'print(bash("printf noninteractive-ok"))' });
  try {
    await f.start();
    const result = await f.result();
    expect(result.details?.status).toBe("ok");
    expect(messageText(result)).toContain("noninteractive-ok");
    expect(f.events.filter((event) => event.type === "extension_ui_request" && event.method === "select")).toEqual([]);
    await f.settled();
  } finally { await f.cleanup(); }
}, 25_000);

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

const readAndEditCode = [
  'captured = open("/workspace/source.txt").read()',
  'assert captured.count("old") == 1',
  'assert "new" not in captured',
  'position = captured.index("old")',
  'print(edit("source.txt", [{"oldText": "old", "newText": "new"}]))',
  'after_edit = open("/workspace/source.txt").read()',
  'assert after_edit == "new\\n"',
].join("\n");

async function fixtureToolCalls(directory: string): Promise<Array<{ toolName: string }>> {
  return (await readFile(path.join(directory, "tool-calls.jsonl"), "utf8")).trim().split("\n")
    .map((line) => JSON.parse(line) as { toolName: string });
}

async function restartPersistedFixture(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  const sessionFile = (await f.client.getState()).sessionFile;
  expect(sessionFile).toBe(path.join(f.directory, "session.jsonl"));
  const entries = (await readFile(sessionFile!, "utf8")).trim().split("\n")
    .map((line) => JSON.parse(line) as { message?: { role?: string; toolName?: string; details?: { state?: string } } });
  const stored = entries.filter((entry) => entry.message?.role === "toolResult" && entry.message.toolName === "code");
  expect(stored.length).toBeGreaterThan(0);
  expect(typeof stored.at(-1)?.message?.details?.state).toBe("string");
  const previousPid = f.client.getProcessPid();
  expect(previousPid).toBeDefined();
  await f.client.restart(sessionFile);
  expect((await f.client.getState()).model?.provider).toBe("pitty-code-fixture");
  expect(f.client.getProcessPid()).not.toBe(previousPid);
}

codeTest("real Python replay preserves earlier reads and variables while new reads see edits", async () => {
  const f = await fixture({ scripted: true });
  try {
    await writeFile(path.join(f.directory, "source.txt"), "old\n");
    const first = await f.runCode({ code: readAndEditCode, reset: true });
    expect(first.details?.status, messageText(first)).toBe("ok");
    expect(await readFile(path.join(f.directory, "source.txt"), "utf8")).toBe("new\n");

    const unrelated = await f.runCode({ code: [
      'assert captured == "old\\n"',
      'assert after_edit == "new\\n"',
      'print("retained", captured.strip(), position, 6 * 7)',
    ].join("\n") });
    expect(unrelated.details?.status, messageText(unrelated)).toBe("ok");
    expect(messageText(unrelated)).toContain("retained old 0 42");
    expect(unrelated.details?.calls).toEqual([]);

    const fresh = await f.runCode({ code: [
      'fresh = open("/workspace/source.txt").read()',
      'assert fresh == "new\\n"',
      'assert captured == "old\\n"',
      'assert after_edit == "new\\n"',
      'print("fresh", fresh.strip())',
    ].join("\n") });
    expect(fresh.details?.status, messageText(fresh)).toBe("ok");
    expect(messageText(fresh)).toContain("fresh new");
    expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName === "edit")).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
}, 30_000);

codeTest("real Python replay survives persisted session restart and an external file change", async () => {
  const f = await fixture({ scripted: true, persistent: true });
  try {
    await writeFile(path.join(f.directory, "source.txt"), "old\n");
    expect((await f.runCode({ code: readAndEditCode, reset: true })).details?.status).toBe("ok");
    expect(await readFile(path.join(f.directory, "source.txt"), "utf8")).toBe("new\n");
    await writeFile(path.join(f.directory, "source.txt"), "external\n");
    await restartPersistedFixture(f);

    const result = await f.runCode({ code: [
      "from pathlib import Path",
      'assert captured == "old\\n"',
      'assert after_edit == "new\\n"',
      'assert position == 0',
      'current = Path("/workspace/source.txt").read_text()',
      'assert current == "external\\n"',
      'print("restored", captured.strip(), "current", current.strip())',
    ].join("\n") });
    expect(result.details?.status, messageText(result)).toBe("ok");
    expect(messageText(result)).toContain("restored old current external");
    expect(result.details?.calls).toEqual([]);
    expect(await readFile(path.join(f.directory, "source.txt"), "utf8")).toBe("external\n");
    expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName === "edit")).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
}, 30_000);

codeTest("real Python replay resumes persisted approval without repeating an approved edit", async () => {
  const f = await fixture({ scripted: true, persistent: true, approvals: ["approve", "suspend"] });
  try {
    await writeFile(path.join(f.directory, "source.txt"), "old\n");
    const suspended = await f.runCode({ code: readAndEditCode + '\nprint(write("resumed.txt", captured + "resumed\\n"))', reset: true });
    expect(suspended.details?.status, messageText(suspended)).toBe("suspended");
    expect(await readFile(path.join(f.directory, "source.txt"), "utf8")).toBe("new\n");
    expect(existsSync(path.join(f.directory, "resumed.txt"))).toBe(false);
    expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName === "edit")).toHaveLength(1);

    await writeFile(path.join(f.directory, "source.txt"), "external\n");
    await restartPersistedFixture(f);
    f.setApprovals(["approve"]);
    const resumed = await f.runCode({ resume: true });
    expect(resumed.details?.status, messageText(resumed)).toBe("ok");
    expect(await readFile(path.join(f.directory, "source.txt"), "utf8")).toBe("external\n");
    expect(await readFile(path.join(f.directory, "resumed.txt"), "utf8")).toBe("old\nresumed\n");
    const calls = await fixtureToolCalls(f.directory);
    expect(calls.filter((call) => call.toolName === "edit")).toHaveLength(1);
    expect(calls.filter((call) => call.toolName === "write")).toHaveLength(1);
    expect(f.events.filter((event) => event.type === "extension_ui_request" && event.method === "select")).toHaveLength(3);
    expect(f.uiErrors).toEqual([]);

    const fresh = await f.runCode({ code: [
      'assert captured == "old\\n"',
      'assert after_edit == "new\\n"',
      'assert open("/workspace/source.txt").read() == "external\\n"',
      'print("resume preserved history and current reads")',
    ].join("\n") });
    expect(fresh.details?.status, messageText(fresh)).toBe("ok");
    expect(messageText(fresh)).toContain("resume preserved history and current reads");
  } finally {
    await f.cleanup();
  }
}, 30_000);

const stateGzipMarker = "pi-code-tool:gzip-v1:";
type LegacyCacheEntry = {
  tool: string;
  key?: string;
  result?: unknown;
  error?: { pythonType: string; message: string };
  denied?: true;
};
type LegacyState = {
  version: 1 | 2;
  snippets: Array<{ code: string; inputs?: Record<string, unknown> }>;
  calls: LegacyCacheEntry[];
  stdout: string;
  stdoutChars?: number;
  suspended?: {
    code: string; cacheLen: number; inputs?: Record<string, unknown>;
    stdout?: string; stdoutChars?: number;
  };
};

function storedCodeStates(sessionText: string): string[] {
  return sessionText.trim().split("\n")
    .map((line) => JSON.parse(line) as { message?: { role?: string; toolName?: string; details?: { state?: string } } })
    .filter((entry) => entry.message?.role === "toolResult" && entry.message.toolName === "code")
    .map((entry) => entry.message?.details?.state ?? "");
}

function encodeLegacyState(state: LegacyState, compressed: boolean): string {
  const json = JSON.stringify(state);
  return compressed ? stateGzipMarker + gzipSync(Buffer.from(json)).toString("base64") : json;
}

function decodeStoredState(state: string): { version: number } {
  const json = state.startsWith(stateGzipMarker)
    ? gunzipSync(Buffer.from(state.slice(stateGzipMarker.length), "base64")).toString("utf8")
    : state;
  return JSON.parse(json) as { version: number };
}

function cachedCall(
  version: 1 | 2,
  tool: string,
  args: unknown[],
  outcome: Pick<LegacyCacheEntry, "result" | "error" | "denied">,
): LegacyCacheEntry {
  return { tool, ...(version === 2 ? { key: JSON.stringify([args, {}]) } : {}), ...outcome };
}

async function installLegacyState(f: Awaited<ReturnType<typeof fixture>>, encoded: string): Promise<void> {
  const seed = await f.runCode({ code: 'print("synthetic session seed")', reset: true });
  expect(seed.details?.status, messageText(seed)).toBe("ok");
  const priorHistory = (await f.messages()).map((message) => ({ role: message.role, text: messageText(message) }));
  const sessionFile = path.join(f.directory, "session.jsonl");
  const previousPid = f.client.getProcessPid();
  expect(previousPid).toBeDefined();
  await f.client.stop();
  // Replace only our synthetic session's metadata while its process is stopped.
  const entries = (await readFile(sessionFile, "utf8")).trim().split("\n")
    .map((line) => JSON.parse(line) as { message?: { role?: string; toolName?: string; details?: { state?: string } } });
  const lastCode = entries.filter((entry) => entry.message?.role === "toolResult" && entry.message.toolName === "code").at(-1);
  expect(lastCode?.message?.details).toBeDefined();
  lastCode!.message!.details!.state = encoded;
  await writeFile(sessionFile, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  await f.client.start();
  expect((await f.client.getState()).model?.provider).toBe("pitty-code-fixture");
  expect(f.client.getProcessPid()).not.toBe(previousPid);
  expect((await f.messages()).map((message) => ({ role: message.role, text: messageText(message) }))).toEqual(priorHistory);
}

function completedLegacyState(version: 1 | 2): LegacyState {
  const code = [
    'saved = read("historical.txt")',
    'old_write = write("already-written.txt", "historical payload\\n")',
    ...(version === 2 ? [
      "try:",
      '    read("old-missing.txt")',
      "except RuntimeError:",
      '    caught_error = "historical error"',
      "try:",
      '    write("denied.txt", "forbidden")',
      "except PermissionError:",
      '    caught_denial = "historical denial"',
    ] : []),
    'print("LEGACY-OUTPUT")',
  ].join("\n");
  const calls = [
    cachedCall(version, "read", ["historical.txt"], { result: "historical bytes\n" }),
    cachedCall(version, "write", ["already-written.txt", "historical payload\n"], { result: "historical receipt" }),
    ...(version === 2 ? [
      cachedCall(version, "read", ["old-missing.txt"], { error: { pythonType: "RuntimeError", message: "historical missing file" } }),
      cachedCall(version, "write", ["denied.txt", "forbidden"], { denied: true }),
    ] : []),
  ];
  return {
    version,
    snippets: [
      { code: "total = base + 1\ndef scale(value):\n    return value * factor", inputs: { base: 6, factor: 3 } },
      { code },
    ],
    calls,
    stdout: "LEGACY-OUTPUT\n",
    ...(version === 2 ? { stdoutChars: "LEGACY-OUTPUT\n".length } : {}),
  };
}

for (const version of [1, 2] as const) {
  for (const compressed of [false, true]) {
    codeTest("real Python imports " + (compressed ? "gzip" : "plain") + " legacy v" + version + " with cached state and fresh live calls", async () => {
      const f = await fixture({ scripted: true, persistent: true, approvals: [] });
      const encoded = encodeLegacyState(completedLegacyState(version), compressed);
      const sessionFile = path.join(f.directory, "session.jsonl");
      try {
        await writeFile(path.join(f.directory, "historical.txt"), "current bytes\n");
        await writeFile(path.join(f.directory, "already-written.txt"), "external change after old write\n");
        await writeFile(path.join(f.directory, "old-missing.txt"), "this file exists now\n");
        await installLegacyState(f, encoded);

        const imported = await f.runCode({ code: [
          "assert total == 7",
          "assert scale(total) == 21",
          'assert saved == "historical bytes\\n"',
          'assert old_write == "historical receipt"',
          ...(version === 2 ? [
            'assert caught_error == "historical error"',
            'assert caught_denial == "historical denial"',
          ] : []),
          'print("imported", scale(total), saved.strip())',
        ].join("\n") });
        expect(imported.details?.status, messageText(imported)).toBe("ok");
        expect(messageText(imported)).toContain("imported 21 historical bytes");
        expect(messageText(imported)).not.toContain("LEGACY-OUTPUT");
        expect(imported.details?.calls).toEqual([]);
        expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName !== "code")).toEqual([]);
        expect(f.events.filter((event) => event.type === "extension_ui_request" && event.method === "select")).toEqual([]);
        expect(await readFile(path.join(f.directory, "already-written.txt"), "utf8")).toBe("external change after old write\n");
        expect(existsSync(path.join(f.directory, "denied.txt"))).toBe(false);
        expect(decodeStoredState(storedCodeStates(await readFile(sessionFile, "utf8")).at(-1)!).version).toBe(3);

        // Identical arguments in new code must use today's tools, not import's cache.
        const fresh = await f.runCode({ code: [
          'fresh = read("historical.txt")',
          'assert fresh == "current bytes\\n"',
          'print("live", fresh.strip())',
        ].join("\n") });
        expect(fresh.details?.status, messageText(fresh)).toBe("ok");
        expect(fresh.details?.calls).toEqual(["read"]);
        expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName === "read")).toHaveLength(1);
        f.setApprovals(["approve"]);
        const written = await f.runCode({ code: 'print(write("already-written.txt", "historical payload\\n"))' });
        expect(written.details?.status, messageText(written)).toBe("ok");
        expect(written.details?.calls).toEqual(["write"]);
        expect(await readFile(path.join(f.directory, "already-written.txt"), "utf8")).toBe("historical payload\n");
        expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName === "write")).toHaveLength(1);
        expect(f.events.filter((event) => event.type === "extension_ui_request" && event.method === "select")).toHaveLength(1);

        await writeFile(path.join(f.directory, "historical.txt"), "after restart\n");
        await restartPersistedFixture(f);
        const continued = await f.runCode({ code: [
          "assert scale(total) == 21",
          'assert saved == "historical bytes\\n"',
          'assert fresh == "current bytes\\n"',
          'print("continued", read("historical.txt").strip())',
        ].join("\n") });
        expect(continued.details?.status, messageText(continued)).toBe("ok");
        expect(messageText(continued)).toContain("continued after restart");
        expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName === "read")).toHaveLength(2);
        expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName === "write")).toHaveLength(1);
        expect(f.uiErrors).toEqual([]);
        const states = storedCodeStates(await readFile(sessionFile, "utf8"));
        expect(states).toContain(encoded);
        expect(decodeStoredState(states.at(-1)!).version).toBe(3);
      } finally {
        await f.cleanup();
      }
    }, 45_000);
  }
}


for (const version of [1, 2] as const) {
  codeTest("real Python imports paused legacy v" + version + " and resumes only pending work after restart", async () => {
    const f = await fixture({ scripted: true, persistent: true, approvals: ["suspend"] });
    const pendingCode = [
      'pre = write("pre.txt", "before\\n")',
      'print("PAST-PROGRESS")',
      'result = write(target, "pending\\n")',
      'print(decorate(pre))',
    ].join("\n");
    const encoded = encodeLegacyState({
      version,
      snippets: [{ code: 'prefix = "committed"\ndef decorate(value):\n    return prefix + ":" + value' }],
      calls: [cachedCall(version, "write", ["pre.txt", "before\n"], { result: "historical pre receipt" })],
      stdout: "",
      suspended: {
        code: pendingCode,
        cacheLen: 0,
        inputs: { target: "pending.txt" },
        ...(version === 2 ? { stdout: "PAST-PROGRESS\n", stdoutChars: "PAST-PROGRESS\n".length } : {}),
      },
    }, version === 2);
    const sessionFile = path.join(f.directory, "session.jsonl");
    try {
      await writeFile(path.join(f.directory, "pre.txt"), "external change after pre-write\n");
      await installLegacyState(f, encoded);
      const suspended = await f.runCode({ resume: true });
      expect(suspended.details?.status, messageText(suspended)).toBe("suspended");
      expect(messageText(suspended)).not.toContain("PAST-PROGRESS");
      expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName === "write")).toEqual([]);
      expect(await readFile(path.join(f.directory, "pre.txt"), "utf8")).toBe("external change after pre-write\n");
      expect(existsSync(path.join(f.directory, "pending.txt"))).toBe(false);
      const firstApproval = f.events.filter((event) => event.type === "extension_ui_request" && event.method === "select");
      expect(firstApproval).toHaveLength(1);
      expect(firstApproval[0]?.title).toContain("pending.txt");
      expect(decodeStoredState(storedCodeStates(await readFile(sessionFile, "utf8")).at(-1)!).version).toBe(3);

      await restartPersistedFixture(f);
      f.setApprovals(["approve"]);
      const resumed = await f.runCode({ resume: true });
      expect(resumed.details?.status, messageText(resumed)).toBe("ok");
      expect(messageText(resumed)).toContain("committed:historical pre receipt");
      expect(messageText(resumed)).not.toContain("PAST-PROGRESS");
      expect(resumed.details?.calls).toEqual(["write"]);
      expect(await readFile(path.join(f.directory, "pending.txt"), "utf8")).toBe("pending\n");
      expect(await readFile(path.join(f.directory, "pre.txt"), "utf8")).toBe("external change after pre-write\n");
      expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName === "write")).toHaveLength(1);
      expect(f.events.filter((event) => event.type === "extension_ui_request" && event.method === "select")).toHaveLength(2);
      const continued = await f.runCode({ code: 'assert target == "pending.txt"\nprint(decorate(pre))' });
      expect(continued.details?.status, messageText(continued)).toBe("ok");
      expect(messageText(continued)).toContain("committed:historical pre receipt");
      expect(f.uiErrors).toEqual([]);
      expect(storedCodeStates(await readFile(sessionFile, "utf8"))).toContain(encoded);
    } finally {
      await f.cleanup();
    }
  }, 45_000);
}

codeTest("real Python imports legacy readonly observations using current files once", async () => {
  const f = await fixture({ scripted: true, persistent: true });
  const encoded = encodeLegacyState({
    version: 2,
    snippets: [{ code: [
      'captured = open("/workspace/known.txt").read()',
      'assert captured == "unchanged\\n"',
      "def label():",
      "    return captured.strip()",
    ].join("\n") }],
    calls: [],
    stdout: "",
  }, true);
  try {
    // The old engine observed this same known content when reconstructing state.
    await writeFile(path.join(f.directory, "known.txt"), "unchanged\n");
    await installLegacyState(f, encoded);
    const imported = await f.runCode({ code: 'print("legacy", label())' });
    expect(imported.details?.status, messageText(imported)).toBe("ok");
    expect(messageText(imported)).toContain("legacy unchanged");
    expect(imported.details?.calls).toEqual([]);
    await writeFile(path.join(f.directory, "known.txt"), "changed after import\n");
    await restartPersistedFixture(f);
    const fresh = await f.runCode({ code: [
      'assert captured == "unchanged\\n"',
      'assert open("/workspace/known.txt").read() == "changed after import\\n"',
      'print("native continuation", label())',
    ].join("\n") });
    expect(fresh.details?.status, messageText(fresh)).toBe("ok");
    expect(messageText(fresh)).toContain("native continuation unchanged");
    expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName !== "code")).toEqual([]);
    const states = storedCodeStates(await readFile(path.join(f.directory, "session.jsonl"), "utf8"));
    expect(states).toContain(encoded);
    expect(decodeStoredState(states.at(-1)!).version).toBe(3);
  } finally {
    await f.cleanup();
  }
}, 45_000);


codeTest("real Python failed legacy reconstruction preserves state and ordinary conversation history", async () => {
  const f = await fixture({ scripted: true, persistent: true });
  const legacyState = encodeLegacyState({
    version: 2,
    snippets: [{ code: [
      'legacy_saved = open("/workspace/legacy-source.txt").read()',
      'assert legacy_saved == "before\\n"',
    ].join("\n") }],
    calls: [],
    stdout: "",
  }, true);
  const sessionFile = path.join(f.directory, "session.jsonl");
  try {
    await writeFile(path.join(f.directory, "legacy-source.txt"), "after\n");
    await installLegacyState(f, legacyState);
    const blocked = await f.runCode({ code: 'print(write("blocked.txt", "must not run"))' });
    expect(blocked.details?.status, messageText(blocked)).toBe("error");
    expect(messageText(blocked).toLowerCase()).toContain("cannot safely restore");
    expect(messageText(blocked)).toContain("AssertionError");
    expect(existsSync(path.join(f.directory, "blocked.txt"))).toBe(false);
    expect(storedCodeStates(await readFile(sessionFile, "utf8")).at(-1)).toBe(legacyState);

    const resume = await f.runCode({ resume: true });
    expect(resume.details?.status, messageText(resume)).toBe("error");
    expect(messageText(resume)).toContain("nothing is suspended");
    expect(storedCodeStates(await readFile(sessionFile, "utf8")).at(-1)).toBe(legacyState);
    expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName === "write")).toEqual([]);

    const priorHistory = (await f.messages()).map((message) => ({ role: message.role, text: messageText(message) }));
    const toolStarts = f.events.filter((event) => event.type === "tool_execution_start").length;
    await f.client.prompt("ordinary conversation still works");
    await waitFor(async () => (await f.messages()).slice(priorHistory.length)
      .some((message) => message.role === "assistant" && messageText(message) === "fixture response"), "ordinary chat response");
    await f.settled();
    expect((await f.messages()).slice(0, priorHistory.length)
      .map((message) => ({ role: message.role, text: messageText(message) }))).toEqual(priorHistory);
    expect(await f.users()).toContain("ordinary conversation still works");
    expect(f.events.filter((event) => event.type === "tool_execution_start")).toHaveLength(toolStarts);
    expect(storedCodeStates(await readFile(sessionFile, "utf8")).at(-1)).toBe(legacyState);

    const reset = await f.runCode({ code: 'print(write("reset.txt", "fresh state"))\nprint(6 * 7)', reset: true });
    expect(reset.details?.status, messageText(reset)).toBe("ok");
    expect(messageText(reset)).toContain("42");
    expect(await readFile(path.join(f.directory, "reset.txt"), "utf8")).toBe("fresh state");
    expect(await readFile(path.join(f.directory, "legacy-source.txt"), "utf8")).toBe("after\n");
    expect(existsSync(path.join(f.directory, "blocked.txt"))).toBe(false);
    expect((await fixtureToolCalls(f.directory)).filter((call) => call.toolName === "write")).toHaveLength(1);
    const states = storedCodeStates(await readFile(sessionFile, "utf8"));
    expect(states.filter((state) => state === legacyState)).toHaveLength(3);
    expect(decodeStoredState(states.at(-1)!).version).toBe(3);
  } finally {
    await f.cleanup();
  }
}, 45_000);
