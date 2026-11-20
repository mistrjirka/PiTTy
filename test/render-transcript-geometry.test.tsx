import { describe, expect, test } from "bun:test";
import { type MarkdownRenderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { MessageView } from "../src/ui/message.tsx";
import type { ConversationItem } from "../src/types.ts";

import { mount } from "./render-helpers/mount.tsx";

describe("OpenTUI components", () => {
	test("keeps assistant wrapper geometry aligned across approved content states", async () => {
		const states: Array<{
			item: ConversationItem;
			content: string;
			expanded: boolean;
		}> = [
			{
				item: {
					kind: "assistant",
					id: "single-thinking",
					text: "",
					thinking: "SINGLE_THINKING",
					timestamp: 1,
					status: "done",
				},
				content: "SINGLE_THINKING",
				expanded: true,
			},
			{
				item: {
					kind: "assistant",
					id: "multi-thinking",
					text: "",
					thinking: "MULTI_THINKING_A\nMULTI_THINKING_B",
					timestamp: 1,
					status: "done",
				},
				content: "MULTI_THINKING_A",
				expanded: true,
			},
			{
				item: {
					kind: "assistant",
					id: "both",
					text: "BOTH_ANSWER",
					thinking: "BOTH_THINKING",
					timestamp: 1,
					status: "done",
				},
				content: "BOTH_THINKING",
				expanded: true,
			},
			{
				item: {
					kind: "assistant",
					id: "answer-only",
					text: "ANSWER_ONLY",
					thinking: "",
					timestamp: 1,
					status: "done",
				},
				content: "ANSWER_ONLY",
				expanded: true,
			},
			{
				item: {
					kind: "assistant",
					id: "collapsed",
					text: "COLLAPSED_ANSWER",
					thinking: "COLLAPSED_THINKING",
					timestamp: 1,
					status: "done",
				},
				// A finished, collapsed thought shows only its heading.
				content: "∴ Thought",
				expanded: false,
			},
		];
		const geometries: Array<{ x: number; right: number; width: number }> = [];
		for (const { item, content, expanded } of states) {
			const setup = await mount(
				() => (
					<MessageView
						item={item}
						showThinking
						thinkingExpanded={expanded}
						toolExpanded={false}
					/>
				),
				80,
				20,
			);
			const wrapper = setup.renderer.root.findDescendantById(item.id);
			const thinking = setup.renderer.root.findDescendantById(
				`${item.id}-thinking`,
			);
			const answer = setup.renderer.root.findDescendantById(
				`${item.id}-answer`,
			);
			const hasThinking =
				item.kind === "assistant" && Boolean(item.thinking.trim());
			const hasAnswer = item.kind === "assistant" && Boolean(item.text.trim());
			const section = hasThinking ? thinking : answer;
			if (!wrapper || !section)
				throw new Error("assistant geometry fixture missing");
			const geometry = {
				x: section.screenX,
				right: section.screenX + section.width,
				width: section.width,
			};
			geometries.push(geometry);
			expect(geometry.right).toBe(wrapper.screenX + wrapper.width);
			const contentLine = setup
				.captureCharFrame()
				.split("\n")
				.find((line) => line.includes(content));
			// One padding cell; the assistant left border is gone.
			expect(contentLine?.indexOf(content)).toBe(1);
			if (hasThinking && hasAnswer && answer) {
				expect({
					x: answer.screenX,
					right: answer.screenX + answer.width,
					width: answer.width,
				}).toEqual(geometry);
				const answerText = item.kind === "assistant" ? item.text : "";
				const answerLine = setup
					.captureCharFrame()
					.split("\n")
					.find((line) => line.includes(answerText));
				expect(answerLine?.indexOf(answerText)).toBe(1);
			}
		}
		const baseline = geometries[0];
		if (!baseline) throw new Error("assistant geometry baseline missing");
		for (const geometry of geometries.slice(1))
			expect(geometry).toEqual(baseline);

		const [streaming, setStreaming] = createSignal<ConversationItem>({
			kind: "assistant",
			id: "stream-transition",
			text: "STREAMED_PARTIAL",
			thinking: "",
			timestamp: 1,
			status: "streaming",
		});
		const transition = await mount(
			() => (
				<MessageView
					item={() => streaming()}
					showThinking
					thinkingExpanded
					toolExpanded={false}
				/>
			),
			80,
			20,
		);
		const answer = transition.renderer.root.findDescendantById(
			"stream-transition-answer",
		);
		if (!answer) throw new Error("streaming answer wrapper missing");
		const initial = { x: answer.screenX, width: answer.width };
		setStreaming({
			kind: "assistant",
			id: "stream-transition",
			text: "FINAL_MARKDOWN",
			thinking: "",
			timestamp: 1,
			status: "done",
		});
		await transition.flush();
		await transition.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		const finalAnswer = transition.renderer.root.findDescendantById(
			"stream-transition-answer",
		);
		if (!finalAnswer) throw new Error("final answer wrapper missing");
		const finalMarkdown = transition.renderer.root.findDescendantById(
			"stream-transition-answer-markdown",
		) as MarkdownRenderable | undefined;
		expect(finalMarkdown?.streaming).toBe(false);
		expect({ x: finalAnswer.screenX, width: finalAnswer.width }).toEqual(
			initial,
		);
		expect(transition.captureCharFrame()).toContain("FINAL_MARKDOWN");
		expect(transition.captureCharFrame()).not.toContain("STREAMED_PARTIAL");
		transition.resize(40, 12);
		await transition.flush();
		transition.resize(80, 20);
		await transition.flush();
		const restored = transition.renderer.root.findDescendantById(
			"stream-transition-answer",
		);
		if (!restored) throw new Error("restored answer wrapper missing");
		expect({ x: restored.screenX, width: restored.width }).toEqual(initial);
		expect(transition.captureCharFrame()).not.toContain("STREAMED_PARTIAL");
	});

	test("preserves stable thinking and answer wrapper identities", async () => {
		const item: ConversationItem = {
			kind: "assistant",
			id: "wrapper-test",
			text: "answer",
			thinking: "thought",
			timestamp: 1,
			status: "done",
		};
		const setup = await mount(() => (
			<MessageView
				item={item}
				showThinking
				thinkingExpanded
				toolExpanded={false}
			/>
		));
		expect(
			setup.renderer.root.findDescendantById("wrapper-test-thinking"),
		).toBeDefined();
		expect(
			setup.renderer.root.findDescendantById("wrapper-test-answer"),
		).toBeDefined();
	});
});
