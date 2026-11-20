import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MessageView, toolOutputExpandable } from "../src/ui/message.tsx";
import { subagentTargets } from "../src/subagents/targets.ts";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import type { ConversationItem, ToolItem } from "../src/types.ts";
import { nextDetailToggle } from "../src/app.tsx";

import { mount } from "./render-helpers/mount.tsx";
import { tempDirs } from "./render-helpers/test-env.ts";

describe("OpenTUI components", () => {
	test("only makes tool output expandable when it actually needs more space", () => {
		expect(toolOutputExpandable("5 pass\n0 fail")).toBe(false);
		expect(toolOutputExpandable("one\ntwo\nthree\nfour\nfive")).toBe(false);
		expect(
			toolOutputExpandable(
				Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n"),
			),
		).toBe(true);
		expect(toolOutputExpandable("x".repeat(200))).toBe(true);
		expect(toolOutputExpandable(`${"alpha ".repeat(30)}\nshort`)).toBe(true);
		expect(toolOutputExpandable("x".repeat(321))).toBe(true);
	});

	test("completed profiled tools render one row with a Changes section", async () => {
		// The live event stream carries no diff; the session file's toolResult
		// `details` is authoritative (same derivation as `initialItems`). The
		// stream twin of an already-rendered session tool is skipped, so the
		// call renders once — with its Changes section intact.
		const now = Date.now();
		const base = process.env.PI_PITTY_PROFILED_ROOT?.trim() || os.tmpdir();
		const root = fs.mkdtempSync(
			path.join(base, "pi-profiled-subagents-stream-diff-"),
		);
		tempDirs.push(root);
		const treeId = `tree-stream-diff-${Date.now()}`;
		const controlDir = path.join(root, "stream-diff-live");
		fs.mkdirSync(path.join(controlDir, "control", "steer-requests"), {
			recursive: true,
		});
		fs.mkdirSync(path.join(controlDir, "control", "acks"), { recursive: true });
		const sessionFile = path.join(root, "stream-diff-session.jsonl");
		fs.writeFileSync(
			sessionFile,
			[
				JSON.stringify({
					message: {
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "call-edit-1",
								name: "edit",
								arguments: { path: "x" },
							},
						],
						timestamp: now - 500,
					},
				}),
				JSON.stringify({
					message: {
						role: "toolResult",
						toolCallId: "call-edit-1",
						toolName: "edit",
						content: "Applied edit",
						details: {
							diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n",
							path: "x",
						},
						timestamp: now - 400,
					},
				}),
			].join("\n") + "\n",
		);
		const statusPath = path.join(controlDir, "status.json");
		fs.writeFileSync(
			statusPath,
			JSON.stringify({
				version: 1,
				runtime: "profiled-subagents",
				treeId,
				updatedAt: now,
				agentId: "stream-differ",
				profile: "explore",
				parentAgentId: "root",
				label: "stream-differ",
				state: "running",
				startedAt: now - 1000,
				sessionPath: sessionFile,
			}),
		);
		let seq = 0;
		const event = (line: Record<string, unknown>) =>
			JSON.stringify({
				v: 1,
				seq: seq++,
				ts: now,
				runId: "stream-differ",
				...line,
			});
		fs.writeFileSync(
			path.join(controlDir, "events.jsonl"),
			[
				event({
					kind: "tool_start",
					toolName: "edit",
					toolCallId: "call-edit-1",
				}),
				event({
					kind: "tool_end",
					toolName: "edit",
					toolCallId: "call-edit-1",
				}),
			].join("\n") + "\n",
		);
		const tool: ToolItem = {
			kind: "tool",
			id: "spawn-stream-diff",
			toolCallId: "spawn-stream-diff-call",
			name: "agent_spawn",
			args: { agent: "explore" },
			output: "",
			details: {
				runtime: "profiled-subagents",
				treeId,
				parentAgentId: "root",
				agentId: "stream-differ",
				profile: "explore",
				label: "stream-differ",
				state: "running",
				controlDir,
				statusPath,
			},
			timestamp: now,
			status: "done",
			isError: false,
		};
		const target = subagentTargets([], [tool]).find(
			(entry) => entry.run.agentId === "stream-differ",
		)!;
		expect(target.active).toBe(true);
		// Exactly one row per call: no stream twin alongside the session row.
		const callTools = readSubagentConversation(target.run).filter(
			(item): item is ToolItem =>
				item.kind === "tool" && item.toolCallId === "call-edit-1",
		);
		expect(callTools).toHaveLength(1);
		const streamTool = callTools[0]!;
		expect(streamTool.diff ?? "").toContain("-old");
		expect(streamTool.diffPath).toBe("x");
		const setup = await mount(() => (
			<MessageView
				item={streamTool}
				showThinking
				toolExpanded={false}
				diffExpanded={false}
			/>
		));
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Changes");
		expect(frame).toContain("+1");
		expect(frame).toContain("-1");
	});

	test("global details toggle collapses mixed individual overrides", () => {
		expect(
			nextDetailToggle({
				toolsExpanded: false,
				thinkingExpanded: false,
				compactionExpanded: true,
				hasExpandedToolOverride: true,
			}),
		).toBe(false);
		expect(
			nextDetailToggle({ toolsExpanded: false, thinkingExpanded: false }),
		).toBe(true);
		expect(
			nextDetailToggle({
				toolsExpanded: false,
				thinkingExpanded: false,
				compactionExpanded: true,
			}),
		).toBe(false);
	});
});

describe("duration and sidebar repaint regressions", () => {
	test("shows sub-second tool durations in milliseconds", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "fast-tool",
			toolCallId: "fast-tool",
			name: "bash",
			args: { command: "true" },
			output: "done",
			timestamp: 1,
			startedAt: 1_000,
			endedAt: 1_347,
			status: "done",
			isError: false,
		};
		const setup = await mount(() => (
			<MessageView item={item} showThinking toolExpanded={false} now={2_000} />
		));
		expect(setup.captureCharFrame()).toContain("347ms");
	});
});

describe("batch A data truth", () => {
	test("task-shaped tools render the derived description, not raw JSON", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "task-1",
			toolCallId: "task-1-call",
			name: "task_fetch",
			args: { agent: "helper", task: "do it" },
			output: "",
			timestamp: 1,
			startedAt: 1,
			status: "done",
			isError: false,
		};
		const setup = await mount(() => (
			<box width="100%" height="100%" flexDirection="column">
				<MessageView
					item={item}
					showThinking
					toolExpanded={false}
					now={2_000}
				/>
			</box>
		));
		const frame = setup.captureCharFrame();
		// The unified family rule derives the label from args…
		expect(frame).toContain("helper");
		// …shows the task gist…
		expect(frame).toContain("do it");
		// …and hides the redundant raw-args preview.
		expect(frame).not.toContain('"agent"');
	});

	test("subagent-family tools without a summary fall back to the args preview", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "task-2",
			toolCallId: "task-2-call",
			name: "task_custom",
			args: { foo: "bar" },
			output: "",
			timestamp: 1,
			startedAt: 1,
			status: "done",
			isError: false,
		};
		const setup = await mount(() => (
			<box width="100%" height="100%" flexDirection="column">
				<MessageView
					item={item}
					showThinking
					toolExpanded={false}
					now={2_000}
				/>
			</box>
		));
		const frame = setup.captureCharFrame();
		expect(frame).toContain("task_custom");
		expect(frame).toContain("bar");
	});
});
