import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { cleanThinkingText, MessageView } from "../src/ui/message.tsx";
import { SubagentInspector } from "../src/ui/subagent-inspector.tsx";
import type { ConversationItem, SubagentRun } from "../src/types.ts";

import { mount } from "./render-helpers/mount.tsx";

describe("OpenTUI components", () => {
	test("removes repeated provider thinking headings without changing prose", () => {
		expect(cleanThinkingText("Thinking:\nThinking: **Planning work**")).toBe(
			"**Planning work**",
		);
		expect(cleanThinkingText("Reasoning\nThinking: inspect files")).toBe(
			"inspect files",
		);
		expect(cleanThinkingText("Thinking about the safest approach")).toBe(
			"Thinking about the safest approach",
		);
	});

	test("renders fenced code with default Markdown rendering when copy is absent", async () => {
		const assistant: ConversationItem = {
			kind: "assistant",
			id: "markdown-code",
			text: "```ts\nconst x = 1;\n```",
			thinking: "",
			timestamp: 1,
			status: "done",
		};
		const setup = await mount(() => (
			<MessageView item={assistant} showThinking toolExpanded={false} />
		));
		expect(setup.captureCharFrame()).toContain("const x = 1;");
	});

	test("renders main and subagent thinking as sanitized Markdown", async () => {
		const assistant: ConversationItem = {
			kind: "assistant",
			id: "markdown-thinking",
			text: "",
			thinking:
				"\u001b[38;2;34;211;238mThinking:\u001b[39m **Planning validation**\n\n- inspect tests\n- run typecheck",
			timestamp: 1,
			status: "done",
		};
		const run: SubagentRun = {
			runId: "run-markdown",
			asyncDir: "/tmp/run-markdown",
			mode: "single",
			state: "running",
			agent: "implementer",
			steps: [],
		};
		const tool: ConversationItem = {
			kind: "tool",
			id: "subagent-tool",
			toolCallId: "subagent-tool",
			name: "bash",
			args: "bun test",
			output: "5 pass\n0 fail",
			timestamp: 2,
			startedAt: 2,
			endedAt: 349,
			status: "done",
			isError: false,
		};

		const main = await mount(() => (
			<MessageView
				item={assistant}
				showThinking
				thinkingExpanded
				toolExpanded={false}
			/>
		));
		const mainFrame = main.captureCharFrame();
		expect(mainFrame).toContain("Planning validation");
		expect(mainFrame).toContain("inspect tests");
		expect(mainFrame).not.toContain("[38;2;");
		expect(mainFrame).not.toContain("**Planning");

		const subagent = await mount(
			() => (
				<SubagentInspector
					run={run}
					items={[assistant, tool]}
					now={1_000}
					thinkingExpanded={() => true}
					toolExpanded={() => false}
					diffExpanded={() => false}
				/>
			),
			110,
			30,
		);
		const subagentFrame = subagent.captureCharFrame();
		expect(subagentFrame).toContain("Planning validation");
		expect(subagentFrame).toContain("✓ bash");
		expect(subagentFrame).toContain("5 pass");
		expect(subagentFrame).not.toContain("[38;2;");
	});

	test("renders distinct user, assistant, and tool messages", async () => {
		const items: ConversationItem[] = [
			{
				kind: "user",
				id: "u",
				text: "Please inspect the tests",
				timestamp: 1,
				optimistic: false,
			},
			{
				kind: "assistant",
				id: "a",
				text: "I found **two** relevant files.",
				thinking: "checking",
				timestamp: 2,
				status: "done",
			},
			{
				kind: "tool",
				id: "t",
				toolCallId: "tool-1",
				name: "bash",
				args: { command: "bun test" },
				output: "5 pass\n0 fail",
				timestamp: 3,
				status: "done",
				isError: false,
			},
		];
		const setup = await mount(() => (
			<box width="100%" height="100%" flexDirection="column">
				{items.map((item) => (
					<MessageView item={item} showThinking toolExpanded={false} />
				))}
			</box>
		));
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Please inspect the tests");
		expect(frame).toContain("two relevant files");
		expect(frame).toContain("bash");
		expect(frame).toContain("5 pass");
		expect(frame).not.toContain("click to expand");
		expect(frame).not.toContain("▶");
	});

	test("renders colorful tool cards with a collapsible diff", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "edit-diff",
			toolCallId: "edit-diff",
			name: "edit",
			args: { path: "src/app.ts", edits: [] },
			output: "Applied edit",
			diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old value\n+new value\n",
			diffPath: "src/app.ts",
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const collapsed = await mount(() => (
			<MessageView
				item={item}
				showThinking
				toolExpanded={false}
				diffExpanded={false}
			/>
		));
		const collapsedFrame = collapsed.captureCharFrame();
		expect(collapsedFrame).toContain("✓ edit");
		expect(collapsedFrame).toContain("Changes");
		expect(collapsedFrame).toContain("+1");
		expect(collapsedFrame).toContain("-1");
		expect(collapsedFrame).not.toContain("old value");

		const expanded = await mount(() => (
			<MessageView item={item} showThinking toolExpanded={false} diffExpanded />
		));
		const expandedFrame = expanded.captureCharFrame();
		expect(expandedFrame).toContain("old value");
		expect(expandedFrame).toContain("new value");
	});

	test("shows the tail of long collapsed thinking instead of its beginning", async () => {
		const thought =
			"opening marker alpha: restate the task, weigh the alternatives, and trace the data flow through the sidebar and the app state before deciding anything, " +
			"middle filler: several paragraphs of analysis about tradeoffs, reset epochs, and the history buffer accumulate here so the preview must choose an end, " +
			"the plan converges on compact rows and a focused render test, so closing marker zeta";
		const assistant: ConversationItem = {
			kind: "assistant",
			id: "tail-thinking",
			text: "",
			thinking: thought,
			timestamp: 1,
			// The one-line preview exists only while the thought streams; a
			// finished collapsed thought is just its heading.
			status: "streaming",
		};
		const setup = await mount(() => (
			<MessageView
				item={assistant}
				showThinking
				thinkingExpanded={false}
				toolExpanded={false}
			/>
		));
		const frame = setup.captureCharFrame();
		expect(frame).toContain("closing marker zeta");
		expect(frame).not.toContain("opening marker alpha");
		expect(frame).toContain("∴ Thinking…");
	});

	test("renders live assistant output as stable plain text and tool timing", async () => {
		const items: ConversationItem[] = [
			{
				kind: "assistant",
				id: "live",
				text: "Streaming **unfinished",
				thinking: "Thinking: checking",
				timestamp: 2,
				status: "streaming",
			},
			{
				kind: "tool",
				id: "tool-time",
				toolCallId: "tool-time",
				name: "bash",
				args: { command: "sleep 1", timeout: 30 },
				output: "running",
				timestamp: 3,
				startedAt: 1_000,
				timeoutMs: 30_000,
				status: "streaming",
				isError: false,
			},
		];
		const setup = await mount(() => (
			<box width="100%" height="100%" flexDirection="column">
				{items.map((item) => (
					<MessageView
						item={item}
						showThinking
						toolExpanded={false}
						now={6_000}
					/>
				))}
			</box>
		));
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Streaming **unfinished");
		expect(frame).toContain("checking");
		expect(frame.match(/Thinking/g)?.length).toBe(1);
		expect(frame).toContain("5s / timeout 30s");
	});

	test("collapses a finished thought to its heading and expands it on demand", async () => {
		const item: ConversationItem = {
			kind: "assistant",
			id: "thinking-toggle",
			text: "Done.",
			thinking: `HEAD_MARKER_ALPHA ${"neutral filler about file inspection ".repeat(8)}\nUNIQUE_EXPANDED_DETAIL`,
			timestamp: 2,
			status: "done",
		};
		const collapsed = await mount(() => (
			<MessageView
				item={item}
				showThinking
				thinkingExpanded={false}
				toolExpanded={false}
			/>
		));
		const collapsedFrame = collapsed.captureCharFrame();
		// A finished, collapsed thought is one heading row with its size.
		expect(collapsedFrame).toContain("∴ Thought · 2 lines");
		expect(collapsedFrame).not.toContain("UNIQUE_EXPANDED_DETAIL");
		expect(collapsedFrame).not.toContain("HEAD_MARKER_ALPHA");

		const expanded = await mount(() => (
			<MessageView
				item={item}
				showThinking
				thinkingExpanded
				toolExpanded={false}
			/>
		));
		const expandedFrame = expanded.captureCharFrame();
		expect(expandedFrame).toContain("▾ Thought · 2 lines");
		expect(expandedFrame).toContain("UNIQUE_EXPANDED_DETAIL");
	});

	test("does not render a fake answer row when an assistant is only thinking", async () => {
		const item: ConversationItem = {
			kind: "assistant",
			id: "thinking-only",
			text: "",
			thinking: "Inspecting the branch state before changing anything.",
			timestamp: 2,
			status: "streaming",
		};
		const setup = await mount(() => (
			<MessageView
				item={item}
				showThinking
				thinkingExpanded
				toolExpanded={false}
			/>
		));
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Thinking");
		expect(frame).toContain("Inspecting the branch state");
		const thinkingLine = frame
			.split("\n")
			.find((line) => line.includes("Inspecting the branch state"));
		expect(thinkingLine?.indexOf("Inspecting the branch state")).toBe(1);
		expect(frame).not.toContain("▍");
	});
});

