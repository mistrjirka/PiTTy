import { afterEach, describe, expect, test } from "bun:test";
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { ExtensionTextWidget } from "../src/state/extension-widgets.ts";
import { AppPromptDock } from "../src/ui/app-prompt-dock.tsx";
import { PromptComposer } from "../src/ui/prompt-composer.tsx";
import type { CommandChoice } from "../src/ui/command-suggestions.tsx";

const active: TestRendererSetup[] = [];
afterEach(() => { for (const setup of active.splice(0)) setup.renderer.destroy(); });
const widget = (key: string, lines: string[], placement: ExtensionTextWidget["placement"] = "aboveEditor"):
	ExtensionTextWidget => ({ key, lines, placement });

async function mount(initial: ExtensionTextWidget[], width = 90, height = 24) {
	const [widgets, setWidgets] = createSignal(initial);
	const [scope, setScope] = createSignal("session-a");
	const [rows, setRows] = createSignal(height);
	const [commands, setCommands] = createSignal<CommandChoice[]>([]);
	let editor: TextareaRenderable | undefined;
	const setup = await testRender(() => (
		<box width="100%" height="100%" flexDirection="column">
			<box flexGrow={1} minHeight={1}><text>Conversation stays visible</text></box>
			<AppPromptDock viewportRows={rows} enabled={() => true}
				extensionWidgets={widgets} extensionWidgetScope={scope}
				queuedFollowUps={() => []} steeringQueue={() => []} followUpQueue={() => []}
				editQueuedFollowUp={() => {}} commandSuggestions={commands}
				commandSuggestionIndex={() => 0} insertSuggestedCommand={() => {}}>
				<PromptComposer streaming={() => true} focused={() => true} placeholder={() => null}
					onEditor={(value) => { editor = value; value.setText("KEEP THIS DRAFT"); }}
					onPaste={() => {}} onKeyDown={() => {}} onMouseDown={() => {}}
					onContentChange={() => {}} onCursorChange={() => {}} onSubmit={() => {}} />
			</AppPromptDock>
			<text height={1} minHeight={1} flexShrink={0}>Footer stays visible</text>
		</box>
	), { width, height, useMouse: true, enableMouseMovement: true });
	active.push(setup);
	const flush = async () => {
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
	};
	await flush();
	return { setup, flush, setWidgets, setScope, setRows, setCommands, editor: () => editor! };
}

