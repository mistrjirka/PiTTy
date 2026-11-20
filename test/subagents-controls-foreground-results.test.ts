import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import { subagentTargets, targetsForTool } from "../src/subagents/targets.ts";
import { initialItems } from "../src/state/conversation.ts";
import { type ToolItem } from "../src/types.ts";
import { useIsolatedSubagentRoots, run } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("subagent controls", () => {
	test("preserves legacy foreground results and progress parsing", () => {
		const results = subagentTargets(
			[],
			[
				{
					kind: "tool",
					id: "legacy-results",
					toolCallId: "legacy-results-call",
					name: "subagent",
					args: {},
					output: "done",
					details: {
						results: [
							{
								agent: "result-child",
								exitCode: 0,
								progress: { status: "running" },
							},
						],
					},
					timestamp: 1,
					status: "done",
					isError: false,
				},
			],
		);
		const progress = subagentTargets(
			[],
			[
				{
					kind: "tool",
					id: "legacy-progress",
					toolCallId: "legacy-progress-call",
					name: "subagent",
					args: {},
					output: "working",
					details: {
						progress: [{ agent: "progress-child", status: "running" }],
					},
					timestamp: 1,
					status: "streaming",
					isError: false,
				},
			],
		);
		expect(results[0]?.label).toBe("result-child");
		expect(results[0]?.key).toBe("legacy-results-call:0");
		expect(results[0]?.state).toBe("running");
		expect(progress[0]?.label).toBe("progress-child");
		expect(progress[0]?.key).toBe("legacy-progress-call:0");
	});

	test("preserves foreground transcript metadata from running result progress", () => {
		const tool = {
			kind: "tool" as const,
			id: "metadata",
			toolCallId: "call-metadata",
			name: "subagent",
			args: {},
			output: "",
			details: {
				results: [
					{
						agent: "worker",
						transcriptPath: "/tmp/foreground.jsonl",
						sessionFile: "/tmp/foreground-session.jsonl",
						progress: {
							agent: "worker",
							status: "running",
							currentTool: "bash",
							turnCount: 3,
							toolCount: 4,
							tokens: { total: 99 },
						},
					},
				],
			},
			timestamp: Date.now(),
			status: "streaming" as const,
			isError: false,
		};
		const target = subagentTargets([], [tool])[0];
		expect(target?.transcriptPath).toBe("/tmp/foreground.jsonl");
		expect(target?.sessionFile).toBe("/tmp/foreground-session.jsonl");
		expect(target?.run.totalTokens).toBe(99);
		expect(target?.run.currentTool).toBe("bash");
		expect(target?.run.turnCount).toBe(3);
		const numeric = subagentTargets(
			[],
			[
				{
					...tool,
					id: "numeric-tokens",
					toolCallId: "numeric-tokens-call",
					details: { progress: [{ agent: "numeric", tokens: 123 }] },
				},
			],
		);
		expect(numeric[0]?.run.totalTokens).toBe(123);
	});

	test("reconstructs persisted calls through targets without creating args-only children", () => {
		const items = initialItems([
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "persisted-call",
						name: "subagent",
						arguments: {
							tasks: [
								{
									label: "custom label",
									agent: "worker",
									model: "provider/model",
								},
							],
						},
					},
				],
			},
			{
				role: "toolResult",
				toolCallId: "persisted-call",
				toolName: "subagent",
				content: [],
				details: { results: [{ progress: [], exitCode: 0 }] },
			},
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "args-only",
						name: "subagent",
						arguments: { label: "never shown" },
					},
				],
			},
			{
				role: "toolResult",
				toolCallId: "unmatched",
				toolName: "subagent",
				content: [],
				details: { results: [] },
			},
		]);
		const tools = items.filter(
			(item): item is ToolItem => item.kind === "tool",
		);
		const targets = subagentTargets([], tools);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.label).toBe("custom label");
		expect(targets[0]?.model).toBe("provider/model");
		expect(targets[0]?.canSteer).toBe(false);
		expect(
			tools.find((tool) => tool.toolCallId === "args-only"),
		).toBeUndefined();
	});

	test("enriches exactly matched artifacts without overriding runtime fields", () => {
		const target = run();
		target.steps = [{ index: 0, agent: "artifact-agent", status: "running" }];
		const tool = {
			kind: "tool" as const,
			id: "artifact-match",
			toolCallId: "artifact-call",
			name: "subagent",
			args: {
				tasks: [
					{
						agent: "requested-agent",
						label: "requested label",
						model: "requested-model",
						thinking: "requested-thinking",
						contextWindow: 4096,
					},
				],
			},
			output: "",
			details: { runId: target.runId },
			timestamp: Date.now(),
			status: "done" as const,
			isError: false,
		};
		const matched = subagentTargets([target], [tool])[0];
		expect(matched?.run).toBe(target);
		expect(matched?.canSteer).toBe(true);
		expect(matched?.label).toBe("artifact-agent · requested label");
		expect(matched?.model).toBe("requested-model");
		expect(matched?.thinking).toBe("requested-thinking");
		expect(matched?.contextWindow).toBe(4096);

		target.steps[0] = {
			...target.steps[0]!,
			label: "artifact label",
			model: "artifact-model",
			thinking: "artifact-thinking",
			contextWindow: 8192,
		};
		const artifactWins = subagentTargets([target], [tool])[0];
		expect(artifactWins?.label).toBe("artifact-agent · artifact label");
		expect(artifactWins?.model).toBe("artifact-model");
		expect(artifactWins?.thinking).toBe("artifact-thinking");
		expect(artifactWins?.contextWindow).toBe(8192);

		const other = run();
		other.runId = "other-run";
		other.steps = [{ index: 0, agent: "other-agent", status: "running" }];
		const mismatched = subagentTargets(
			[other],
			[{ ...tool, details: { runId: "unrelated" } }],
		)[0];
		expect(mismatched?.label).toBe("other-agent");
		expect(mismatched?.model).toBeUndefined();
	});

	test("restores requested metadata from the exact persisted call", () => {
		const tool = {
			kind: "tool" as const,
			id: "requested",
			toolCallId: "requested-call",
			name: "subagent",
			args: {
				agent: "requested-worker",
				model: "provider/model",
				thinking: "high",
				contextWindow: 8192,
			},
			output: "done",
			details: { results: [{ progress: {}, exitCode: 0 }] },
			timestamp: Date.now(),
			status: "done" as const,
			isError: false,
		};
		const target = subagentTargets([], [tool])[0];
		expect(target?.label).toBe("requested-worker");
		expect(target?.model).toBe("provider/model");
		expect(target?.thinking).toBe("high");
		expect(target?.contextWindow).toBe(8192);
		expect(target?.canSteer).toBe(false);
	});

	test("falls back to a bounded child session file transcript", () => {
		const target = run();
		const sessionFile = path.join(target.asyncDir!, "child-session.jsonl");
		fs.writeFileSync(
			sessionFile,
			[
				JSON.stringify({
					message: {
						role: "assistant",
						content: [{ type: "text", text: "from session" }],
						timestamp: 1,
					},
				}),
				"not json",
			].join("\n"),
		);
		target.sessionFile = sessionFile;
		const items = readSubagentConversation(target);
		expect(items).toHaveLength(1);
		expect(items[0]?.kind === "assistant" ? items[0].text : "").toBe(
			"from session",
		);
	});

	test("parses progress objects nested in result details", () => {
		const tool = {
			kind: "tool" as const,
			id: "nested",
			toolCallId: "call-nested",
			name: "subagent",
			args: {},
			output: "",
			details: {
				results: [{ progress: { agent: "nested-worker", status: "running" } }],
			},
			timestamp: Date.now(),
			status: "done" as const,
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(targets[0]?.label).toBe("nested-worker");
		expect(targets[0]?.active).toBe(true);
	});

	test("keeps rich completed foreground results with empty progress", () => {
		const tool = {
			kind: "tool" as const,
			id: "completed-empty-progress",
			toolCallId: "call-completed-empty-progress",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				results: [
					{
						agent: "worker",
						progress: [],
						exitCode: 0,
						transcriptPath: "/tmp/rich.jsonl",
						sessionFile: "/tmp/rich-session.jsonl",
					},
				],
			},
			timestamp: Date.now(),
			status: "done" as const,
			isError: false,
		};
		const target = subagentTargets([], [tool])[0];
		expect(target?.label).toBe("worker");
		expect(target?.state).toBe("completed");
		expect(target?.transcriptPath).toBe("/tmp/rich.jsonl");
	});

	test("keeps completed foreground result metadata without progress", () => {
		const tool = {
			kind: "tool" as const,
			id: "completed",
			toolCallId: "call-completed",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				results: [
					{
						agent: "worker",
						exitCode: 0,
						transcriptPath: "/tmp/completed.jsonl",
						sessionFile: "/tmp/completed-session.jsonl",
					},
				],
			},
			timestamp: Date.now(),
			status: "done" as const,
			isError: false,
		};
		const target = subagentTargets([], [tool])[0];
		expect(target?.state).toBe("completed");
		expect(target?.active).toBe(false);
		expect(target?.transcriptPath).toBe("/tmp/completed.jsonl");
	});

	test("ignores metadata-free and empty foreground tool results", () => {
		const tools = [
			{
				kind: "tool" as const,
				id: "empty",
				toolCallId: "call-empty",
				name: "subagent",
				args: {},
				output: "",
				timestamp: 1,
				status: "done" as const,
				isError: false,
			},
			{
				kind: "tool" as const,
				id: "empty-results",
				toolCallId: "call-empty-results",
				name: "delegate",
				args: {},
				output: "",
				details: { results: [] },
				timestamp: 2,
				status: "done" as const,
				isError: false,
			},
			{
				kind: "tool" as const,
				id: "empty-progress",
				toolCallId: "call-empty-progress",
				name: "agent",
				args: {},
				output: "",
				details: { progress: [] },
				timestamp: 3,
				status: "done" as const,
				isError: false,
			},
		];
		expect(subagentTargets([], tools)).toEqual([]);
		const restored = initialItems(
			tools.map((tool) => ({
				role: "toolResult",
				toolCallId: tool.toolCallId,
				toolName: tool.name,
				content: [],
				details: tool.details,
				timestamp: tool.timestamp,
			})),
		);
		expect(
			subagentTargets(
				[],
				restored.filter((item): item is ToolItem => item.kind === "tool"),
			),
		).toEqual([]);
	});

	test("falls back safely for malformed foreground details", () => {
		const tool = {
			kind: "tool" as const,
			id: "malformed",
			toolCallId: "call-malformed",
			name: "subagent",
			args: {},
			output: "",
			details: { progress: [null, 42, "bad"] },
			timestamp: Date.now(),
			status: "pending" as const,
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(targets).toHaveLength(0);
	});

	test("maps a subagent tool result to each child in its run", () => {
		const target = run();
		target.mode = "parallel";
		target.steps = [
			{ index: 0, agent: "one", status: "running" },
			{ index: 1, agent: "two", status: "completed" },
		];
		const tool = {
			kind: "tool" as const,
			id: "tool-1",
			toolCallId: "call-1",
			name: "subagent",
			args: {},
			output: "started",
			details: { runId: "run-1" },
			timestamp: Date.now(),
			status: "done" as const,
			isError: false,
		};
		expect(
			targetsForTool(tool, subagentTargets([target]))
				.map((item) => item.label)
				.sort(),
		).toEqual(["one #1", "two #2"]);
	});
});
