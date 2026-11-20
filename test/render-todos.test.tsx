import { describe, expect, test } from "bun:test";
import type { ConversationItem } from "../src/types.ts";
import { preserveEquivalentTodos, preserveReferencedList } from "../src/ui/list-stability.ts";
import { deriveTodos, type TodoViewItem } from "../src/ui/todos.tsx";

import "./render-helpers/test-env.ts";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("OpenTUI components", () => {
	test("derives active todos first and completed todos at the end", () => {
		const items: ConversationItem[] = [
			{
				kind: "tool",
				id: "todo-add-1",
				toolCallId: "todo-add-1",
				name: "todo",
				args: {
					action: "add",
					id: "1",
					text: "Inspect the RPC events",
					status: "in_progress",
				},
				output: "Created todo #1: Inspect the RPC events (in_progress)",
				timestamp: 1,
				status: "done",
				isError: false,
			},
			{
				kind: "tool",
				id: "todo-add-2",
				toolCallId: "todo-add-2",
				name: "todo",
				args: { action: "add", id: "2", text: "Add regression tests" },
				output: "Created todo #2: Add regression tests (pending)",
				timestamp: 2,
				status: "done",
				isError: false,
			},
			{
				kind: "tool",
				id: "todo-done-1",
				toolCallId: "todo-done-1",
				name: "todo",
				args: { action: "complete", id: "1" },
				output: "#1 -> completed",
				timestamp: 3,
				status: "done",
				isError: false,
			},
		];
		const todos = deriveTodos(items);
		expect(todos.map((todo) => todo.id)).toEqual(["2", "1"]);
		expect(todos[0]?.done).toBe(false);
		expect(todos[1]?.done).toBe(true);
	});

	test("omits deleted todos from authoritative task snapshots", () => {
		const items: ConversationItem[] = [
			{
				kind: "tool",
				id: "todo-delete-result",
				toolCallId: "todo-delete-result",
				name: "todo",
				args: { action: "delete", id: 7 },
				output: "Deleted todo #7",
				details: {
					tasks: [
						{ id: 7, subject: "Remove me", status: "deleted" },
						{ id: 8, subject: "Keep me", status: "pending" },
					],
				},
				timestamp: 1,
				status: "done",
				isError: false,
			},
		];
		expect(deriveTodos(items)).toEqual([
			{ id: "8", text: "Keep me", status: "pending", done: false },
		]);
	});

	test("removes deleted todos and preserves unchanged panel inputs", () => {
		const items: ConversationItem[] = [
			{
				kind: "tool",
				id: "todo-add",
				toolCallId: "todo-add",
				name: "todo",
				args: { action: "add", id: "1", text: "Remove me" },
				output: "Created todo #1: Remove me (pending)",
				timestamp: 1,
				status: "done",
				isError: false,
			},
			{
				kind: "tool",
				id: "todo-delete",
				toolCallId: "todo-delete",
				name: "todo",
				args: { action: "delete", id: "1" },
				output: "Deleted todo #1",
				timestamp: 2,
				status: "done",
				isError: false,
			},
		];
		expect(deriveTodos(items)).toEqual([]);

		const todo: TodoViewItem = {
			id: "2",
			text: "Keep me",
			status: "pending",
			done: false,
			activeForm: "keeping me",
		};
		const todos = [todo];
		expect(preserveEquivalentTodos(todos, [{ ...todo }])).toBe(todos);
		const changedTodos = [{ ...todo, text: "Changed" }];
		expect(preserveEquivalentTodos(todos, changedTodos)).toBe(changedTodos);
		const firstTool = items[0]!;
		const toolList = [firstTool];
		expect(preserveReferencedList(toolList, [firstTool])).toBe(toolList);
		const replacement = { ...firstTool };
		expect(preserveReferencedList(toolList, [replacement])).toBeInstanceOf(
			Array,
		);
		expect(preserveReferencedList(toolList, [replacement])).not.toBe(toolList);
	});
});