describe("batch B render layer", () => {
	test("thinking/answer pairs keep exactly one alternative visible", async () => {
		const streaming: ConversationItem = {
			kind: "assistant",
			id: "pair-1",
			text: "draft reply",
			thinking: "considering it",
			timestamp: 1,
			status: "streaming",
		};
		const [item, setItem] = createSignal<ConversationItem>(streaming);
		const [expanded, setExpanded] = createSignal(true);
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<MessageView
						item={item}
						showThinking
						thinkingExpanded={expanded}
						toolExpanded={false}
						now={2_000}
					/>
				</box>
			),
			100,
			30,
		);
		const visible = (id: string): boolean | undefined =>
			(
				setup.renderer.root.findDescendantById(id) as
					| { visible?: boolean }
					| undefined
			)?.visible;
		// Streaming + expanded: the streaming text shows, its markdown
		// replacement stays hidden — never both, never neither.
		expect(visible("pair-1-thinking-stream")).toBe(true);
		expect(visible("pair-1-thinking-markdown")).toBe(false);
		expect(visible("pair-1-answer-stream")).toBe(true);
		expect(visible("pair-1-answer-markdown")).toBe(false);
		// Streaming -> done: exactly one alternative flips per pair.
		setItem({ ...streaming, status: "done" });
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		expect(visible("pair-1-thinking-stream")).toBe(false);
		expect(visible("pair-1-thinking-markdown")).toBe(true);
		expect(visible("pair-1-answer-stream")).toBe(false);
		expect(visible("pair-1-answer-markdown")).toBe(true);
		// No frame duplicates the thought or the reply across the pair.
		const frame = setup.captureCharFrame();
		expect(frame.split("considering it").length - 1).toBe(1);
		expect(frame.split("draft reply").length - 1).toBe(1);
		// Collapsed -> expanded flip on the settled item: preview hides as
		// the markdown shows, still exactly one.
		setExpanded(false);
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		expect(visible("pair-1-thinking-markdown")).toBe(false);
		setExpanded(true);
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		expect(visible("pair-1-thinking-markdown")).toBe(true);
		expect(setup.captureCharFrame().split("considering it").length - 1).toBe(1);
	});
});
