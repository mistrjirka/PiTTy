import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import type { PiEvent } from "../src/types.ts";

const clients: PiRpcClient[] = [];
const directories: string[] = [];
afterEach(async () => {
	for (const client of clients.splice(0)) await client.stop();
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture(mode: "reject" | "compaction") {
	const directory = await mkdtemp(join(tmpdir(), "pitty-queue-wire-"));
	directories.push(directory);
	const executable = join(directory, "fixture.mjs");
	await writeFile(executable, `import { createInterface } from "node:readline";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
let pending;
createInterface({ input: process.stdin }).on("line", (line) => {
 const command = JSON.parse(line);
 const response = (success, data, error) => send({ type: "response", id: command.id, command: command.type, success, data, error });
 if (process.env.QUEUE_WIRE_MODE === "reject") { response(false, undefined, "Rejected " + command.type); return; }
 if (command.type === "get_state") {
  send({ type: "compaction_start" });
  response(true, { isStreaming: true, isCompacting: true });
 } else if (command.type === "prompt") {
  pending = () => response(true, { messageId: command.messageId });
  setTimeout(() => { send({ type: "compaction_end" }); pending(); }, 120);
 } else response(true, {});
});`);
	const client = new PiRpcClient({
		cwd: directory, executable, requestTimeoutMs: 40, env: { QUEUE_WIRE_MODE: mode },
	});
	clients.push(client);
	await client.start();
	return client;
}

describe("queued-input RPC wire handling", () => {
	test("propagates failed prompt, steering, follow-up, and mutation responses", async () => {
		const client = await fixture("reject");
		await expect(client.prompt("keep me")).rejects.toThrow("Rejected prompt");
		await expect(client.steer("keep me")).rejects.toThrow("Rejected steer");
		await expect(client.followUp("keep me")).rejects.toThrow("Rejected follow_up");
		await expect(client.updateQueuedMessage("id", "new", 1)).rejects.toThrow("Rejected update_queued_message");
		await expect(client.removeQueuedMessage("id", 1)).rejects.toThrow("Rejected remove_queued_message");
		await expect(client.combineQueuedMessages(["one", "two"], 1)).rejects.toThrow("Rejected combine_queued_messages");
	});

	test("a prompt sent after compaction starts does not time out while compaction runs", async () => {
		const client = await fixture("compaction");
		const events: PiEvent[] = [];
		client.onEvent((event) => { events.push(event); });
		await client.getState();
		await expect(client.prompt("during compaction", "steer", "during-id")).resolves.toBeUndefined();
		expect(events.map((event) => event.type)).toEqual(["compaction_start", "compaction_end"]);
	});
});
