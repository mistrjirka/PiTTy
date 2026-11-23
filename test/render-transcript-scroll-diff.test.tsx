import { describe, expect, test } from "bun:test";
import {
	Renderable,
	type BoxRenderable,
	type TextRenderable,
	type ScrollBoxRenderable,
} from "@opentui/core";
import { createSignal } from "solid-js";
import { MessageView } from "../src/ui/message.tsx";
import type { ConversationItem } from "../src/types.ts";

import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("OpenTUI components", () => {
	test("keeps wheel scrolling transcript-first until output scrolling is explicit", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "scroll-owner-tool",
			toolCallId: "scroll-owner-tool",
			name: "bash",
			args: {},
			output: Array.from(
				{ length: 40 },
				(_, index) => `OUTPUT_ROW_${index + 1}`,
			).join("\n"),
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const [expanded, setExpanded] = createSignal(true);
		let transcript!: ScrollBoxRenderable;
		const setup = await mount(
			() => (
				<scrollbox
					id="scroll-owner-transcript"
					ref={(value) => {
						transcript = value;
					}}
					height={12}
					scrollY
					scrollX={false}
				>
					<MessageView
						item={item}
						showThinking
						toolExpanded={expanded}
						onToggleTool={() => setExpanded((value) => !value)}
					/>
				</scrollbox>
			),
			90,
			16,
		);
		let frame = setup.captureCharFrame();
		expect(frame).toContain("scroll output");
		const initiallyHiddenInner = setup.renderer.root.findDescendantById(
			"scroll-owner-tool-output-scroll",
		) as ScrollBoxRenderable | undefined;
		expect(initiallyHiddenInner).toBeDefined();
		expect(initiallyHiddenInner?.visible).toBe(false);
		const previewRow = frame
			.split("\n")
			.findIndex((line) => line.includes("OUTPUT_ROW_2"));
		expect(previewRow).toBeGreaterThanOrEqual(0);
		await setup.mockMouse.scroll(4, previewRow, "down");
		await setup.flush();
		expect(transcript.scrollTop).toBeGreaterThan(0);

		transcript.scrollTo(0);
		await setup.flush();
		frame = setup.captureCharFrame();
		const outputScrollToggle = setup.renderer.root.findDescendantById(
			"scroll-owner-tool-output-scroll-toggle",
		) as Renderable | undefined;
		expect(outputScrollToggle).toBeDefined();
		if (!outputScrollToggle) throw new Error("output scroll toggle missing");
		await setup.mockMouse.click(outputScrollToggle.x, outputScrollToggle.y);
		await setup.flush();
		const inner = setup.renderer.root.findDescendantById(
			"scroll-owner-tool-output-scroll",
		) as ScrollBoxRenderable | undefined;
		expect(inner).toBeDefined();
		if (!inner) throw new Error("inner output scrollbox missing");
		frame = setup.captureCharFrame();
		expect(frame).toContain("chat scroll");
		inner.scrollTo(10);
		await setup.flush();
		const innerBefore = inner.scrollTop;
		await setup.mockMouse.scroll(4, inner.y + 1, "up");
		await setup.flush();
		expect(inner.scrollTop).toBeLessThan(innerBefore);
		expect(transcript.scrollTop).toBe(0);

		frame = setup.captureCharFrame();
		const toolToggle = setup.renderer.root.findDescendantById(
			"scroll-owner-tool-tool-toggle",
		) as Renderable | undefined;
		expect(toolToggle).toBeDefined();
		if (!toolToggle) throw new Error("tool collapse toggle missing");
		await setup.mockMouse.click(toolToggle.x, toolToggle.y);
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 4, maxFrames: 300 });
		expect(expanded()).toBe(false);
		expect(setup.captureCharFrame()).toContain("▸ details");
		expect(inner.visible).toBe(false);
	});

	test("keeps wrapped transcript diff rows intrinsic and sequential", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "wrapped-diff-rows",
			toolCallId: "wrapped-diff-rows",
			name: "edit",
			args: {},
			output: "Applied edit",
			diff: "@@ -1,4 +1,4 @@\n context marker remains stable\n-this ordinary prose line contains enough words to wrap at this width and keep testing sequential rendering without overlap\n+that ordinary prose line contains enough words to wrap at this width and keep testing sequential rendering without overlap",
			diffPath: "src/example.ts",
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const setup = await mount(
			() => (
				<MessageView
					item={item}
					showThinking
					toolExpanded={false}
					diffExpanded
				/>
			),
			40,
			30,
		);
		const diffPreview = setup.renderer.root.findDescendantById(
			"wrapped-diff-rows-diff-preview",
		) as BoxRenderable | undefined;
		expect(diffPreview).toBeDefined();
		if (!diffPreview) throw new Error("diff preview missing");
		const rows = diffPreview.getChildren() as TextRenderable[];
		expect(rows.length).toBe(4);
		expect(rows.filter((row) => row.height > 1).length).toBeGreaterThanOrEqual(
			2,
		);
		for (const [index, row] of rows.entries()) {
			expect(row.height).toBe(row.virtualLineCount);
			if (index > 0) {
				const previousRow = rows[index - 1];
				if (!previousRow) throw new Error("previous diff row missing");
				expect(row.y).toBeGreaterThanOrEqual(
					previousRow.y + previousRow.height,
				);
			}
		}
	});

	test("keeps diff path and resets explicit diff scroll ownership on collapse", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "scroll-owner-diff",
			toolCallId: "scroll-owner-diff",
			name: "edit",
			args: {},
			output: "Applied edit",
			diff: Array.from(
				{ length: 30 },
				(_, index) => `${index % 2 ? "+" : "-"}DIFF_ROW_${index + 1}`,
			).join("\n"),
			diffPath: "src/example.ts",
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const [diffExpanded, setDiffExpanded] = createSignal(true);
		const setup = await mount(
			() => (
				<MessageView
					item={item}
					showThinking
					toolExpanded={false}
					diffExpanded={diffExpanded}
					onToggleDiff={() => setDiffExpanded((value) => !value)}
				/>
			),
			100,
			30,
		);
		const diffPreview = setup.renderer.root.findDescendantById(
			"scroll-owner-diff-diff-preview",
		) as BoxRenderable | undefined;
		expect(diffPreview).toBeDefined();
		// 100 columns shows the diff side by side: 30 alternating -/+ lines
		// pair into 15 rows, and the preview sizes to those rows.
		expect(diffPreview?.height).toBe(15);
		let frame = setup.captureCharFrame();
		expect(frame).toContain("src/example.ts");
		expect(frame).toContain("scroll diff · collapse");
		const diffScrollToggle = setup.renderer.root.findDescendantById(
			"scroll-owner-diff-diff-scroll-toggle",
		) as Renderable | undefined;
		expect(diffScrollToggle).toBeDefined();
		if (!diffScrollToggle) throw new Error("diff scroll toggle missing");
		await setup.mockMouse.click(diffScrollToggle.x, diffScrollToggle.y);
		await setup.flush();
		const diffInner = setup.renderer.root.findDescendantById(
			"scroll-owner-diff-diff-scroll",
		) as ScrollBoxRenderable | undefined;
		expect(diffInner).toBeDefined();
		if (!diffInner) throw new Error("diff scrollbox missing");
		expect(diffInner.visible).toBe(true);
		frame = setup.captureCharFrame();
		const diffToggle = setup.renderer.root.findDescendantById(
			"scroll-owner-diff-diff-toggle",
		) as Renderable | undefined;
		expect(diffToggle).toBeDefined();
		if (!diffToggle) throw new Error("diff collapse toggle missing");
		await setup.mockMouse.click(diffToggle.x, diffToggle.y);
		await setup.flush();
		expect(diffExpanded()).toBe(false);
		expect(setup.captureCharFrame()).toContain("view diff");
		setDiffExpanded(true);
		await setup.flush();
		expect(diffInner.visible).toBe(false);
		expect(setup.captureCharFrame()).toContain("scroll diff · collapse");

		const diffHeader = setup.renderer.root.findDescendantById(
			"scroll-owner-diff-diff-header",
		) as Renderable | undefined;
		expect(diffHeader).toBeDefined();
		if (!diffHeader) throw new Error("diff header missing");
		await setup.mockMouse.click(diffHeader.x, diffHeader.y);
		await setup.flush();
		expect(diffExpanded()).toBe(false);
		await setup.mockMouse.click(diffHeader.x, diffHeader.y);
		await setup.flush();
		expect(diffExpanded()).toBe(true);
	});

	test("keeps diff actions visible when the path is long", async () => {
		const longPath =
			"/home/jirka/.local/share/pi-work/projects/pitty/intents/a-very-long-workstream-name/src/example.ts";
		const item: ConversationItem = {
			kind: "tool",
			id: "long-diff-path",
			toolCallId: "long-diff-path",
			name: "edit",
			args: {},
			output: "Applied edit",
			diff: "-old\n+new",
			diffPath: longPath,
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const setup = await mount(
			() => (
				<MessageView
					item={item}
					showThinking
					toolExpanded={false}
					diffExpanded
				/>
			),
			80,
			16,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("scroll diff");
		expect(frame).toContain("collapse");
		expect(frame).not.toContain(longPath);
	});

	test("wraps long expanded diff lines instead of clipping them", async () => {
		const longToken =
			"LONG_DIFF_TOKEN_" + "abcdefghijklmnopqrstuvwxyz0123456789_".repeat(4);
		const item: ConversationItem = {
			kind: "tool",
			id: "edit-diff-wrap",
			toolCallId: "edit-diff-wrap",
			name: "edit",
			args: { path: "src/app.ts", edits: [] },
			output: "Applied edit",
			diff: `--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-short\n+${longToken}\n`,
			diffPath: "src/app.ts",
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const width = 48;
		const setup = await mount(
			() => (
				<MessageView
					item={item}
					showThinking
					toolExpanded={false}
					diffExpanded
				/>
			),
			width,
			24,
		);
		const frame = setup.captureCharFrame();
		const lines = frame.split("\n");
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(width);
		expect(frame.replace(/\s+/g, "")).toContain("LONG_DIFF_TOKEN_");
		// Contiguous long tokens must continue on a following row, not vanish past the edge.
		const wrappedRows = lines.filter((line) =>
			/LONG_DIFF_TOKEN_|[a-z0-9_]{12,}/i.test(line),
		);
		expect(wrappedRows.length).toBeGreaterThan(1);
		expect(frame).not.toContain(longToken);
	});
});
