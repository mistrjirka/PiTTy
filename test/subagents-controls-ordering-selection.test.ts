import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listSubagentRuns } from "../src/subagents/artifacts.ts";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import { reconcileSubagentSelection, subagentTargets } from "../src/subagents/targets.ts";
import { useIsolatedSubagentRoots, roots, run } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("subagent controls", () => {
	test("keeps live transcript discovery in refreshed run listings", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-oc-refresh-"));
		roots.push(root);
		const cwd = path.join(root, "project");
		const asyncDir = path.join(root, "run");
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		fs.mkdirSync(asyncDir, { recursive: true });
		const transcriptPath = path.join(artifacts, "uuid_worker_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		fs.writeFileSync(
			transcriptPath.replace("_transcript.jsonl", "_meta.json"),
			JSON.stringify({ agent: "worker", runId: "child", timestamp: Date.now() }),
		);
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId: "run-refresh",
				mode: "single",
				state: "running",
				cwd,
				steps: [{ index: 0, agent: "worker", status: "running", startedAt: Date.now() }],
			}),
		);

		const listed = listSubagentRuns(undefined, root);
		expect(listed[0]?.steps[0]?.transcriptPath).toBe(transcriptPath);
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
		expect(targets.map((item) => item.key)).toEqual(["run-1:0", "run-1:1"]);
		expect(targets[1]?.label).toBe("implementer #2");
		expect(targets[1]?.canSteer).toBe(true);
		expect(targets[0]?.canSteer).toBe(false);
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
		).toEqual(["run-a:0", "run-a:1", "run-b:0", "run-b:1"]);
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

	test("keeps the most recently launched run at the top regardless of activity changes", () => {
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
		).toEqual(["run-b:0", "run-b:1", "run-a:0", "run-a:1"]);
		first.steps[1]!.status = "running";
		expect(
			subagentTargets([first, second]).map((target) => target.key),
		).toEqual(["run-b:0", "run-b:1", "run-a:0", "run-a:1"]);
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
});
