import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSessionMessages } from "../src/subagents/transcript-reader-records.ts";
import { createSignal } from "solid-js";
import type { ToolItem } from "../src/types.ts";
import { ConversationModel, initialItems, isConversationEvent } from "../src/state/conversation.ts";
import { displayToolOutput, toolDisplayState } from "../src/state/code-tool-presentation.ts";
import { ToolEventCoalescer } from "../src/state/tool-event-coalescer.ts";
import { MessageView } from "../src/ui/message.tsx";
import { toolStatusGlyph } from "../src/ui/message-format.tsx";
import { PendingInputPanel } from "../src/ui/pending-input-panel.tsx";
import type { PendingInputItem, QueuedInputActions } from "../src/tabs/queued-input-actions.ts";
import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();
const cellId = "11111111-1111-4111-8111-111111111111";
const text = (value: string) => [{ type: "text", text: value }];
function result(status: string, output: string, cellStatus = status === "running" ? "running" : "complete"): {
	content: ReturnType<typeof text>;
	details: { status: string; cell: { id: string; status: string }; historical?: boolean };
} {
	return { content: text(output), details: { status, cell: { id: cellId, status: cellStatus } } };
}
function apply(model: ConversationModel, event: Record<string, unknown>) { model.apply(event); }
function start(model: ConversationModel, callId = "code-run", args: unknown = { code: 'print("before")' }) {
	apply(model, { type: "tool_execution_start", toolCallId: callId, toolName: "code", args });
}
function finish(model: ConversationModel, output: ReturnType<typeof result>, callId = "code-run") {
	apply(model, { type: "tool_execution_end", toolCallId: callId, toolName: "code", result: output, isError: false });
}
function tool(model: ConversationModel, callId = "code-run"): ToolItem {
	const item = model.items.find((entry) => entry.kind === "tool" && entry.toolCallId === callId);
	if (!item || item.kind !== "tool") throw new Error("Missing tool " + callId);
	return item;
}
function completion(output: ReturnType<typeof result>) {
	return { type: "entry_appended", entry: {
		type: "tool_completion", id: "completion", parentId: null, timestamp: new Date(1).toISOString(),
		toolCallId: "code-run", toolName: "code", result: output,
	} };
}

test("yielded code keeps bounded printed output and nested host work stays active until its own end", () => {
	const model = new ConversationModel();
	start(model);
	apply(model, { type: "tool_execution_update", toolCallId: "code-run", toolName: "code",
		partialResult: { content: text("before\n" + "x".repeat(20_000) + "\nlast"), details: { status: "ok" } } });
	apply(model, { type: "tool_execution_start", toolCallId: "code-run/1", parentToolCallId: "code-run",
		toolName: "read", args: { path: "held.txt" } });
	finish(model, result("running", "[running] Code cell " + cellId + " yielded; collect it with wait."));
	apply(model, { type: "agent_settled" });
	expect(toolStatusGlyph(tool(model)).glyph).toBe("↪");
	expect(toolDisplayState(tool(model))?.label).toBe("yielded");
	expect(tool(model).yieldedOutput?.length).toBeLessThanOrEqual(7168);
	expect(displayToolOutput(tool(model))).toContain("before");
	expect(displayToolOutput(tool(model))).toContain("last");
	expect(tool(model, "code-run/1").status).toBe("streaming");
	apply(model, { type: "tool_execution_end", toolCallId: "code-run/1", toolName: "read",
		result: { content: text("host output") }, isError: false });
	expect(tool(model, "code-run/1").status).toBe("done");
});

