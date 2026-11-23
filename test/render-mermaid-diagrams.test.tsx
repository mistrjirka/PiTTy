import { expect, test } from "bun:test";
import { MessageView } from "../src/ui/message.tsx";
import { renderMermaidInTerminal } from "../src/ui/mermaid-renderer.ts";
import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";
import type { AssistantItem } from "../src/types.ts";

useRenderTestEnv();

const assistant = (text: string): AssistantItem => ({
	kind: "assistant", id: "mermaid-test", text, thinking: "",
	timestamp: 1, status: "done",
});

test("Mermaid rendering produces readable Unicode diagrams without ANSI", () => {
	const diagram = renderMermaidInTerminal("graph LR\nA[Start] --> B[Done]");
	expect(diagram).toContain("Start");
	expect(diagram).toContain("Done");
	expect(diagram).toContain("►");
	expect(diagram).not.toContain("\x1b");
	expect(renderMermaidInTerminal("")).toBeUndefined();
	expect(renderMermaidInTerminal("graph TD\n" + "A-->A\n".repeat(110))).toBeUndefined();
	expect(renderMermaidInTerminal("graph TD\n" + "x".repeat(6100))).toBeUndefined();
});

test("an assistant Mermaid fence renders inline, with clickable original source", async () => {
	const text = "Before diagram.\n\n```mermaid\ngraph LR\nA[Start] --> B[Done]\n```\n\nAfter diagram.";
	const setup = await mount(() => <MessageView item={assistant(text)} showThinking toolExpanded={false} />, 100, 34);
	try {
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Before diagram.");
		expect(frame).toContain("Mermaid diagram · show source");
		expect(frame).toContain("Start");
		expect(frame).toContain("Done");
		expect(frame).toContain("After diagram.");
		const toggle = setup.renderer.root.findDescendantById("mermaid-test-answer-markdown-mermaid-1-toggle");
		expect(toggle).toBeDefined();
		if (!toggle) return;
		await setup.mockMouse.click(toggle.x + 2, toggle.y);
		await setup.flush();
		const source = setup.captureCharFrame();
		expect(source).toContain("Mermaid source · show diagram");
		expect(source).toContain("graph LR");
		expect(source).toContain("A[Start] --> B[Done]");
	} finally {
		setup.renderer.destroy();
	}
});

test("expanded tool output renders Mermaid without changing other output text", async () => {
	const tool = {
		kind: "tool" as const,
		id: "mermaid-tool", toolCallId: "mermaid-tool-call", name: "bash",
		args: { command: "cat diagram.md" },
		output: "Diagram follows:\n\n```mermaid\ngraph LR\nA[One] --> B[Two]\n```",
		timestamp: 1, status: "done" as const, isError: false,
	};
	const setup = await mount(() => <MessageView item={tool}
		showThinking toolExpanded={true} />, 110, 34);
	try {
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Mermaid diagram · show source");
		expect(frame).toContain("One");
		expect(frame).toContain("Two");
		expect(frame).toContain("Diagram follows");
	} finally {
		setup.renderer.destroy();
	}
});

test("bad or unsupported Mermaid syntax preserves the original Markdown fence", async () => {
	const text = "```mermaid\nnotADiagram X\n```";
	const setup = await mount(() => <MessageView item={assistant(text)} showThinking toolExpanded={false} />, 100, 22);
	try {
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("notADiagram X");
		expect(frame).not.toContain("Mermaid diagram · show source");
	} finally {
		setup.renderer.destroy();
	}
});