describe("extension widget rendering", () => {
	test("renders both placements with actual color and literal text", async () => {
		const ui = await mount([
			widget("build", ["\x1b[38;2;22;211;238mBuild complete\x1b[0m", "**literal text**"]),
			widget("branch", ["Branch: example"], "belowEditor"),
		]);
		const frame = ui.setup.captureCharFrame();
		expect(frame.indexOf("Build complete")).toBeLessThan(frame.indexOf("KEEP THIS DRAFT"));
		expect(frame.indexOf("Branch: example")).toBeGreaterThan(frame.indexOf("KEEP THIS DRAFT"));
		expect(frame).toContain("**literal text**");
		expect(frame).not.toContain("[object Object]");
		const span = ui.setup.captureSpans().lines.flatMap((line) => line.spans)
			.find((item) => item.text.includes("Build complete"));
		expect(span?.fg.toInts().slice(0, 3)).toEqual([22, 211, 238]);
		expect(ui.editor().focused).toBe(true);
	});
	test("updates and clears output without changing the focused draft", async () => {
		const ui = await mount([widget("build", ["Old output"]), widget("other", ["Other extension"])]);
		ui.setWidgets([widget("build", ["Updated output"]), widget("other", ["Other extension"])]);
		await ui.flush();
		expect(ui.setup.captureCharFrame()).toContain("Updated output");
		expect(ui.setup.captureCharFrame()).not.toContain("Old output");
		ui.setWidgets([]);
		await ui.flush();
		expect(ui.setup.captureCharFrame()).not.toContain("Updated output");
		expect(ui.setup.captureCharFrame()).not.toContain("Other extension");
		expect(ui.setup.renderer.root.findDescendantById("extension-widgets-above")).toBeUndefined();
		expect(ui.editor().plainText).toBe("KEEP THIS DRAFT");
		expect(ui.editor().focused).toBe(true);
	});
	test("scrolls long output without hiding the editor or losing its focus", async () => {
		const ui = await mount([widget("long", Array.from({ length: 80 }, (_, index) => `Output line ${index + 1}`))]);
		const scroll = ui.setup.renderer.root.findDescendantById("extension-widgets-above") as ScrollBoxRenderable;
		expect(scroll.scrollHeight).toBeGreaterThan(scroll.height);
		expect(scroll.height).toBeLessThanOrEqual(10);
		await ui.setup.mockMouse.scroll(scroll.x + 3, scroll.y + 1, "down");
		await ui.flush();
		expect(scroll.scrollTop).toBeGreaterThan(0);
		expect(ui.editor().focused).toBe(true);
		scroll.scrollTo(Infinity);
		await ui.flush();
		expect(ui.setup.captureCharFrame()).toContain("Output line 80");
		expect(ui.setup.captureCharFrame()).toContain("KEEP THIS DRAFT");
		expect(ui.setup.captureCharFrame()).toContain("Footer stays visible");
	});
	test("wraps narrow text and keeps suggestions and the editor usable", async () => {
		const ui = await mount([
			widget("long", ["A long extension line wraps across this narrow terminal without covering the editor."]),
			widget("status", ["Still working"], "belowEditor"),
		], 48, 18);
		ui.setCommands(Array.from({ length: 9 }, (_, index) => ({ name: `example${index}` })));
		await ui.flush();
		const frame = ui.setup.captureCharFrame();
		expect(frame).toContain("A long extension line");
		expect(frame).toContain("Commands");
		expect(frame).toContain("KEEP THIS DRAFT");
		expect(frame).toContain("Footer stays visible");
		expect(ui.editor().y + ui.editor().height).toBeLessThan(18);
		expect(ui.editor().focused).toBe(true);
	});
	test("session changes reset widget scroll without carrying old text", async () => {
		const ui = await mount([widget("same-key", Array.from({ length: 60 }, (_, index) => `Old session ${index}`))]);
		const scroll = ui.setup.renderer.root.findDescendantById("extension-widgets-above") as ScrollBoxRenderable;
		scroll.scrollTo(Infinity);
		await ui.flush();
		ui.setScope("session-b");
		ui.setWidgets([widget("same-key", ["New session widget"])]);
		await ui.flush();
		expect(ui.setup.captureCharFrame()).toContain("New session widget");
		expect(ui.setup.captureCharFrame()).not.toContain("Old session");
		expect(ui.editor().plainText).toBe("KEEP THIS DRAFT");
	});
	test("shrinks a long widget replaced by one line and remeasures wrapped text after resize", async () => {
		const ui = await mount([widget("same", Array.from({ length: 40 }, (_, index) => `Line ${index}`))]);
		const region = () => ui.setup.renderer.root.findDescendantById("extension-widgets-above") as ScrollBoxRenderable;
		expect(region().height).toBeGreaterThan(1);
		ui.setWidgets([widget("same", ["Short update"])]);
		await ui.flush();
		expect(region().height).toBe(1);
		expect(ui.setup.captureCharFrame()).toContain("Short update");
		ui.setWidgets([widget("same", ["A longer line must wrap when the terminal becomes narrower, without leaving a fixed-height empty panel."])]);
		await ui.flush();
		const wideHeight = region().height;
		ui.setup.resize(48, 24);
		await ui.flush();
		expect(region().height).toBeGreaterThan(wideHeight);
		expect(ui.setup.captureCharFrame()).toContain("empty panel.");
		expect(ui.editor().plainText).toBe("KEEP THIS DRAFT");
	});

	test("empty widgets reserve no rows", async () => {
		const ui = await mount([widget("empty", [])]);
		expect(ui.setup.renderer.root.findDescendantById("extension-widgets-above")).toBeUndefined();
		expect(ui.setup.captureCharFrame()).toContain("KEEP THIS DRAFT");
	});
});
