import { afterEach, describe, expect, test } from "bun:test";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import type { PiEvent } from "../src/types.ts";

const clients: PiRpcClient[] = [];
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
afterEach(async () => {
  for (const client of clients.splice(0)) await client.stop();
});

describe("PiRpcClient", () => {
  test("starts Pi RPC, reads state, and forwards stream events", async () => {
    const client = new PiRpcClient({ cwd: process.cwd(), executable: path.resolve("scripts/mock-pi-rpc.mjs") });
    clients.push(client);
    const events: PiEvent[] = [];
    let stopListening = () => {};
    const settled = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for mock agent_settled event.")), 5_000);
      stopListening = client.onEvent((event) => {
        events.push(event);
        if (event.type === "agent_settled") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await client.start();
    const state = await client.getState();
    expect(state.sessionName).toBe("Mock Pi Session");
    const messages = await client.getMessages();
    expect(messages).toHaveLength(2);
    await client.prompt("hello");
    await settled;
    stopListening();
    expect(events.some((event) => event.type === "agent_start")).toBe(true);
    expect(events.some((event) => event.type === "message_end")).toBe(true);
    expect(events.some((event) => event.type === "agent_settled")).toBe(true);
  });

  test("applies model, thinking, and session name mutations immediately", async () => {
    const client = new PiRpcClient({ cwd: process.cwd(), executable: path.resolve("scripts/mock-pi-rpc.mjs") });
    clients.push(client);
    await client.start();
    await client.setModel("anthropic", "claude-test");
    expect((await client.getState()).model?.provider).toBe("anthropic");
    expect((await client.getState()).model?.id).toBe("claude-test");
    expect(await rejectionMessage(client.setModel("anthropic", "failed"))).toContain("Model unavailable");
    await client.setThinkingLevel("minimal");
    expect((await client.getState()).thinkingLevel).toBe("minimal");
    expect(await rejectionMessage(client.setThinkingLevel("xhigh"))).toContain("Thinking level unavailable");
    await client.setSessionName("Renamed");
    expect((await client.getState()).sessionName).toBe("Renamed");
    expect(await rejectionMessage(client.setSessionName("failed"))).toContain("Rename rejected");
  });

  test("restarts the same client with the authoritative session and keeps listeners", async () => {
    const client = new PiRpcClient({ cwd: process.cwd(), executable: path.resolve("scripts/mock-pi-rpc.mjs"), args: ["--continue", "--session", "/tmp/stale.jsonl", "--session-id", "stale-id", "--verbose"] });
    clients.push(client);
    const events: PiEvent[] = [];
    const stopListening = client.onEvent((event) => events.push(event));
    await client.start();
    await client.restart("/tmp/current.jsonl");
    expect((await client.getState()).sessionFile).toBe("/tmp/current.jsonl");
    await client.prompt("after restart");
    await new Promise((resolve) => setTimeout(resolve, 100));
    stopListening();
    expect(events.some((event) => event.type === "agent_settled")).toBe(true);
  });

  test("reports restart failure while allowing explicit recovery", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pitty-rpc-restart-"));
    const client = new PiRpcClient({ cwd: process.cwd(), executable: path.resolve("scripts/mock-pi-rpc.mjs"), env: { MOCK_RESTART_FAILURE_FILE: path.join(directory, "started") } });
    clients.push(client);
    await client.start();
    await expect(client.restart("/tmp/current-session.jsonl")).rejects.toThrow("Pi exited during startup");
    await rm(directory, { recursive: true, force: true });
  });

  test("switches sessions and reports Pi cancellation", async () => {
    const client = new PiRpcClient({ cwd: process.cwd(), executable: path.resolve("scripts/mock-pi-rpc.mjs") });
    clients.push(client);
    await client.start();
    expect(await client.switchSession("/tmp/next-session.jsonl")).toEqual({ cancelled: false });
    expect((await client.getState()).sessionFile).toBe("/tmp/next-session.jsonl");
    expect(await client.switchSession("cancel")).toEqual({ cancelled: true });
    expect((await client.getState()).sessionFile).toBe("/tmp/next-session.jsonl");
    expect(await rejectionMessage(client.switchSession("unsupported"))).toContain("Unknown command: switch_session");
    expect(await rejectionMessage(client.switchSession("failed"))).toContain("Session file not found");
  });
});
