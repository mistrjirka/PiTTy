import { describe, expect, test } from "bun:test";
import { ownedSubagentTargetsForItems, subagentTargets } from "../src/subagents/targets.ts";
import { type SubagentRun, type ToolItem } from "../src/types.ts";
import { useIsolatedSubagentRoots } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("subagent controls", () => {
	test("pairs unambiguous index-only workflow results by trace position", () => {
		const tool: ToolItem = {
			kind: "tool",
			id: "positional",
			toolCallId: "positional-call",
			name: "subagent",
			args: {},
			output: "done",
			timestamp: 1,
			status: "done",
			isError: false,
			details: {
				workflow: {
					trace: [
						{ operation: "run", key: "a", agent: "one", state: "started" },
						{ operation: "run", key: "b", agent: "two", state: "started" },
					],
				},
				results: [
					{ index: 0, agent: "one", sessionFile: "/tmp/one" },
					{ index: 0, agent: "two", sessionFile: "/tmp/two" },
				],
			},
		};
		const targets = subagentTargets([], [tool]);
		expect(
			targets.find((target) => target.workflowKey === "a")?.sessionFile,
		).toBe("/tmp/one");
		expect(
			targets.find((target) => target.workflowKey === "b")?.sessionFile,
		).toBe("/tmp/two");
	});

	test("merges terminal runId results into the stable workflow key row", () => {
		const tool = {
			kind: "tool" as const,
			id: "workflow-runid-terminal",
			toolCallId: "workflow-runid-call",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				workflow: {
					trace: [
						{
							operation: "run",
							key: "logic",
							agent: "impl-check-logic",
							state: "started",
						},
						{
							operation: "run",
							key: "logic",
							runId: "child-run",
							state: "completed",
						},
					],
				},
				results: [
					{
						runId: "child-run",
						agent: "impl-check-logic",
						exitCode: 0,
						sessionFile: "/tmp/child.jsonl",
						progress: { currentTool: "bash" },
					},
				],
			},
			timestamp: 1,
			status: "done" as const,
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.key).toBe("workflow-runid-call:logic");
		expect(targets[0]?.state).toBe("completed");
		expect(targets[0]?.sessionFile).toBe("/tmp/child.jsonl");
		expect(targets[0]?.run.currentTool).toBe("bash");
	});

	test("does not merge an unowned trace with a parent-scoped persisted child", () => {
		const makeRun = (
			runId: string,
			parentWorkflowRunId: string,
		): SubagentRun => ({
			runId,
			asyncDir: `/tmp/${runId}`,
			control: "file",
			mode: "single",
			state: "running",
			steps: [
				{
					index: 0,
					agent: runId,
					status: "running",
					workflowKey: "shared",
					parentWorkflowRunId,
					sessionFile: `/tmp/${runId}.jsonl`,
				},
			],
		});
		const tool: ToolItem = {
			kind: "tool",
			id: "unowned-trace",
			toolCallId: "unowned-trace-call",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				workflow: {
					trace: [{ operation: "run", key: "shared", state: "completed" }],
				},
			},
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const targets = subagentTargets(
			[makeRun("child-one", "parent-one"), makeRun("child-two", "parent-two")],
			[tool],
		);
		expect(
			targets.find((target) => target.key === "unowned-trace-call:shared")
				?.sessionFile,
		).toBeUndefined();
		expect(
			targets
				.filter((target) => target.sessionFile?.includes("child-"))
				.map((target) => target.sessionFile),
		).toEqual(["/tmp/child-one.jsonl", "/tmp/child-two.jsonl"]);
	});

	test("scopes workflow reconciliation and overlays terminal trace lifecycle", () => {
		const tool: ToolItem = {
			kind: "tool",
			id: "workflow-scoped",
			toolCallId: "workflow-scoped-call",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				runId: "parent-two",
				workflow: {
					trace: [{ operation: "run", key: "shared-key", state: "completed" }],
				},
			},
			timestamp: 1_000,
			status: "done",
			isError: false,
		};
		const makeRun = (
			runId: string,
			parentWorkflowRunId: string,
		): SubagentRun => ({
			runId,
			asyncDir: `/tmp/${runId}`,
			control: "file",
			mode: "single",
			state: "running",
			steps: [
				{
					index: 0,
					agent: runId,
					status: "running",
					workflowKey: "shared-key",
					parentWorkflowRunId,
					sessionFile: `/tmp/${runId}.jsonl`,
				},
			],
		});
		const targets = subagentTargets(
			[
				makeRun("persisted-one", "parent-one"),
				makeRun("persisted-two", "parent-two"),
			],
			[tool],
		);
		expect(targets).toHaveLength(2);
		const selected = targets.find(
			(target) => target.key === "workflow-scoped-call:shared-key",
		);
		expect(selected?.step?.agent).toBe("persisted-two");
		expect(selected?.sessionFile).toBe("/tmp/persisted-two.jsonl");
		expect(selected?.state).toBe("completed");
		expect(selected?.active).toBe(false);
		expect(selected?.canSteer).toBe(false);
		expect(selected?.run.state).toBe("completed");
	});

	test("reconciles six live workflow traces with aliased persisted steps", () => {
		const tool: ToolItem = {
			kind: "tool",
			id: "workflow-live",
			toolCallId: "workflow-live-call",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				workflow: {
					trace: Array.from({ length: 6 }, (_, index) => ({
						operation: "run",
						key: `step-${index}`,
						...(index === 5
							? { runId: `child-${index}`, state: "completed" }
							: { state: "started" }),
					})),
				},
				results: [{ runId: "child-5", exitCode: 0 }],
			},
			timestamp: 1_000,
			startedAt: 1_000,
			endedAt: 2_000,
			status: "done",
			isError: false,
		};
		const run: SubagentRun = {
			runId: "persisted-workflow",
			asyncDir: "/tmp/persisted-workflow",
			control: "file",
			mode: "parallel",
			state: "running",
			startedAt: 1_000,
			steps: Array.from({ length: 6 }, (_, index) => ({
				index,
				agent: `impl-check-${index}`,
				status: index === 5 ? "completed" : "running",
				workflowKey: `step-${index}`,
				runId: `child-${index}`,
				sessionFile: `/tmp/child-${index}.jsonl`,
			})),
		};
		const targets = subagentTargets([run], [tool]);
		const owned =
			ownedSubagentTargetsForItems([tool], targets).get(tool.id) ?? [];
		expect(owned).toHaveLength(6);
		expect(
			owned.every((target) =>
				target.label.startsWith(`impl-check-${target.stepIndex}`),
			),
		).toBe(true);
		expect(owned.map((target) => target.sessionFile)).toEqual(
			expect.arrayContaining(
				Array.from({ length: 6 }, (_, index) => `/tmp/child-${index}.jsonl`),
			),
		);
		expect(owned.some((target) => target.label === "foreground subagent")).toBe(
			false,
		);
		expect(owned.find((target) => target.childRunId === "child-5")?.state).toBe(
			"completed",
		);
	});

	test("does not cross-assign ambiguous index-only workflow results", () => {
		const tool = {
			kind: "tool" as const,
			id: "workflow-index-only",
			toolCallId: "workflow-index-only-call",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				workflow: {
					trace: [
						{
							operation: "run",
							key: "alpha",
							agent: "alpha",
							state: "completed",
						},
						{ operation: "run", key: "beta", agent: "beta", state: "failed" },
					],
				},
				results: [
					{
						index: 0,
						agent: "terminal-alpha",
						exitCode: 0,
						sessionFile: "/tmp/alpha.jsonl",
					},
					{
						index: 0,
						agent: "terminal-beta",
						exitCode: 1,
						sessionFile: "/tmp/beta.jsonl",
					},
				],
			},
			timestamp: 1,
			status: "done" as const,
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(
			targets.find((target) => target.key.endsWith(":alpha")),
		).toMatchObject({
			label: "alpha",
			state: "completed",
		});
		expect(
			targets.find((target) => target.key.endsWith(":beta")),
		).toMatchObject({
			label: "beta",
			state: "failed",
		});
		expect(targets).toHaveLength(2);
		expect(targets.every((target) => target.sessionFile === undefined)).toBe(
			true,
		);
	});

	test("merges workflow terminal results into trace children without duplicates", () => {
		const tool = {
			kind: "tool" as const,
			id: "workflow-terminal",
			toolCallId: "workflow-terminal-call",
			name: "subagent",
			args: {},
			output: "done",
			details: {
				workflow: {
					trace: [
						{
							operation: "run",
							key: "child",
							agent: "worker",
							state: "started",
						},
						{
							operation: "note",
							key: "ignored",
							agent: "noise",
							state: "started",
						},
					],
				},
				results: [{ key: "child", agent: "worker", exitCode: 0 }],
			},
			timestamp: 1,
			status: "done" as const,
			isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.key).toBe("workflow-terminal-call:child");
		expect(targets[0]?.state).toBe("completed");
	});
});
