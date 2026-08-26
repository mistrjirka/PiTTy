import { describe, expect, test } from "bun:test";
import { createTabRuntime, planForkTab, resolveTabDraftSwitch, startTabRuntime } from "../src/tabs/runtime.ts";
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

describe("tab runtime factory", () => {
	test("creates isolated clients, models, drafts, and expansion state", () => {
		const first = createTabRuntime({ id: "one", cwd: process.cwd() });
		const second = createTabRuntime({ id: "two", cwd: process.cwd() });
		expect(first.client).not.toBe(second.client);
		expect(first.conversation).not.toBe(second.conversation);
		expect(first.drafts).not.toBe(second.drafts);
		expect(first.expandedToolIds).not.toBe(second.expandedToolIds);
	});

	test("stores distinct session files across interleaved state updates", async () => {
		const first = createTabRuntime({ id: "first", cwd: process.cwd(), client: new StubClient(state("/tmp/one.jsonl", "one")) });
		const second = createTabRuntime({ id: "second", cwd: process.cwd(), client: new StubClient(state("/tmp/two.jsonl", "two")) });
		await startTabRuntime(first); await startTabRuntime(second);
		expect(first.sessionState?.sessionFile).toBe("/tmp/one.jsonl");
		expect(second.sessionState?.sessionFile).toBe("/tmp/two.jsonl");
		expect(first.sessionState?.sessionFile).not.toBe(second.sessionState?.sessionFile);
	});

	test("keeps tab models isolated when another client exits", () => {
		const firstClient = new StubClient(state("/tmp/a.jsonl", "a"));
		const secondClient = new StubClient(state("/tmp/b.jsonl", "b"));
		const first = createTabRuntime({ id: "first", cwd: process.cwd(), client: firstClient });
		const second = createTabRuntime({ id: "second", cwd: process.cwd(), client: secondClient });
		firstClient.emit("exit", new Error("tab A stopped"));
		secondClient.deliver({ type: "compaction_start" });
		expect(first.lastError?.message).toBe("tab A stopped");
		expect(second.conversation.items.length).toBeGreaterThan(0);
		expect(second.conversation.items).not.toBe(first.conversation.items);
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
