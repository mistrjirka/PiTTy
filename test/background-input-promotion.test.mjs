import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import backgroundInputPromotion, { promoteForegroundCommands } from "../src/pi-extensions/bg-input-promotion.mjs";

const KEY = Symbol.for("pi-bg-bash.registry");
const SESSION = "test-session";
const original = globalThis[KEY];
afterEach(() => {
	if (original === undefined) delete globalThis[KEY];
	else globalThis[KEY] = original;
});

function registry(sessionId = SESSION) {
	return {
		ctx: { sessionManager: { getSessionId: () => sessionId } },
		foreground: new Set(),
		tasks: new Map(),
		launching: new Set(),
	};
}

function foreground(state, id = "bg-1") {
	const task = { id, ownerSessionId: SESSION, pid: 1234, toolCallId: "call-" + id, startedAt: 1_000 };
	let count = 0;
	const run = {
		promote() {
			count++;
			state.tasks.set(id, task);
			state.foreground.delete(run);
		},
	};
	state.foreground.add(run);
	return { task, count: () => count };
}

function handlersFor(state) {
	globalThis[KEY] = state;
	const handlers = new Map();
	backgroundInputPromotion({ on(name, handler) { handlers.set(name, handler); } });
	return handlers;
}

describe("background handoff after accepted input", () => {
	it("does nothing without the plugin or for another session", async () => {
		assert.deepEqual(await promoteForegroundCommands(undefined, SESSION), []);
		const state = registry("other-session");
		const run = foreground(state);
		assert.deepEqual(await promoteForegroundCommands(state, SESSION), []);
		assert.equal(run.count(), 0);
		assert.equal(state.foreground.size, 1);
	});

	it("promotes every current foreground call once using its existing handle", async () => {
		const state = registry();
		const first = foreground(state, "bg-1");
		const second = foreground(state, "bg-2");
		const tasks = await promoteForegroundCommands(state, SESSION);
		assert.deepEqual(tasks, [first.task, second.task]);
		assert.equal(first.count(), 1);
		assert.equal(second.count(), 1);
		assert.deepEqual(await promoteForegroundCommands(state, SESSION), []);
		assert.equal(first.count(), 1);
	});

	it("waits for an in-progress spawn to register before promoting", async () => {
		const state = registry();
		let releaseSpawn, completeLaunch;
		const spawn = new Promise((resolve) => { releaseSpawn = resolve; });
		const launching = new Promise((resolve) => { completeLaunch = resolve; });
		state.launching.add(launching);
		async function launch() {
			try { await spawn; return 1234; }
			finally { state.launching.delete(launching); completeLaunch(); }
		}
		let run;
		const operation = (async () => { await launch(); run = foreground(state); })();
		const promotion = promoteForegroundCommands(state, SESSION);
		assert.equal(state.tasks.size, 0);
		releaseSpawn();
		await operation;
		assert.deepEqual(await promotion, [run.task]);
		assert.equal(run.count(), 1);
	});

	it("does not promote after a session changes while a spawn is pending", async () => {
		const state = registry();
		const run = foreground(state);
		let release;
		state.launching.add(new Promise((resolve) => { release = resolve; }));
		const promotion = promoteForegroundCommands(state, SESSION);
		state.ctx = { sessionManager: { getSessionId: () => "different-session" } };
		release();
		assert.deepEqual(await promotion, []);
		assert.equal(run.count(), 0);
	});

	it("uses accepted RPC input and keeps the tool result reason truthful", async () => {
		const state = registry();
		const run = foreground(state);
		globalThis[KEY] = state;
		const handlers = new Map();
		backgroundInputPromotion({ on(name, handler) { handlers.set(name, handler); } });
		assert.equal(handlers.has("input"), false);
		await handlers.get("input_queued")({ source: "extension" }, state.ctx);
		assert.equal(run.count(), 0);
		await handlers.get("input_queued")({ source: "rpc", mode: "steer" }, state.ctx);
		assert.equal(run.count(), 1);
		run.task.toolCallId = "outer-code/1";
		const structuredContent = { output: "hello", task_id: run.task.id, truncated: false };
		const result = handlers.get("tool_result")({
			toolName: "bash", toolCallId: run.task.toolCallId, parentToolCallId: "outer-code",
			input: { command: "command", timeout: 30 },
			content: [{ type: "text", text: "The user pressed ctrl+shift+b after 2.1 s: this command keeps running.\nOutput so far:\nhello" }],
			structuredContent,
		});
		assert.equal(result.structuredContent, structuredContent);
		assert.equal(run.task.deadline, 31_000);
		assert.equal(result.content[0].text,
			"A new user message arrived: this command keeps running.\nOutput so far:\nhello");
		assert.equal(handlers.get("tool_result")({
			toolName: "bash", toolCallId: run.task.toolCallId,
			content: [{ type: "text", text: "Unrelated result" }],
		}), undefined);
	});

	it("preserves the original deadline instead of restarting timeout at promotion", async () => {
		const state = registry();
		const run = foreground(state);
		const handlers = handlersFor(state);
		await handlers.get("input_queued")({ source: "rpc" }, state.ctx);
		// The actual start precedes promotion. This must not use Date.now().
		assert.ok(run.task.startedAt < Date.now());
		const result = handlers.get("tool_result")({
			toolName: "bash", toolCallId: run.task.toolCallId,
			input: { timeout: 7200 },
			content: [{ type: "text", text: "Output without the shortcut prefix" }],
		});
		assert.equal(run.task.deadline, 7_201_000);
		assert.equal(run.task.pid, 1234);
		assert.equal(run.count(), 1);
		assert.equal(result, undefined);
	});

	it("never extends an existing deadline when retaining the declared timeout", async () => {
		for (const [previous, expected] of [[5_000, 5_000], [50_000, 21_000]]) {
			const state = registry();
			const run = foreground(state);
			run.task.deadline = previous;
			const handlers = handlersFor(state);
			await handlers.get("input_queued")({ source: "rpc" }, state.ctx);
			handlers.get("tool_result")({
				toolName: "bash", toolCallId: run.task.toolCallId,
				input: { timeout: 20, waitFor: "ready" }, content: [],
			});
			assert.equal(run.task.deadline, expected);
		}
	});

	it("does not invent a deadline without a valid declared timeout", async () => {
		for (const timeout of [undefined, 0, -1, "20", Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) {
			const state = registry();
			const run = foreground(state);
			const handlers = handlersFor(state);
			await handlers.get("input_queued")({ source: "rpc" }, state.ctx);
			handlers.get("tool_result")({
				toolName: "bash", toolCallId: run.task.toolCallId,
				input: { timeout }, content: [],
			});
			assert.equal(run.task.deadline, undefined);
		}
	});
});
