import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { readSubagentConversation, readSubagentTranscript } from "../src/subagents/transcript.ts";
import { ownedSubagentTargetsForItems, subagentTargets, targetsForTool, type SubagentTarget } from "../src/subagents/targets.ts";
import { type ToolItem } from "../src/types.ts";
import { useIsolatedSubagentRoots, run } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("subagent controls", () => {
	test("reads the active subagent transcript", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "transcript.jsonl");
		fs.writeFileSync(
			transcriptPath,
			[
				JSON.stringify({
					recordType: "message",
					role: "assistant",
					text: "visible result",
					ts: 1,
				}),
				JSON.stringify({
					recordType: "tool_start",
					toolName: "bash",
					argsPreview: "git status",
					ts: 2,
				}),
			].join("\n"),
		);
		target.transcriptPath = transcriptPath;
		const entries = readSubagentTranscript(target);
		expect(entries.map((entry) => entry.text)).toEqual([
			"visible result",
			"git status",
		]);
	});

	test("builds the same conversation model for subagent thinking and tools", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "conversation.jsonl");
		fs.writeFileSync(
			transcriptPath,
			[
				JSON.stringify({
					recordType: "message",
					role: "assistant",
					ts: 10,
					message: {
						role: "assistant",
						content: [
							{
								type: "thinking",
								thinking:
									"\u001b[38;2;34;211;238mThinking:\u001b[39m **Inspecting tests**",
							},
							{ type: "text", text: "Found **two** failures." },
						],
						stopReason: "toolUse",
					},
				}),
				JSON.stringify({
					recordType: "tool_start",
					toolName: "bash",
					toolCallId: "call-1",
					argsPreview: "bun test",
					ts: 20,
				}),
				JSON.stringify({ recordType: "tool_end", toolName: "bash", ts: 367 }),
				JSON.stringify({
					recordType: "message",
					role: "toolResult",
					text: "5 pass\n0 fail",
					ts: 368,
					message: {
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "bash",
						content: [{ type: "text", text: "5 pass\n0 fail" }],
						isError: false,
					},
				}),
			].join("\n"),
		);
		target.transcriptPath = transcriptPath;

		const items = readSubagentConversation(target);
		expect(items).toHaveLength(2);
		expect(items[0]?.kind).toBe("assistant");
		expect(items[0]?.kind === "assistant" ? items[0].thinking : "").toContain(
			"Inspecting tests",
		);
		expect(items[1]?.kind).toBe("tool");
		if (items[1]?.kind === "tool") {
			expect(items[1].name).toBe("bash");
			expect(items[1].args).toBe("bun test");
			expect(items[1].output).toBe("5 pass\n0 fail");
			expect(items[1].startedAt).toBe(20);
			expect(items[1].endedAt).toBe(367);
			expect(items[1].status).toBe("done");
		}
	});

	test("assigns one owner to repeated logical targets across tool items", () => {
		const firstTool: ToolItem = {
			kind: "tool",
			id: "first-item",
			toolCallId: "first-call",
			name: "subagent",
			args: {},
			output: "",
			details: {
				progress: [
					{
						agent: "worker",
						status: "running",
						sessionFile: "/tmp/repeated.jsonl",
					},
				],
			},
			timestamp: 1,
			status: "streaming",
			isError: false,
		};
		const secondTool: ToolItem = {
			...firstTool,
			id: "second-item",
			toolCallId: "second-call",
			details: {
				progress: [
					{
						agent: "worker",
						status: "completed",
						sessionFile: "/tmp/repeated.jsonl",
					},
				],
			},
			status: "done",
		};
		const firstTarget = subagentTargets([], [firstTool])[0]!;
		const secondTarget = subagentTargets([], [secondTool])[0]!;
		const owned = ownedSubagentTargetsForItems(
			[firstTool, secondTool],
			[firstTarget, secondTarget],
		);
		expect(owned.get("first-item")).toHaveLength(1);
		expect(owned.get("second-item") ?? []).toHaveLength(0);
		expect(owned.get("first-item")?.[0]?.state).toBe("completed");
	});

	test("owns every foreground workflow child when result run ids are composite", () => {
		const toolCallId = "wf-foreground-call";
		const tool: ToolItem = {
			kind: "tool",
			id: "wf-foreground-item",
			toolCallId,
			name: "subagent",
			args: { workflowScript: "return runs.run('alpha', {agent:'scout', task:'a'})" },
			output: "done",
			details: {
				mode: "workflow",
				runId: toolCallId,
				results: [
					{
						index: 0,
						agent: "scout",
						exitCode: 0,
						sessionFile: "/sessions/base/child-a/run-0/session.jsonl",
						transcriptPath: "/artifacts/child-a_scout_0_transcript.jsonl",
					},
					{
						index: 1,
						agent: "scout",
						exitCode: 0,
						sessionFile: "/sessions/base/child-b/run-0/session.jsonl",
						transcriptPath: "/artifacts/child-b_scout_0_transcript.jsonl",
					},
				],
				workflow: {
					trace: [
						{ operation: "run", key: "alpha", agent: "scout", state: "started" },
						{ operation: "run", key: "beta", agent: "scout", state: "started" },
						{ operation: "run", key: "alpha", agent: "scout", state: "completed", runId: "child-a", durationMs: 1000 },
						{ operation: "run", key: "beta", agent: "scout", state: "completed", runId: "child-b", durationMs: 2000 },
					],
				},
			},
			timestamp: 1000,
			status: "done",
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(targets.map((target) => target.key).sort()).toEqual([
			`${toolCallId}:alpha`,
			`${toolCallId}:beta`,
		]);
		const owned = ownedSubagentTargetsForItems([tool], targets).get(tool.id) ?? [];
		expect(owned.map((target) => target.key).sort()).toEqual([
			`${toolCallId}:alpha`,
			`${toolCallId}:beta`,
		]);
		expect(owned.every((target) => Boolean(target.transcriptPath))).toBe(true);
		expect(owned.every((target) => Boolean(target.sessionFile))).toBe(true);
	});

	test("keeps result data on workflow children when trace and result counts differ", () => {
		const toolCallId = "wf-partial-call";
		const tool: ToolItem = {
			kind: "tool",
			id: "wf-partial-item",
			toolCallId,
			name: "subagent",
			args: { workflowScript: "partial" },
			output: "done",
			details: {
				mode: "workflow",
				runId: toolCallId,
				results: [
					{
						index: 0,
						agent: "scout",
						exitCode: 0,
						sessionFile: "/sessions/base/child-a/run-0/session.jsonl",
						transcriptPath: "/artifacts/child-a_scout_0_transcript.jsonl",
					},
				],
				workflow: {
					trace: [
						{ operation: "run", key: "alpha", agent: "scout", state: "started" },
						{ operation: "run", key: "beta", agent: "scout", state: "started" },
						{ operation: "run", key: "alpha", agent: "scout", state: "completed", runId: "child-a", durationMs: 1000 },
					],
				},
			},
			timestamp: 1000,
			status: "done",
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		const byKey = new Map(targets.map((target) => [target.key, target]));
		expect(byKey.get(`${toolCallId}:alpha`)?.transcriptPath).toBe(
			"/artifacts/child-a_scout_0_transcript.jsonl",
		);
		expect(byKey.get(`${toolCallId}:alpha`)?.sessionFile).toBe(
			"/sessions/base/child-a/run-0/session.jsonl",
		);
		expect(byKey.get(`${toolCallId}:beta`)?.transcriptPath).toBeUndefined();
	});

	test("targetsForTool falls back to toolCallId for composite workflow run ids", () => {
		const toolCallId = "wf-direct-call";
		const item: ToolItem = {
			kind: "tool",
			id: "wf-direct-item",
			toolCallId,
			name: "subagent",
			args: {},
			output: "done",
			details: { mode: "workflow", runId: toolCallId },
			timestamp: 1000,
			status: "done",
			isError: false,
		};
		const makeTarget = (key: string): SubagentTarget =>
			subagentTargets([], [
				{
					...item,
					details: {
						mode: "workflow",
						runId: toolCallId,
						workflow: {
							trace: [
								{
									operation: "run",
									key,
									agent: "scout",
									state: "completed",
									runId: `child-${key}`,
								},
							],
						},
					},
				},
			])[0]!;
		const targets = [makeTarget("alpha"), makeTarget("beta")];
		expect(targetsForTool(item, targets).map((t) => t.key).sort()).toEqual([
			`${toolCallId}:alpha`,
			`${toolCallId}:beta`,
		]);
	});

	test("keeps distinct parallel step indexes as separate targets", () => {
		const target = run();
		target.mode = "parallel";
		target.steps = [
			{
				index: 0,
				agent: "first",
				status: "running",
				sessionFile: "/tmp/shared.jsonl",
			},
			{
				index: 1,
				agent: "second",
				status: "running",
				sessionFile: "/tmp/shared.jsonl",
			},
		];
		const tool: ToolItem = {
			kind: "tool",
			id: "parallel-item",
			toolCallId: "parallel-call",
			name: "subagent",
			args: {},
			output: "",
			details: { runId: target.runId },
			timestamp: 1,
			status: "streaming",
			isError: false,
		};
		const owned = ownedSubagentTargetsForItems(
			[tool],
			subagentTargets([target]),
		);
		expect(owned.get("parallel-item")).toHaveLength(2);
	});
});
