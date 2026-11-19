import { describe, expect, test } from "bun:test";
import { DiagnosticLogger } from "../src/diagnostics/logger.ts";
import {
	createInputActions,
	type InputActionsPorts,
} from "../src/tabs/input-actions.ts";
import { createTabRuntime } from "../src/tabs/runtime.ts";

describe("extracted app input actions", () => {
	test("executes a slash command without sending it to Pi, then restores an editable follow-up", async () => {
		const runtime = createTabRuntime({ id: "active", cwd: process.cwd() });
		runtime.startupResolved = true;
		let text = "/help";
		let cleared = 0;
		let lastRestored = "";
		const handled: string[] = [];
		const ports: InputActionsPorts = {
			logger: new DiagnosticLogger({ enabled: false }),
			tabRuntimeIsActive: (id) => id === runtime.id,
			trimMessageWindowIfFollowingLatest: () => {},
			conversationTouch: () => {},
			scrollToBottom: () => {},
			clearRuntimeMainDraftIfMatches: (_runtime, value) => {
				if (value === text) cleared++;
			},
			toast: () => {},
			activeRuntime: () => runtime,
			startupPhase: () => ({ kind: "ready" }),
			dialog: () => undefined,
			expandedPromptText: () => text,
			handleSlashCommand: async (value) => {
				handled.push(value);
				return true;
			},
			clearMainDraft: () => {
				text = "";
			},
			syncMainDraft: (value) => {
				lastRestored = value;
			},
			touch: () => {},
			syncRuntimeMainDraft: () => {},
			getPrompt: () => undefined,
			queuedFollowUps: () => runtime.queuedFollowUps,
		};
		const actions = createInputActions(ports);
		await actions.submit();
		expect(handled).toEqual(["/help"]);
		expect(cleared).toBe(1);
		expect(runtime.submitInFlight).toBe(false);
		expect(runtime.conversation.items).toHaveLength(0);

		runtime.conversation.isStreaming = true;
		text = "Make this safer";
		actions.queueFollowUp();
		expect(runtime.queuedFollowUps).toHaveLength(1);
		expect(runtime.queuedFollowUps[0]?.text).toBe("Make this safer");
		actions.restoreQueuedFollowUp();
		expect(runtime.queuedFollowUps).toHaveLength(1);
		expect(runtime.pendingInputEdit?.id).toBe(runtime.queuedFollowUps[0]?.id);
		expect(lastRestored).toBe("Make this safer");
		actions.queuedInput.cancelEdit();
		expect(runtime.pendingInputEdit).toBeUndefined();
	});

	test("rejects submit before startup is ready without clearing the draft", async () => {
		const runtime = createTabRuntime({ id: "active", cwd: process.cwd() });
		let cleared = false;
		const notices: string[] = [];
		const ports: InputActionsPorts = {
			logger: new DiagnosticLogger({ enabled: false }),
			tabRuntimeIsActive: () => true,
			trimMessageWindowIfFollowingLatest: () => {},
			conversationTouch: () => {},
			scrollToBottom: () => {},
			clearRuntimeMainDraftIfMatches: () => {
				cleared = true;
			},
			toast: (message) => {
				notices.push(message);
			},
			activeRuntime: () => runtime,
			startupPhase: () => ({ kind: "starting" }),
			dialog: () => undefined,
			expandedPromptText: () => "Hello",
			handleSlashCommand: async () => true,
			clearMainDraft: () => {},
			syncMainDraft: () => {},
			touch: () => {},
			syncRuntimeMainDraft: () => {},
			getPrompt: () => undefined,
			queuedFollowUps: () => [],
		};
		await createInputActions(ports).submit();
		expect(cleared).toBe(false);
		expect(notices[0]).toContain("still starting");
		expect(runtime.submitInFlight).toBe(false);
	});
});
