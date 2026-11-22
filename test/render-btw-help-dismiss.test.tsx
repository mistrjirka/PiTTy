import { expect, test } from "bun:test";
import { createSignal } from "solid-js";
import type { TextareaRenderable } from "@opentui/core";
import {
	BTW_WIDGET_KEY,
	TransientWidgetDismissController,
} from "../src/state/extension-widgets.ts";
import { ExtensionWidgetController, type ExtensionWidgetRuntime } from "../src/tabs/extension-widget-controller.ts";
import { AppPromptDock } from "../src/ui/app-prompt-dock.tsx";
import { PromptComposer } from "../src/ui/prompt-composer.tsx";
import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

test("typing after 30 seconds removes /btw help but keeps the draft and other widgets", async () => {
	const runtime: ExtensionWidgetRuntime = { id: "main", extensionWidgets: new Map() };
	const [revision, update] = createSignal(0);
	const notify = () => update((current) => current + 1);
	let now = 1_000;
	const widgets = new ExtensionWidgetController(notify, () => now);
	const dismiss = new TransientWidgetDismissController(notify, () => now);
	let editor: TextareaRenderable | undefined;
	let previousDraft = "";
	const setup = await mount(() => (
		<box width="100%" height="100%" flexDirection="column">
			<box flexGrow={1} minHeight={1}><text>Conversation</text></box>
			<AppPromptDock viewportRows={() => 24} enabled={() => true}
				extensionWidgets={() => { revision(); return [...runtime.extensionWidgets!.values()]; }}
				queuedFollowUps={() => []} steeringQueue={() => []} followUpQueue={() => []}
				editQueuedFollowUp={() => {}} commandSuggestions={() => []}
				commandSuggestionIndex={() => 0} insertSuggestedCommand={() => {}}>
				<PromptComposer streaming={() => false} focused={() => true} placeholder={() => null}
					onEditor={(value) => { editor = value; value.focus(); }}
					onPaste={() => {}} onKeyDown={() => {}} onMouseDown={() => {}}
					onContentChange={() => {
						const text = editor?.plainText ?? "";
						if (text && text !== previousDraft) dismiss.onUserTyped(runtime);
						previousDraft = text;
					}} onCursorChange={() => {}} onSubmit={() => {}} />
			</AppPromptDock>
			<text height={1} minHeight={1}>Footer</text>
		</box>
	), 94, 24);
	try {
		widgets.handle({ type: "extension_ui_request", method: "setWidget", widgetKey: BTW_WIDGET_KEY,
			widgetLines: ["BTW", "/btw <question>  Ask using the current conversation.", "/btw clear  Hide help."] }, runtime);
		widgets.handle({ type: "extension_ui_request", method: "setWidget", widgetKey: "another", widgetLines: ["Other extension output"] }, runtime);
		await setup.flush();
		expect(setup.captureCharFrame()).toContain("Ask using the current conversation");
		now += 30_000;
		await setup.mockInput.typeText("Continue my task");
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(frame).not.toContain("Ask using the current conversation");
		expect(frame).toContain("Other extension output");
		expect(editor?.plainText).toBe("Continue my task");
		expect(editor?.focused).toBe(true);
	} finally {
		setup.renderer.destroy();
	}
});
