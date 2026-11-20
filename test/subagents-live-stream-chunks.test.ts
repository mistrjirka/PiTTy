import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import { type AssistantItem } from "../src/types.ts";
import { useIsolatedSubagentRoots, streamHarness, streamAgent } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("profiled live event stream", () => {
	test("accumulates consecutive same-block chunks into one streaming item", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "stream-agent", "streamer");
		writeEvents(agent.controlDir, [
			{ kind: "thinking", blockId: "think-1", text: "conside" },
			{ kind: "thinking", blockId: "think-1", text: "ring it" },
			{ kind: "text", blockId: "text-1", text: "draft" },
			{ kind: "text", blockId: "text-1", text: " reply" },
		]);
		const target = liveTarget("streamer", [spawnTool(agent, "streamer")]);
		expect(target?.active).toBe(true);
		expect(target?.run.eventsPath).toBeDefined();
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(2);
		const [thinkingItem, textItem] = items;
		if (thinkingItem?.kind !== "assistant") throw new Error("expected a streaming thinking item");
		expect(thinkingItem.status).toBe("streaming");
		expect(thinkingItem.thinking).toBe("considering it");
		expect(thinkingItem.text).toBe("");
		if (textItem?.kind !== "assistant") throw new Error("expected a streaming text item");
		expect(textItem.status).toBe("streaming");
		expect(textItem.text).toBe("draft reply");
		expect(now).toBeLessThanOrEqual(Date.now());
	});

	test("starts a new item when the block id changes", () => {
		const { fixture, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "blocks-agent", "blocks");
		writeEvents(agent.controlDir, [
			{ kind: "text", blockId: "text-1", text: "one" },
			{ kind: "text", blockId: "text-2", text: "two" },
		]);
		const target = liveTarget("blocks", [spawnTool(agent, "blocks")]);
		const items = readSubagentConversation(target!.run);
		expect(items).toHaveLength(2);
		expect(items.map((item) => item.kind === "assistant" ? item.text : undefined)).toEqual(["one", "two"]);
		expect(items.every((item) => item.kind === "assistant" && item.status === "streaming")).toBe(true);
	});

	test("live stream owns a persisted final answer so it renders once in wire order", () => {
		const { fixture, now, writeEvents, spawnTool, liveTarget } = streamHarness();
		const agent = streamAgent(fixture, "answer-agent", "answer-child");
		const sessionPath = path.join(agent.controlDir, "session.jsonl");
		fs.writeFileSync(sessionPath, JSON.stringify({
			message: {
				role: "assistant",
				content: [{ type: "text", text: "No concrete findings." }],
				timestamp: now - 500,
			},
		}) + "\n");
		fs.writeFileSync(agent.statusPath, JSON.stringify({
			version: 1,
			runtime: "profiled-subagents",
			treeId: fixture.treeId,
			updatedAt: now,
			agentId: "answer-child",
			profile: "explore",
			parentAgentId: "root",
			label: "answer-child",
			state: "running",
			startedAt: now - 1_000,
			sessionPath,
		}));
		writeEvents(agent.controlDir, [
			{ kind: "tool_start", toolName: "bash", toolCallId: "call-1" },
			{ kind: "tool_end", toolName: "bash", toolCallId: "call-1" },
			{ kind: "text", blockId: "final-answer", messageSeq: 1, text: "No concrete findings." },
		]);
		const target = liveTarget("answer-child", [spawnTool(agent, "answer-child")]);
		const items = readSubagentConversation(target!.run);
		expect(items.map((item) => item.kind)).toEqual(["tool", "assistant"]);
		const answers = items.filter(
			(item): item is AssistantItem => item.kind === "assistant" && item.text === "No concrete findings.",
		);
		expect(answers).toHaveLength(1);
		expect(answers[0]?.status).toBe("done");
		expect(answers[0]?.id).toContain("m1-final-answer");
	});
});
