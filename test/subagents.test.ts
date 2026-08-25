import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	pauseSubagent,
	steerSubagent,
	stopSubagent,
} from "../src/subagents/control.ts";
import {
	applyDerivedChildTranscript,
	childRunIdFromSessionFile,
	listSubagentRuns,
	matchesSubagentSession,
	readSubagentRun,
	subagentTempRoot,
} from "../src/subagents/artifacts.ts";
import {
	listMissionRuns,
	mergeMissionRuns,
} from "../src/subagents/missions.ts";
import {
	readSubagentConversation,
	readSubagentTranscript,
	subagentActivityAt,
	substantiveSubagentActivityAt,
} from "../src/subagents/transcript.ts";
import { createSubagentTranscriptCache } from "../src/subagents/transcript-cache.ts";
import {
	ownedSubagentTargetsForItems,
	reconcileSubagentSelection,
	subagentTargets,
	targetsForTool,
	type SubagentTarget,
} from "../src/subagents/targets.ts";
import { initialItems } from "../src/state/conversation.ts";
import type { ConversationItem, SubagentRun, SubagentStep, ToolItem } from "../src/types.ts";

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

const MISSION_CHILD_KEYS = [
	"logic",
	"types",
	"smell",
	"architecture",
	"reuse",
	"security",
] as const;

function capturedMission(
	ownerSessionId: string,
	workflowRunId: string,
	status = "active",
) {
	return {
		schemaVersion: 1,
		id: "captured-mission",
		title: "[prompt redacted]",
		objective: "[prompt redacted]",
		status,
		createdAt: "2026-08-15T14:22:59.000Z",
		updatedAt: "2026-08-15T14:23:00.000Z",
		ownerSessionId,
		runs: [],
		workflowChildren: MISSION_CHILD_KEYS.map((key, index) => ({
			workflowRunId,
			key: `impl-check-${key}`,
			status: "running",
			agent: `impl-check-${key}`,
			startedAt: "2026-08-15T14:22:59.000Z",
			updatedAt: "2026-08-15T14:23:00.000Z",
			runId: `child-${index}`,
			artifactPaths: [],
			sessionPath: `/tmp/child-${index}.jsonl`,
			heartbeat: {
				status: "running",
				updatedAt: "2026-08-15T14:23:01.000Z",
			},
		})),
		decisions: [],
		artifacts: [],
		receipts: [],
	};
}

function writeMissionFixture(root: string, name: string, value: unknown): void {
	fs.writeFileSync(path.join(root, `${name}.json`), JSON.stringify(value));
}

