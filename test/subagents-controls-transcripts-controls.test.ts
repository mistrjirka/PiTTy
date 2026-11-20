import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pauseSubagent, resumeSubagent, steerSubagent, stopSubagent } from "../src/subagents/control.ts";
import { asyncRunsRoot, matchesSubagentSession, readSubagentRun } from "../src/subagents/artifacts.ts";
import { listMissionRuns } from "../src/subagents/missions.ts";
import { type SubagentRun } from "../src/types.ts";
import { useIsolatedSubagentRoots, roots, run, capturedMission, writeMissionFixture } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("subagent controls", () => {
	test("derives transcript paths for workflow steps that lack them", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-wf-transcript-"));
		roots.push(root);
		const sessionDir = path.join(root, "sessions");
		const childDir = path.join(
			sessionDir,
			"2026-08-16T00-00-00-000Z_session",
			"child-run-1",
			"run-0",
		);
		fs.mkdirSync(childDir, { recursive: true });
		const sessionFile = path.join(childDir, "session.jsonl");
		fs.writeFileSync(sessionFile, "{}\n");
		const artifactsDir = path.join(sessionDir, "subagent-artifacts");
		fs.mkdirSync(artifactsDir, { recursive: true });
		const transcriptPath = path.join(
			artifactsDir,
			"child-run-1_scout_0_transcript.jsonl",
		);
		fs.writeFileSync(transcriptPath, "{}\n");

		const asyncDir = path.join(root, "run");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "workflow-run-1",
				sessionId: "session-1",
				mode: "workflow",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				steps: [
					{
						agent: "scout",
						status: "running",
						workflowKey: "alpha",
						parentWorkflowRunId: "workflow-run-1",
						sessionFile,
					},
				],
			}),
		);
		const parsed = readSubagentRun(asyncDir);
		expect(parsed?.steps[0]?.transcriptPath).toBe(transcriptPath);
		expect(parsed?.steps[0]?.runId).toBe("child-run-1");
	});

	test("derives the transcript from the parent session file when child sessions live in a custom dir", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-wf-transcript-custom-"));
		roots.push(root);
		const customSessions = path.join(root, "custom-sessions");
		const childDir = path.join(customSessions, "child-run-2", "run-0");
		fs.mkdirSync(childDir, { recursive: true });
		const sessionFile = path.join(childDir, "session.jsonl");
		fs.writeFileSync(sessionFile, "{}\n");
		// The parent session file (and session-mode artifacts) live elsewhere
		// than the custom child session dir, so only the parent-derived
		// candidate can find the transcript.
		const parentSessionDir = path.join(root, "parent-sessions");
		const parentSessionFile = path.join(parentSessionDir, "parent.jsonl");
		const artifactsDir = path.join(parentSessionDir, "subagent-artifacts");
		fs.mkdirSync(artifactsDir, { recursive: true });
		const transcriptPath = path.join(artifactsDir, "child-run-2_scout_0_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "{}\n");

		const asyncDir = path.join(root, "run");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "workflow-run-3",
				sessionId: parentSessionFile,
				mode: "workflow",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				steps: [
					{
						agent: "scout",
						status: "running",
						workflowKey: "alpha",
						parentWorkflowRunId: "workflow-run-3",
						sessionFile,
					},
				],
			}),
		);
		const parsed = readSubagentRun(asyncDir);
		expect(parsed?.steps[0]?.transcriptPath).toBe(transcriptPath);
		expect(parsed?.steps[0]?.runId).toBe("child-run-2");
	});

	test("leaves steps without a child session layout untouched", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-wf-transcript-none-"));
		roots.push(root);
		const asyncDir = path.join(root, "run");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "workflow-run-2",
				sessionId: "session-1",
				mode: "workflow",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				steps: [
					{
						agent: "scout",
						status: "running",
						sessionFile: path.join(root, "flat-session.jsonl"),
					},
				],
			}),
		);
		const parsed = readSubagentRun(asyncDir);
		expect(parsed?.steps[0]?.transcriptPath).toBeUndefined();
		expect(parsed?.steps[0]?.runId).toBeUndefined();
	});

	test("derives the child run id even when the transcript is not written yet", () => {
		const root = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-wf-transcript-pending-"),
		);
		roots.push(root);
		const sessionDir = path.join(root, "sessions");
		const childDir = path.join(
			sessionDir,
			"2026-08-16T00-00-00-000Z_session",
			"child-run-7",
			"run-0",
		);
		fs.mkdirSync(childDir, { recursive: true });
		fs.writeFileSync(path.join(childDir, "session.jsonl"), "{}\n");
		fs.mkdirSync(path.join(sessionDir, "subagent-artifacts"), {
			recursive: true,
		});

		const asyncDir = path.join(root, "run");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "workflow-run-7",
				sessionId: "session-1",
				mode: "workflow",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				steps: [
					{
						agent: "scout",
						status: "running",
						sessionFile: path.join(childDir, "session.jsonl"),
					},
				],
			}),
		);
		const parsed = readSubagentRun(asyncDir);
		expect(parsed?.steps[0]?.runId).toBe("child-run-7");
		expect(parsed?.steps[0]?.transcriptPath).toBeUndefined();
	});

	test("resolves project-scoped transcripts from the run cwd", () => {
		const root = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-wf-transcript-project-"),
		);
		roots.push(root);
		const sessionDir = path.join(root, "sessions");
		const childDir = path.join(
			sessionDir,
			"2026-08-16T00-00-00-000Z_session",
			"child-run-8",
			"run-0",
		);
		fs.mkdirSync(childDir, { recursive: true });
		fs.writeFileSync(path.join(childDir, "session.jsonl"), "{}\n");
		const projectCwd = path.join(root, "project");
		const projectArtifacts = path.join(
			projectCwd,
			".pi",
			"subagents",
			"artifacts",
		);
		fs.mkdirSync(projectArtifacts, { recursive: true });
		const transcriptPath = path.join(
			projectArtifacts,
			"child-run-8_scout_0_transcript.jsonl",
		);
		fs.writeFileSync(transcriptPath, "{}\n");

		const asyncDir = path.join(root, "run");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "workflow-run-8",
				sessionId: "session-1",
				mode: "workflow",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				cwd: projectCwd,
				steps: [
					{
						agent: "scout",
						status: "running",
						sessionFile: path.join(childDir, "session.jsonl"),
					},
				],
			}),
		);
		const parsed = readSubagentRun(asyncDir);
		expect(parsed?.steps[0]?.transcriptPath).toBe(transcriptPath);
	});

	test("derives transcript paths for mission workflow children", () => {
		const root = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-mission-transcript-"),
		);
		roots.push(root);
		const owner = path.join(root, "sessions", "current.jsonl");
		fs.mkdirSync(path.dirname(owner), { recursive: true });
		fs.writeFileSync(owner, "{}\n");
		const workflowRunId = "workflow-mission-transcript";
		const mission = capturedMission(owner, workflowRunId);
		const childDir = path.join(
			path.dirname(owner),
			"base",
			"child-run-9",
			"run-0",
		);
		fs.mkdirSync(childDir, { recursive: true });
		const sessionPath = path.join(childDir, "session.jsonl");
		fs.writeFileSync(sessionPath, "{}\n");
		const artifactsDir = path.join(path.dirname(owner), "subagent-artifacts");
		fs.mkdirSync(artifactsDir, { recursive: true });
		const transcriptPath = path.join(
			artifactsDir,
			"child-run-9_impl-check-logic_0_transcript.jsonl",
		);
		fs.writeFileSync(transcriptPath, "{}\n");
		const child = { ...mission.workflowChildren[0]! };
		Reflect.deleteProperty(child, "runId");
		child.sessionPath = sessionPath;
		mission.workflowChildren[0] = child;
		writeMissionFixture(root, "first", mission);
		const runs = listMissionRuns({ sessionFile: owner }, process.cwd(), root);
		expect(runs[0]?.steps[0]?.transcriptPath).toBe(transcriptPath);
		expect(runs[0]?.steps[0]?.runId).toBe("child-run-9");
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

	test("resume removes the interrupt control", () => {
		const target = run();
		pauseSubagent(target);
		expect(
			JSON.parse(
				fs.readFileSync(
					path.join(target.asyncDir!, "control", "interrupt.json"),
					"utf8",
				),
			).type,
		).toBe("interrupt");
		resumeSubagent(target);
		let exists = true;
		try {
			fs.statSync(path.join(target.asyncDir!, "control", "interrupt.json"));
		} catch {
			exists = false;
		}
		expect(exists).toBe(false);
	});

	test("resume rejects foreground runs without touching disk", () => {
		const target: SubagentRun = {
			runId: "foreground",
			control: "foreground",
			mode: "single",
			state: "paused",
			steps: [],
		};
		expect(() => resumeSubagent(target)).toThrow(
			"read-only; file control is unsupported",
		);
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
		expect(() => resumeSubagent(target)).toThrow(
			"File-control directory is missing",
		);
	});

	test("rejects symlinked file-control directories", () => {
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pi-oc-outside-"));
		const link = fs.mkdtempSync(path.join(asyncRunsRoot(), "pi-oc-link-"));
		fs.rmSync(link, { recursive: true, force: true });
		fs.symlinkSync(outside, link, "dir");
		roots.push(outside, link);
		const target = { ...run(), asyncDir: link };
		expect(() => pauseSubagent(target)).toThrow(
			"File-control directory is not a regular directory",
		);
		expect(fs.existsSync(path.join(outside, "control"))).toBe(false);
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
});
