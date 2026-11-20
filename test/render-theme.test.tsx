import { describe, expect, test } from "bun:test";
import { type BoxRenderable, type MarkdownRenderable } from "@opentui/core";
import { createDynamic } from "@opentui/solid";
import { createSignal } from "solid-js";
import { MessageView } from "../src/ui/message.tsx";
import type { ConversationItem } from "../src/types.ts";
import { colors, createThemeController, effectiveTheme } from "../src/ui/theme.ts";

import { mount } from "./render-helpers/mount.tsx";

describe("runtime theme transitions", () => {
	test("updates same-mounted surfaces and Markdown styles once per effective palette change", async () => {
		const controller = createThemeController();
		controller.apply(effectiveTheme("PiTTy Midnight"));
		const initial: ConversationItem = {
			kind: "assistant",
			id: "theme-transition",
			text: "Initial answer",
			thinking: "Initial thought",
			timestamp: 1,
			status: "done",
		};
		const [item, setItem] = createSignal<ConversationItem>(initial);
		let surface: BoxRenderable | undefined;
		const ThemeProbe = () => {
			const Contents = () => (
				<box
					id="theme-transition-surface"
					ref={(value) => {
						surface = value;
					}}
					backgroundColor={colors.background}
				>
					<MessageView
						item={item}
						showThinking
						thinkingExpanded
						toolExpanded={false}
					/>
					<MessageView
						item={{
							kind: "tool",
							id: "theme-tool",
							toolCallId: "theme-call",
							name: "bash",
							args: {},
							output: "done",
							timestamp: 1,
							status: "done",
							isError: false,
						}}
						showThinking={false}
						toolExpanded={false}
					/>
				</box>
			);
			const EvenTheme = () => <Contents />;
			const OddTheme = () => <Contents />;
			return createDynamic(
				() => (controller.revision() % 2 === 0 ? EvenTheme : OddTheme),
				{},
			);
		};
		const setup = await mount(() => <ThemeProbe />, 90, 24);
		const initialAnswer = setup.renderer.root.findDescendantById(
			"theme-transition-answer-markdown",
		) as MarkdownRenderable | undefined;
		const initialThinking = setup.renderer.root.findDescendantById(
			"theme-transition-thinking-markdown",
		) as MarkdownRenderable | undefined;
		if (!initialAnswer || !initialThinking || !surface)
			throw new Error("theme transition fixture missing native renderables");
		const initialAnswerStyle = initialAnswer.syntaxStyle;
		const initialThinkingStyle = initialThinking.syntaxStyle;

		try {
			controller.apply(effectiveTheme("Solarized Light"));
			await setup.flush();
			const lightSurface = setup.renderer.root.findDescendantById(
				"theme-transition-surface",
			) as BoxRenderable | undefined;
			const lightTool = setup.renderer.root.findDescendantById("theme-tool") as
				| BoxRenderable
				| undefined;
			const lightAnswer = setup.renderer.root.findDescendantById(
				"theme-transition-answer-markdown",
			) as MarkdownRenderable | undefined;
			const lightThinking = setup.renderer.root.findDescendantById(
				"theme-transition-thinking-markdown",
			) as MarkdownRenderable | undefined;
			if (!lightAnswer || !lightThinking || !lightSurface || !lightTool)
				throw new Error("light theme fixture missing native renderables");
			expect(lightSurface.backgroundColor.toInts().slice(0, 3)).toEqual([
				253, 246, 227,
			]);
			// Tool rows paint no background of their own; they show the
			// themed surface beneath them.
			expect(lightTool.backgroundColor.toInts()[3]).toBe(0);
			expect(lightAnswer.syntaxStyle).toBe(controller.markdownStyle);
			expect(lightThinking.syntaxStyle).toBe(controller.thinkingMarkdownStyle);
			expect(lightAnswer.syntaxStyle).not.toBe(initialAnswerStyle);
			expect(lightThinking.syntaxStyle).not.toBe(initialThinkingStyle);

			const lightAnswerStyle = lightAnswer.syntaxStyle;
			const lightThinkingStyle = lightThinking.syntaxStyle;
			controller.apply(effectiveTheme("Solarized Light"));
			setItem({
				...initial,
				text: "Updated answer",
				thinking: "Updated thought",
			});
			await setup.flush();
			expect(
				setup.renderer.root.findDescendantById(
					"theme-transition-answer-markdown",
				),
			).toBe(lightAnswer);
			expect(lightAnswer.syntaxStyle).toBe(lightAnswerStyle);
			expect(lightThinking.syntaxStyle).toBe(lightThinkingStyle);
			expect(setup.captureCharFrame()).toContain("Updated answer");
		} finally {
			controller.apply(effectiveTheme("PiTTy Midnight"));
		}
	});
});
