import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import { subagentTargets, targetsForTool } from "../src/subagents/targets.ts";
import { type SubagentRun, type ToolItem } from "../src/types.ts";
import { useIsolatedSubagentRoots, run } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("subagent controls", () => {
	test("maps a live foreground tool progress item and dedupes its async launch", () => {
		const target = run();
		const tool = {
			kind: "tool" as const,
			id: "foreground-tool",
			toolCallId: "call-foreground",
			name: "subagent",
			args: {},
			output: "working",
			details: {
				progress: [{ agent: "worker", status: "pending", currentTool: "bash" }],
			},
			timestamp: Date.now(),
			status: "streaming" as const,
			isError: false,
		};
		const asyncLaunch = {
			...tool,
			toolCallId: "call-async",
			details: { asyncDir: target.asyncDir! },
			status: "done" as const,
		};
		const targets = subagentTargets([target], [tool, asyncLaunch]);
		expect(
			targets.filter((item) => item.run.runId === target.runId),
		).toHaveLength(1);
		const foreground = targets.find(
			(item) => item.toolCallId === tool.toolCallId,
		);
		expect(foreground?.active).toBe(true);
		expect(foreground?.state).toBe("pending");
		expect(foreground?.canSteer).toBe(false);
		expect(
			targetsForTool(tool, targets).map((item) => item.toolCallId),
		).toEqual([tool.toolCallId]);
	});

	test("projects live workflow trace children with stable identities", () => {
		const liveTool = {
			kind: "tool" as const,
			id: "workflow-live",
			toolCallId: "workflow-call",
			name: "subagent",
			args: {},
			output: "working",
			details: {
				workflow: {
					trace: [
						{
							operation: "run",
							key: "child-a",
							agent: "worker-a",
							state: "started",
						},
						{
							operation: "run",
							key: "child-b",
							agent: "worker-b",
							state: "started",
						},
					],
				},
			},
			timestamp: 1,
			status: "streaming" as const,
			isError: false,
		};
		const first = subagentTargets([], [liveTool]);
		expect(first.map((target) => target.key)).toEqual([
			"workflow-call:child-a",
			"workflow-call:child-b",
		]);
		expect(first.every((target) => target.active)).toBe(true);

		const updated = subagentTargets(
			[],
			[
				{
					...liveTool,
					details: {
						workflow: {
							trace: [
								{
									operation: "run",
									key: "child-a",
									agent: "worker-a",
									state: "started",
								},
								{
									operation: "run",
									key: "child-a",
									agent: "worker-a",
									state: "completed",
								},
								{
									operation: "run",
									key: "child-b",
									agent: "worker-b",
									state: "started",
								},
							],
						},
					},
				},
			],
		);
		expect(updated.map((target) => target.key)).toEqual(
			first.map((target) => target.key),
		);
	});

	test("keeps live workflow children visible while persisted parent steps are empty", () => {
		const tool: ToolItem = {
			kind: "tool",
			id: "workflow-race",
			toolCallId: "workflow-race-call",
			name: "subagent",
			args: {},
			output: "working",
			details: {
				runId: "workflow-parent",
				workflow: {
					trace: [
						{
							operation: "run",
							key: "logic",
							agent: "worker",
							state: "started",
						},
					],
				},
			},
			timestamp: 100,
			status: "streaming",
			isError: false,
		};
		const run: SubagentRun = {
			runId: "workflow-parent",
			asyncDir: "/tmp/workflow-parent",
			control: "file",
			mode: "workflow",
			state: "running",
			steps: [],
		};

		const targets = subagentTargets([run], [tool]);
		expect(targets.map((target) => target.key)).toEqual([
			"workflow-race-call:logic",
		]);
		expect(targets[0]?.label).toBe("worker");

		run.steps = [
			{
				index: 0,
				agent: "persisted-worker",
				status: "running",
				workflowKey: "logic",
				parentWorkflowRunId: "workflow-parent",
				runId: "workflow-child",
				sessionFile: "/tmp/workflow-child.jsonl",
			},
		];
		const reconciled = subagentTargets([run], [tool]);
		expect(reconciled.map((target) => target.key)).toEqual([
			"workflow-parent:0",
		]);
		expect(reconciled[0]?.sessionFile).toBe("/tmp/workflow-child.jsonl");
	});

	test("uses the stable workflow key when live trace metadata omits a name", () => {
		const tool = {
			kind: "tool" as const,
			id: "workflow-key-only",
			toolCallId: "workflow-key-only-call",
			name: "subagent",
			args: {},
			output: "working",
			details: {
				workflow: {
					trace: [{ operation: "run", key: "logic", state: "started" }],
				},
			},
			timestamp: 1,
			status: "streaming" as const,
			isError: false,
		};
		const [target] = subagentTargets([], [tool]);
		expect(target?.label).toBe("logic");
		expect(target?.active).toBe(true);
		expect(target?.sessionFile).toBeUndefined();
		expect(target?.transcriptPath).toBeUndefined();
	});

	test("suppresses persisted child projections once the workflow parent owns steps", () => {
		const parent: SubagentRun = {
			runId: "parent",
			mode: "workflow",
			state: "running",
			steps: [0, 1, 2].map((index) => ({
				index,
				agent: `agent-${index}`,
				workflowKey: `k${index}`,
				runId: `child-${index}`,
				status: "running",
				sessionFile: `/tmp/c${index}`,
			})),
		};
		const children = [0, 1, 2].map(
			(index): SubagentRun => ({
				runId: `child-${index}`,
				mode: "single",
				state: "running",
				parentWorkflowRunId: "parent",
				workflowKey: `k${index}`,
				steps: [
					{
						index: 0,
						agent: `agent-${index}`,
						status: "running",
						sessionFile: `/tmp/c${index}`,
					},
				],
			}),
		);
		expect(subagentTargets([parent, ...children])).toHaveLength(3);
		expect(subagentTargets(children)).toHaveLength(3);
	});

	test("transfers suppressed child session metadata into the visible parent step", () => {
		const sessionFile = path.join(os.tmpdir(), "workflow-child-session.jsonl");
		fs.writeFileSync(
			sessionFile,
			JSON.stringify({
				message: {
					role: "assistant",
					content: [{ type: "text", text: "child transcript" }],
				},
			}),
		);
		const parent: SubagentRun = {
			runId: "workflow-parent",
			mode: "workflow",
			state: "completed",
			steps: [
				{
					index: 0,
					agent: "worker",
					workflowKey: "logic",
					runId: "workflow-child",
					status: "completed",
				},
			],
		};
		const child: SubagentRun = {
			runId: "workflow-child",
			mode: "single",
			state: "completed",
			parentWorkflowRunId: "workflow-parent",
			workflowKey: "logic",
			sessionFile,
			steps: [],
		};

		const targets = subagentTargets([parent, child]);
		expect(targets).toHaveLength(1);
		const target = targets[0];
		expect(target?.key).toBe("workflow-parent:0");
		expect(target?.sessionFile).toBe(sessionFile);
		expect(target?.run.steps[0]?.sessionFile).toBe(sessionFile);
		expect(
			readSubagentConversation(target!.run, 160, target!.stepIndex),
		).toEqual([
			expect.objectContaining({ kind: "assistant", text: "child transcript" }),
		]);
	});
});
