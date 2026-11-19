import { describe, expect, test } from "bun:test";
import { DiagnosticLogger } from "../src/diagnostics/logger.ts";
import type { QueueState, QueuedMessage } from "../src/rpc/queue-types.ts";
import { createInputActions, type InputActionsPorts } from "../src/tabs/input-actions.ts";
import { ConversationModel } from "../src/state/conversation.ts";
import { createTabRuntime } from "../src/tabs/runtime.ts";

function fixture(messages: QueuedMessage[] = []) {
	const runtime = createTabRuntime({ id: "active", cwd: process.cwd() });
	runtime.startupResolved = true;
	runtime.conversation.isStreaming = true;
	runtime.conversation.applyQueueState({ revision: 1, messages });
	let draft = "";
	const notices: string[] = [];
	const prompts: Array<{ text: string; behavior?: string | undefined; id?: string | undefined }> = [];
	let aborts = 0;
	runtime.client.prompt = async (text, behavior, id) => { prompts.push({ text, behavior, id }); };
	runtime.client.followUp = async (text, id) => { prompts.push({ text, behavior: "followUp", id }); };
	runtime.client.abort = async () => { aborts++; };
	const ports: InputActionsPorts = {
		logger: new DiagnosticLogger({ enabled: false }),
		tabRuntimeIsActive: (id) => id === runtime.id,
		trimMessageWindowIfFollowingLatest() {}, conversationTouch() {}, scrollToBottom() {},
		clearRuntimeMainDraftIfMatches(_runtime, expected) { if (draft.trim() === expected.trim()) draft = ""; },
		toast(text) { notices.push(text); },
		activeRuntime: () => runtime, startupPhase: () => ({ kind: "ready" }), dialog: () => undefined,
		expandedPromptText: () => draft, handleSlashCommand: async () => false,
		clearMainDraft() { draft = ""; }, syncMainDraft(text) { draft = text; },
		syncRuntimeMainDraft(_runtime, text) { draft = text; },
		touch() {}, getPrompt: () => undefined, queuedFollowUps: () => runtime.queuedFollowUps,
	};
	const actions = createInputActions(ports);
	return { runtime, actions, prompts, notices, get draft() { return draft; }, set draft(text: string) { draft = text; }, get aborts() { return aborts; } };
}

const one: QueuedMessage = { id: "one", mode: "steer", message: "first" };
const two: QueuedMessage = { id: "two", mode: "steer", message: "second" };