test("later collection reconciles the original receipt by cell id without copying final stdout twice", () => {
	const model = new ConversationModel();
	start(model);
	apply(model, { type: "tool_execution_update", toolCallId: "code-run",
		partialResult: { content: text("before"), details: { status: "ok" } } });
	finish(model, result("running", '[running] Collect with {"wait":"' + cellId + '"}.'));
	start(model, "code-wait", { wait: cellId });
	finish(model, result("suspended", 'before\n[paused] Use {"resume":true}.'), "code-wait");
	const original = tool(model);
	expect(original.yieldedOutput).toBeUndefined();
	expect(toolStatusGlyph(original).glyph).toBe("◷");
	expect(toolDisplayState(original)?.label).toBe("collected · paused");
	expect(displayToolOutput(original)).not.toContain('"wait"');
	expect(displayToolOutput(original)).not.toContain("before");
	expect(toolDisplayState(tool(model, "code-wait"))?.label).toBe("paused");
	expect(tool(model, "code-wait").output).toContain("before");
});

test("durable completion updates the original card and defeats a buffered stale stream update", async () => {
	const model = new ConversationModel();
	start(model);
	finish(model, result("running", "[running] awaiting collection"));
	const id = tool(model).id;
	const [item, setItem] = createSignal(tool(model));
	const setup = await mount(() => <MessageView item={item} showThinking toolExpanded />, 100, 35);
	try {
		expect(setup.captureCharFrame()).toContain("yielded");
		const updates = new ToolEventCoalescer({ applyEvent: (event) => apply(model, event) });
		updates.handle({ type: "tool_execution_update", toolCallId: "code-run", toolName: "code",
			partialResult: { content: text("stale progress"), details: { status: "ok" } } });
		const done = completion(result("suspended", "Finished host output\n[paused] Next call needs the new input."));
		expect(isConversationEvent(done)).toBe(true);
		updates.handle(done);
		updates.flush();
		setItem(tool(model));
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(tool(model).id).toBe(id);
		expect(tool(model).status).toBe("done");
		expect(frame).toContain("paused");
		expect(frame).toContain("Finished host output");
		expect(frame).not.toContain("yielded");
		expect(frame).not.toContain("stale progress");
		expect(model.items.filter((entry) => entry.kind === "tool")).toHaveLength(1);
	} finally { setup.renderer.destroy(); }
});

test("failed execution is an error even when the foreground wrapper returned successfully", () => {
	const model = new ConversationModel();
	start(model);
	finish(model, result("error", "Python failed"));
	expect(tool(model).isError).toBe(true);
	expect(tool(model).status).toBe("error");
	expect(toolStatusGlyph(tool(model)).glyph).toBe("✗");
	const restored = initialItems([{ role: "toolResult", toolCallId: "code-run", toolName: "code",
		...result("error", "Python failed"), isError: false }]);
	expect(restored[0]).toMatchObject({ status: "error", isError: true });
});

test("historical observations do not finish an active cell or show a live success badge", () => {
	const model = new ConversationModel();
	start(model);
	finish(model, result("running", "[running] active"));
	start(model, "old-handle", { wait: cellId });
	const saved = result("ok", "Historical result");
	finish(model, { ...saved, details: { ...saved.details, historical: true } }, "old-handle");
	expect(tool(model).codeCell?.status).toBe("running");
	expect(toolDisplayState(tool(model, "old-handle"))?.label).toBe("saved result");
	expect(toolStatusGlyph(tool(model, "old-handle")).glyph).toBe("·");
	const wrong = completion({ ...saved, details: { ...saved.details, cell: { id: "foreign-cell", status: "complete" } } });
	apply(model, wrong);
	expect(tool(model).output).toBe("[running] active");
});

test("restored completion stays terminal despite a later-position old running receipt", () => {
	const restored = initialItems([
		{ role: "toolResult", toolCallId: "code-run", toolName: "code", ...result("suspended", "checkpoint") },
		{ role: "toolResult", toolCallId: "code-wait", toolName: "code", ...result("running", "[running] earlier wait") },
	], { stableIds: true });
	const row = restored.find((entry) => entry.kind === "tool" && entry.toolCallId === "code-wait");
	expect(row?.kind).toBe("tool");
	if (!row || row.kind !== "tool") return;
	expect(row.codeCell?.status).toBe("complete");
	expect(toolDisplayState(row)?.label).toBe("collected · paused");
	expect(displayToolOutput(row)).not.toContain("[running]");
});

