import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	pauseSubagent,
	steerSubagent,
	stopSubagent,
} from "../src/subagents/control.ts";
import {
	listSubagentRuns,
	matchesSubagentSession,
	readSubagentRun,
	subagentTempRoot,
} from "../src/subagents/artifacts.ts";
import {
	readSubagentConversation,
	readSubagentTranscript,
} from "../src/subagents/transcript.ts";
import {
	ownedSubagentTargetsForItems,
	reconcileSubagentSelection,
	subagentTargets,
	targetsForTool,
} from "../src/subagents/targets.ts";
import { initialItems } from "../src/state/conversation.ts";
import type { SubagentRun, ToolItem } from "../src/types.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function run(): SubagentRun {
	const asyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-oc-test-"));
	roots.push(asyncDir);
	return {
		runId: "run-1",
		asyncDir,
		mode: "single",
		state: "running",
		steps: [],
	};
}

describe("subagent controls", () => {
	test("uses the same uid-scoped temp root as pi-subagents", () => {
		if (process.getuid)
			expect(subagentTempRoot()).toBe(
				path.join(os.tmpdir(), `pi-subagents-uid-${process.getuid()}`),
			);
	});

	test("parses pi-subagents v1 progress and cost fields", () => {
		const target = run();
		fs.writeFileSync(
			path.join(target.asyncDir!, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "run-1",
				sessionId: "session-1",
				mode: "parallel",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				currentStep: 1,
				chainStepCount: 2,
				currentTool: "bash",
				currentPath: "src/app.ts",
				turnCount: 4,
				toolCount: 7,
				totalTokens: { input: 100, output: 50, total: 150 },
				totalCost: { inputTokens: 100, outputTokens: 50, costUsd: 0.0123 },
				steps: [
					{
						agent: "worker",
						status: "running",
						model: "provider/child",
						thinking: "high",
						contextWindow: 8192,
						currentTool: "edit",
						turnCount: 2,
						toolCount: 3,
						tokens: { input: 40, output: 20, total: 60 },
					},
				],
			}),
		);
		const parsed = readSubagentRun(target.asyncDir!);
		expect(parsed?.totalTokens).toBe(150);
		expect(parsed?.totalCost).toBe(0.0123);
		expect(parsed?.steps[0]?.currentTool).toBe("edit");
		expect(parsed?.steps[0]?.model).toBe("provider/child");
		expect(parsed?.steps[0]?.thinking).toBe("high");
		expect(parsed?.steps[0]?.contextWindow).toBe(8192);
		expect(parsed?.steps[0]?.tokens?.total).toBe(60);
	});

	test("matches restored runs whose artifact sessionId is the session file path", () => {
		const sessionFile = path.join(os.tmpdir(), "pi-session-test.jsonl");
		const restored: SubagentRun = {
			runId: "restored-1",
			asyncDir: path.join(os.tmpdir(), "restored-1"),
			sessionId: sessionFile,
			sessionFile,
			mode: "single",
			state: "running",
			steps: [],
		};
		expect(
			matchesSubagentSession(restored, {
				sessionId: "uuid-from-rpc",
				sessionFile,
			}),
		).toBe(true);
		expect(
			matchesSubagentSession(restored, {
				sessionId: "other",
				sessionFile: `${sessionFile}.other`,
			}),
		).toBe(false);
	});

	test("writes portable pause and stop requests", () => {
		const target = run();
		pauseSubagent(target);
		stopSubagent(target);
		try {
			expect(
				JSON.parse(
					fs.readFileSync(
						path.join(target.asyncDir!, "control", "interrupt.json"),
						"utf8",
					),
				).type,
			).toBe("interrupt");
		} catch (error) {
			throw new Error("interrupt control artifact is malformed", {
				cause: error,
			});
		}
		try {
			expect(
				JSON.parse(
					fs.readFileSync(
						path.join(target.asyncDir!, "control", "timeout.json"),
						"utf8",
					),
				).type,
			).toBe("timeout");
		} catch (error) {
			throw new Error("timeout control artifact is malformed", {
				cause: error,
			});
		}
	});

	test("rejects all file controls for foreground runs without writing", () => {
		const target: SubagentRun = {
			runId: "foreground",
			control: "foreground",
			mode: "single",
			state: "running",
			steps: [],
		};
		expect(() => pauseSubagent(target)).toThrow(
			"read-only; file control is unsupported",
		);
		expect(() => stopSubagent(target)).toThrow(
			"read-only; file control is unsupported",
		);
		expect(() => steerSubagent(target, "focus on tests")).toThrow(
			"read-only; file control is unsupported",
		);
	});

	test("reports a missing file-control directory separately", () => {
		const target: SubagentRun = {
			runId: "missing-dir",
			mode: "single",
			state: "running",
			steps: [],
		};
		expect(() => pauseSubagent(target)).toThrow(
			"File-control directory is missing",
		);
	});

	test("writes a steer request", () => {
		const target = run();
		steerSubagent(target, "focus on tests", 0);
		const dir = path.join(target.asyncDir!, "control", "steer-requests");
		const files = fs.readdirSync(dir);
		expect(files).toHaveLength(1);
		try {
			expect(
				JSON.parse(fs.readFileSync(path.join(dir, files[0]!), "utf8")).message,
			).toBe("focus on tests");
		} catch (error) {
			throw new Error("steer request artifact is malformed", { cause: error });
		}
	});

	test("sorts restored runs by launch order, not activity", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-oc-runs-"));
		roots.push(root);
		const completed = path.join(root, "completed");
		const running = path.join(root, "running");
		fs.mkdirSync(completed);
		fs.mkdirSync(running);
		fs.writeFileSync(
			path.join(completed, "status.json"),
			JSON.stringify({
				runId: "completed",
				mode: "single",
				state: "complete",
				startedAt: 1_000,
				lastUpdate: 9_000,
				steps: [],
			}),
		);
		fs.writeFileSync(
			path.join(running, "status.json"),
			JSON.stringify({
				runId: "running",
				mode: "single",
				state: "running",
				startedAt: 2_000,
				lastUpdate: 1_000,
				steps: [],
			}),
		);
		expect(listSubagentRuns(undefined, root).map((item) => item.runId)).toEqual(
			["completed", "running"],
		);
	});

	test("splits parallel runs into declared child index order", () => {
		const target = run();
		target.mode = "parallel";
		target.steps = [
			{
				index: 0,
				agent: "reviewer",
				status: "completed",
				transcriptPath: "/tmp/reviewer.jsonl",
			},
			{
				index: 1,
				agent: "implementer",
				status: "running",
				sessionFile: "/tmp/implementer-session.jsonl",
				transcriptPath: "/tmp/implementer.jsonl",
			},
		];
		const targets = subagentTargets([target]);
		expect(targets.map((item) => item.key)).toEqual(["run-1:1", "run-1:0"]);
		expect(targets[0]?.label).toBe("implementer #2");
		expect(targets[0]?.canSteer).toBe(true);
		expect(targets[1]?.canSteer).toBe(false);
	});

	test("keeps same-start parallel runs grouped and index ordered", () => {
		const first = run();
		first.runId = "run-a";
		first.startedAt = 1_000;
		first.steps = [
			{ index: 0, agent: "a0", status: "completed", lastActivityAt: 9_000 },
			{ index: 1, agent: "a1", status: "running", lastActivityAt: 1_000 },
		];
		const second = run();
		second.runId = "run-b";
		second.startedAt = 1_000;
		second.steps = [
			{ index: 0, agent: "b0", status: "running", lastActivityAt: 8_000 },
			{ index: 1, agent: "b1", status: "completed", lastActivityAt: 2_000 },
		];
		expect(
			subagentTargets([first, second]).map((target) => target.key),
		).toEqual(["run-a:1", "run-b:0", "run-a:0", "run-b:1"]);
	});

	test("groups active targets first and keeps stable launch order despite activity updates", () => {
		const first = run();
		first.runId = "run-a";
		first.startedAt = 1_000;
		first.steps = [
			{ index: 0, agent: "a0", status: "running", lastActivityAt: 9_000 },
			{ index: 1, agent: "a1", status: "running", lastActivityAt: 1_000 },
		];
		const second = run();
		second.runId = "run-b";
		second.startedAt = 2_000;
		second.steps = [
			{ index: 0, agent: "b0", status: "completed", lastActivityAt: 8_000 },
			{ index: 1, agent: "b1", status: "completed", lastActivityAt: 2_000 },
		];
		const before = subagentTargets([first, second]).map((target) => target.key);
		first.steps[0]!.lastActivityAt = 100;
		first.steps[1]!.lastActivityAt = 100_000;
		second.steps[0]!.lastActivityAt = 100;
		second.steps[1]!.lastActivityAt = 100_000;
		expect(
			subagentTargets([first, second]).map((target) => target.key),
		).toEqual(before);
	});

	test("moves a target between groups when its active state changes", () => {
		const first = run();
		first.runId = "run-a";
		first.startedAt = 1_000;
		first.steps = [
			{ index: 0, agent: "a0", status: "running" },
			{ index: 1, agent: "a1", status: "completed" },
		];
		const second = run();
		second.runId = "run-b";
		second.startedAt = 2_000;
		second.steps = [
			{ index: 0, agent: "b0", status: "running" },
			{ index: 1, agent: "b1", status: "completed" },
		];
		expect(
			subagentTargets([first, second]).map((target) => target.key),
		).toEqual(["run-a:0", "run-b:0", "run-a:1", "run-b:1"]);
		first.steps[1]!.status = "running";
		expect(
			subagentTargets([first, second]).map((target) => target.key),
		).toEqual(["run-a:0", "run-a:1", "run-b:0", "run-b:1"]);
	});

	test("reconciles a stale foreground selection to its unique active child", () => {
		const previous = subagentTargets(
			[],
			[
				{
					kind: "tool",
					id: "fg",
					toolCallId: "fg-call",
					name: "subagent",
					args: {},
					output: "",
					timestamp: 1,
					status: "done",
					isError: false,
					details: {
						progress: [{ sessionFile: "/tmp/child", status: "done" }],
					},
				},
			],
		);
		const activeRun = run();
		activeRun.runId = "async";
		activeRun.steps = [
			{
				index: 0,
				agent: "child",
				status: "running",
				sessionFile: "/tmp/child",
			},
		];
		const next = subagentTargets([activeRun]);
		expect(reconcileSubagentSelection(previous[0]?.key, previous, next)).toBe(
			"async:0",
		);
		expect(previous[0]?.canSteer).toBe(false);
	});

	test("does not reconcile unrelated or ambiguous child identities", () => {
		const previousTarget = subagentTargets(
			[],
			[
				{
					kind: "tool",
					id: "fg",
					toolCallId: "fg-call",
					name: "subagent",
					args: {},
					output: "",
					timestamp: 1,
					status: "done",
					isError: false,
					details: {
						progress: [{ sessionFile: "/tmp/child", status: "done" }],
					},
				},
			],
		)[0];
		const first = run();
		first.runId = "async-a";
		first.steps = [
			{ index: 0, agent: "a", status: "running", sessionFile: "/tmp/other" },
		];
		const second = run();
		second.runId = "async-b";
		second.steps = [
			{ index: 0, agent: "b", status: "running", sessionFile: "/tmp/child" },
		];
		const third = run();
		third.runId = "async-c";
		third.steps = [
			{ index: 0, agent: "c", status: "running", sessionFile: "/tmp/child" },
		];
		const next = subagentTargets([first, second, third]);
		const ambiguous = next[1]
			? [
					{ ...next[1], key: "ambiguous-a" },
					{ ...next[1], key: "ambiguous-b" },
				]
			: [];
		expect(
			reconcileSubagentSelection(
				previousTarget?.key,
				previousTarget ? [previousTarget] : [],
				ambiguous,
			),
		).toBe("ambiguous-a");
		expect(previousTarget?.canSteer).toBe(false);
	});

	test("dedupes resumed children by session file and keeps the active transcript", () => {
		const original = run();
		original.runId = "failed-run";
		original.state = "failed";
		original.steps = [
			{
				index: 0,
				agent: "old-label",
				status: "completed",
				sessionFile: "/tmp/shared-child.jsonl",
				transcriptPath: "/tmp/missing-old.jsonl",
			},
		];
		const resumed = run();
		resumed.runId = "resumed-run";
		resumed.steps = [
			{
				index: 0,
				agent: "new-label",
				status: "running",
				sessionFile: "/tmp/shared-child.jsonl",
				transcriptPath: "/tmp/live-child.jsonl",
			},
		];
		const targets = subagentTargets([original, resumed]);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.active).toBe(true);
		expect(targets[0]?.label).toBe("new-label");
		expect(targets[0]?.transcriptPath).toBe("/tmp/live-child.jsonl");
	});

	test("keeps distinct parallel child indexes sharing a session file", () => {
		const target = run();
		target.mode = "parallel";
		target.steps = [
			{
				index: 0,
				agent: "first",
				status: "running",
				sessionFile: "/tmp/shared-parallel.jsonl",
			},
			{
				index: 1,
				agent: "second",
				status: "running",
				sessionFile: "/tmp/shared-parallel.jsonl",
			},
		];
		expect(subagentTargets([target])).toHaveLength(2);
	});

	test("dedupes resumed children using the run session file fallback", () => {
		const original = run();
		original.runId = "original-run";
		original.sessionFile = "/tmp/shared-run-session.jsonl";
		original.steps = [{ index: 0, agent: "old", status: "completed" }];
		const resumed = run();
		resumed.runId = "resumed-run";
		resumed.sessionFile = original.sessionFile;
		resumed.steps = [{ index: 0, agent: "new", status: "running" }];
		const targets = subagentTargets([original, resumed]);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.label).toBe("new");
	});

	test("keeps distinct foreground entries sharing a session file", () => {
		const tool = {
			kind: "tool" as const,
			id: "foreground-indexed",
			toolCallId: "call-foreground-indexed",
			name: "subagent",
			args: {},
			output: "",
			details: {
				progress: [
					{
						agent: "first",
						status: "running",
						sessionFile: "/tmp/shared-foreground.jsonl",
					},
					{
						agent: "second",
						status: "running",
						sessionFile: "/tmp/shared-foreground.jsonl",
					},
				],
			},
			timestamp: Date.now(),
			status: "streaming" as const,
			isError: false,
		};
		expect(subagentTargets([], [tool])).toHaveLength(2);
	});

	test("reads a specifically selected parallel child transcript", () => {
		const target = run();
		target.mode = "parallel";
		const first = path.join(target.asyncDir!, "first.jsonl");
		const second = path.join(target.asyncDir!, "second.jsonl");
		fs.writeFileSync(
			first,
			JSON.stringify({
				recordType: "message",
				role: "assistant",
				text: "first child",
				ts: 1,
			}),
		);
		fs.writeFileSync(
			second,
			JSON.stringify({
				recordType: "message",
				role: "assistant",
				text: "second child",
				ts: 2,
			}),
		);
		target.steps = [
			{ index: 0, agent: "first", status: "running", transcriptPath: first },
			{ index: 1, agent: "second", status: "running", transcriptPath: second },
		];
		const items = readSubagentConversation(target, 160, 1);
		expect(items).toHaveLength(1);
		expect(items[0]?.kind === "assistant" ? items[0].text : "").toBe(
			"second child",
		);
	});

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
		expect(target?.run.currentTool).toBe("bash");
		expect(target?.run.turnCount).toBe(3);
		expect(target?.run.totalTokens).toBe(99);
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

	test("nearest-match fallback attaches a run to the spawning tool call, not an earlier unrelated one", () => {
		const earlierTool: ToolItem = {
			kind: "tool",
			id: "earlier-item",
			toolCallId: "earlier-call",
			name: "subagent",
			args: {},
			output: "",
			details: {},
			timestamp: 1_000,
			status: "done",
			isError: false,
		};
		const laterTool: ToolItem = {
			kind: "tool",
			id: "later-item",
			toolCallId: "later-call",
			name: "subagent",
			args: {},
			output: "",
			details: {},
			timestamp: 5_000,
			status: "streaming",
			isError: false,
		};
		const earlierRun = run();
		earlierRun.runId = "run-earlier";
		earlierRun.startedAt = 1_050;
		earlierRun.steps = [
			{ index: 0, agent: "earlier-child", status: "running" },
		];
		const laterRun = run();
		laterRun.runId = "run-later";
		laterRun.startedAt = 5_050;
		laterRun.mode = "parallel";
		laterRun.steps = [
			{ index: 0, agent: "later-child-a", status: "running" },
			{ index: 1, agent: "later-child-b", status: "running" },
		];
		const owned = ownedSubagentTargetsForItems(
			[earlierTool, laterTool],
			subagentTargets([earlierRun, laterRun]),
		);
		// The earlier (legacy, runId-less) tool call keeps its own nearby run, and
		// the later parallel run attaches to the later tool call instead of
		// leaking onto the earlier one.
		expect(owned.get("earlier-item") ?? []).toHaveLength(1);
		expect(owned.get("earlier-item")?.[0]?.run.runId).toBe("run-earlier");
		expect(owned.get("later-item") ?? []).toHaveLength(2);
		expect(
			owned.get("later-item")?.map((target) => target.run.runId),
		).toEqual(["run-later", "run-later"]);
	});

	test("nearest-match fallback drops a run that is outside the window", () => {
		const tool: ToolItem = {
			kind: "tool",
			id: "far-item",
			toolCallId: "far-call",
			name: "subagent",
			args: {},
			output: "",
			details: {},
			timestamp: 100_000,
			status: "streaming",
			isError: false,
		};
		const farRun = run();
		farRun.runId = "run-far";
		farRun.startedAt = 10_000; // >30s from tool.timestamp
		farRun.steps = [{ index: 0, agent: "far-child", status: "running" }];
		const owned = ownedSubagentTargetsForItems(
			[tool],
			subagentTargets([farRun]),
		);
		expect(owned.get("far-item") ?? []).toHaveLength(0);
	});

	test("nearest-match fallback does not attach a run to a non-subagent tool call", () => {
		const tool: ToolItem = {
			kind: "tool",
			id: "other-item",
			toolCallId: "other-call",
			name: "bash",
			args: {},
			output: "",
			details: {},
			timestamp: 5_000,
			status: "streaming",
			isError: false,
		};
		const nearbyRun = run();
		nearbyRun.runId = "run-near";
		nearbyRun.startedAt = 5_050;
		nearbyRun.steps = [{ index: 0, agent: "near-child", status: "running" }];
		const owned = ownedSubagentTargetsForItems(
			[tool],
			subagentTargets([nearbyRun]),
		);
		expect(owned.get("other-item") ?? []).toHaveLength(0);
	});
});
