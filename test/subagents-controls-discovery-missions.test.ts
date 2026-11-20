import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pauseSubagent, resumeSubagent, steerSubagent, stopSubagent } from "../src/subagents/control.ts";
import { childRunIdFromSessionFile, readSubagentRun, subagentTempRoot } from "../src/subagents/artifacts.ts";
import { listMissionRuns, mergeMissionRuns } from "../src/subagents/missions.ts";
import { subagentTargets } from "../src/subagents/targets.ts";
import { type SubagentRun, type ToolItem } from "../src/types.ts";
import { useIsolatedSubagentRoots, roots, run, profiledFixture, capturedMission, writeMissionFixture } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("subagent controls", () => {
	test("discovers profiled root and nested agents from one tree without duplicating the spawn", () => {
		const fixture = profiledFixture();
		const startedAt = Date.now();
		const rootAgent = fixture.writeAgent("root-agent", {
			agentId: "max", profile: "implementer", parentAgentId: "root", label: "backend", state: "running", startedAt,
			model: "provider/model", thinking: "medium", sessionPath: path.join(fixture.runtimeRoot, "max.jsonl"),
		});
		fixture.writeAgent("nested-agent", {
			agentId: "zoe", profile: "explore", parentAgentId: "max", label: "explore", state: "waiting", startedAt: startedAt + 1,
			sessionPath: path.join(fixture.runtimeRoot, "zoe.jsonl"), waitingForParent: true,
			pendingQuestion: "Approve the exact-publication hold?", pendingQuestionContext: "Legal hold prevents deletion",
		});
		const tool: ToolItem = {
			kind: "tool", id: "spawn-tool", toolCallId: "call-spawn", name: "agent_spawn",
			args: { agent: "implementer", prompt: "implement it" }, output: "Started background agent @max.",
			details: {
				runtime: "profiled-subagents", treeId: fixture.treeId, parentAgentId: "root", agentId: "max", profile: "implementer",
				label: "backend", controlDir: rootAgent.controlDir, statusPath: rootAgent.statusPath, state: "running", startedAt,
			},
			timestamp: startedAt, status: "done", isError: false,
		};
		const targets = subagentTargets([], [tool]);
		expect(targets).toHaveLength(2);
		expect(targets.map((target) => [target.run.profile, target.run.parentAgentId, target.state]).sort()).toEqual([
			["explore", "max", "waiting"],
			["implementer", "root", "running"],
		]);
		expect(targets.every((target) => target.run.control === "profiled" && target.canSteer)).toBe(true);
		const waiting = targets.find((target) => target.run.agentId === "zoe");
		expect(waiting?.run.pendingQuestion).toBe("Approve the exact-publication hold?");
		expect(waiting?.run.pendingQuestionContext).toBe("Legal hold prevents deletion");
	});

	test("profiled controls support steer/stop but deliberately reject pause/resume", () => {
		const fixture = profiledFixture();
		const agent = fixture.writeAgent("agent", {
			agentId: "max", profile: "implementer", parentAgentId: "root", label: "implementer", state: "running", startedAt: Date.now(),
		});
		const target: SubagentRun = {
			runId: "profiled:test", control: "profiled", runtime: "profiled-subagents", controlDir: agent.controlDir, statusPath: agent.statusPath,
			mode: "profiled", state: "running", agent: "implementer", profile: "implementer", agentId: "max", treeId: fixture.treeId, parentAgentId: "root", steps: [],
		};
		const steer = steerSubagent(target, "focus on the compiler error");
		const steerDir = path.join(agent.controlDir, "control", "steer-requests");
		const requestFiles = fs.readdirSync(steerDir);
		expect(requestFiles).toHaveLength(1);
		expect(JSON.parse(fs.readFileSync(path.join(steerDir, requestFiles[0]!), "utf8")).message).toBe("focus on the compiler error");
		expect(steer.requestId.length).toBeGreaterThan(0);
		stopSubagent(target);
		expect(JSON.parse(fs.readFileSync(path.join(agent.controlDir, "control", "stop.json"), "utf8")).type).toBe("stop");
		expect(() => pauseSubagent(target)).toThrow("Pause/resume is not supported by profiled subagents");
		expect(() => resumeSubagent(target)).toThrow("Pause/resume is not supported by profiled subagents");
	});

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

	test("parses live context window fields for subagent context-usage display", () => {
		// The sidebar/inspector show `used / limit` from the live context window,
		// so readSubagentRun must ingest window/windowPeak and per-step contextWindow.
		const target = run();
		fs.writeFileSync(
			path.join(target.asyncDir!, "status.json"),
			JSON.stringify({
				lifecycleArtifactVersion: 1,
				runId: "run-1",
				sessionId: "session-1",
				mode: "single",
				state: "running",
				startedAt: 1000,
				lastUpdate: 2000,
				currentTool: "bash",
				// Run-level window is ingested from the totalTokens breakdown object.
				totalTokens: { input: 100, output: 50, total: 150, window: 168187, windowPeak: 168187 },
				steps: [
					{
						agent: "worker",
						status: "running",
						runId: "step-run",
						model: "provider/child",
						contextWindow: 1048576,
						currentTool: "edit",
						tokens: { input: 40, output: 20, total: 60, window: 168187, windowPeak: 168187 },
					},
				],
			}),
		);
		const parsed = readSubagentRun(target.asyncDir!);
		expect(parsed?.tokens?.window).toBe(168187);
		expect(parsed?.tokens?.windowPeak).toBe(168187);
		expect(parsed?.steps[0]?.contextWindow).toBe(1048576);
		expect(parsed?.steps[0]?.tokens?.window).toBe(168187);
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
});
