import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import { createSubagentTranscriptCache } from "../src/subagents/transcript-cache.ts";
import { PROFILED_HEARTBEAT_MAX_AGE_MS } from "../src/subagents/profiled.ts";
import { type AssistantItem, type SubagentRun, type ToolItem } from "../src/types.ts";
import { useIsolatedSubagentRoots, roots, streamHarness, streamAgent } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("profiled live event stream", () => {
	test("folds a thinking-only failed attempt into its direct-parent retry", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "retry-agent", "retry-child");
		const sessionPath = path.join(agent.controlDir, "session.jsonl");
		const sessionLines = [
			{
				id: "attempt-a",
				parentId: "before-a",
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: "partial thought" }],
					stopReason: "error",
					timestamp: now - 200,
				},
			},
			{
				id: "attempt-b",
				parentId: "attempt-a",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "continued thought" },
						{ type: "text", text: "final answer" },
					],
					stopReason: "stop",
					timestamp: now - 100,
				},
			},
		];
		fs.writeFileSync(sessionPath, sessionLines.map((line) => JSON.stringify(line)).join("\n") + "\n");
		fs.writeFileSync(agent.statusPath, JSON.stringify({
			version: 1, runtime: "profiled-subagents", treeId: fixture.treeId, updatedAt: now,
			agentId: "retry-child", profile: "explore", parentAgentId: "root", label: "retry-child",
			state: "completed", startedAt: now - 300, sessionPath,
		}));
		writeEvents(agent.controlDir, [
			{ kind: "thinking", blockId: "think-0", messageSeq: 1, text: "partial thought", ts: now - 200 },
			{ kind: "thinking", blockId: "think-0", messageSeq: 2, text: "continued thought", ts: now - 100 },
			{ kind: "text", blockId: "text-1", messageSeq: 2, text: "final answer", ts: now - 90 },
		]);
		const target = liveTarget("retry-child", [spawnTool(agent, "retry-child")]);
		if (!target) throw new Error("expected retry target");
		const items = readSubagentConversation({ ...target.run, state: "completed", activityState: "completed" });
		const assistants = items.filter((item): item is AssistantItem => item.kind === "assistant");
		expect(assistants).toHaveLength(2);
		const thinkingRow = assistants.find((item) => Boolean(item.thinking));
		const answerRow = assistants.find((item) => Boolean(item.text));
		expect(thinkingRow?.thinking).toBe("partial thought\n\ncontinued thought");
		expect(thinkingRow?.status).toBe("done");
		expect(thinkingRow?.sourceEntryId).toBe("attempt-b");
		expect(thinkingRow?.retriedAfterInterruptedThinking).toBe(true);
		expect(answerRow?.text).toBe("final answer");
		expect(assistants.some((item) => item.sourceEntryId === "attempt-a")).toBe(false);
	});

	test("does not fold an errored thought when the next assistant is not its direct child", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "retry-boundary-agent", "retry-boundary-child");
		const sessionPath = path.join(agent.controlDir, "session.jsonl");
		const sessionLines = [
			{ id: "attempt-a", parentId: "before-a", message: { role: "assistant", content: [{ type: "thinking", thinking: "failed thought" }], stopReason: "error", timestamp: now - 200 } },
			{ id: "attempt-b", parentId: "tool-result-between", message: { role: "assistant", content: [{ type: "thinking", thinking: "new turn" }], stopReason: "stop", timestamp: now - 100 } },
		];
		fs.writeFileSync(sessionPath, sessionLines.map((line) => JSON.stringify(line)).join("\n") + "\n");
		fs.writeFileSync(agent.statusPath, JSON.stringify({
			version: 1, runtime: "profiled-subagents", treeId: fixture.treeId, updatedAt: now,
			agentId: "retry-boundary-child", profile: "explore", parentAgentId: "root", label: "retry-boundary-child",
			state: "completed", startedAt: now - 300, sessionPath,
		}));
		writeEvents(agent.controlDir, [
			{ kind: "thinking", blockId: "think-0", messageSeq: 1, text: "failed thought", ts: now - 200 },
			{ kind: "thinking", blockId: "think-0", messageSeq: 2, text: "new turn", ts: now - 100 },
		]);
		const target = liveTarget("retry-boundary-child", [spawnTool(agent, "retry-boundary-child")]);
		if (!target) throw new Error("expected retry boundary target");
		const items = readSubagentConversation({ ...target.run, state: "completed", activityState: "completed" });
		const assistants = items.filter((item): item is AssistantItem => item.kind === "assistant");
		expect(assistants).toHaveLength(2);
		expect(assistants[0]?.status).toBe("error");
		expect(assistants[1]?.retriedAfterInterruptedThinking).toBeUndefined();
	});

	test("tagged live assistant keeps the same row identity when it finalizes", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "finalize-agent", "finalizer");
		const sessionPath = path.join(agent.controlDir, "session.jsonl");
		fs.writeFileSync(sessionPath, "");
		fs.writeFileSync(agent.statusPath, JSON.stringify({
			version: 1, runtime: "profiled-subagents", treeId: fixture.treeId, updatedAt: now,
			agentId: "finalizer", profile: "explore", parentAgentId: "root", label: "finalizer",
			state: "running", startedAt: now - 1_000, sessionPath,
		}));
		writeEvents(agent.controlDir, [
			{ kind: "text", blockId: "text-0", messageSeq: 1, text: "Hello " },
			{ kind: "text", blockId: "text-0", messageSeq: 1, text: "world" },
		]);
		const live = liveTarget("finalizer", [spawnTool(agent, "finalizer")]);
		if (!live) throw new Error("expected live target");
		const liveItems = readSubagentConversation(live.run);
		expect(liveItems).toHaveLength(1);
		const liveItem = liveItems[0];
		if (liveItem?.kind !== "assistant") throw new Error("expected streaming assistant");
		expect(liveItem.status).toBe("streaming");
		expect(liveItem.text).toBe("Hello world");

		fs.writeFileSync(sessionPath, JSON.stringify({
			message: { role: "assistant", content: [{ type: "text", text: "Hello world" }], timestamp: now + 10 },
		}) + "\n");
		const finished = { ...live.run, state: "completed", activityState: "completed" };
		const finishedItems = readSubagentConversation(finished);
		expect(finishedItems).toHaveLength(1);
		const finishedItem = finishedItems[0];
		if (finishedItem?.kind !== "assistant") throw new Error("expected finalized assistant");
		expect(finishedItem.id).toBe(liveItem.id);
		expect(finishedItem.text).toBe("Hello world");
		expect(finishedItem.status).toBe("done");
	});

	test("keeps live thinking between persisted tool rows in wire order", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "chronology-agent", "chronology-child");
		const sessionPath = path.join(agent.controlDir, "session.jsonl");
		const sessionLines = [
			{ message: { role: "user", content: [{ type: "text", text: "Review this." }], timestamp: now - 1_000 } },
			{ message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "one" } }], timestamp: now - 900 } },
			{ message: { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "one" }], timestamp: now - 700 } },
			{ message: { role: "assistant", content: [{ type: "toolCall", id: "call-2", name: "read", arguments: { path: "two" } }], timestamp: now - 600 } },
			{ message: { role: "toolResult", toolCallId: "call-2", toolName: "read", content: [{ type: "text", text: "two" }], timestamp: now - 300 } },
		];
		fs.writeFileSync(sessionPath, sessionLines.map((line) => JSON.stringify(line)).join("\n") + "\n");
		fs.writeFileSync(agent.statusPath, JSON.stringify({
			version: 1,
			runtime: "profiled-subagents",
			treeId: fixture.treeId,
			updatedAt: now,
			agentId: "chronology-child",
			profile: "explore",
			parentAgentId: "root",
			label: "chronology-child",
			state: "running",
			startedAt: now - 1_100,
			sessionPath,
		}));
		writeEvents(agent.controlDir, [
			{ ts: now - 950, kind: "thinking", blockId: "think-1", text: "first thought" },
			{ ts: now - 900, kind: "tool_start", toolName: "bash", toolCallId: "call-1" },
			{ ts: now - 700, kind: "tool_end", toolName: "bash", toolCallId: "call-1" },
			{ ts: now - 650, kind: "thinking", blockId: "think-2", text: "middle thought" },
			{ ts: now - 600, kind: "tool_start", toolName: "read", toolCallId: "call-2" },
			{ ts: now - 300, kind: "tool_end", toolName: "read", toolCallId: "call-2" },
			{ ts: now - 200, kind: "thinking", blockId: "think-3", text: "last thought" },
		]);
		const target = liveTarget("chronology-child", [spawnTool(agent, "chronology-child")]);
		const items = readSubagentConversation(target!.run);
		expect(items.map((item) => item.kind)).toEqual([
			"user",
			"assistant",
			"tool",
			"assistant",
			"tool",
			"assistant",
		]);
		expect(items.map((item) => item.kind === "assistant" ? item.thinking : item.kind === "tool" ? item.name : item.kind === "user" ? item.text : "")).toEqual([
			"Review this.",
			"first thought",
			"bash",
			"middle thought",
			"read",
			"last thought",
		]);
	});

	test("keeps the beginning of a long live thinking block beyond 400 stream events", () => {
		const { fixture, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "long-thinking-agent", "long-thinking");
		writeEvents(agent.controlDir, Array.from({ length: 450 }, (_, index) => ({
			kind: "thinking",
			blockId: "think-long",
			text: index === 0 ? "FIRST " : "x",
		})));
		const target = liveTarget("long-thinking", [spawnTool(agent, "long-thinking")]);
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(1);
		if (items[0]?.kind !== "assistant") throw new Error("expected one accumulated thinking item");
		expect(items[0].thinking.startsWith("FIRST ")).toBe(true);
		expect(items[0].thinking.length).toBe("FIRST ".length + 449);
	});

	test("matches tool_end by call id and keeps a dangling start streaming", () => {
		const { fixture, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "tools-agent", "tools");
		writeEvents(agent.controlDir, [
			{ kind: "tool_start", toolName: "bash", toolCallId: "call-1" },
			{ kind: "tool_start", toolName: "grep", toolCallId: "call-2" },
			{ kind: "tool_end", toolName: "bash", toolCallId: "call-1" },
			{ kind: "tool_end", toolName: "nope", toolCallId: "call-9" },
		]);
		const target = liveTarget("tools", [spawnTool(agent, "tools")]);
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(2);
		const [bash, grep] = items;
		if (bash?.kind !== "tool" || grep?.kind !== "tool") throw new Error("expected two tool items");
		expect(bash.name).toBe("bash");
		expect(bash.status).toBe("done");
		expect(bash.endedAt).toBeDefined();
		expect(grep.name).toBe("grep");
		expect(grep.status).toBe("streaming");
		expect(grep.endedAt).toBeUndefined();
	});

	test("ignores a torn trailing line, unknown kinds and unknown versions", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "torn-agent", "torn");
		writeEvents(agent.controlDir, [
			{ kind: "text", blockId: "text-1", text: "ok" },
			{ kind: "mystery", blockId: "m-1", text: "?", futureField: [1, 2, 3] },
			{ v: 2, kind: "text", blockId: "v2", text: "new" },
			`{"v":1,"seq":99,"ts":${now},"runId":"stream-child","kind":"text","blockId":"torn","text":"oops`,
		]);
		const target = liveTarget("torn", [spawnTool(agent, "torn")]);
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(1);
		if (items[0]?.kind !== "assistant") throw new Error("expected one assistant item");
		expect(items[0].text).toBe("ok");
		expect(items[0].status).toBe("streaming");
	});

	test("ignores the stream once the run is not live so content is not duplicated", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const old = now - PROFILED_HEARTBEAT_MAX_AGE_MS - 1;
		const sessionPath = path.join(fixture.runtimeRoot, "child.jsonl");
		fs.writeFileSync(sessionPath, JSON.stringify({
			timestamp: new Date(now).toISOString(), type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
		}) + "\n");
		const agent = streamAgent(fixture, "done-agent", "done-child", { state: "completed", startedAt: old, updatedAt: old, sessionPath });
		writeEvents(agent.controlDir, [
			{ kind: "text", blockId: "text-1", text: "Hello " },
			{ kind: "text", blockId: "text-1", text: "world" },
		]);
		const target = liveTarget("done-child", [spawnTool(agent, "done-child")]);
		expect(target?.state).toBe("completed");
		expect(target?.active).toBe(false);
		// The stream file is present — suppression comes from the liveness
		// rule, not from a missing path.
		expect(target?.run.eventsPath).toBeDefined();
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(1);
		if (items[0]?.kind !== "assistant") throw new Error("expected the completed assistant message");
		expect(items[0].status).toBe("done");
		expect(items[0].text).toBe("Hello world");
	});

	test("exposes the stream on status-less runs and leaves it undefined when absent", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "bare-agent", "bare");
		fs.rmSync(agent.statusPath);
		writeEvents(agent.controlDir, [{ kind: "text", blockId: "text-1", text: "hi" }]);
		const pending: ToolItem = { ...spawnTool(agent, "bare", "pending"), timestamp: now };
		const target = liveTarget("bare", [pending]);
		expect(target?.run.eventsPath).toBe(path.join(agent.controlDir, "events.jsonl"));
		expect(target?.active).toBe(true);
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(1);
		if (items[0]?.kind !== "assistant") throw new Error("expected a streaming item");
		expect(items[0].text).toBe("hi");
		expect(items[0].status).toBe("streaming");

		const noStream = streamAgent(fixture, "nostream-agent", "nostream");
		const plain = liveTarget("nostream", [spawnTool(noStream, "nostream")]);
		expect(plain?.run.eventsPath).toBeUndefined();
	});

	test("invalidates the inspected transcript when the stream appends", () => {
		const { fixture, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "cache-agent", "cached");
		writeEvents(agent.controlDir, [{ kind: "text", blockId: "text-1", text: "one" }]);
		const target = liveTarget("cached", [spawnTool(agent, "cached")]);
		if (!target) throw new Error("expected a cached target");
		const cache = createSubagentTranscriptCache();
		expect(cache(undefined, true)).toEqual([]);
		expect(cache(target, false)).toEqual([]);
		const first = cache(target, true);
		if (first[0]?.kind !== "assistant") throw new Error("expected a streaming item");
		expect(first[0].text).toBe("one");
		writeEvents(agent.controlDir, [
			{ kind: "text", blockId: "text-1", text: "one" },
			{ kind: "text", blockId: "text-1", text: " two" },
		]);
		const second = cache(target, true);
		if (second[0]?.kind !== "assistant") throw new Error("expected an updated streaming item");
		expect(second[0].text).toBe("one two");
		expect(second).not.toBe(first);
	});

	test("keeps interleaved thinking and tools in wire order", () => {
		const { fixture, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "interleave-agent", "interleaved");
		writeEvents(agent.controlDir, [
			{ kind: "thinking", blockId: "think-1", text: "first thought" },
			{ kind: "tool_start", toolName: "bash", toolCallId: "call-1" },
			{ kind: "thinking", blockId: "think-2", text: "second thought" },
			{ kind: "tool_end", toolName: "bash", toolCallId: "call-1" },
		]);
		const target = liveTarget("interleaved", [spawnTool(agent, "interleaved")]);
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(3);
		expect(items.map((item) => item.kind)).toEqual(["assistant", "tool", "assistant"]);
		const [first, tool, second] = items;
		if (first?.kind !== "assistant" || second?.kind !== "assistant" || tool?.kind !== "tool") {
			throw new Error("expected assistant, tool, assistant in wire order");
		}
		expect(first.thinking).toBe("first thought");
		expect(tool.name).toBe("bash");
		expect(tool.status).toBe("done");
		expect(second.thinking).toBe("second thought");
	});

	test("live tools render one row per call when the session already holds the result", () => {
		// Session call+result AND stream start+end for one callId: the stream
		// twin must not double the session row (once at start, once at finish).
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stream-dupe-"));
		roots.push(dir);
		const now = Date.now();
		const sessionFile = path.join(dir, "session.jsonl");
		fs.writeFileSync(sessionFile, [
			JSON.stringify({
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "x" } }],
					timestamp: now - 500,
				},
			}),
			JSON.stringify({
				message: {
					role: "toolResult", toolCallId: "call-1", toolName: "read",
					content: "file contents", timestamp: now - 400,
				},
			}),
		].join("\n") + "\n");
		const eventsPath = path.join(dir, "events.jsonl");
		let seq = 0;
		fs.writeFileSync(eventsPath, [
			{ kind: "tool_start", toolName: "read", toolCallId: "call-1" },
			{ kind: "tool_end", toolName: "read", toolCallId: "call-1" },
		].map((line) => JSON.stringify({ v: 1, seq: seq++, ts: now, runId: "dupe-child", ...line })).join("\n") + "\n");
		const run: SubagentRun = {
			runId: "dupe-live", mode: "profiled", control: "profiled", state: "running",
			steps: [], sessionFile, eventsPath, startedAt: now - 1000,
			lastUpdate: now, profiledStatusBacked: true,
		};
		const tools = readSubagentConversation(run).filter(
			(item): item is ToolItem => item.kind === "tool" && item.toolCallId === "call-1",
		);
		expect(tools).toHaveLength(1);
		expect(tools[0]?.status).toBe("done");
		expect(tools[0]?.output).toBe("file contents");
	});

	test("live in-flight tools keep the single streaming stream row", () => {
		// Session holds the call but no result yet: no session row exists, so
		// the stream row below is still created and reads streaming.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stream-inflight-"));
		roots.push(dir);
		const now = Date.now();
		const sessionFile = path.join(dir, "session.jsonl");
		fs.writeFileSync(sessionFile, JSON.stringify({
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "x" } }],
				timestamp: now - 500,
			},
		}) + "\n");
		const eventsPath = path.join(dir, "events.jsonl");
		fs.writeFileSync(eventsPath, JSON.stringify({ v: 1, seq: 0, ts: now, runId: "dupe-child", kind: "tool_start", toolName: "read", toolCallId: "call-1" }) + "\n");
		const run: SubagentRun = {
			runId: "dupe-inflight", mode: "profiled", control: "profiled", state: "running",
			steps: [], sessionFile, eventsPath, startedAt: now - 1000,
			lastUpdate: now, profiledStatusBacked: true,
		};
		const tools = readSubagentConversation(run).filter(
			(item): item is ToolItem => item.kind === "tool" && item.toolCallId === "call-1",
		);
		expect(tools).toHaveLength(1);
		expect(tools[0]?.status).toBe("streaming");
		expect(tools[0]?.id.startsWith("subagent-stream-")).toBe(true);
	});
});
