import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MessageView } from "../src/ui/message.tsx";
import { Sidebar, sidebarScopeForTarget } from "../src/ui/sidebar.tsx";
import { SubagentInspector } from "../src/ui/subagent-inspector.tsx";
import { SubagentSelectorDialog } from "../src/ui/subagent-selector.tsx";
import { subagentTargets } from "../src/subagents/targets.ts";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import type { SubagentRun } from "../src/types.ts";

import { mount } from "./render-helpers/mount.tsx";
import { tempDirs } from "./render-helpers/test-env.ts";

describe("OpenTUI components", () => {
	test("inspector, selector and sidebar keep their per-child views for parallel subagents", async () => {
		const run: SubagentRun = {
			runId: "parallel-run",
			asyncDir: "/tmp/parallel-run",
			mode: "parallel",
			state: "running",
			steps: [
				{
					index: 0,
					agent: "implementer",
					status: "running",
					sessionFile: "/tmp/impl.jsonl",
					model: "provider/child",
					contextWindow: 8192,
					thinking: "high",
					lastActivityAt: 1_000,
				},
				{
					index: 1,
					agent: "reviewer",
					status: "completed",
					lastActivityAt: 500,
				},
			],
		};
		const targets = subagentTargets([run]);
		const selector = await mount(
			() => (
				<SubagentSelectorDialog
					targets={targets}
					selectedKey={targets[0]?.key}
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			90,
			24,
		);
		const selectorFrame = selector.captureCharFrame();
		expect(selectorFrame).toContain("implementer");
		expect(selectorFrame).toContain("reviewer");
		expect(selectorFrame.indexOf("implementer")).toBeLessThan(
			selectorFrame.indexOf("reviewer"),
		);
		expect(selectorFrame).toContain("1 active");

		const finished = targets.find(
			(target) => target.step?.agent === "reviewer",
		)!;
		const inspector = await mount(
			() => <SubagentInspector target={finished} items={[]} now={2_000} />,
			100,
			24,
		);
		const inspectorFrame = inspector.captureCharFrame();
		expect(inspectorFrame).toContain("finished · read only");
		// Model/context belong to the sidebar scope; the inspector shows none.
		expect(inspectorFrame).not.toContain("— / —");
		expect(inspectorFrame).not.toContain("Thinking:");
		expect(inspectorFrame).not.toContain("Context");
		expect(inspectorFrame).not.toContain("Model");
		expect(inspectorFrame).toContain("reviewer #2");
		expect(inspectorFrame).toContain("finished");
		expect(inspectorFrame).not.toContain("parallel/completed");
		expect(inspectorFrame).not.toContain("▤");
		expect(inspectorFrame).not.toContain("◆");
		expect(inspectorFrame).not.toContain("ctx?");
		expect(inspectorFrame).not.toContain("Steer reviewer #2");
		expect(inspectorFrame).not.toContain("Ctrl+A pause");
		expect(inspectorFrame).not.toContain("Ctrl+Shift+A stop");

		const active = targets.find(
			(target) => target.step?.agent === "implementer",
		)!;
		const sidebar = await mount(
			() => <Sidebar runs={[run]} now={2_000} />,
			42,
			24,
		);
		// Row one: agent and age; row two: what it is doing.
		// No start time recorded: the row shows no run time rather than the
		// status file's age.
		expect(sidebar.captureCharFrame()).toMatch(/implementer #1\s*\n/);
		expect(sidebar.captureCharFrame()).toContain("working");
		const activeInspector = await mount(
			() => <SubagentInspector target={active} items={[]} now={2_000} />,
			100,
			24,
		);
		const activeFrame = activeInspector.captureCharFrame();
		expect(activeFrame).toContain("◐ working");
		// Each child's own model reaches the sidebar through its scope.
		expect(sidebarScopeForTarget(active).model).toBe("provider/child");
		expect(sidebarScopeForTarget(active).thinking).toBe("high");
		expect(activeFrame).not.toContain("parallel/running");
		expect(activeFrame).not.toContain("▤");
		expect(activeFrame).not.toContain("◆");
		expect(activeFrame).not.toContain("8.2k ctx");
	});

	test("profiled live child streams thinking, text and tool starts through MessageView", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-stream-render-"));
		tempDirs.push(dir);
		const now = Date.now();
		const eventsPath = path.join(dir, "events.jsonl");
		const lines = [
			{ kind: "thinking", blockId: "think-1", text: "considering the API" },
			{ kind: "thinking", blockId: "think-1", text: " surface" },
			{ kind: "text", blockId: "text-1", text: "drafting the reply" },
			{ kind: "tool_start", toolName: "bash", toolCallId: "call-t1" },
		];
		fs.writeFileSync(
			eventsPath,
			lines
				.map((line, seq) =>
					JSON.stringify({
						v: 1,
						seq,
						ts: now,
						runId: "stream-child",
						...line,
					}),
				)
				.join("\n") + "\n",
		);
		const run: SubagentRun = {
			runId: "profiled:stream-child",
			control: "profiled",
			runtime: "profiled-subagents",
			mode: "profiled",
			state: "running",
			agent: "explore",
			profiledStatusBacked: true,
			lastUpdate: now,
			startedAt: now - 1_000,
			eventsPath,
			steps: [],
		};
		const items = readSubagentConversation(run);
		expect(items).toHaveLength(3);
		expect(
			items.map((item) =>
				item.kind === "assistant" || item.kind === "tool"
					? item.status
					: undefined,
			),
		).toEqual(["streaming", "streaming", "streaming"]);
		const setup = await mount(() => (
			<box width="100%" height="100%" flexDirection="column">
				{items.map((item) => (
					<MessageView
						item={item}
						showThinking
						toolExpanded={false}
						now={now}
					/>
				))}
			</box>
		));
		const frame = setup.captureCharFrame();
		// Live thinking block, streaming answer text and streaming tool glyph.
		expect(frame).toContain("considering the API surface");
		expect(frame).toContain("drafting the reply");
		expect(frame).toContain("Thinking");
		expect(frame).toContain("◉");
		// A block opened by the stream but still waiting for its first chunk
		// (inside the writer's coalescing window) renders the cursor.
		const cursor = await mount(() => (
			<MessageView
				item={{
					kind: "assistant",
					id: "stream-cursor",
					text: "",
					thinking: "",
					timestamp: now,
					status: "streaming",
				}}
				showThinking
				toolExpanded={false}
				now={now}
			/>
		));
		expect(cursor.captureCharFrame()).toContain("▍");
	});
});
