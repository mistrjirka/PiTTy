/** Packaged Pi runtime checks. All providers and profiles are synthetic and offline. */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";

const executable = process.env.PITTY_TEST_MANAGED_RUNTIME;
const run = executable ? test : test.skip;

async function waitFor(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for " + label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(profile: string, extension = false, expiry = false) {
  if (!executable || !existsSync(executable)) throw new Error("Set PITTY_TEST_MANAGED_RUNTIME to the built runtime.");
  const directory = await mkdtemp(path.join(os.tmpdir(), "pitty-managed-cache-"));
  const agentDirectory = path.join(directory, "agent");
  await mkdir(agentDirectory);
  await writeFile(path.join(agentDirectory, "settings.json"), JSON.stringify({
    defaultProvider: "pitty-btw-fixture", defaultModel: "fixture",
    defaultThinkingLevel: "off", packages: [], retry: { enabled: false },
    ...(expiry ? { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 1 } } : {}),
  }));
  const runtimeRoot = path.dirname(path.dirname(executable));
  const helper = pathToFileURL(path.join(runtimeRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "index.js")).href;
  const source = (await readFile(path.join(import.meta.dir, "fixtures", "managed-cache-usage-extension.mjs"), "utf8"))
    .replace('"@earendil-works/pi-ai"', JSON.stringify(helper));
  const providerExtension = path.join(directory, "provider.mjs");
  await writeFile(providerExtension, source);
  const usageFile = path.join(directory, "usage.json");
  await writeFile(usageFile, JSON.stringify({ fiveHour: 20, weekly: 50, resetAt: null }));
  const client = new PiRpcClient({
    cwd: directory, executable,
    args: ["--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", ...(expiry ? ["--tools", "offline_wait"] : ["--no-tools"]),
      "--extension", providerExtension, "--provider", "pitty-btw-fixture", "--model", "fixture"],
    env: {
      PI_CODING_AGENT_DIR: agentDirectory,
      PITTY_BTW_FIXTURE_DIR: directory,
      PITTY_USAGE_PROFILE: profile,
      PITTY_USAGE_EXTENSION: extension ? "1" : "0",
      PITTY_EXPIRY_FIXTURE: expiry ? "1" : "0",
      PITTY_DISABLE_FORK_CODE_TOOL: "1",
      XDG_STATE_HOME: path.join(directory, "state"),
    },
    requestTimeoutMs: 15_000,
  });
  const cleanup = async () => {
    await client.stop();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await client.start();
    expect((await client.getState()).model?.provider).toBe("pitty-btw-fixture");
  } catch (error) { await cleanup(); throw error; }
  return {
    client, directory, cleanup,
    setUsage: (value: Record<string, unknown>) => writeFile(usageFile, JSON.stringify(value)),
    settings: async () => JSON.parse(await readFile(path.join(agentDirectory, "settings.json"), "utf8")) as {
      compaction?: { method?: string }; cacheMaintenance?: string;
    },
    hold: (name: string) => writeFile(path.join(directory, "hold-" + name), ""),
    release: (name: string) => rm(path.join(directory, "hold-" + name), { force: true }),
    started: (name: string) => waitFor(() => existsSync(path.join(directory, name + "-started")), name + " start"),
  };
}

run("managed runtime defaults to cache-aware expiry compaction and exposes loaded extension availability", async () => {
  const plain = await fixture("alpha");
  const loaded = await fixture("beta", true);
  try {
    const state = await plain.client.getState();
    expect(state.autoCompactionEnabled).toBe(true);
    expect(state.compactionMethod).toBe("cache-aware");
    expect(state.cacheMaintenance).toBe("compact");
    expect(state.compactionMethods?.find((item) => item.id === "extension")?.available).toBe(false);
    expect((await loaded.client.getState()).compactionMethods?.find((item) => item.id === "extension")?.available).toBe(true);
    await loaded.client.setCompactionMethod("extension");
    await loaded.client.setCacheMaintenance("off");
    await loaded.client.setInputActive(true);
    await loaded.client.setInputActive(false);
    expect((await loaded.client.getState()).compactionMethod).toBe("extension");
    expect((await loaded.client.getState()).cacheMaintenance).toBe("off");
    await waitFor(async () => {
      const saved = await loaded.settings();
      return saved.compaction?.method === "extension" && saved.cacheMaintenance === "off";
    }, "persisted compaction policy");
    await loaded.client.setCompactionMethod("cache-aware");
    await loaded.client.setCacheMaintenance("compact");
    expect((await loaded.client.getState()).compactionMethod).toBe("cache-aware");
    expect((await loaded.client.getState()).cacheMaintenance).toBe("compact");
  } finally { await Promise.all([plain.cleanup(), loaded.cleanup()]); }
}, 45_000);

