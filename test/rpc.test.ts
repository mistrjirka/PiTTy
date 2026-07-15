import { afterEach, describe, expect, test } from "bun:test";
import * as path from "node:path";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import type { PiEvent } from "../src/types.ts";

const clients: PiRpcClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.stop();
});

describe("PiRpcClient", () => {
  test("starts Pi RPC, reads state, and forwards stream events", async () => {
    const client = new PiRpcClient({ cwd: process.cwd(), executable: path.resolve("scripts/mock-pi-rpc.mjs") });
    clients.push(client);
    const events: PiEvent[] = [];
    client.onEvent((event) => events.push(event));
    await client.start();
    const state = await client.getState();
    expect(state.sessionName).toBe("Mock Pi Session");
    const messages = await client.getMessages();
    expect(messages).toHaveLength(2);
    await client.prompt("hello");
    await Bun.sleep(20);
    expect(events.some((event) => event.type === "agent_start")).toBe(true);
    expect(events.some((event) => event.type === "message_end")).toBe(true);
    expect(events.some((event) => event.type === "agent_settled")).toBe(true);
  });
});