test("nested metadata attached at message_start is deduplicated and cannot replace real host stdout", () => {
	const model = new ConversationModel();
	start(model);
	apply(model, { type: "tool_execution_start", toolCallId: "code-run/1", parentToolCallId: "code-run",
		toolName: "read", args: { path: "file.txt" } });
	apply(model, { type: "tool_execution_end", toolCallId: "code-run/1", toolName: "read",
		result: { content: text("actual host stdout") }, isError: false });
	finish(model, result("ok", "summary"));
	const message = { role: "toolResult", toolCallId: "code-run", toolName: "code",
		...result("ok", "summary"), nestedCalls: { complete: true, calls: [
			{ id: "code-run/1", name: "read", status: "ok", arguments: { path: "file.txt" } },
		] } };
	apply(model, { type: "message_start", message });
	apply(model, { type: "message_end", message });
	expect(model.items.filter((entry) => entry.kind === "tool")).toHaveLength(2);
	expect(tool(model, "code-run/1").output).toBe("actual host stdout");
	expect(tool(model, "code-run/1").recordedNestedStatus).toBeUndefined();
});

test("history restores bounded metadata-only host rows once, with the latest recorded status", () => {
	const call = { id: "code-run/1", name: "read", arguments: { path: "file.txt" } };
	const messages = [
		{ role: "toolResult", toolCallId: "code-run", toolName: "code", ...result("running", "[running]"),
			nestedCalls: { complete: false, calls: [{ ...call, status: "unfinished" }] } },
		{ role: "toolResult", toolCallId: "code-wait", toolName: "code", ...result("suspended", "[paused]"),
			nestedCalls: { complete: true, calls: [{ ...call, status: "ok" }] } },
	];
	const items = initialItems(messages, { stableIds: true });
	const nested = items.filter((entry) => entry.kind === "tool" && entry.toolCallId === call.id);
	expect(nested).toHaveLength(1);
	expect(nested[0]).toMatchObject({ args: { path: "file.txt" }, output: "", status: "done", recordedNestedStatus: "ok" });
	expect(nested[0]).not.toHaveProperty("images");
	expect(nested[0]).not.toHaveProperty("diff");
	const capped = initialItems([{ role: "toolResult", toolCallId: "many", toolName: "code", content: [],
		nestedCalls: { complete: false, calls: Array.from({ length: 300 }, (_, n) => ({
			id: "many/" + n, name: "read", status: "unfinished", arguments: { text: "x".repeat(10_000) },
		})) } }]);
	expect(capped).toHaveLength(257);
	expect(capped[1]).toMatchObject({ args: undefined, status: "done", recordedNestedStatus: "unfinished" });
	if (capped[1]?.kind === "tool") expect(toolStatusGlyph(capped[1]).glyph).toBe("?");
});

test("queue editing tells the user when the original was consumed", async () => {
	const pending: PendingInputItem = { id: "one", source: "pi", mode: "steer", text: "correction" };
	const [messages, setMessages] = createSignal([pending]);
	const actions: QueuedInputActions = {
		messages, editing: () => ({ ...pending, previousDraft: "draft" }), busy: () => false,
		queueSupported: () => true, edit() {}, cancel: async () => {}, combineWithNext: async () => {},
		saveEdit: async () => {}, cancelEdit() {},
	};
	const setup = await mount(() => <PendingInputPanel queuedFollowUps={[]} steering={[]} followUps={[]}
		onEditQueuedFollowUp={() => {}} pendingInput={actions} />, 100, 12);
	try {
		expect(setup.captureCharFrame()).toContain("Enter saves only while queued");
		setMessages([]);
		await setup.flush();
		expect(setup.captureCharFrame()).toContain("No longer queued · Edited text is unsent");
		expect(setup.captureCharFrame()).not.toContain("Original stays queued");
		expect(setup.captureCharFrame()).toContain("[Cancel edit]");
	} finally { setup.renderer.destroy(); }
});

