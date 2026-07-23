import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
	ConversationModel,
	extractThinking,
	initialItems,
} from "../src/state/conversation.ts";
import type { PiEvent } from "../src/types.ts";

const event = (value: Record<string, unknown>): PiEvent => value as PiEvent;

describe("conversation content boundaries", () => {
	test("separates adjacent thinking blocks while preserving a single block", () => {
		expect(
			extractThinking({
				content: [
					{ type: "thinking", thinking: "gap" },
					{ type: "reasoning", text: "Analyzing" },
				],
			}),
		).toBe("gap\n\nAnalyzing");
		expect(
			extractThinking({
				content: [{ type: "thinking", thinking: "exact\ntext" }],
			}),
		).toBe("exact\ntext");
	});

	test("preserves tool details through initial history reconstruction", () => {
		const items = initialItems([
			{
				role: "toolResult",
				toolCallId: "call",
				toolName: "subagent",
				content: [],
				details: { results: [] },
				timestamp: 1,
			},
		]);
		expect(items[0]?.kind).toBe("tool");
		expect(items[0]?.kind === "tool" && items[0].details).toEqual({
			results: [],
		});
	});

	test("correlates persisted tool results by exact tool-call id", () => {
		const items = initialItems([
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "first",
						name: "subagent",
						arguments: { agent: "one", model: "m1" },
					},
					{
						type: "toolCall",
						id: "second",
						name: "subagent",
						arguments: { agent: "two", model: "m2" },
					},
					{ type: "toolCall", id: "bad", name: "subagent", arguments: [] },
				],
			},
			{
				role: "toolResult",
				toolCallId: "second",
				toolName: "subagent",
				content: [],
			},
			{
				role: "toolResult",
				toolCallId: "first",
				toolName: "wrong",
				content: [],
			},
			{
				role: "toolResult",
				toolCallId: "unmatched",
				toolName: "generic",
				content: [],
			},
		]);
		expect(
			items
				.filter((item) => item.kind === "tool")
				.map((item) => (item.kind === "tool" ? [item.name, item.args] : [])),
		).toEqual([
			["subagent", { agent: "two", model: "m2" }],
			["subagent", { agent: "one", model: "m1" }],
			["generic", undefined],
		]);
	});
});

