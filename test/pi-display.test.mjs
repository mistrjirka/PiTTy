import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { displayEvent, displayMessages } from "../src/pi-display/messages.mjs";
import { patchPiRpcSource } from "../src/pi-display/patch-source.mjs";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";

describe("Pi display-only RPC projection", () => {
	test("drops only code-tool state without changing the stored object", () => {
		const state = "x".repeat(32_000);
		const original = {
			role: "toolResult",
			toolName: "code",
			content: [{ type: "text", text: "visible" }],
			details: { state, status: "ok", calls: 3 },
		};
		const other = {
			role: "toolResult",
			toolName: "read",
			details: { state: "retain" },
		};
		const projected = displayMessages([original, other]);
		assert.equal(projected[0].details.state, undefined);
		assert.deepEqual(projected[0].details, { status: "ok", calls: 3 });
		assert.strictEqual(projected[0].content, original.content);
		assert.strictEqual(projected[1], other);
		assert.equal(original.details.state, state);
		assert.equal(
			displayMessages([{ ...original, details: { state } }])[0].details,
			undefined,
		);
	});

	test("does not invoke lazy code snapshot getters while rendering the UI", () => {
		let reads = 0;
		const details = { status: "ok", calls: 2 };
		Object.defineProperty(details, "state", {
			enumerable: true,
			get() {
				reads += 1;
				throw new Error("A large interpreter state was accessed by the UI");
			},
		});
		const original = {
			role: "toolResult",
			toolName: "code",
			details,
			content: [{ type: "text", text: "shown" }],
		};
		const [projected] = displayMessages([original]);
		assert.deepEqual(projected.details, { status: "ok", calls: 2 });
		const event = displayEvent({ type: "message_end", message: original });
		assert.deepEqual(event.message.details, { status: "ok", calls: 2 });
		assert.equal(reads, 0);
	});

	test("filters live results, final messages and repeated turn/agent events", () => {
		const msg = {
			role: "toolResult",
			toolName: "code",
			content: [{ type: "text", text: "ok" }],
			details: { state: "state", calls: 5 },
		};
		const inspect = (event) => {
			const projected = displayEvent(event);
			assert.equal(
				JSON.stringify(projected).includes('"state":"state"'),
				false,
			);
			assert.equal(JSON.stringify(event).includes('"state":"state"'), true);
			assert.equal(JSON.stringify(projected).includes('"calls":5'), true);
		};
		inspect({ type: "message_end", message: msg });
		inspect({ type: "message_start", message: msg });
		inspect({ type: "agent_end", messages: [msg] });
		inspect({
			type: "turn_end",
			message: { role: "assistant" },
			toolResults: [msg],
		});
		inspect({ type: "tool_execution_end", toolName: "code", result: msg });
		inspect({
			type: "tool_execution_update",
			toolName: "code",
			partialResult: msg,
		});
		const other = {
			type: "tool_execution_end",
			toolName: "read",
			result: { details: { state: "safe" } },
		};
		assert.strictEqual(displayEvent(other), other);
	});

	test("adds a separate RPC command without modifying the original command", () => {
		const piSource = readFileSync(
			path.resolve(
				"node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js",
			),
			"utf8",
		);
		const projected = patchPiRpcSource(
			piSource,
			"file:///tmp/pitty-display.js",
		);
		assert.ok(projected);
		assert.match(projected, /case "get_display_messages"/);
		assert.match(projected, /case "get_messages"/);
		assert.match(projected, /__pittyDisplayEvent\(toJsonEvent\(event\)\)/);
		assert.equal(
			patchPiRpcSource("unrecognized new RPC source", "file:///tmp/a.js"),
			undefined,
		);
	});

	test("starts unmodified Pi with an isolated synthetic session and transfers compact history", {
		skip: process.platform === "win32",
	}, async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "pitty-display-rpc-"));
		const file = path.join(dir, "fixture.jsonl");
		const now = new Date().toISOString();
		const id = randomUUID(),
			userId = randomUUID(),
			assistantId = randomUUID(),
			resultId = randomUUID(),
			call = randomUUID();
		const state = "Z".repeat(1_000_000);
		const rows = [
			{ type: "session", version: 3, id, timestamp: now, cwd: dir },
			{
				type: "message",
				id: userId,
				parentId: null,
				timestamp: now,
				message: {
					role: "user",
					content: [{ type: "text", text: "compact session" }],
					timestamp: 1,
				},
			},
			{
				type: "message",
				id: assistantId,
				parentId: userId,
				timestamp: now,
				message: {
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: call,
							name: "code",
							arguments: { code: "1+2" },
						},
					],
					stopReason: "toolUse",
					api: "openai-responses",
					provider: "test",
					model: "test",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
					},
					timestamp: 2,
				},
			},
			{
				type: "message",
				id: resultId,
				parentId: assistantId,
				timestamp: now,
				message: {
					role: "toolResult",
					toolCallId: call,
					toolName: "code",
					content: [{ type: "text", text: "expected visible text" }],
					details: { state, calls: 1, status: "ok" },
					isError: false,
					timestamp: 3,
				},
			},
		];
		writeFileSync(
			file,
			rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
		);
		const commands = [];
		const logger = {
			info() {},
			warn() {},
			error() {},
			debug() {},
			rpc(direction, value) {
				if (direction === "tx") commands.push(value.type);
			},
		};
		const client = new PiRpcClient({
			cwd: dir,
			executable: path.resolve(
				"node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
			),
			args: ["--no-extensions", "--session", file],
			env: { PI_CODING_AGENT_DIR: path.join(dir, "agent") },
			requestTimeoutMs: 30_000,
			logger,
		});
		try {
			await client.start();
			const messages = await client.getMessages(30_000);
			assert.equal(messages.length, 3);
			assert.equal(messages.at(-1).details?.state, undefined);
			assert.equal(messages.at(-1).details?.calls, 1);
			assert.equal(messages.at(-1).content[0].text, "expected visible text");
			assert.deepEqual(
				commands.filter(
					(command) =>
						command === "get_messages" || command === "get_display_messages",
				),
				["get_display_messages"],
			);
			assert.ok(readFileSync(file, "utf8").includes(state));
		} finally {
			await client.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