describe("pending message actions", () => {
	test("identical delivered messages remain separate while each start/end pair stays one row", () => {
		const model = new ConversationModel();
		const message = { role: "user" as const, content: [{ type: "text" as const, text: "same" }], timestamp: 100 };
		for (let i = 0; i < 2; i++) {
			model.apply({ type: "message_start", message });
			model.apply({ type: "message_end", message: { ...message, timestamp: 101 } });
		}
		expect(model.items.filter((item) => item.kind === "user")).toHaveLength(2);
		expect(new Set(model.items.map((item) => item.id)).size).toBe(2);
	});
	test("back-to-back managed submits before agent_start queue safely without ghost transcript rows", async () => {
		const f = fixture();
		f.runtime.conversation.isStreaming = false;
		let finish = () => {};
		const gate = new Promise<void>((resolve) => { finish = resolve; });
		f.runtime.client.prompt = async (text, behavior, id) => {
			f.prompts.push({ text, behavior, id });
			if (text === "first") await gate;
			else f.runtime.conversation.applyQueueState({
				revision: 2, messages: [{ id: id!, mode: "steer", message: text }],
			});
		};
		f.draft = "first";
		const first = f.actions.submit();
		await Promise.resolve();
		f.draft = "second";
		await f.actions.submit();
		expect(f.prompts.map((entry) => entry.behavior)).toEqual(["steer", "steer"]);
		expect(f.runtime.conversation.items.filter((item) => item.kind === "user")).toEqual([]);
		f.runtime.client.removeQueuedMessage = async () => ({ revision: 3, messages: [] });
		await f.actions.queuedInput.cancel(f.actions.queuedInput.messages()[0]!);
		finish();
		await first;
		expect(f.runtime.conversation.items.filter((item) => item.kind === "user")).toEqual([]);
	});
	test("compaction accepts consecutive messages and clears each acknowledged draft", async () => {
		const f = fixture();
		f.runtime.conversation.isCompacting = true;
		f.draft = "first";
		await f.actions.submit();
		expect(f.draft).toBe("");
		await f.actions.submit();
		f.draft = "second";
		await f.actions.submit();
		expect(f.prompts.map((entry) => [entry.text, entry.behavior])).toEqual([["first", "steer"], ["second", "steer"]]);
		expect(new Set(f.prompts.map((entry) => entry.id)).size).toBe(2);
		expect(f.runtime.queuedFollowUps).toEqual([]);
	});

	test("old Pi compaction fallback clears the accepted draft instead of duplicating it", async () => {
		const f = fixture();
		f.runtime.conversation.queue = undefined;
		f.runtime.conversation.isCompacting = true;
		f.draft = "during compaction";
		await f.actions.submit();
		await f.actions.submit();
		expect(f.runtime.queuedFollowUps.map((item) => item.text)).toEqual(["during compaction"]);
		expect(f.prompts).toEqual([]);
		expect(f.draft).toBe("");
	});

	test("allows another draft while rejecting repeated Enter before acknowledgment", async () => {
		const f = fixture();
		let finish = () => {};
		const gate = new Promise<void>((resolve) => { finish = resolve; });
		f.runtime.client.prompt = async (text, behavior, id) => { f.prompts.push({ text, behavior, id }); await gate; };
		f.draft = "first";
		const first = f.actions.submit();
		await Promise.resolve();
		await f.actions.submit();
		f.draft = "second";
		const second = f.actions.submit();
		await Promise.resolve();
		expect(f.prompts.map((entry) => entry.text)).toEqual(["first", "second"]);
		finish();
		await Promise.all([first, second]);
		expect(f.draft).toBe("");
		expect(f.runtime.submitInFlight).toBe(false);
	});

	test("RPC rejection preserves the unsent draft", async () => {
		const f = fixture();
		f.runtime.client.prompt = async () => { throw new Error("Queue rejected"); };
		f.draft = "keep this";
		await f.actions.submit();
		expect(f.draft).toBe("keep this");
		expect(f.runtime.conversation.items.some((item) => item.kind === "system" && item.text === "Queue rejected")).toBe(true);
	});

	test("Alt+Enter uses the authoritative follow-up queue when supported", async () => {
		const f = fixture();
		f.draft = "later";
		f.actions.queueFollowUp();
		await Promise.resolve();
		expect(f.prompts[0]?.behavior).toBe("followUp");
		expect(f.prompts[0]?.id).toBeTruthy();
		expect(f.runtime.queuedFollowUps).toEqual([]);
		expect(f.draft).toBe("");
	});

	test("edit saves by ID and restores the previous composer draft", async () => {
		const f = fixture([one, two]);
		const calls: unknown[] = [];
		f.runtime.client.updateQueuedMessage = async (id, message, revision) => {
			calls.push([id, message, revision]);
			return { revision: 2, messages: [{ ...one, message }, two] };
		};
		f.draft = "unfinished new prompt";
		f.actions.queuedInput.edit(f.actions.queuedInput.messages()[0]!);
		expect(f.draft).toBe("first");
		expect(f.runtime.conversation.queue?.messages).toEqual([one, two]);
		f.draft = "revised";
		await f.actions.submit();
		expect(calls).toEqual([["one", "revised", 1]]);
		expect(f.runtime.conversation.queue?.messages[0]?.message).toBe("revised");
		expect(f.draft).toBe("unfinished new prompt");
		expect(f.runtime.pendingInputEdit).toBeUndefined();
		expect(f.prompts).toEqual([]);
	});

	test("cancel edit changes no queued message and restores prior draft", () => {
		const f = fixture([one]);
		f.draft = "prior";
		f.actions.restoreQueuedFollowUp();
		f.draft = "discard edit";
		f.actions.queuedInput.cancelEdit();
		expect(f.draft).toBe("prior");
		expect(f.runtime.conversation.queue?.messages).toEqual([one]);
		expect(f.aborts).toBe(0);
	});

	test("consumed message rejects edit and keeps the unsent changed text", async () => {
		const f = fixture([one]);
		f.actions.restoreQueuedFollowUp();
		f.draft = "changed";
		f.runtime.conversation.applyQueueState({ revision: 2, messages: [] });
		await f.actions.submit();
		expect(f.draft).toBe("changed");
		expect(f.runtime.pendingInputEdit?.id).toBe("one");
		expect(f.notices.at(-1)).toContain("no longer queued");
		expect(f.prompts).toEqual([]);
	});

	test("stale mutation response cannot resurrect a message consumed by a newer event", async () => {
		const f = fixture([one]);
		f.runtime.client.updateQueuedMessage = async (_id, message) => {
			f.runtime.conversation.applyQueueState({ revision: 3, messages: [] });
			return { revision: 2, messages: [{ ...one, message }] };
		};
		f.actions.restoreQueuedFollowUp();
		f.draft = "revised";
		await f.actions.submit();
		expect(f.runtime.conversation.queue).toEqual({ revision: 3, messages: [] });
	});

	test("typing while Save waits is preserved as an unsent draft", async () => {
		const f = fixture([one]);
		let finish = (_value: QueueState) => {};
		f.runtime.client.updateQueuedMessage = async () => new Promise<QueueState>((resolve) => { finish = resolve; });
		f.actions.restoreQueuedFollowUp();
		f.draft = "revision one";
		const save = f.actions.submit();
		f.draft = "another thought";
		finish({ revision: 2, messages: [{ ...one, message: "revision one" }] });
		await save;
		expect(f.draft).toBe("another thought");
		expect(f.runtime.pendingInputEdit).toBeUndefined();
	});

	test("cancel removes the selected ID without aborting work or removing repeated text", async () => {
		const second = { ...two, message: one.message };
		const f = fixture([one, second]);
		const calls: unknown[] = [];
		f.runtime.client.removeQueuedMessage = async (id, revision) => {
			calls.push([id, revision]);
			return { revision: 2, messages: [second] };
		};
		await f.actions.queuedInput.cancel(f.actions.queuedInput.messages()[0]!);
		expect(calls).toEqual([["one", 1]]);
		expect(f.runtime.conversation.queue?.messages).toEqual([second]);
		expect(f.aborts).toBe(0);
	});

	test("combine sends exactly two neighboring IDs and leaves different modes separate", async () => {
		const f = fixture([one, two, { id: "three", mode: "followUp", message: "later" }]);
		const calls: unknown[] = [];
		f.runtime.client.combineQueuedMessages = async (ids, revision) => {
			calls.push([ids, revision]);
			return { revision: 2, messages: [{ ...one, message: "first\n\nsecond" }, { id: "three", mode: "followUp", message: "later" }] };
		};
		await f.actions.queuedInput.combineWithNext(f.actions.queuedInput.messages()[0]!);
		expect(calls).toEqual([[["one", "two"], 1]]);
		await f.actions.queuedInput.combineWithNext(f.actions.queuedInput.messages()[0]!);
		expect(calls).toHaveLength(1);
		expect(f.notices.at(-1)).toContain("same delivery mode");
	});

	test("failed cancel retains pending state without claiming success", async () => {
		const f = fixture([one]);
		f.runtime.client.removeQueuedMessage = async () => { throw new Error("Message already being processed"); };
		await f.actions.queuedInput.cancel(f.actions.queuedInput.messages()[0]!);
		expect(f.runtime.conversation.queue?.messages).toEqual([one]);
		expect(f.notices).toEqual(["Message already being processed"]);
	});

	test("local follow-ups combine and cancel explicitly without sending or aborting", async () => {
		const f = fixture();
		f.runtime.conversation.queue = undefined;
		f.runtime.queuedFollowUps = [{ id: "a", text: "first" }, { id: "b", text: "second" }];
		await f.actions.queuedInput.combineWithNext(f.actions.queuedInput.messages()[0]!);
		expect(f.runtime.queuedFollowUps).toEqual([{ id: "a", text: "first\n\nsecond" }]);
		await f.actions.queuedInput.cancel(f.actions.queuedInput.messages()[0]!);
		expect(f.runtime.queuedFollowUps).toEqual([]);
		expect(f.prompts).toEqual([]);
		expect(f.aborts).toBe(0);
	});
});