run("managed usage RPC keeps two profiles separate and refreshes five-hour and weekly values", async () => {
  const alpha = await fixture("alpha");
  const beta = await fixture("beta");
  try {
    await beta.setUsage({ fiveHour: 71, weekly: 93, resetAt: 2_000_000_000_000 });
    const [a, b] = await Promise.all([alpha.client.getProviderUsage(), beta.client.getProviderUsage()]);
    expect(a.accountId).toBe("fixture:alpha");
    expect(b.accountId).toBe("fixture:beta");
    expect(a.limits.map((limit) => limit.percent)).toEqual([20, 50]);
    expect(b.limits.map((limit) => limit.percent)).toEqual([71, 93]);
    expect(a.limits[0]?.resetAt).toBeNull();
    expect(b.limits[0]?.resetAt).toBe(2_000_000_000_000);
    await alpha.setUsage({ fiveHour: 25, weekly: 51, resetAt: null });
    expect((await alpha.client.getProviderUsage()).limits.map((limit) => limit.percent)).toEqual([25, 51]);
    expect((await beta.client.getProviderUsage()).limits.map((limit) => limit.percent)).toEqual([71, 93]);
  } finally { await Promise.all([alpha.cleanup(), beta.cleanup()]); }
}, 45_000);

run("managed usage requests do not interrupt a pending main request or enter its conversation", async () => {
  const f = await fixture("alpha");
  try {
    await f.hold("main");
    await f.client.prompt("Synthetic pending work", "steer");
    await f.started("main");
    const messages = await f.client.getMessages();
    const usage = await f.client.getProviderUsage();
    expect(usage.status).toBe("ok");
    expect((await f.client.getState()).isStreaming).toBe(true);
    expect(await f.client.getMessages()).toEqual(messages);
    expect((await f.client.getQueue()).messages).toEqual([]);
    expect(existsSync(path.join(f.directory, "main-aborted"))).toBe(false);
    await f.release("main");
    await waitFor(async () => !(await f.client.getState()).isStreaming, "main completion");
  } finally { await f.cleanup(); }
}, 30_000);

run("managed usage reports unavailable limits honestly and redacts provider errors", async () => {
  const f = await fixture("alpha");
  try {
    await f.setUsage({ unavailable: true });
    const missing = await f.client.getProviderUsage();
    expect(missing.status).toBe("unavailable");
    expect(missing.observedAt).toBeNull();
    expect(missing.limits).toEqual([]);
    await f.setUsage({ fail: true });
    const failed = await f.client.getProviderUsage();
    expect(failed.status).toBe("error");
    expect(failed.limits).toEqual([]);
    expect(JSON.stringify(failed)).not.toContain("fixture-secret");
  } finally { await f.cleanup(); }
}, 30_000);

run("managed expiry timer stages a checkpoint without aborting a pending tool and retains late input", async () => {
  const f = await fixture("alpha", false, true);
  const compactions: string[] = [];
  f.client.onEvent((event) => {
    if (event.type === "compaction_end" && "reason" in event) compactions.push(String(event.reason));
  });
  try {
    await f.client.prompt("Earlier instructions " + "important context ".repeat(200));
    await f.started("main");
    await waitFor(async () => !(await f.client.getState()).isStreaming, "seed completion");
    await f.hold("tool");
    await f.hold("compaction");
    await f.client.prompt("Run the pending command");
    await f.started("tool");
    await f.started("compaction");
    expect(existsSync(path.join(f.directory, "tool-aborted"))).toBe(false);
    expect((await f.client.getState()).isStreaming).toBe(true);
    await f.client.prompt("Preserve this late user correction", "steer");
    await f.release("compaction");
    expect(compactions).toEqual([]);
    await f.release("tool");
    await waitFor(async () => !(await f.client.getState()).isStreaming, "post-compaction continuation");
    expect(compactions).toEqual(["cache-expiry"]);
    expect(existsSync(path.join(f.directory, "tool-aborted"))).toBe(false);
    const requests = (await readFile(path.join(f.directory, "requests.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { kind: string; messages: unknown[] });
    const continuation = JSON.stringify(requests.filter((request) => request.kind === "main").at(-1)?.messages);
    expect(continuation).toContain("Synthetic main-conversation summary");
    expect(continuation.match(/saved pending command result/g)).toHaveLength(1);
    expect(continuation.match(/Preserve this late user correction/g)).toHaveLength(1);
  } finally { await f.cleanup(); }
}, 30_000);
