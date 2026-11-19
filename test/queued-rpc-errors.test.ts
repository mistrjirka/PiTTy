import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiRpcClient, type PiRpcClientOptions } from "../src/rpc/pi-rpc-client.ts";
import type { PiEvent, RpcResponse } from "../src/types.ts";

const clients: PiRpcClient[] = [];
const directories: string[] = [];
const traces: Array<{ file: string; parent: Array<Record<string, unknown>> }> = [];

class TracedClient extends PiRpcClient {
	constructor(options: PiRpcClientOptions, private readonly record: (stage: string, fields: Record<string, unknown>) => void) {
		super(options);
	}
	protected override write(value: Record<string, unknown>): void {
		this.record("parent:send", { type: value.type, id: value.id });
		super.write(value);
		this.record("parent:write-return", { type: value.type, id: value.id });
	}
	protected override data<T>(response: RpcResponse): T {
		this.record("parent:response", { command: response.command, id: response.id, success: response.success });
		return super.data<T>(response);
	}
}
afterEach(async () => {
	for (const trace of traces.splice(0)) {
		let child: unknown = "trace file was not created";
		try {
			child = readFileSync(trace.file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
		} catch (error) {
			child = error instanceof Error ? error.message : String(error);
		}
		console.error("QUEUE_WIRE_TRACE " + JSON.stringify({ parent: trace.parent, child }));
	}
	for (const client of clients.splice(0)) await client.stop();
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture(mode: "reject" | "compaction") {
	const directory = await mkdtemp(join(tmpdir(), "pitty-queue-wire-"));
	directories.push(directory);
	const trace = { file: join(directory, "wire-trace.jsonl"), parent: [] as Array<Record<string, unknown>> };
	traces.push(trace);
	const record = (stage: string, fields: Record<string, unknown>) => trace.parent.push({ stage, at: Date.now(), ...fields });
	const executable = join(directory, "fixture.mjs");
	await writeFile(executable, `import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const trace = (stage, fields = {}) => appendFileSync(process.env.QUEUE_WIRE_TRACE_FILE, JSON.stringify({ stage, at: Date.now(), ...fields }) + "\\n");
const send = (value) => {
 trace("child:send", { type: value.type, command: value.command, id: value.id });
 process.stdout.write(JSON.stringify(value) + "\\n", () => trace("child:flushed", { type: value.type, command: value.command, id: value.id }));
};
trace("child:start", { pid: process.pid, mode: process.env.QUEUE_WIRE_MODE });
let pending;
createInterface({ input: process.stdin }).on("line", (line) => {
 const command = JSON.parse(line);
 trace("child:receive", { type: command.type, id: command.id });
 const response = (success, data, error) => send({ type: "response", id: command.id, command: command.type, success, data, error });
 if (process.env.QUEUE_WIRE_MODE === "reject") { response(false, undefined, "Rejected " + command.type); return; }
 if (command.type === "get_state") {
  send({ type: "compaction_start" });
  response(true, { isStreaming: true, isCompacting: true });
 } else if (command.type === "prompt") {
  pending = () => response(true, { messageId: command.messageId });
  trace("child:timer-scheduled", { delayMs: 120 });
  setTimeout(() => { trace("child:timer-fired"); send({ type: "compaction_end" }); pending(); }, 120);
 } else response(true, {});
});`);
	const client = new TracedClient({
		cwd: directory, executable, requestTimeoutMs: 40, env: { QUEUE_WIRE_MODE: mode, QUEUE_WIRE_TRACE_FILE: trace.file },
	}, record);
	client.onEvent((event) => record("parent:event", { type: event.type }));
	client.on("stderr", (chunk: string) => record("parent:stderr", { chunk }));
	client.on("protocol-error", (error: Error) => record("parent:protocol-error", { message: error.message }));
	client.on("exit", (error: Error) => record("parent:exit", { message: error.message }));
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
		const result = await client.prompt("during compaction", "steer", "during-id");
		expect(result).toBeUndefined();
		expect(events.map((event) => event.type)).toEqual(["compaction_start", "compaction_end"]);
	});
});
