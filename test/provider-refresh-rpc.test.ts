/** Verify that reconnecting a provider refreshes one live Pi process without touching sessions. */
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import type { RpcCommand } from "../src/types.ts";

const binary = process.env.PITTY_TEST_MANAGED_RUNTIME;
const live = binary ? test : test.skip;
class TestClient extends PiRpcClient {
  async raw(command: RpcCommand): Promise<unknown> {
    return this.data(await this.request(command));
  }
}
live("refreshes model catalog in place and rejects invalid provider identifiers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pitty-provider-refresh-"));
  await writeFile(path.join(root, "settings.json"), JSON.stringify({
    packages: [], compaction: { enabled: false }, retry: { enabled: false },
  }));
  const pi = new TestClient({
    cwd: root, executable: binary!,
    args: ["--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-tools"],
    env: { PI_CODING_AGENT_DIR: root, PI_OFFLINE: "1" },
    requestTimeoutMs: 25_000,
  });
  try {
    await pi.start();
    const before = await pi.getState();
    const models = await pi.refreshProviderModels("openai-codex");
    expect(Array.isArray(models)).toBe(true);
    await expect(pi.raw({ type: "refresh_provider_models", providerId: "x/../../secret" }))
      .rejects.toThrow(/Invalid provider ID/);
    const after = await pi.getState();
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.messageCount).toBe(before.messageCount);
  } finally {
    await pi.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
