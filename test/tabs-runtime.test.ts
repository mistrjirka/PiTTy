import { describe, expect, test } from "bun:test";
import { blankTabPiArgs, createTabRuntime, planForkTab, prepareForkedTabRuntime, refreshRuntimeEntries, resolveTabDraftSwitch, sessionFilePiArgs, startTabRuntime } from "../src/tabs/runtime.ts";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import type { RpcSessionState } from "../src/types.ts";

const state = (sessionFile: string, sessionId: string): RpcSessionState => ({
	sessionFile, sessionId, thinkingLevel: "low", isStreaming: false, isCompacting: false,
	steeringMode: "all", followUpMode: "all", autoCompactionEnabled: true,
	messageCount: 0, pendingMessageCount: 0,
});

class StubClient extends PiRpcClient {
	private readonly eventCallbacks: Array<(event: Record<string, unknown>) => void> = [];
	constructor(private readonly response: RpcSessionState) { super({ cwd: process.cwd() }); }
	async start(): Promise<void> {}
	async getState(): Promise<RpcSessionState> { return this.response; }
	onEvent(listener: (event: Record<string, unknown>) => void): () => void { this.eventCallbacks.push(listener); return () => {}; }
	deliver(event: Record<string, unknown>): void { for (const listener of this.eventCallbacks) listener(event); }
}

class DelayedEntryClient extends StubClient {
	private resolveMessages!: (messages: Array<{ entryId: string; text: string }>) => void;
	private readonly messages = new Promise<Array<{ entryId: string; text: string }>>((resolve) => {
		this.resolveMessages = resolve;
	});

	override async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		return this.messages;
	}

	release(messages: Array<{ entryId: string; text: string }>): void {
		this.resolveMessages(messages);
	}
}

class ForkStubClient extends PiRpcClient {
	readonly calls: string[] = [];
	private stateIndex = 0;

	constructor(
		private readonly states: readonly RpcSessionState[],
		private readonly messages: unknown[],
		private readonly cancelled = false,
	) {
		super({ cwd: process.cwd() });
	}

	async start(): Promise<void> { this.calls.push("start"); }
	async getState(): Promise<RpcSessionState> {
		this.calls.push("getState");
		const value = this.states[Math.min(this.stateIndex, this.states.length - 1)];
		this.stateIndex += 1;
		if (!value) throw new Error("missing state fixture");
		return value;
	}
	async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
		this.calls.push(`fork:${entryId}`);
		return { text: "selected prompt", cancelled: this.cancelled };
	}
	async getMessages(): Promise<unknown[]> {
		this.calls.push("getMessages");
		return this.messages;
	}
	async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		this.calls.push("getForkMessages");
		return [{ entryId: "entry-1", text: "selected prompt" }];
	}
	async stop(): Promise<void> { this.calls.push("stop"); }
}