test("child inspector overlays durable completion entries and excludes native checkpoint state", () => {
	const directory = mkdtempSync(join(tmpdir(), "pitty-child-completion-"));
	try {
		const sessionFile = join(directory, "child.jsonl");
		const checkpoint = "native-checkpoint-" + "x".repeat(100_000);
		const host = { id: "code-run/1", name: "read", arguments: { path: "file.txt" } };
		const original = { role: "toolResult", toolCallId: "code-run", toolName: "code",
			...result("running", "[running] old receipt"), timestamp: 10,
			nestedCalls: { complete: false, calls: [{ ...host, status: "unfinished" }] } };
		original.details = { ...original.details, state: checkpoint } as typeof original.details;
		const done = completion(result("suspended", "Checkpoint stdout\n[paused] Before the next host call."));
		const payload = {
			...done.entry.result,
			details: { ...done.entry.result.details, state: checkpoint },
			nestedCalls: { complete: true, calls: [{ ...host, status: "ok" }] },
		};
		writeFileSync(sessionFile, [
			{ type: "message", id: "original", parentId: null, message: original },
			{ ...done.entry, result: payload },
		].map((record) => JSON.stringify(record)).join("\n") + "\n");
		const messages = readSessionMessages({ runId: "child", mode: "background", state: "done", steps: [], sessionFile });
		expect(messages).toHaveLength(1);
		expect(JSON.stringify(messages)).not.toContain("native-checkpoint");
		const items = initialItems(messages, { stableIds: true });
		expect(items.filter((entry) => entry.kind === "tool" && entry.toolCallId === "code-run")).toHaveLength(1);
		const code = items.find((entry) => entry.kind === "tool" && entry.toolCallId === "code-run");
		expect(code).toMatchObject({ output: "Checkpoint stdout\n[paused] Before the next host call.", status: "done" });
		if (code?.kind === "tool") expect(toolDisplayState(code)?.label).toBe("paused");
		const nested = items.filter((entry) => entry.kind === "tool" && entry.toolCallId === host.id);
		expect(nested).toHaveLength(1);
		expect(nested[0]).toMatchObject({ recordedNestedStatus: "ok", output: "", args: host.arguments });
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

test("runtime exit stops an unfinished nested spinner without claiming success", () => {
	const model = new ConversationModel();
	apply(model, { type: "tool_execution_start", toolCallId: "code-run/1", parentToolCallId: "code-run",
		toolName: "read", args: { path: "held.txt" } });
	apply(model, { type: "agent_settled", processExited: true });
	const row = tool(model, "code-run/1");
	expect(row.status).toBe("error");
	expect(toolStatusGlyph(row).glyph).toBe("✗");
	expect(row.output).toContain("before completion was confirmed");
});


test("compacted-away tool completion remains visible through the generic custom renderer", async () => {
	const restored = initialItems([{
		role: "custom", customType: "tool_completion", display: true, timestamp: 10,
		content: text("Code completion for code-run\nFinal checkpoint output"),
		details: { toolCallId: "code-run", toolName: "code" },
	}], { stableIds: true });
	expect(restored).toHaveLength(1);
	expect(restored[0]).toMatchObject({
		kind: "custom", customType: "tool_completion",
		text: "Code completion for code-run\nFinal checkpoint output",
	});
	const item = restored[0]!;
	const setup = await mount(() => <MessageView item={item} showThinking toolExpanded />, 100, 20);
	try {
		expect(setup.captureCharFrame()).toContain("Code completion for code-run");
		expect(setup.captureCharFrame()).toContain("Final checkpoint output");
	} finally { setup.renderer.destroy(); }
});
