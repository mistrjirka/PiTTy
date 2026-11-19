/** Regression coverage for the production prompt dock at real terminal sizes. */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { testRender } from "@opentui/solid";
import type { TextareaRenderable } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { createSignal } from "solid-js";
import { AppPromptDock } from "../src/ui/app-prompt-dock.tsx";
import { PromptComposer } from "../src/ui/prompt-composer.tsx";
import { colors } from "../src/ui/theme.ts";
import type { CommandChoice } from "../src/ui/command-suggestions.tsx";

const active: TestRendererSetup[] = [];
afterEach(async () => {
	for (const setup of active.splice(0)) await setup.dispose();
});
const output = join(import.meta.dir, "../docs/screenshots");
function saveRenderedScreenshot(setup: TestRendererSetup, name: string): void {
	if (process.env.PITTY_CAPTURE_AUTOCOMPLETE !== "1") return;
	const frame = setup.captureSpans();
	const screenshot = {
		cols: frame.cols,
		rows: frame.rows,
		lines: frame.lines.map((line) =>
			line.spans.map((span) => ({
				text: span.text,
				width: span.width,
				fg: span.fg.toInts().slice(0, 3),
				bg: span.bg.toInts().slice(0, 3),
				attributes: span.attributes,
			})),
		),
	};
	mkdirSync(output, { recursive: true });
	writeFileSync(
		join(output, "autocomplete-" + name + ".json"),
		JSON.stringify(screenshot),
	);
}
function lineIndex(frame: string, text: string): number {
	return frame.split("\n").findIndex((line) => line.includes(text));
}
async function mountDock(height: number, initiallyPending = true) {
	const allCommands: CommandChoice[] = Array.from({ length: 24 }, (_, n) => ({
		name: "operation-" + n,
		description: "Description " + n,
	}));
	const [commands, setCommands] = createSignal(allCommands);
	const [selected, setSelected] = createSignal(0);
	let editor: TextareaRenderable | undefined;
	const pending = initiallyPending
		? [{ id: "queue-1", text: "Queued local follow-up" }]
		: [];
	const setup = await testRender(
		() => (
			<box
				height="100%"
				width="100%"
				flexDirection="column"
				backgroundColor={colors.background}
			>
				<box flexShrink={0} height={1} backgroundColor={colors.panelRaised}>
					<text fg={colors.cyan}>PiTTy 0.7.7 | Demo session</text>
				</box>
				<box flexGrow={1} minHeight={1} flexDirection="column">
					<scrollbox
						flexGrow={1}
						minHeight={1}
						stickyScroll
						stickyStart="bottom"
					>
						<text fg={colors.muted}>user: /op</text>
						<text fg={colors.textBright}>
							Assistant: Choose a slash command below.
						</text>
					</scrollbox>
					<box height={1} minHeight={1} flexShrink={0}>
						<text fg={colors.cyan}>↓ Latest message</text>
					</box>
					<AppPromptDock
						viewportRows={() => height}
						enabled={() => true}
						queuedFollowUps={() => pending}
						steeringQueue={() => []}
						followUpQueue={() => []}
						editQueuedFollowUp={() => {}}
						commandSuggestions={commands}
						commandSuggestionIndex={selected}
						insertSuggestedCommand={() => {}}
					>
						<PromptComposer
							streaming={() => false}
							focused={() => true}
							placeholder={() => "PROMPT_ANCHOR"}
							onEditor={(value) => {
								editor = value;
							}}
							onPaste={() => {}}
							onKeyDown={() => {}}
							onMouseDown={() => {}}
							onContentChange={() => {}}
							onCursorChange={() => {}}
							onSubmit={() => {}}
						/>
					</AppPromptDock>
				</box>
				<box height={1} flexShrink={0}>
					<text fg={colors.green}>ready | Ctrl+P models</text>
				</box>
			</box>
		),
		{ width: 80, height, useMouse: true },
	);
	active.push(setup);
	await setup.flush();
	await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
	return { setup, setCommands, setSelected, getEditor: () => editor };
}

describe("autocomplete placement relative to the prompt", () => {
	for (const height of [13, 20, 30]) {
		test(
			"at " + height + " rows, suggestions sit above the visible prompt",
			async () => {
				const { setup, setSelected, setCommands, getEditor } =
					await mountDock(height);
				const frame = setup.captureCharFrame();
				const header = lineIndex(frame, "Commands");
				const first = lineIndex(frame, "/operation-0");
				const prompt = lineIndex(frame, "PROMPT_ANCHOR");
				const footer = lineIndex(frame, "Ctrl+P models");
				expect(first).toBeGreaterThan(header);
				expect(prompt).toBeGreaterThan(first);
				expect(footer).toBeGreaterThan(prompt);
				expect(prompt).toBeLessThan(height);
				expect(frame).not.toContain("Pending input");
				expect(getEditor()).toBeDefined();
				if (height >= 20) expect(frame).toContain("/operation-5");
				saveRenderedScreenshot(setup, String(height));

				setSelected(18);
				await setup.flush();
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
				await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
				const scrolled = setup.captureCharFrame();
				expect(scrolled).toContain("/operation-18");
				expect(lineIndex(scrolled, "PROMPT_ANCHOR")).toBeGreaterThan(
					lineIndex(scrolled, "/operation-18"),
				);
				if (height === 30) saveRenderedScreenshot(setup, "30-scrolled");

				// When slash suggestions disappear, restore the pending queue without
				// removing or moving the main prompt outside the visible terminal.
				setCommands([]);
				await setup.flush();
				await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
				const pending = setup.captureCharFrame();
				expect(pending).toContain("Pending input");
				expect(lineIndex(pending, "PROMPT_ANCHOR")).toBeGreaterThan(
					lineIndex(pending, "Pending input"),
				);
				expect(lineIndex(pending, "Ctrl+P models")).toBeGreaterThan(
					lineIndex(pending, "PROMPT_ANCHOR"),
				);
				if (height === 20) saveRenderedScreenshot(setup, "20-pending");
			},
		);
	}
});