describe("tab runtime factory", () => {
	test("removes startup session selectors for blank tabs while preserving other Pi args", () => {
		expect(blankTabPiArgs(["--extension", "observer", "--continue", "--session", "/tmp/source.jsonl", "--model", "gpt", "--", "-c", "--session=keep"])).toEqual(["--extension", "observer", "--model", "gpt", "--", "-c", "--session=keep"]);
		expect(blankTabPiArgs(["-c", "-s", "/tmp/source.jsonl", "-m", "gpt"])).toEqual(["-m", "gpt"]);
		expect(blankTabPiArgs(["--session", "--", "--session=after"])).toEqual(["--", "--session=after"]);
		expect(sessionFilePiArgs(["--extension", "observer", "--", "custom-arg"], "/tmp/fork.jsonl")).toEqual(["--extension", "observer", "--session", "/tmp/fork.jsonl", "--", "custom-arg"]);
	});

	test("sessionFilePiArgs drops continue/resume flags when forcing a session file", () => {
		expect(sessionFilePiArgs(["--continue", "-c", "--resume", "-r", "--model", "gpt"], "/tmp/fork.jsonl")).toEqual(["--model", "gpt", "--session", "/tmp/fork.jsonl"]);
		expect(sessionFilePiArgs(["-c", "--", "--custom"], "/tmp/fork.jsonl")).toEqual(["--session", "/tmp/fork.jsonl", "--", "--custom"]);
	});

	test("creates isolated clients, models, drafts, and expansion state", () => {
		const first = createTabRuntime({ id: "one", cwd: process.cwd() });
		const second = createTabRuntime({ id: "two", cwd: process.cwd() });
		expect(first.client).not.toBe(second.client);
		expect(first.conversation).not.toBe(second.conversation);
		expect(first.drafts).not.toBe(second.drafts);
		expect(first.expandedToolIds).not.toBe(second.expandedToolIds);
		first.inspectSubagent = true;
		first.selectedTargetKey = "target-a";
		expect(second.inspectSubagent).toBe(false);
		expect(second.selectedTargetKey).toBeUndefined();
	});

	test("records settled request timing separately from model performance", async () => {
		const client = new StubClient(state("/tmp/timing.jsonl", "timing"));
		const runtime = createTabRuntime({
			id: "timing",
			cwd: process.cwd(),
			client,
		});
		client.deliver({ type: "agent_start" });
		await Bun.sleep(2);
		client.deliver({ type: "turn_start" });
		client.deliver({
			type: "message_start",
			message: { role: "assistant", provider: "openai", model: "gpt-5" },
		});
		client.deliver({
			type: "message_update",
			assistantMessageEvent: { type: "toolcall_start" },
		});
		client.deliver({ type: "tool_execution_start", toolCallId: "tool" });
		await Bun.sleep(2);
		client.deliver({ type: "tool_execution_end", toolCallId: "tool" });
		client.deliver({ type: "turn_end" });
		client.deliver({ type: "agent_settled" });

		expect(runtime.lastRequestTiming?.provider).toBe("openai");
		expect(runtime.lastRequestTiming?.modelId).toBe("gpt-5");
		expect(runtime.lastRequestTiming?.requestMs).toBeGreaterThan(0);
		expect(runtime.lastRequestTiming?.toolCallDurationsMs).toHaveLength(1);
		expect(runtime.timingHistory).toHaveLength(1);
		runtime.messageUpdates.dispose();
	});

	test("stores distinct session files across interleaved state updates", async () => {
		const first = createTabRuntime({ id: "first", cwd: process.cwd(), client: new StubClient(state("/tmp/one.jsonl", "one")) });
		const second = createTabRuntime({ id: "second", cwd: process.cwd(), client: new StubClient(state("/tmp/two.jsonl", "two")) });
		await startTabRuntime(first); await startTabRuntime(second);
		expect(first.sessionState?.sessionFile).toBe("/tmp/one.jsonl");
		expect(second.sessionState?.sessionFile).toBe("/tmp/two.jsonl");
		expect(first.sessionState?.sessionFile).not.toBe(second.sessionState?.sessionFile);
	});

	test("flushes message batches before boundaries without transcript invalidation from extensions", () => {
		const client = new StubClient(state("/tmp/messages.jsonl", "messages"));
		const eventTypes: string[] = [];
		let conversationChanges = 0;
		const runtime = createTabRuntime({
			id: "messages",
			cwd: process.cwd(),
			client,
			onEvent: (event) => eventTypes.push(String(event.type)),
			onConversationChange: () => { conversationChanges += 1; },
		});
		client.deliver({ type: "message_start", message: { role: "assistant", content: [], timestamp: 1 } });
		client.deliver({ type: "message_update", message: { role: "assistant", content: [], timestamp: 1 }, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "a" } });
		client.deliver({ type: "message_update", message: { role: "assistant", content: [], timestamp: 1 }, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "b" } });
		client.deliver({ type: "extension_ui_request", id: "extension", method: "setWidget" });

		expect(eventTypes).toEqual([
			"message_start",
			"message_update",
			"message_update",
			"extension_ui_request",
		]);
		expect(conversationChanges).toBe(2);
		const assistant = runtime.conversation.items[0];
		if (!assistant || assistant.kind !== "assistant")
			throw new Error("buffered assistant missing");
		expect(assistant.text).toBe("ab");
		runtime.messageUpdates.dispose();
	});

	test("keeps cumulative tool updates on the tool coalescer path", () => {
		const client = new StubClient(state("/tmp/tools.jsonl", "tools"));
		let conversationChanges = 0;
		const runtime = createTabRuntime({
			id: "tools",
			cwd: process.cwd(),
			client,
			onConversationChange: () => { conversationChanges += 1; },
		});
		client.deliver({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: { command: "printf" } });
		client.deliver({ type: "tool_execution_update", toolCallId: "tool-1", toolName: "bash", partialResult: { content: [{ type: "text", text: "first" }] } });
		client.deliver({ type: "tool_execution_update", toolCallId: "tool-1", toolName: "bash", partialResult: { content: [{ type: "text", text: "latest" }] } });
		client.deliver({ type: "extension_ui_request", id: "extension", method: "setWidget" });

		expect(conversationChanges).toBe(1);
		runtime.coalescer.flush();
		expect(conversationChanges).toBe(2);
		const tool = runtime.conversation.items.find((item) => item.kind === "tool");
		if (!tool || tool.kind !== "tool") throw new Error("tool fixture missing");
		expect(tool.output).toBe("latest");
		runtime.messageUpdates.dispose();
	});

	test("prepares a populated fork without touching the source runtime", async () => {
		const sourceClient = new ForkStubClient(
			[state("/tmp/source.jsonl", "source")],
			[],
		);
		const provisionalClient = new ForkStubClient(
			[
				state("/tmp/source.jsonl", "source-copy"),
				state("/tmp/forked.jsonl", "forked"),
			],
			[
				{
					role: "user",
					content: [{ type: "text", text: "selected prompt" }],
					timestamp: 1,
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "forked answer" }],
					timestamp: 2,
				},
			],
		);
		const source = createTabRuntime({ id: "source", cwd: process.cwd(), client: sourceClient });
		const provisional = createTabRuntime({ id: "fork", cwd: process.cwd(), client: provisionalClient });

		const result = await prepareForkedTabRuntime(provisional, "entry-1");

		expect(sourceClient.calls).toEqual([]);
		expect(source.conversation.items).toEqual([]);
		expect(provisionalClient.calls).toEqual([
			"start",
			"getState",
			"fork:entry-1",
			"getState",
			"getMessages",
			"getForkMessages",
		]);
		expect(result.sessionFile).toBe("/tmp/forked.jsonl");
		expect(provisional.sessionState?.sessionId).toBe("forked");
		expect(provisional.conversation.items.map((item) => item.kind)).toEqual([
			"user",
			"assistant",
		]);
		const firstItem = provisional.conversation.items[0];
		if (!firstItem || firstItem.kind !== "user")
			throw new Error("fork fixture missing user message");
		expect(firstItem.entryId).toBe("entry-1");
	});

	test("stops fork preparation before history loading when Pi cancels", async () => {
		const client = new ForkStubClient(
			[state("/tmp/source.jsonl", "source-copy")],
			[],
			true,
		);
		const runtime = createTabRuntime({ id: "fork", cwd: process.cwd(), client });

		await expect(prepareForkedTabRuntime(runtime, "entry-1")).rejects.toThrow(
			"Fork cancelled.",
		);
		await Bun.sleep(0);
		expect(client.calls).toEqual(["start", "getState", "fork:entry-1"]);
		expect(runtime.conversation.items).toEqual([]);
	});

	test("keeps tab models isolated when another client exits", () => {
		const firstClient = new StubClient(state("/tmp/a.jsonl", "a"));
		const secondClient = new StubClient(state("/tmp/b.jsonl", "b"));
		const first = createTabRuntime({ id: "first", cwd: process.cwd(), client: firstClient });
		const second = createTabRuntime({ id: "second", cwd: process.cwd(), client: secondClient });
		first.conversation.isStreaming = true;
		first.conversation.isCompacting = true;
		first.compactionTelemetry = { version: 1, phase: "preparing" };
		first.smartCompactProgress = "Smart Compact 1/5 · Extract";
		firstClient.emit("exit", new Error("tab A stopped"));
		secondClient.deliver({ type: "compaction_start" });
		expect(first.lastError?.message).toBe("tab A stopped");
		expect(first.conversation.isStreaming).toBe(false);
		expect(first.conversation.isCompacting).toBe(false);
		expect(first.compactionTelemetry).toBeUndefined();
		expect(first.smartCompactProgress).toBeUndefined();
		expect(second.conversation.items.length).toBeGreaterThan(0);
		expect(second.conversation.items).not.toBe(first.conversation.items);
	});

	test("does not synthesize settlement for recoverable protocol errors", () => {
		const client = new StubClient(state("/tmp/protocol.jsonl", "protocol"));
		const runtime = createTabRuntime({ id: "protocol", cwd: process.cwd(), client });
		runtime.conversation.isStreaming = true;
		runtime.conversation.isCompacting = true;
		const version = runtime.eventVersion;
		client.emit("protocol-error", new Error("malformed event"));
		expect(runtime.eventVersion).toBe(version + 1);
		expect(runtime.conversation.isStreaming).toBe(true);
		expect(runtime.conversation.isCompacting).toBe(true);
		expect(runtime.lastError?.message).toBe("malformed event");
	});

	test("discards an entry refresh after a newer runtime event", async () => {
		const client = new DelayedEntryClient(state("/tmp/entries.jsonl", "entries"));
		const runtime = createTabRuntime({ id: "entries", cwd: process.cwd(), client });
		runtime.conversation.optimisticUser("hello");
		const pending = refreshRuntimeEntries(runtime);
		client.deliver({ type: "agent_start" });
		client.release([{ entryId: "entry-1", text: "hello" }]);
		await pending;
		expect(runtime.entryIndex.idFor(0)).toBeUndefined();
	});

	test("restores the target draft without an activation echo", () => {
		expect(resolveTabDraftSwitch("old editor", "target draft")).toEqual({ editorText: "target draft" });
		expect(resolveTabDraftSwitch("old editor", "")).toEqual({ editorText: "" });
	});

	test("keeps the target draft when an echo arrives between activation and setText", () => {
		const target = resolveTabDraftSwitch("stale editor", "saved target");
		expect(target.editorText).toBe("saved target");
	});

	test("plans branched and original tabs while respecting the cap", () => {
		const plan = planForkTab("/tmp/original.jsonl", "/tmp/branched.jsonl", 2);
		expect(plan.canCreate).toBe(true);
		expect(plan.originalSessionFile).toBe("/tmp/original.jsonl");
		expect(plan.branchedSessionFile).toBe("/tmp/branched.jsonl");
		expect(planForkTab("/tmp/original.jsonl", "/tmp/branched.jsonl", 8).canCreate).toBe(false);
	});
});
