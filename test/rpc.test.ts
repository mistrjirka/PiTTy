import { afterEach, describe, expect, test } from "bun:test";
import * as path from "node:path";
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

  test("switches sessions and reports Pi cancellation", async () => {
    const client = new PiRpcClient({ cwd: process.cwd(), executable: path.resolve("scripts/mock-pi-rpc.mjs") });
    clients.push(client);
    await client.start();
    expect(await client.switchSession("/tmp/next-session.jsonl")).toEqual({ cancelled: false });
    expect(await client.switchSession("cancel")).toEqual({ cancelled: true });
    expect(await rejectionMessage(client.switchSession("unsupported"))).toContain("Unknown command: switch_session");
    expect(await rejectionMessage(client.switchSession("failed"))).toContain("Session file not found");
  });
});
