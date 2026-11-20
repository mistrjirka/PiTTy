import { afterEach, describe, expect, test } from "bun:test";
import type { TextareaRenderable } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { DiagnosticLogger } from "../src/diagnostics/logger.ts";
import { createInputActions } from "../src/tabs/input-actions.ts";
import { createTabRuntime } from "../src/tabs/runtime.ts";
import { AppPromptDock } from "../src/ui/app-prompt-dock.tsx";
import { PromptComposer } from "../src/ui/prompt-composer.tsx";

const active: TestRendererSetup[] = [];
afterEach(() => { for (const setup of active.splice(0)) setup.renderer.destroy(); });

describe("pending message controls", () => {
	test.each([false, true])("Alt+Enter leaves the draft unchanged with Kitty keyboard=%s", async (kittyKeyboard) => {
		let editor: TextareaRenderable | undefined;
		const submitted: string[] = [];
		const setup = await testRender(() => (
			<PromptComposer streaming={() => true} focused={() => true} placeholder={() => null}
				onEditor={(value) => { editor = value; }} onPaste={() => {}}
				onKeyDown={() => {}} onMouseDown={() => {}} onContentChange={() => {}}
				onCursorChange={() => {}} onSubmit={() => { submitted.push(editor!.plainText); }} />
		), { width: 80, height: 12, kittyKeyboard });
		active.push(setup);
		await setup.flush();
		await setup.mockInput.typeText("keep this draft");

		setup.mockInput.pressEnter({ meta: true });
		await setup.flush();
		expect(submitted).toEqual([]);
		expect(editor?.plainText).toBe("keep this draft");

		// Legacy terminals send a bare linefeed for Shift+Enter.
		if (kittyKeyboard) setup.mockInput.pressEnter({ shift: true });
		else setup.mockInput.pressKey("\n");
		await setup.flush();
		expect(submitted).toEqual([]);
		expect(editor?.plainText).toBe("keep this draft\n");

		await setup.mockInput.typeText("second line");
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(submitted).toEqual(["keep this draft\nsecond line"]);
	});

	test("clicks edit, cancel edit, combine, cancel and saves through the live composer", async () => {
		const [revision, setRevision] = createSignal(0);
		const touch = () => setRevision((value) => value + 1);
		const runtime = createTabRuntime({ id: "ui-test", cwd: process.cwd(), onConversationChange: touch });
		runtime.startupResolved = true;
		runtime.conversation.isStreaming = true;
		runtime.conversation.applyQueueState({ revision: 1, messages: [
			{ id: "one", mode: "steer", message: "first pending" },
			{ id: "two", mode: "steer", message: "second pending" },
			{ id: "three", mode: "followUp", message: "later pending" },
		] });
		runtime.client.updateQueuedMessage = async (id, message) => ({
			revision: runtime.conversation.queue!.revision + 1,
			messages: runtime.conversation.queue!.messages.map((item) => item.id === id ? { ...item, message } : item),
		});
		runtime.client.removeQueuedMessage = async (id) => ({
			revision: runtime.conversation.queue!.revision + 1,
			messages: runtime.conversation.queue!.messages.filter((item) => item.id !== id),
		});
		runtime.client.combineQueuedMessages = async (ids) => ({
			revision: runtime.conversation.queue!.revision + 1,
			messages: runtime.conversation.queue!.messages.filter((item) => item.id !== ids[1]).map((item) =>
				item.id === ids[0] ? { ...item, message: runtime.conversation.queue!.messages.filter((entry) => ids.includes(entry.id)).map((entry) => entry.message).join("\n\n") } : item),
		});
		let editor: TextareaRenderable | undefined;
		let draft = "existing draft";
		const sync = (text: string) => { draft = text; editor?.setText(text); };
		const actions = createInputActions({
			logger: new DiagnosticLogger({ enabled: false }),
			tabRuntimeIsActive: () => true, trimMessageWindowIfFollowingLatest() {},
			conversationTouch: touch, scrollToBottom() {},
			clearRuntimeMainDraftIfMatches(_runtime, text) { if (draft === text) sync(""); },
			toast() {}, activeRuntime: () => runtime, startupPhase: () => ({ kind: "ready" }),
			dialog: () => undefined, expandedPromptText: () => editor?.plainText ?? draft,
			handleSlashCommand: async () => false, clearMainDraft: () => sync(""),
			syncMainDraft: sync, syncRuntimeMainDraft: (_runtime, text) => sync(text),
			touch, getPrompt: () => editor,
			queuedFollowUps: () => { revision(); return runtime.queuedFollowUps; }, queueRevision: revision,
		});
		const setup = await testRender(() => (
			<box width="100%" height="100%" flexDirection="column">
				<box flexGrow={1} minHeight={1}><text>Conversation</text></box>
				<AppPromptDock viewportRows={() => 18} enabled={() => true}
					queuedFollowUps={() => []} steeringQueue={() => []} followUpQueue={() => []}
					editQueuedFollowUp={actions.editQueuedFollowUp} pendingInput={actions.queuedInput}
					commandSuggestions={() => []} commandSuggestionIndex={() => 0} insertSuggestedCommand={() => {}}>
					<PromptComposer streaming={() => true} focused={() => true} placeholder={() => null}
						onEditor={(value) => { editor = value; value.setText(draft); }} onPaste={() => {}}
						onKeyDown={() => {}} onMouseDown={() => {}} onContentChange={() => { draft = editor?.plainText ?? draft; }}
						onCursorChange={() => {}} onSubmit={() => { void actions.submit(); }} />
				</AppPromptDock>
			</box>
		), { width: 100, height: 18, useMouse: true, enableMouseMovement: true });
		active.push(setup);
		const flush = async () => { await setup.flush(); await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 }); };
		await flush();
		const firstFrame = setup.captureCharFrame();
		expect(firstFrame).toContain("Pending input");
		expect(firstFrame).toContain("[Edit]");
		expect(firstFrame).toContain("[Cancel]");
		expect(firstFrame).toContain("[Combine next]");
		expect(firstFrame).toContain("existing draft");
		const click = async (id: string) => {
			const control = setup.renderer.root.findDescendantById(id);
			expect(control).toBeDefined();
			await setup.mockMouse.click(control!.x + 2, control!.y);
			await flush();
		};
		await click("pending-edit-one");
		expect(editor?.plainText).toBe("first pending");
		expect(setup.captureCharFrame()).toContain("Enter saves");
		expect(setup.captureCharFrame()).toContain("[Cancel edit]");
		await click("pending-cancel-edit");
		expect(editor?.plainText).toBe("existing draft");
		await click("pending-combine-one");
		expect(runtime.conversation.queue?.messages[0]?.message).toBe("first pending\n\nsecond pending");
		expect(runtime.conversation.queue?.messages).toHaveLength(2);
		expect(setup.renderer.root.findDescendantById("pending-combine-one")).toBeUndefined();
		await click("pending-edit-one");
		editor?.clear();
		await setup.mockInput.typeText("updated through composer");
		setup.mockInput.pressEnter({ meta: true });
		await flush();
		expect(runtime.conversation.queue?.messages[0]?.message).toBe("first pending\n\nsecond pending");
		expect(editor?.plainText).toBe("updated through composer");
		setup.mockInput.pressEnter();
		await flush();
		expect(runtime.conversation.queue?.messages[0]?.message).toBe("updated through composer");
		expect(editor?.plainText).toBe("existing draft");
		await click("pending-cancel-one");
		expect(runtime.conversation.queue?.messages.map((item) => item.id)).toEqual(["three"]);
		expect(setup.captureCharFrame()).toContain("later pending");
		expect(setup.captureCharFrame()).not.toContain("updated through composer");
	});
});
