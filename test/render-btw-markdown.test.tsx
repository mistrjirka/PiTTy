import { expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { BTW_WIDGET_KEY, type ExtensionTextWidget } from "../src/state/extension-widgets.ts";
import { ExtensionWidgetArea } from "../src/ui/extension-widget-area.tsx";
import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

const btwWidget = (body: string): ExtensionTextWidget => ({
	key: BTW_WIDGET_KEY,
	placement: "aboveEditor",
	lines: ["BTW · Answer", "> Where are we?", "", ...body.split("\n")],
});

test("BTW answer renders Markdown while other extension text stays literal", async () => {
	const [widgets, setWidgets] = createSignal<ExtensionTextWidget[]>([
		btwWidget("## Summary\n**Readable** answer\n- First item"),
		{ key: "other-extension", placement: "aboveEditor", lines: ["**literal** marker"] },
	]);
	const setup = await mount(() => (
		<box width="100%" height="100%" flexDirection="column">
			<ExtensionWidgetArea widgets={widgets()} maxRows={18} />
		</box>
	), 100, 30);
	try {
		await setup.flush();
		const first = setup.captureCharFrame();
		expect(first).toContain("Readable");
		expect(first).not.toContain("**Readable**");
		expect(first).toContain("Summary");
		expect(first).toContain("**literal** marker");

		setWidgets([btwWidget("Updated **formatted** text"), { key: "other-extension",
			placement: "aboveEditor", lines: ["**literal** marker"] }]);
		await setup.flush();
		const updated = setup.captureCharFrame();
		expect(updated).toContain("Updated formatted text");
		expect(updated).not.toContain("**formatted**");
		expect(updated).not.toContain("Readable");
	} finally {
		setup.renderer.destroy();
	}
});

test("BTW help stays literal, including angle brackets in commands", async () => {
	const widgets: ExtensionTextWidget[] = [{
		key: BTW_WIDGET_KEY, placement: "aboveEditor",
		lines: ["BTW", "/btw <question>  Ask using the current conversation."],
	}];
	const setup = await mount(() => (
		<box width="100%" height="100%" flexDirection="column">
			<ExtensionWidgetArea widgets={widgets} maxRows={10} />
		</box>
	), 100, 24);
	try {
		await setup.flush();
		expect(setup.captureCharFrame()).toContain("/btw <question>");
	} finally {
		setup.renderer.destroy();
	}
});
