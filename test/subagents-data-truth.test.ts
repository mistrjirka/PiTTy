import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import { createSubagentTranscriptCache } from "../src/subagents/transcript-cache.ts";
import { isSubagentFamilyToolName, profiledSubagentRunsFromTools } from "../src/subagents/profiled.ts";
import { subagentRunIdFromTool, subagentTargets, type SubagentTarget } from "../src/subagents/targets.ts";
import { type AssistantItem, type SubagentRun, type ToolItem } from "../src/types.ts";
import { isSpawnToolItem } from "../src/ui/spawn-group.tsx";
import { useIsolatedSubagentRoots, roots } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("batch A data truth", () => {
	function transcriptRun(lines: string[]): { run: SubagentRun; file: string } {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-batch-a-"));
		roots.push(dir);
		const file = path.join(dir, "transcript.jsonl");
		fs.writeFileSync(file, lines.length ? `${lines.join("\n")}\n` : "");
		const run: SubagentRun = {
			runId: "batch-a",
			mode: "single",
			state: "done",
			steps: [{ index: 0, agent: "worker", status: "done", transcriptPath: file }],
		};
		return { run, file };
	}

	function profiledFiles(sessionLines: unknown[], eventLines: Array<Record<string, unknown>>): {
		sessionFile: string;
		eventsPath: string;
	} {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-batch-a-profiled-"));
		roots.push(dir);
		const sessionFile = path.join(dir, "session.jsonl");
		fs.writeFileSync(
			sessionFile,
			sessionLines.map((line) => JSON.stringify(line)).join("\n") + "\n",
		);
		const eventsPath = path.join(dir, "events.jsonl");
		let seq = 0;
		fs.writeFileSync(
			eventsPath,
			eventLines.map((line) => JSON.stringify({ v: 1, seq: seq++, ts: 1_000, runId: "batch-a-child", ...line })).join("\n") + "\n",
		);
		return { sessionFile, eventsPath };
	}

	function stoppedProfiledRun(sessionLines: unknown[], eventLines: Array<Record<string, unknown>>): SubagentRun {
		const { sessionFile, eventsPath } = profiledFiles(sessionLines, eventLines);
		return {
			runId: "batch-a-stopped",
			mode: "profiled",
			control: "profiled",
			state: "completed",
			steps: [],
			sessionFile,
			eventsPath,
			startedAt: 500,
			lastUpdate: 900,
		};
	}

	function liveProfiledRun(sessionLines: unknown[], eventLines: Array<Record<string, unknown>>): SubagentRun {
		const { sessionFile, eventsPath } = profiledFiles(sessionLines, eventLines);
		return {
			runId: "batch-a-live",
			mode: "profiled",
			control: "profiled",
			state: "running",
			steps: [],
			sessionFile,
			eventsPath,
			startedAt: 500,
			lastUpdate: Date.now(),
			profiledStatusBacked: true,
		};
	}

	test("transcript ids are stable across re-reads and appends without timestamps", () => {
		// No record carries `ts`: the old Date.now() fallback minted fresh ids
		// on every poll. The clock is forced forward between reads so any
		// remaining wall-clock dependence fails this test deterministically.
		const realNow = Date.now;
		let tick = 1_000_000;
		Date.now = () => (tick += 1_000);
		try {
			const { run, file } = transcriptRun([
				JSON.stringify({ recordType: "message", role: "user", text: "do the thing", id: "msg-1", runId: "batch-a" }),
				JSON.stringify({ recordType: "tool_start", toolName: "read", toolCallId: "call-1", runId: "batch-a" }),
				JSON.stringify({ recordType: "message", role: "toolResult", toolCallId: "call-1", toolName: "read", text: "contents", runId: "batch-a" }),
			]);
			const first = readSubagentConversation(run).map((item) => item.id);
			expect(first.length).toBeGreaterThan(0);
			expect(new Set(first).size).toBe(first.length);
			const second = readSubagentConversation(run).map((item) => item.id);
			expect(second).toEqual(first);
			fs.appendFileSync(
				file,
				`${JSON.stringify({ recordType: "message", role: "user", text: "more", id: "msg-2", runId: "batch-a" })}\n`,
			);
			const third = readSubagentConversation(run).map((item) => item.id);
			expect(third.slice(0, first.length)).toEqual(first);
			expect(third.length).toBe(first.length + 1);
		} finally {
			Date.now = realNow;
		}
	});

	test("session-backed transcript ids are stable across re-reads", () => {
		const run = liveProfiledRun(
			[
				{ message: { role: "user", content: [{ type: "text", text: "go" }], timestamp: 100 } },
				{ message: { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 200 } },
			],
			[],
		);
		const first = readSubagentConversation(run).map((item) => item.id);
		expect(first.length).toBe(2);
		expect(readSubagentConversation(run).map((item) => item.id)).toEqual(first);
	});

	test("tagged live thinking replaces only its exact persisted assistant field", () => {
		const thought =
			"Verifying outbox persistence, RabbitMQ queue declarations, envelope schema, and publish-after-commit flow.";
		const run = liveProfiledRun(
			[
				{ message: { role: "assistant", content: [{ type: "thinking", thinking: thought }], timestamp: 200 } },
			],
			[{ kind: "thinking", blockId: "think-live", messageSeq: 1, text: thought }],
		);
		const thinking = readSubagentConversation(run).filter(
			(item): item is AssistantItem => item.kind === "assistant" && Boolean(item.thinking),
		);
		expect(thinking).toHaveLength(1);
		expect(thinking[0]?.thinking).toBe(thought);
		expect(thinking[0]?.sourceMessageSeq).toBe(1);
	});

	test("distinct live thinking block identities remain distinct even when text matches", () => {
		const thought =
			"Extending verification to ticketing repository inserts, crash boundary, and remaining unsafe casts.";
		const run = liveProfiledRun([], [
			{ kind: "thinking", blockId: "think-a", messageSeq: 1, text: thought },
			{ kind: "thinking", blockId: "think-b", messageSeq: 1, text: thought },
		]);
		const thinking = readSubagentConversation(run).filter(
			(item): item is AssistantItem => item.kind === "assistant" && Boolean(item.thinking),
		);
		expect(thinking).toHaveLength(2);
		expect(thinking.map((item) => item.thinking)).toEqual([thought, thought]);
		expect(thinking[0]?.id).not.toBe(thinking[1]?.id);
	});

	test("stream item ids derive from block identity, not read order", () => {
		const run = liveProfiledRun([], [
			{ kind: "thinking", blockId: "think-1", text: "consider " },
			{ kind: "thinking", blockId: "think-1", text: "this" },
			{ kind: "tool_start", toolName: "read", toolCallId: "call-9" },
		]);
		const first = readSubagentConversation(run);
		expect(first).toHaveLength(2);
		expect(first[0]?.id).toContain("think-1");
		expect(first[1]?.id).toContain("call-9");
		expect(readSubagentConversation(run).map((item) => item.id)).toEqual(first.map((item) => item.id));
	});

	test("a stopped run keeps the thinking it streamed when the session copy is empty", () => {
		const run = stoppedProfiledRun(
			[
				{
					message: {
						role: "assistant",
						content: [{ type: "thinking", thinking: "" }],
						timestamp: 50,
					},
				},
			],
			[{ kind: "thinking", blockId: "b1", text: "streamed thought" }],
		);
		const items = readSubagentConversation(run);
		expect(items).toHaveLength(1);
		const item = items[0];
		if (item?.kind !== "assistant") throw new Error("expected an assistant item");
		expect(item.thinking).toBe("streamed thought");
		expect(item.status).toBe("done");
	});

	test("a stopped run does not render thinking the session already has twice", () => {
		const run = stoppedProfiledRun(
			[
				{
					message: {
						role: "assistant",
						content: [{ type: "thinking", thinking: "same thought" }],
						timestamp: 50,
					},
				},
			],
			[{ kind: "thinking", blockId: "b1", text: "same thought" }],
		);
		const items = readSubagentConversation(run);
		expect(items).toHaveLength(1);
		const item = items[0];
		if (item?.kind !== "assistant") throw new Error("expected an assistant item");
		expect(item.thinking).toBe("same thought");
	});

	test("a stopped run never replaces persisted thinking with a shorter stream value", () => {
		const run = stoppedProfiledRun(
			[
				{
					message: {
						role: "assistant",
						content: [{ type: "thinking", thinking: "Hello brave new world" }],
						timestamp: 50,
					},
				},
			],
			[{ kind: "thinking", blockId: "b1", text: "brave new" }],
		);
		const items = readSubagentConversation(run);
		expect(items).toHaveLength(1);
		const item = items[0];
		if (item?.kind !== "assistant") throw new Error("expected an assistant item");
		expect(item.thinking).toBe("Hello brave new world");
	});

	test("a tagged stopped run grows its exact persisted field from the completed stream", () => {
		const run = stoppedProfiledRun(
			[
				{
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Hello " }],
						timestamp: 50,
					},
				},
			],
			[{ kind: "text", blockId: "t1", messageSeq: 1, text: "Hello world" }],
		);
		const items = readSubagentConversation(run);
		expect(items).toHaveLength(1);
		const item = items[0];
		if (item?.kind !== "assistant") throw new Error("expected an assistant item");
		expect(item.text).toBe("Hello world");
	});

	test("tagged multi-turn stream keeps repeated block ids chronological and final answer once", () => {
		const run = stoppedProfiledRun(
			[
				{ message: { role: "user", content: [{ type: "text", text: "do the task" }], timestamp: 10 } },
				{ message: { role: "assistant", content: [{ type: "thinking", thinking: "" }, { type: "toolCall", id: "call-a", name: "read", arguments: { path: "a" } }], timestamp: 30 } },
				{ message: { role: "toolResult", toolCallId: "call-a", toolName: "read", content: "A", timestamp: 40 } },
				{ message: { role: "assistant", content: [{ type: "thinking", thinking: "" }, { type: "toolCall", id: "call-b", name: "bash", arguments: { command: "true" } }], timestamp: 60 } },
				{ message: { role: "toolResult", toolCallId: "call-b", toolName: "bash", content: "B", timestamp: 70 } },
				{ message: { role: "assistant", content: [{ type: "thinking", thinking: "final thought" }, { type: "text", text: "FINAL ANSWER" }], timestamp: 100 } },
			],
			[
				{ kind: "thinking", blockId: "think-0", messageSeq: 1, text: "first thought", ts: 20 },
				{ kind: "tool_start", toolName: "read", toolCallId: "call-a", messageSeq: 1, ts: 21 },
				{ kind: "tool_end", toolName: "read", toolCallId: "call-a", messageSeq: 1, ts: 22 },
				{ kind: "thinking", blockId: "think-0", messageSeq: 2, text: "second thought", ts: 50 },
				{ kind: "tool_start", toolName: "bash", toolCallId: "call-b", messageSeq: 2, ts: 51 },
				{ kind: "tool_end", toolName: "bash", toolCallId: "call-b", messageSeq: 2, ts: 52 },
				{ kind: "thinking", blockId: "think-0", messageSeq: 3, text: "final thought", ts: 80 },
				{ kind: "text", blockId: "text-1", messageSeq: 3, text: "FINAL ", ts: 90 },
				{ kind: "text", blockId: "text-1", messageSeq: 3, text: "ANSWER", ts: 91 },
			],
		);
		const items = readSubagentConversation(run);
		const summary = items.map((item) =>
			item.kind === "assistant"
				? item.thinking ? `think:${item.thinking}` : `text:${item.text}`
				: item.kind === "tool" ? `tool:${item.name}:${item.output}`
				: item.kind === "user" ? `user:${item.text}`
				: item.kind,
		);
		expect(summary).toEqual([
			"user:do the task",
			"think:first thought",
			"tool:read:A",
			"think:second thought",
			"tool:bash:B",
			"think:final thought",
			"text:FINAL ANSWER",
		]);
		expect(summary.filter((value) => value === "text:FINAL ANSWER")).toHaveLength(1);
	});

	test("stream tools backfill args and output from the session file", () => {
		// In-flight: the session holds the call but no result yet, so no
		// session row exists and the single stream row backfills args from
		// the session file. (Once the result lands the session row takes over
		// and no stream twin is created — one row per call.)
		const run = liveProfiledRun(
			[
				{
					message: {
						role: "assistant",
						content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "x" } }],
						timestamp: 100,
					},
				},
			],
			[
				{ kind: "tool_start", toolName: "read", toolCallId: "call-1" },
				{ kind: "tool_end", toolName: "read", toolCallId: "call-1" },
			],
		);
		const tools = readSubagentConversation(run).filter((item): item is ToolItem => item.kind === "tool");
		expect(tools).toHaveLength(1);
		const stream = tools.find((tool) => tool.id.startsWith("subagent-stream-"));
		if (!stream) throw new Error("expected a stream tool item");
		expect(stream.args).toEqual({ path: "x" });
		expect(stream.output).toBe("");
		expect(stream.status).toBe("done");
	});

	test("stream tools stay bare when no args exist anywhere", () => {
		const run = liveProfiledRun([], [{ kind: "tool_start", toolName: "read", toolCallId: "call-missing" }]);
		const tools = readSubagentConversation(run).filter((item): item is ToolItem => item.kind === "tool");
		expect(tools).toHaveLength(1);
		expect(tools[0]?.args).toBeUndefined();
	});

	test("a same-size rewrite with a frozen mtime is observed", () => {
		const line = (text: string): string =>
			JSON.stringify({ recordType: "message", role: "user", text, id: "m1" });
		const { run, file } = transcriptRun([line("aaa")]);
		// Pin the clock: an explicit whole-millisecond mtime before the first
		// read and the identical value after the rewrite, so (mtimeMs, size)
		// alone cannot tell the two parses apart.
		const frozenAt = new Date(1_700_000_000_000);
		fs.utimesSync(file, frozenAt, frozenAt);
		const first = readSubagentConversation(run);
		expect(first.map((item) => (item.kind === "user" ? item.text : ""))).toEqual(["aaa"]);
		const replacement = line("bbb");
		expect(replacement.length).toBe(line("aaa").length);
		fs.writeFileSync(file, `${replacement}\n`);
		fs.utimesSync(file, frozenAt, frozenAt);
		const frozen = fs.statSync(file);
		expect(frozen.mtimeMs).toBe(1_700_000_000_000);
		const second = readSubagentConversation(run);
		expect(second.map((item) => (item.kind === "user" ? item.text : ""))).toEqual(["bbb"]);
	});

	test("the transcript cache invalidates on a same-size same-mtime rewrite", () => {
		const line = (text: string): string =>
			JSON.stringify({ recordType: "message", role: "user", text, id: "m1" });
		const { run, file } = transcriptRun([line("aaa")]);
		const target: SubagentTarget = {
			key: "batch-a-cache",
			run,
			label: "batch-a",
			state: "done",
			active: false,
			canSteer: false,
			transcriptPath: file,
		};
		const frozenAt = new Date(1_700_000_000_000);
		fs.utimesSync(file, frozenAt, frozenAt);
		const cache = createSubagentTranscriptCache();
		const first = cache(target, true);
		expect(first.map((item) => (item.kind === "user" ? item.text : ""))).toEqual(["aaa"]);
		fs.writeFileSync(file, `${line("bbb")}\n`);
		fs.utimesSync(file, frozenAt, frozenAt);
		expect(fs.statSync(file).mtimeMs).toBe(1_700_000_000_000);
		const second = cache(target, true);
		expect(second).not.toBe(first);
		expect(second.map((item) => (item.kind === "user" ? item.text : ""))).toEqual(["bbb"]);
	});

	test("profiled session snapshots observe same-size rewrites with a frozen mtime", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-batch-a-session-"));
		roots.push(dir);
		const sessionFile = path.join(dir, "session.jsonl");
		const usageLine = (input: number): string =>
			JSON.stringify({ message: { role: "assistant", usage: { input, cacheRead: 0, cacheWrite: 0 } } });
		expect(usageLine(20).length).toBe(usageLine(10).length);
		const frozenAt = new Date(1_700_000_000_000);
		const spawnTool: ToolItem = {
			kind: "tool",
			id: "spawn-batch-a",
			toolCallId: "spawn-batch-a-call",
			name: "agent_spawn",
			args: { agent: "explore" },
			output: "",
			details: {
				runtime: "profiled-subagents",
				treeId: "batch-a-tree",
				parentAgentId: "root",
				agentId: "snapshotted",
				sessionPath: sessionFile,
			},
			timestamp: 1,
			status: "done",
			isError: false,
		};
		fs.writeFileSync(sessionFile, `${usageLine(10)}\n`);
		fs.utimesSync(sessionFile, frozenAt, frozenAt);
		expect(profiledSubagentRunsFromTools([spawnTool])[0]?.tokens?.window).toBe(10);
		fs.writeFileSync(sessionFile, `${usageLine(20)}\n`);
		fs.utimesSync(sessionFile, frozenAt, frozenAt);
		expect(fs.statSync(sessionFile).mtimeMs).toBe(1_700_000_000_000);
		expect(profiledSubagentRunsFromTools([spawnTool])[0]?.tokens?.window).toBe(20);
	});

	test("task and workflow tools agree on family, grouping and ownership", () => {
		expect(isSubagentFamilyToolName("task_run")).toBe(true);
		expect(isSubagentFamilyToolName("workflow_run")).toBe(true);
		expect(isSubagentFamilyToolName("subagent")).toBe(true);
		expect(isSubagentFamilyToolName("delegate_task")).toBe(true);
		expect(isSubagentFamilyToolName("subagent_supervisor")).toBe(false);
		expect(isSubagentFamilyToolName("bash")).toBe(false);
		const spawn = (name: string, extra: Partial<ToolItem> = {}): ToolItem => ({
			kind: "tool",
			id: `spawn-${name}`,
			toolCallId: `spawn-${name}-call`,
			name,
			args: {},
			output: "",
			timestamp: 1,
			status: "streaming",
			isError: false,
			...extra,
		});
		// Grouping agrees with the family rule.
		expect(isSpawnToolItem(spawn("task_run"))).toBe(true);
		expect(isSpawnToolItem(spawn("workflow_run"))).toBe(true);
		expect(isSpawnToolItem(spawn("subagent_supervisor"))).toBe(false);
		expect(isSpawnToolItem(spawn("bash"))).toBe(false);
		// Ownership agrees with the family rule: a task_* tool owns its target.
		expect(subagentRunIdFromTool(spawn("task_run", { details: { runId: "run-task" } }))).toBe("run-task");
		expect(subagentRunIdFromTool(spawn("workflow_run", { details: { asyncId: "async-wf" } }))).toBe("async-wf");
		expect(subagentRunIdFromTool(spawn("subagent_supervisor", { details: { runId: "run-sv" } }))).toBeUndefined();
		for (const name of ["task_run", "workflow_run"]) {
			const tool = spawn(name, {
				details: {
					results: [{ key: "child", agent: "worker", progress: { agent: "worker", state: "running" } }],
				},
			});
			const targets = subagentTargets([], [tool]);
			expect(targets.map((target) => target.toolCallId)).toContain(tool.toolCallId);
		}
		const supervisor = spawn("subagent_supervisor", {
			details: {
				results: [{ key: "child", agent: "worker", progress: { agent: "worker", state: "running" } }],
			},
		});
		expect(subagentTargets([], [supervisor])).toHaveLength(0);
	});
});
