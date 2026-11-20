import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readSubagentRun, resolveLiveChildTranscriptPath, subagentTempRoot } from "../src/subagents/artifacts.ts";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import { ownedSubagentTargetsForItems, subagentTargets, type SubagentTarget } from "../src/subagents/targets.ts";
import { type SubagentRun, type ToolItem } from "../src/types.ts";
import { useIsolatedSubagentRoots, roots, run } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("subagent controls", () => {
	test("profiled agent_spawn ownership matches the exact recursive child identity", () => {
		const profiledTarget = (
			agentId: string,
			parentAgentId: string,
			controlDir: string,
		): SubagentTarget => ({
			key: `profiled-${agentId}`,
			run: {
				runId: `profiled-${agentId}`,
				runtime: "profiled-subagents",
				control: "profiled",
				controlDir,
				treeId: "tree-recursive",
				agentId,
				parentAgentId,
				profile: agentId === "cai" ? "implementer" : "explore",
				mode: parentAgentId === "root" ? "profiled" : "nested",
				state: "running",
				startedAt: 1_000,
				steps: [],
			},
			label: `@${agentId}`,
			state: "running",
			active: true,
			canSteer: true,
			startedAt: 1_000,
		});
		const parent = profiledTarget("cai", "root", "/tmp/cai");
		const child = profiledTarget("theo", "cai", "/tmp/theo");
		const sibling = profiledTarget("aki", "cai", "/tmp/aki");
		const tool: ToolItem = {
			kind: "tool",
			id: "nested-spawn",
			toolCallId: "nested-spawn-call",
			name: "agent_spawn",
			args: { agent: "explore" },
			output: "",
			details: {
				runtime: "profiled-subagents",
				treeId: "tree-recursive",
				parentAgentId: "cai",
				agentId: "theo",
				controlDir: "/tmp/theo",
			},
			timestamp: 1_000,
			status: "streaming",
			isError: false,
		};
		const owned = ownedSubagentTargetsForItems(
			[tool],
			[parent, sibling, child],
		).get(tool.id);
		expect(owned).toEqual([child]);
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

	test("matches same-name concurrent tool results by call id in completion order", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "call-ids.jsonl");
		fs.writeFileSync(transcriptPath, [
			JSON.stringify({ recordType: "tool_start", toolName: "bash", toolCallId: "call-a", argsPreview: "first", ts: 1 }),
			JSON.stringify({ recordType: "tool_start", toolName: "bash", toolCallId: "call-b", argsPreview: "second", ts: 2 }),
			JSON.stringify({ recordType: "message", role: "toolResult", toolCallId: "call-b", text: "second result", ts: 3 }),
			JSON.stringify({ recordType: "message", role: "toolResult", toolCallId: "call-a", text: "first result", ts: 4 }),
		].join("\n"));
		target.transcriptPath = transcriptPath;
		const tools = readSubagentConversation(target).filter((item): item is ToolItem => item.kind === "tool");
		expect(tools).toHaveLength(2);
		expect(tools.map((tool) => [tool.toolCallId, tool.output])).toEqual([
			["call-a", "first result"],
			["call-b", "second result"],
		]);
	});

	test("does not attach ID-bearing unknown tool records by same-name fallback", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "unknown-call-id.jsonl");
		fs.writeFileSync(transcriptPath, [
			JSON.stringify({ recordType: "tool_start", toolName: "bash", toolCallId: "call-known", argsPreview: "known", ts: 1 }),
			JSON.stringify({ recordType: "tool_start", toolName: "bash", argsPreview: "legacy", ts: 2 }),
			JSON.stringify({ recordType: "message", role: "toolResult", toolName: "bash", toolCallId: "call-unknown", text: "unknown result", ts: 3 }),
			JSON.stringify({ recordType: "tool_end", toolName: "bash", toolCallId: "call-unknown", ts: 4 }),
		].join("\n"));
		target.transcriptPath = transcriptPath;

		const tools = readSubagentConversation(target).filter((item): item is ToolItem => item.kind === "tool");
		expect(tools).toHaveLength(3);
		expect(tools[0]).toEqual(expect.objectContaining({ toolCallId: "call-known", output: "" }));
		expect(tools[1]).toEqual(expect.objectContaining({ args: "legacy", output: "" }));
		expect(tools[0]?.endedAt).toBeUndefined();
		expect(tools[1]?.endedAt).toBeUndefined();
		expect(tools[2]).toEqual(expect.objectContaining({ toolCallId: "call-unknown", output: "unknown result" }));
	});

	test("preserves repeated user prompts unless records identify a known duplicate", () => {
		const target = run();
		const transcriptPath = path.join(target.asyncDir!, "users.jsonl");
		fs.writeFileSync(transcriptPath, [
			JSON.stringify({ recordType: "message", role: "user", text: "repeat", ts: 1 }),
			JSON.stringify({ recordType: "message", role: "user", text: "repeat", ts: 2 }),
			JSON.stringify({ recordType: "message", role: "user", subtype: "initial_prompt", text: "duplicate", ts: 3 }),
			JSON.stringify({ recordType: "message", role: "user", subtype: "message_end", text: "duplicate", ts: 4 }),
		].join("\n"));
		target.transcriptPath = transcriptPath;
		expect(readSubagentConversation(target).filter((item) => item.kind === "user").map((item) => item.text)).toEqual([
			"repeat",
			"repeat",
			"duplicate",
		]);
	});

	test("projects workflowChildren live activity over sparse workflow trace rows", () => {
		const tool: ToolItem = {
			kind: "tool", id: "workflow-live-projection", toolCallId: "workflow-call", name: "subagent", args: {}, output: "working",
			details: {
				mode: "workflow", runId: "workflow-parent",
				workflow: { trace: [{ operation: "run", key: "child", state: "started", agent: "general" }] },
				workflowChildren: { version: 1, children: [{ childId: "child", state: "running", agent: "general", model: "provider/live", activity: { currentTool: "bash", currentToolStartedAt: 250, lastActivityAt: 300, toolCount: 2, turnCount: 1, tokens: 30 } }] },
			}, timestamp: 100, status: "streaming", isError: false,
		};
		const target = subagentTargets([], [tool])[0];
		expect(target).toMatchObject({ model: "provider/live", lastUpdate: 300 });
		expect(target?.run).toMatchObject({ currentTool: "bash", currentToolStartedAt: 250, lastUpdate: 300 });
	});

	test("dedupes workflow child rows by richness", () => {
		const mission: SubagentRun = { runId: "mission-run", control: "mission", mode: "workflow", state: "running", steps: [
			{ index: 0, agent: "worker", status: "running", workflowKey: "child", sessionFile: "/tmp/shared-child.jsonl" },
		] };
		const artifact: SubagentRun = { runId: "artifact-run", control: "file", mode: "workflow", state: "running", steps: [
			{ index: 0, agent: "worker", status: "running", workflowKey: "child", sessionFile: "/tmp/shared-child.jsonl", model: "provider/live", transcriptPath: "/tmp/live-transcript.jsonl" },
		] };
		const targets = subagentTargets([mission, artifact]);
		expect(targets).toHaveLength(1);
		expect(targets[0]).toMatchObject({ model: "provider/live", transcriptPath: "/tmp/live-transcript.jsonl" });
	});

	test("resolves only a unique in-window live transcript", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-query-"));
		roots.push(cwd);
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const now = Date.now();
		const transcriptPath = path.join(artifacts, "child_worker_0_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, startedAt: now, cwd })).toBe(transcriptPath);
		const second = path.join(artifacts, "other_worker_0_transcript.jsonl");
		fs.writeFileSync(second, "");
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, startedAt: now, cwd })).toBeUndefined();
		fs.rmSync(second);
		fs.utimesSync(transcriptPath, new Date(now - 20_000), new Date(now - 20_000));
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, startedAt: now, cwd })).toBeUndefined();
	});

	test("does not resolve a bare parent session id from a relative artifact directory", () => {
		const relativeDir = path.join(process.cwd(), "subagent-artifacts");
		fs.mkdirSync(relativeDir, { recursive: true });
		const transcriptPath = path.join(relativeDir, "bare_worker_0_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		try {
			expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, startedAt: Date.now(), parentSessionFile: "session-id" })).toBeUndefined();
		} finally {
			fs.rmSync(relativeDir, { recursive: true, force: true });
		}
	});

	test("uses the child-local index zero for workflow transcript artifacts", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflow-query-"));
		roots.push(cwd);
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const first = path.join(artifacts, "child-a_worker_0_transcript.jsonl");
		fs.writeFileSync(first, "");
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, childRunId: "child-a", startedAt: Date.now(), cwd })).toBe(first);
		const second = path.join(artifacts, "child-b_worker_0_transcript.jsonl");
		fs.writeFileSync(second, "");
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, startedAt: Date.now(), cwd })).toBeUndefined();
	});

	test("enriches a workflow parent step from its matching live child", () => {
		const parent: SubagentRun = {
			runId: "parent-live",
			asyncDir: "/tmp/parent-live",
			control: "file",
			mode: "workflow",
			state: "running",
			steps: [{ index: 0, agent: "worker", workflowKey: "alpha", runId: "child-live", status: "running" }],
		};
		const child: SubagentRun = {
			runId: "child-live",
			parentWorkflowRunId: "parent-live",
			control: "file",
			mode: "single",
			state: "running",
			steps: [{ index: 0, agent: "worker", workflowKey: "alpha", runId: "child-live", status: "running", model: "provider/live", currentTool: "bash", currentToolStartedAt: 200, lastActivityAt: 300, turnCount: 2, toolCount: 4, sessionFile: "/tmp/child-live.jsonl" }],
		};
		const targets = subagentTargets([parent, child]);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.step).toMatchObject({ model: "provider/live", currentTool: "bash", currentToolStartedAt: 200, lastActivityAt: 300, turnCount: 2, toolCount: 4 });
		expect(targets[0]?.sessionFile).toBe("/tmp/child-live.jsonl");
	});

	test("keeps parent workflow metadata authoritative during child enrichment", () => {
		const parent: SubagentRun = { runId: "parent-authority", mode: "workflow", state: "running", steps: [{ index: 0, agent: "worker", workflowKey: "alpha", runId: "child-authority", status: "running", model: "provider/parent", currentTool: "parent-tool" }] };
		const child: SubagentRun = { runId: "child-authority", parentWorkflowRunId: "parent-authority", mode: "single", state: "running", steps: [{ index: 0, agent: "worker", workflowKey: "alpha", runId: "child-authority", status: "running", model: "provider/child", currentTool: "child-tool" }] };
		const target = subagentTargets([parent, child])[0];
		expect(target?.step).toMatchObject({ model: "provider/parent", currentTool: "parent-tool" });
	});

	test("isolates live metadata between workflow children", () => {
		const parent: SubagentRun = { runId: "parent-isolated", mode: "workflow", state: "running", steps: [
			{ index: 0, agent: "worker-a", workflowKey: "alpha", runId: "child-a", status: "running" },
			{ index: 1, agent: "worker-b", workflowKey: "beta", runId: "child-b", status: "running" },
		] };
		const childA: SubagentRun = { runId: "child-a", parentWorkflowRunId: "parent-isolated", mode: "single", state: "running", steps: [{ index: 0, agent: "worker-a", workflowKey: "alpha", runId: "child-a", status: "running", model: "provider/a", currentTool: "tool-a" }] };
		const childB: SubagentRun = { runId: "child-b", parentWorkflowRunId: "parent-isolated", mode: "single", state: "running", steps: [{ index: 0, agent: "worker-b", workflowKey: "beta", runId: "child-b", status: "running", model: "provider/b", currentTool: "tool-b" }] };
		const targets = subagentTargets([parent, childA, childB]);
		expect(targets).toHaveLength(2);
		expect(targets.find((target) => target.workflowKey === "alpha")?.step).toMatchObject({ model: "provider/a", currentTool: "tool-a" });
		expect(targets.find((target) => target.workflowKey === "beta")?.step).toMatchObject({ model: "provider/b", currentTool: "tool-b" });
	});

	test("rejects same-agent matches split between cwd and temp roots", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-ambiguous-"));
		roots.push(cwd);
		const cwdArtifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		const tempArtifacts = path.join(subagentTempRoot(), "artifacts");
		fs.mkdirSync(cwdArtifacts, { recursive: true });
		fs.mkdirSync(tempArtifacts, { recursive: true });
		roots.push(tempArtifacts);
		const cwdPath = path.join(cwdArtifacts, "cwd_worker_0_transcript.jsonl");
		const tempPath = path.join(tempArtifacts, "temp_worker_0_transcript.jsonl");
		fs.writeFileSync(cwdPath, "");
		fs.writeFileSync(tempPath, "");
		const startedAt = Date.now();
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, startedAt, cwd })).toBeUndefined();
	});

	test("resolves an indexed target through its exact flat child run artifact", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-flat-run-"));
		roots.push(cwd);
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const transcriptPath = path.join(artifacts, "child-run-flat_worker_transcript.jsonl");
		fs.writeFileSync(transcriptPath, "");
		expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 1, childRunId: "child-run-flat", cwd })).toBe(transcriptPath);
	});

	test("rejects unsafe child run ids without probing outside the artifact root", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-unsafe-"));
		roots.push(cwd);
		const artifacts = path.join(cwd, ".pi", "subagents", "artifacts");
		fs.mkdirSync(artifacts, { recursive: true });
		const outside = path.join(cwd, "outside_worker_transcript.jsonl");
		fs.writeFileSync(outside, "");
		for (const childRunId of ["../outside", "child/run", "child\u0000run"]) {
			expect(resolveLiveChildTranscriptPath({ agent: "worker", index: 0, childRunId, cwd, parentSessionFile: "session-id" })).toBeUndefined();
		}
	});

	test("uses live progress precedence through every foreground entry path", () => {
		const live = {
			version: 1,
			children: [{ childId: "child", agent: "worker", activity: { currentTool: "live-tool", toolCount: 2 } }],
		};
		const makeTool = (callId: string, details: Record<string, unknown>): ToolItem => ({
			kind: "tool",
			id: callId,
			toolCallId: callId,
			name: "subagent",
			args: {},
			output: "working",
			details: { ...details, workflowChildren: live },
			timestamp: 1,
			status: "streaming",
			isError: false,
		});
		const resultsOnly = makeTool("results-only", {
			results: [{ key: "child", progress: { agent: "worker", currentTool: "stored-tool", toolCount: 1 } }],
		});
		const traceTerminal = makeTool("trace-terminal", {
			workflow: { trace: [{ operation: "run", key: "child", agent: "worker", state: "started" }] },
			results: [{ key: "child", progress: { agent: "worker", currentTool: "stored-tool", toolCount: 1 } }],
		});
		const traceOnly = makeTool("trace-only", {
			workflow: { trace: [{ operation: "run", key: "child", agent: "worker", state: "started" }] },
		});
		const targets = subagentTargets([], [resultsOnly, traceTerminal, traceOnly]);
		expect(targets.map((target) => [target.toolCallId, target.run.currentTool, target.run.toolCount])).toEqual([
			["results-only", "live-tool", 2],
			["trace-only", "live-tool", 2],
			["trace-terminal", "live-tool", 2],
		]);
	});

	test("maps contextLimit to contextWindow without overriding explicit contextWindow", () => {
		const target = run();
		fs.writeFileSync(path.join(target.asyncDir!, "status.json"), JSON.stringify({ runId: "context-limit", mode: "single", state: "running", contextLimit: 1048576, steps: [
			{ index: 0, agent: "explicit", status: "running", contextWindow: 8192, contextLimit: 1048576 },
			{ index: 1, agent: "fallback", status: "running", contextLimit: 65536 },
		]}));
		const parsed = readSubagentRun(target.asyncDir!);
		expect(parsed?.contextWindow).toBe(1048576);
		expect(parsed?.steps[0]?.contextWindow).toBe(8192);
		expect(parsed?.steps[1]?.contextWindow).toBe(65536);
	});
});
