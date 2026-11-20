import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyDerivedChildTranscript } from "../src/subagents/artifacts.ts";
import { subagentActivityAt, substantiveSubagentActivityAt } from "../src/subagents/transcript.ts";
import { createSubagentTranscriptCache } from "../src/subagents/transcript-cache.ts";
import { subagentTargets } from "../src/subagents/targets.ts";
import { type ConversationItem, type SubagentStep } from "../src/types.ts";
import { useIsolatedSubagentRoots, roots, run } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("subagent controls", () => {
	test("uses persisted activity timestamps when projecting targets", () => {
		const stepRun = run();
		stepRun.steps = [
			{
				index: 0,
				agent: "one",
				status: "running",
				lastActivityAt: 123,
				currentToolStartedAt: 99,
			},
		];
		expect(subagentTargets([stepRun])[0]?.lastUpdate).toBe(123);

		const runOnly = run();
		runOnly.lastActivityAt = 456;
		runOnly.currentToolStartedAt = 400;
		expect(subagentTargets([runOnly])[0]?.lastUpdate).toBe(456);
	});

	test("uses persisted activity precedence before transcript fallback", () => {
		const stepRun = run();
		stepRun.endedAt = 400;
		const step: SubagentStep = {
			index: 0,
			agent: "one",
			status: "running",
			lastActivityAt: 100,
			currentToolStartedAt: 200,
			endedAt: 300,
		};
		stepRun.steps = [step];

		expect(subagentActivityAt(stepRun, 0)).toBe(100);
		delete step.lastActivityAt;
		expect(subagentActivityAt(stepRun, 0)).toBe(200);
		delete step.currentToolStartedAt;
		expect(subagentActivityAt(stepRun, 0)).toBe(300);
		delete step.endedAt;
		expect(subagentActivityAt(stepRun, 0)).toBe(400);

		const runOnly = run();
		runOnly.endedAt = 700;
		runOnly.currentToolStartedAt = 600;
		runOnly.lastActivityAt = 500;
		expect(subagentActivityAt(runOnly)).toBe(500);
		delete runOnly.lastActivityAt;
		expect(subagentActivityAt(runOnly)).toBe(600);
		delete runOnly.currentToolStartedAt;
		expect(subagentActivityAt(runOnly)).toBe(700);
	});

	test("ignores streaming-only transcript updates for last activity", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "transcript.jsonl");
		target.transcriptPath = transcriptPath;
		fs.writeFileSync(
			transcriptPath,
			[
				JSON.stringify({
					recordType: "message",
					role: "assistant",
					text: "streaming",
					ts: 100,
				}),
				JSON.stringify({
					recordType: "message",
					role: "assistant",
					text: "reformatted",
					ts: 200,
				}),
				JSON.stringify({ recordType: "tool_start", toolName: "bash", ts: 300 }),
				JSON.stringify({
					recordType: "message",
					role: "assistant",
					text: "more streaming",
					ts: 400,
				}),
				JSON.stringify({ recordType: "tool_end", toolName: "bash", ts: 350 }),
			].join("\n"),
		);
		expect(substantiveSubagentActivityAt(target)).toBe(350);
		expect(subagentActivityAt(target)).toBe(350);
		expect(subagentTargets([target])[0]?.lastUpdate).toBe(350);
	});

	test("reuses selected transcript items for sibling updates", () => {
		const first = run();
		first.steps = [
			{ index: 0, agent: "one", status: "running", lastActivityAt: 10 },
		];
		const second = run();
		second.runId = "run-2";
		second.steps = [
			{ index: 0, agent: "two", status: "running", lastActivityAt: 20 },
		];
		let reads = 0;
		const cache = createSubagentTranscriptCache(() => {
			reads += 1;
			return [];
		});
		const initial = subagentTargets([first, second]);
		const items = cache(initial[0], true);
		const siblingUpdate = subagentTargets([
			first,
			{ ...second, lastActivityAt: 30 },
		]);
		expect(cache(siblingUpdate[0], true)).toBe(items);
		expect(reads).toBe(1);

		const selectedUpdate = subagentTargets([
			{ ...first, steps: [{ ...first.steps[0]!, lastActivityAt: 40 }] },
			second,
		]);
		expect(cache(selectedUpdate[0], true)).not.toBe(items);
		expect(reads).toBe(2);
	});

	test("keeps transcript item references stable across fresh reads", () => {
		const targetRun = run();
		targetRun.steps = [{ index: 0, agent: "worker", status: "running", lastActivityAt: 1 }];
		let output: ConversationItem[] = [
			{ kind: "user", id: "user-1", text: "task", timestamp: 1, optimistic: false },
			{ kind: "tool", id: "tool-1", toolCallId: "call-1", name: "bash", args: "pwd", output: "", timestamp: 2, startedAt: 2, status: "streaming", isError: false },
		];
		const cache = createSubagentTranscriptCache(() => output.map((item) => ({ ...item })));
		const target = subagentTargets([targetRun])[0]!;
		const first = cache(target, true);
		targetRun.steps[0]!.lastActivityAt = 2;
		const unchanged = cache(subagentTargets([targetRun])[0], true);
		expect(unchanged).not.toBe(first);
		expect(unchanged[0]).toBe(first[0]);
		expect(unchanged[1]).toBe(first[1]);
		output = output.map((item) => item.kind === "tool" ? { ...item, output: "done", status: "done" } : item);
		targetRun.steps[0]!.lastActivityAt = 3;
		const changed = cache(subagentTargets([targetRun])[0], true);
		expect(changed[0]).toBe(first[0]);
		expect(changed[1]).not.toBe(first[1]);
		const callsBefore = changed;
		expect(cache(subagentTargets([targetRun])[0], true)).toBe(callsBefore);
	});

	test("refreshes inspected transcript when the file changes without an activity update", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-transcript-cache-"));
		roots.push(root);
		const transcriptPath = path.join(root, "transcript.jsonl");
		fs.writeFileSync(transcriptPath, "first\n");
		const targetRun = run();
		targetRun.transcriptPath = transcriptPath;
		targetRun.lastActivityAt = 1;
		let reads = 0;
		const cache = createSubagentTranscriptCache(() => {
			reads += 1;
			return [];
		});
		const target = subagentTargets([targetRun])[0]!;

		cache(target, true);
		fs.appendFileSync(transcriptPath, "second\n");
		cache(target, true);

		expect(reads).toBe(2);
	});

	test("discovers live transcripts using real metadata and verified names", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-artifacts-"));
		roots.push(cwd);
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const now = Date.now();
		const transcriptPath = path.join(artifacts, "uuid_worker_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		fs.writeFileSync(transcriptPath.replace("_transcript.jsonl", "_meta.json"), JSON.stringify({ agent: "worker", runId: "child", timestamp: now }));
		const targetRun = run();
		targetRun.cwd = cwd;
		targetRun.startedAt = now;
		const step: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-live", status: "running", startedAt: now };
		applyDerivedChildTranscript(step, cwd);
		expect(step.transcriptPath).toBe(transcriptPath);

		const indexedPath = path.join(artifacts, "uuid_worker_2_transcript.jsonl");
		fs.writeFileSync(indexedPath, "");
		fs.writeFileSync(indexedPath.replace("_transcript.jsonl", "_meta.json"), JSON.stringify({ agent: "worker", runId: "child-2", timestamp: now }));
		const indexedStep: SubagentStep = { index: 2, agent: "worker", workflowKey: "k-indexed", status: "running", startedAt: now };
		applyDerivedChildTranscript(indexedStep, cwd);
		expect(indexedStep.transcriptPath).toBe(indexedPath);
		const wrongIndexStep: SubagentStep = { index: 1, agent: "worker", workflowKey: "k-wrong", status: "running", startedAt: now };
		applyDerivedChildTranscript(wrongIndexStep, cwd);
		expect(wrongIndexStep.transcriptPath).toBeUndefined();
	});

	test("fails closed for stale, ambiguous, or mismatched live artifacts", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-artifacts-"));
		roots.push(cwd);
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const now = Date.now();
		const writeArtifact = (name: string, agent: string): string => {
			const transcriptPath = path.join(artifacts, name);
			fs.writeFileSync(transcriptPath, "");
			fs.writeFileSync(transcriptPath.replace("_transcript.jsonl", "_meta.json"), JSON.stringify({ agent, runId: name, timestamp: now }));
			return transcriptPath;
		};
		const oldPath = writeArtifact("old_worker_transcript.jsonl", "worker");
		fs.utimesSync(oldPath, new Date(now - 10_000), new Date(now - 10_000));
		const oldRun = run();
		oldRun.cwd = cwd;
		oldRun.startedAt = now;
		const oldStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-old", status: "running", startedAt: now };
		applyDerivedChildTranscript(oldStep, cwd);
		expect(oldStep.transcriptPath).toBeUndefined();

		writeArtifact("one_worker_transcript.jsonl", "worker");
		writeArtifact("two_worker_transcript.jsonl", "worker");
		const ambiguousStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-ambiguous", status: "running", startedAt: now };
		applyDerivedChildTranscript(ambiguousStep, cwd);
		expect(ambiguousStep.transcriptPath).toBeUndefined();
		const mismatchPath = writeArtifact("mismatch_worker_transcript.jsonl", "other");
		const mismatchStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-mismatch", status: "running", startedAt: now };
		applyDerivedChildTranscript(mismatchStep, cwd);
		expect(mismatchStep.transcriptPath).toBeUndefined();
		expect(fs.existsSync(mismatchPath)).toBe(true);
	});

	test("scopes live discovery to a real parent session path", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-parent-artifacts-"));
		roots.push(root);
		const parentSessionFile = path.join(root, "session.jsonl");
		const artifacts = path.join(root, "subagent-artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const transcriptPath = path.join(artifacts, "uuid_worker_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		fs.writeFileSync(transcriptPath.replace("_transcript.jsonl", "_meta.json"), JSON.stringify({ agent: "worker", runId: "child", timestamp: Date.now() }));
		const pathStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-parent", status: "running", startedAt: Date.now() };
		applyDerivedChildTranscript(pathStep, undefined, parentSessionFile);
		expect(pathStep.transcriptPath).toBe(transcriptPath);
		const idStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-id", status: "running", startedAt: Date.now() };
		applyDerivedChildTranscript(idStep, undefined, "session-id");
		expect(idStep.transcriptPath).toBeUndefined();
	});

	test("live discovery ignores non-running steps and never leaks across scopes", () => {
		const cwdA = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-scope-a-"));
		roots.push(cwdA);
		const artifactsA = path.join(cwdA, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifactsA, { recursive: true });
		const now = Date.now();
		const transcriptPath = path.join(artifactsA, "uuid_worker_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		fs.writeFileSync(
			transcriptPath.replace("_transcript.jsonl", "_meta.json"),
			JSON.stringify({ agent: "worker", runId: "child", timestamp: now }),
		);

		const completedStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-done", status: "completed" };
		applyDerivedChildTranscript(completedStep, cwdA);
		expect(completedStep.transcriptPath).toBeUndefined();

		const cwdB = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-scope-b-"));
		roots.push(cwdB);
		const scopedStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-scope", status: "running", startedAt: now };
		applyDerivedChildTranscript(scopedStep, cwdB);
		expect(scopedStep.transcriptPath).toBeUndefined();

		const runningStep: SubagentStep = { index: 0, agent: "worker", workflowKey: "k-live", status: "running", startedAt: now };
		applyDerivedChildTranscript(runningStep, cwdA);
		expect(runningStep.transcriptPath).toBe(transcriptPath);
	});
});