describe("ConversationModel", () => {
	test("keeps an optimistic user message visible and reconciles it", () => {
		const model = new ConversationModel();
		model.optimisticUser("hello");
		expect(model.items).toHaveLength(1);
		expect(model.items[0]?.kind).toBe("user");
		model.apply(
			event({
				type: "message_end",
				message: { role: "user", content: "hello", timestamp: 1 },
			}),
		);
		expect(model.items).toHaveLength(1);
		expect(model.items[0]?.kind === "user" && model.items[0].optimistic).toBe(
			false,
		);
	});

	test("updates one streaming assistant item instead of duplicating chunks", () => {
		const model = new ConversationModel();
		model.apply(
			event({
				type: "message_start",
				message: { role: "assistant", content: [] },
			}),
		);
		model.apply(
			event({
				type: "message_update",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "abc" }],
				},
				assistantMessageEvent: { type: "text_delta", delta: "abc" },
			}),
		);
		model.apply(
			event({
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "abcdef" }],
				},
			}),
		);
		expect(model.items).toHaveLength(1);
		expect(model.items[0]?.kind === "assistant" && model.items[0].text).toBe(
			"abcdef",
		);
		expect(model.items[0]?.kind === "assistant" && model.items[0].status).toBe(
			"done",
		);
	});

	test("creates a real collapsible diff preview for write tools", () => {
		const cwd = mkdtempSync(path.join(tmpdir(), "piui-diff-"));
		try {
			writeFileSync(path.join(cwd, "example.ts"), "const value = 1;\n", "utf8");
			const model = new ConversationModel([], cwd);
			model.apply(
				event({
					type: "tool_execution_start",
					toolCallId: "write-diff",
					toolName: "write",
					args: {
						path: "example.ts",
						content: "const value = 2;\nconst added = true;\n",
					},
				}),
			);
			const item = model.items[0];
			expect(item?.kind).toBe("tool");
			expect(item?.kind === "tool" && item.diff).toContain("-const value = 1;");
			expect(item?.kind === "tool" && item.diff).toContain("+const value = 2;");
			expect(item?.kind === "tool" && item.diffPath).toBe("example.ts");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("correlates tool progress by tool call id", () => {
		const model = new ConversationModel();
		model.apply(
			event({
				type: "tool_execution_start",
				toolCallId: "x",
				toolName: "bash",
				args: { command: "ls" },
			}),
		);
		model.apply(
			event({
				type: "tool_execution_update",
				toolCallId: "x",
				toolName: "bash",
				partialResult: { content: [{ type: "text", text: "one" }] },
			}),
		);
		model.apply(
			event({
				type: "tool_execution_end",
				toolCallId: "x",
				toolName: "bash",
				result: { content: [{ type: "text", text: "one\ntwo" }] },
				isError: false,
			}),
		);
		expect(model.items).toHaveLength(1);
		expect(model.items[0]?.kind === "tool" && model.items[0].output).toBe(
			"one\ntwo",
		);
	});
});

describe("ConversationModel regressions", () => {
	test("does not duplicate optimistic users across message_start and message_end", () => {
		const model = new ConversationModel();
		model.optimisticUser("continue please");
		model.apply(
			event({
				type: "message_start",
				message: {
					role: "user",
					content: "continue please",
					timestamp: Date.now(),
				},
			}),
		);
		model.apply(
			event({
				type: "message_end",
				message: {
					role: "user",
					content: "continue please",
					timestamp: Date.now(),
				},
			}),
		);
		expect(model.items.filter((item) => item.kind === "user")).toHaveLength(1);
		expect(model.items[0]?.kind === "user" && model.items[0].optimistic).toBe(
			false,
		);
	});

	test("uses assistant deltas when the partial message has not caught up", () => {
		const model = new ConversationModel();
		model.apply(
			event({
				type: "message_start",
				message: { role: "assistant", content: [] },
			}),
		);
		model.apply(
			event({
				type: "message_update",
				message: { role: "assistant", content: [] },
				assistantMessageEvent: { type: "thinking_delta", delta: "checking " },
			}),
		);
		model.apply(
			event({
				type: "message_update",
				message: { role: "assistant", content: [] },
				assistantMessageEvent: { type: "text_delta", delta: "Visible answer" },
			}),
		);
		model.apply(
			event({
				type: "message_end",
				message: { role: "assistant", content: [] },
			}),
		);
		expect(model.items).toHaveLength(1);
		expect(
			model.items[0]?.kind === "assistant" && model.items[0].thinking,
		).toBe("checking ");
		expect(model.items[0]?.kind === "assistant" && model.items[0].text).toBe(
			"Visible answer",
		);
	});

	test("does not render empty assistant tool-call placeholders", () => {
		const model = new ConversationModel();
		model.apply(
			event({
				type: "message_start",
				message: { role: "assistant", content: [] },
			}),
		);
		model.apply(
			event({
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "x", name: "bash", arguments: {} }],
				},
			}),
		);
		expect(model.items).toHaveLength(0);
	});

	test("tracks isCompacting across compaction_start and compaction_end", () => {
		const model = new ConversationModel();
		expect(model.isCompacting).toBe(false);
		model.apply(event({ type: "compaction_start", reason: "manual" }));
		expect(model.isCompacting).toBe(true);
		model.apply(event({ type: "compaction_end" }));
		expect(model.isCompacting).toBe(false);
	});

	test("clears isCompacting even when compaction ends with an error", () => {
		const model = new ConversationModel();
		model.apply(event({ type: "compaction_start", reason: "auto" }));
		model.apply(event({ type: "compaction_end", errorMessage: "boom" }));
		expect(model.isCompacting).toBe(false);
		const last = model.items.at(-1);
		expect(last?.kind === "system" && last.tone).toBe("error");
	});
});

describe("ConversationModel live repaint identity", () => {
	test("replaces assistant values while retaining a stable row identity", () => {
		const model = new ConversationModel();
		model.apply(
			event({
				type: "message_update",
				message: { role: "assistant", content: [], timestamp: 10 },
				assistantMessageEvent: { type: "thinking_delta", delta: "first" },
			}),
		);
		const first = model.items[0];
		model.apply(
			event({
				type: "message_update",
				message: { role: "assistant", content: [], timestamp: 10 },
				assistantMessageEvent: { type: "text_delta", delta: "answer" },
			}),
		);
		expect(model.items[0]).not.toBe(first);
		expect(model.items[0]?.id).toBe(first?.id);
		expect(
			model.items[0]?.kind === "assistant" && model.items[0].thinking,
		).toBe("first");
		expect(model.items[0]?.kind === "assistant" && model.items[0].text).toBe(
			"answer",
		);
	});

	test("reconciles optimistic users even when Pi normalizes whitespace", () => {
		const model = new ConversationModel();
		model.optimisticUser("continue please");
		model.apply(
			event({
				type: "message_start",
				message: {
					role: "user",
					content: " continue   please\n",
					timestamp: Date.now(),
				},
			}),
		);
		model.apply(
			event({
				type: "message_end",
				message: {
					role: "user",
					content: " continue   please\n",
					timestamp: Date.now(),
				},
			}),
		);
		expect(model.items.filter((item) => item.kind === "user")).toHaveLength(1);
		expect(model.items[0]?.kind === "user" && model.items[0].optimistic).toBe(
			false,
		);
	});

	test("replaces tool objects when output changes", () => {
		const model = new ConversationModel();
		model.apply(
			event({
				type: "tool_execution_start",
				toolCallId: "tool",
				toolName: "bash",
				args: {},
			}),
		);
		const first = model.items[0];
		model.apply(
			event({
				type: "tool_execution_end",
				toolCallId: "tool",
				toolName: "bash",
				result: { content: [{ type: "text", text: "done" }] },
				isError: false,
			}),
		);
		expect(model.items[0]).not.toBe(first);
		expect(model.items[0]?.kind === "tool" && model.items[0].output).toBe(
			"done",
		);
	});
});