describe("subagent controls", () => {
	test("projects the captured mission shape into six scoped read-only children", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mission-test-"));
		roots.push(root);
		const workflowRunId = "workflow-captured";
		const owner = path.join(root, "sessions", "current.jsonl");
		const mission = capturedMission(owner, workflowRunId);
		writeMissionFixture(root, "mission", mission);

		const runs = listMissionRuns({ sessionFile: owner }, process.cwd(), root);
		const targets = subagentTargets(runs);
		expect(targets).toHaveLength(6);
		expect(targets.map((target) => target.key).sort()).toEqual(
			mission.workflowChildren
				.map((child) => `${workflowRunId}:${child.key}`)
				.sort(),
		);
		expect(
			targets.every(
				(target) =>
					target.active &&
					!target.canSteer &&
					Boolean(target.sessionFile) &&
					target.parentWorkflowRunId === workflowRunId,
			),
		).toBe(true);
		expect(runs[0]?.startedAt).toBe(Date.parse("2026-08-15T14:22:59.000Z"));
		expect(runs[0]?.lastUpdate).toBe(Date.parse("2026-08-15T14:23:01.000Z"));
		expect(listMissionRuns({}, process.cwd(), root)).toEqual([]);
		expect(
			listMissionRuns(
				{ sessionFile: path.join(root, "other.jsonl") },
				process.cwd(),
				root,
			),
		).toEqual([]);

		const terminalTool: ToolItem = {
			kind: "tool",
			id: "captured-workflow",
			toolCallId: workflowRunId,
			name: "subagent",
			args: {},
			output: "stopped",
			details: {
				mode: "workflow",
				runId: workflowRunId,
				workflow: {
					trace: mission.workflowChildren.map((child) => ({
						operation: "run",
						key: child.key,
						agent: child.agent,
						state: "stopped",
					})),
				},
			},
			timestamp: Date.parse("2026-08-15T14:23:02.000Z"),
			status: "error",
			isError: true,
		};
		const terminalTargets = subagentTargets(runs, [terminalTool]);
		expect(terminalTargets).toHaveLength(6);
		expect(terminalTargets.every((target) => target.state === "stopped")).toBe(
			true,
		);
		expect(terminalTargets.every((target) => Boolean(target.sessionFile))).toBe(
			true,
		);
		expect(terminalTargets.map((target) => target.key).sort()).toEqual(
			targets.map((target) => target.key).sort(),
		);

		const persisted: SubagentRun = {
			runId: workflowRunId,
			mode: "workflow",
			state: "completed",
			steps: [],
		};
		expect(
			mergeMissionRuns(
				[persisted],
				{ sessionFile: owner },
				process.cwd(),
				root,
			),
		).toEqual([persisted]);
	});

	test("projects paused and stopped children without dropping running siblings", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mission-status-"));
		roots.push(root);
		const workflowRunId = "workflow-statuses";
		const owner = path.join(root, "sessions", "current.jsonl");
		const mission = capturedMission(owner, workflowRunId);
		mission.workflowChildren[0]!.status = "paused";
		mission.workflowChildren[0]!.heartbeat.status = "paused";
		mission.workflowChildren[1]!.status = "stopped";
		mission.workflowChildren[1]!.heartbeat.status = "stopped";
		writeMissionFixture(root, "mission", mission);

		const runs = listMissionRuns({ sessionFile: owner }, process.cwd(), root);
		const targets = subagentTargets(runs);
		expect(targets).toHaveLength(6);
		expect(targets.map((target) => [target.key, target.state]).sort()).toEqual(
			mission.workflowChildren
				.map((child) => [
					`${workflowRunId}:${child.key}`,
					child.heartbeat.status,
				])
				.sort(),
		);
		expect(targets.slice(2).every((target) => target.active)).toBe(true);
		expect(targets.slice(2).every((target) => target.canSteer === false)).toBe(
			true,
		);
		expect(targets[0]?.active).toBe(false);
		expect(targets[0]?.canSteer).toBe(false);
		expect(targets[1]?.active).toBe(false);
		expect(targets[1]?.canSteer).toBe(false);
	});

	test("derives the upstream project mission directory from the session path", () => {
		const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-root-"));
		roots.push(agentRoot);
		const projectRoot = path.join(agentRoot, "project");
		const owner = path.join(agentRoot, "sessions", "current.jsonl");
		const workflowRunId = "workflow-derived-root";
		const digest = createHash("sha256")
			.update(path.resolve(projectRoot))
			.digest("hex");
		const missionRoot = path.join(agentRoot, "missions", "projects", digest);
		fs.mkdirSync(missionRoot, { recursive: true });
		writeMissionFixture(
			missionRoot,
			"mission",
			capturedMission(owner, workflowRunId),
		);
		expect(
			listMissionRuns({ sessionFile: owner }, projectRoot).map(
				(run) => run.runId,
			),
		).toEqual([workflowRunId]);
	});

	test("fails closed for terminal, malformed, or ambiguous mission children", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mission-invalid-"));
		roots.push(root);
		const owner = path.join(root, "sessions", "current.jsonl");
		const workflowRunId = "workflow-ambiguous";
		const mission = capturedMission(owner, workflowRunId);
		writeMissionFixture(root, "first", mission);
		writeMissionFixture(root, "second", {
			...mission,
			id: "duplicate-mission",
		});
		expect(
			listMissionRuns({ sessionFile: owner }, process.cwd(), root),
		).toEqual([]);

		fs.rmSync(path.join(root, "second.json"));
		writeMissionFixture(root, "first", { ...mission, status: "failed" });
		expect(
			listMissionRuns({ sessionFile: owner }, process.cwd(), root),
		).toEqual([]);

		const malformedHeartbeat = capturedMission(owner, workflowRunId);
		malformedHeartbeat.workflowChildren[0]!.heartbeat.updatedAt = "not-a-date";
		writeMissionFixture(root, "first", malformedHeartbeat);
		expect(
			listMissionRuns({ sessionFile: owner }, process.cwd(), root),
		).toEqual([]);

		const duplicateKey = capturedMission(owner, workflowRunId);
		duplicateKey.workflowChildren[1]!.key =
			duplicateKey.workflowChildren[0]!.key;
		writeMissionFixture(root, "first", duplicateKey);
		expect(
			listMissionRuns({ sessionFile: owner }, process.cwd(), root),
		).toEqual([]);
	});
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
				workflowKey: "workflow-root-key",
				parentWorkflowRunId: "workflow-parent-run",
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
						workflowKey: "workflow-step",
						parentWorkflowRunId: "parent-workflow-run",
						runId: "workflow-child-run",
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
		expect(parsed?.workflowKey).toBe("workflow-root-key");
		expect(parsed?.parentWorkflowRunId).toBe("workflow-parent-run");
		expect(parsed?.steps[0]?.currentTool).toBe("edit");
		expect(parsed?.steps[0]?.model).toBe("provider/child");
		expect(parsed?.steps[0]?.thinking).toBe("high");
		expect(parsed?.steps[0]?.contextWindow).toBe(8192);
		expect(parsed?.steps[0]?.tokens?.total).toBe(60);
		expect(parsed?.steps[0]?.workflowKey).toBe("workflow-step");
		expect(parsed?.steps[0]?.parentWorkflowRunId).toBe("parent-workflow-run");
		expect(parsed?.steps[0]?.runId).toBe("workflow-child-run");
	});

	test("extracts child run ids only from child session file layouts", () => {
		expect(childRunIdFromSessionFile("/a/b/c/run-0/session.jsonl")).toBe("c");
		expect(childRunIdFromSessionFile("/a/b/c/run-2/session.jsonl")).toBe("c");
		expect(childRunIdFromSessionFile("/a/b/c/session.jsonl")).toBeUndefined();
		expect(
			childRunIdFromSessionFile("/a/b/c/run-x/session.jsonl"),
		).toBeUndefined();
		expect(childRunIdFromSessionFile(undefined)).toBeUndefined();
		expect(childRunIdFromSessionFile("")).toBeUndefined();
	});

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
		expect(owned.get("later-item")?.map((target) => target.run.runId)).toEqual([
			"run-later",
			"run-later",
		]);
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

	test("filters only the synthetic prompt marker and preserves error-only assistant records", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "transcript.jsonl");
		fs.writeFileSync(transcriptPath, [
			JSON.stringify({ recordType: "message", role: "user", text: "[prompt redacted]; live Prompt Audit only. extra", ts: 1 }),
			JSON.stringify({ recordType: "message", role: "user", text: "[prompt redacted]; live Prompt Audit only.", ts: 2 }),
			JSON.stringify({ recordType: "message", role: "assistant", message: { role: "assistant", stopReason: "error", errorMessage: "Provider finish_reason: network_error" }, ts: 3 }),
		].join("\n"));
		target.transcriptPath = transcriptPath;
		const items = readSubagentConversation(target);
		expect(items).toEqual([
			expect.objectContaining({ kind: "user", text: "[prompt redacted]; live Prompt Audit only. extra" }),
			expect.objectContaining({ kind: "system", tone: "error", text: "Provider finish_reason: network_error" }),
		]);
	});

	test("enriches workflow steps from exactly matched child metadata and fails closed", () => {
		const target = run();
		target.mode = "workflow";
		const sessionFile = path.join(target.asyncDir!, "sessions", "base", "child-0", "run-0", "session.jsonl");
		fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
		target.steps = [{ index: 0, agent: "worker", workflowKey: "alpha", runId: "child-0", status: "failed", sessionFile }];
		const artifacts = path.join(target.asyncDir!, "sessions", "subagent-artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		fs.writeFileSync(path.join(artifacts, "child-0_worker_0_meta.json"), JSON.stringify({ workflowKey: "alpha", agent: "worker", index: 0, model: "provider/model", thinking: "high", contextWindow: 8192, error: "network_error" }));
		const enriched = subagentTargets([target])[0];
		expect(enriched).toMatchObject({ model: "provider/model", thinking: "high", contextWindow: 8192, error: "network_error" });
		fs.writeFileSync(path.join(artifacts, "child-0_worker_0_meta.json"), JSON.stringify({ workflowKey: "other", agent: "worker", index: 0, model: "wrong" }));
		expect(subagentTargets([target])[0]?.model).toBeUndefined();
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
