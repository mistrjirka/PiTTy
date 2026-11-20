import { describe, expect, test } from "bun:test";
import { type TextareaRenderable } from "@opentui/core";
import { Show, createSignal } from "solid-js";
import { ModelSelectorDialog } from "../src/ui/model-selector.tsx";
import { REQUEST_TIMING_VERSION } from "../src/tabs/request-timing.ts";
import { SessionSelector } from "../src/ui/session-selector.tsx";
import type { SessionChoice, SessionDiscoveryState } from "../src/sessions.ts";

import { mount } from "./render-helpers/mount.tsx";

describe("OpenTUI components", () => {
	test("renders every session picker state and selects the first search result", async () => {
		const choice: SessionChoice = {
			path: "/tmp/target.jsonl",
			id: "target",
			name: "Target session",
			modified: new Date("2024-01-01T00:00:00Z"),
			messageCount: 3,
			firstMessage: "Find the target",
		};
		const renderState = async (
			state: SessionDiscoveryState,
			switching = false,
		) => {
			const setup = await mount(() => (
				<SessionSelector
					state={state}
					switching={switching}
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			));
			return setup.captureCharFrame();
		};

		expect(await renderState({ kind: "loading" })).toContain(
			"Loading sessions…",
		);
		expect(
			await renderState({ kind: "loading", progress: { loaded: 1, total: 2 } }),
		).toContain("Loading sessions… 1/2");
		expect(await renderState({ kind: "empty", choices: [] })).toContain(
			"No resumable sessions in this directory.",
		);
		expect(
			await renderState({ kind: "error", error: "permission denied" }),
		).toContain("Unable to discover sessions: permission denied");
		expect(await renderState({ kind: "success", choices: [choice] })).toContain(
			"Target session",
		);

		let selected: SessionChoice | undefined;
		const setup = await mount(() => (
			<SessionSelector
				state={{ kind: "success", choices: [choice] }}
				onSelect={(value) => {
					selected = value;
				}}
				onCancel={() => {}}
			/>
		));
		await setup.mockInput.typeText("target");
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(selected).toEqual(choice);
	});

	test("model and session selectors accept immediate keyboard search, navigation, selection, and cancel", async () => {
		const models = [
			{ provider: "openai", id: "alpha", name: "Alpha" },
			{ provider: "anthropic", id: "beta", name: "Beta" },
		];
		let selectedModel: string | undefined;
		const modelSetup = await mount(() => (
			<ModelSelectorDialog
				models={models}
				timingHistory={[
					{
						timingVersion: REQUEST_TIMING_VERSION,
						provider: "openai",
						modelId: "alpha",
						turnMs: 7_000,
						toolCallDurationsMs: [100, 100, 100],
						toolCallCount: 3,
					},
					{
						timingVersion: REQUEST_TIMING_VERSION,
						provider: "anthropic",
						modelId: "beta",
						turnMs: 2_000,
						toolCallDurationsMs: [900],
						toolCallCount: 1,
					},
				]}
				onSelect={(model) => {
					selectedModel = model.id;
				}}
				onCancel={() => {}}
			/>
		));
		await modelSetup.mockInput.typeText("beta");
		await modelSetup.flush();
		expect(modelSetup.captureCharFrame()).toContain("anthropic/beta");
		expect(modelSetup.captureCharFrame()).not.toContain("Tool 900ms");
		modelSetup.mockInput.pressArrow("down");
		await modelSetup.flush();
		modelSetup.mockInput.pressEnter();
		await modelSetup.flush();
		expect(selectedModel).toBe("beta");

		let selected = 0;
		const choice: SessionChoice = {
			path: "/tmp/session",
			id: "session",
			name: "Planning",
			modified: new Date(),
			messageCount: 1,
			firstMessage: "Planning",
		};
		const sessionSetup = await mount(() => (
			<SessionSelector
				state={{ kind: "success", choices: [choice] }}
				onSelect={() => {
					selected += 1;
				}}
				onCancel={() => {}}
			/>
		));
		await sessionSetup.mockInput.typeText("planning");
		await sessionSetup.flush();
		sessionSetup.mockInput.pressArrow("up");
		await sessionSetup.flush();
		sessionSetup.mockInput.pressArrow("down");
		await sessionSetup.flush();
		sessionSetup.mockInput.pressEnter();
		await sessionSetup.flush();
		expect(selected).toBe(1);

		let cancelled = 0;
		const cancelSetup = await mount(() => (
			<SessionSelector
				state={{ kind: "success", choices: [choice] }}
				onSelect={() => {}}
				onCancel={() => {
					cancelled += 1;
				}}
			/>
		));
		cancelSetup.mockInput.pressEscape();
		await Bun.sleep(30);
		await cancelSetup.flush();
		expect(cancelled).toBe(1);
	});

	test("session selector confirms and declines pending streaming switches", async () => {
		const choice: SessionChoice = {
			path: "/tmp/pending",
			id: "pending",
			name: "Pending session",
			modified: new Date(),
			messageCount: 1,
			firstMessage: "Pending",
		};
		let confirmed = 0;
		const enterSetup = await mount(() => (
			<SessionSelector
				state={{ kind: "success", choices: [choice] }}
				streaming
				pending={choice}
				onSelect={() => {}}
				onCancel={() => {}}
				onConfirm={() => {
					confirmed += 1;
				}}
				onDecline={() => {}}
			/>
		));
		enterSetup.mockInput.pressKey("y");
		await enterSetup.flush();
		expect(confirmed).toBe(1);

		const settledSetup = await mount(() => (
			<SessionSelector
				state={{ kind: "success", choices: [choice] }}
				pending={choice}
				onSelect={() => {}}
				onCancel={() => {}}
			/>
		));
		expect(settledSetup.captureCharFrame()).toContain(
			"Pi has settled. Switch to “Pending session”?",
		);

		const queuedSetup = await mount(() => (
			<SessionSelector
				state={{ kind: "success", choices: [choice] }}
				confirmation="queued"
				queuedCount={2}
				pending={choice}
				onSelect={() => {}}
				onCancel={() => {}}
			/>
		));
		expect(queuedSetup.captureCharFrame()).toContain(
			"Discard 2 local queued messages and switch to “Pending session”?",
		);
		const oneQueuedSetup = await mount(() => (
			<SessionSelector
				state={{ kind: "success", choices: [choice] }}
				confirmation="queued"
				queuedCount={1}
				pending={choice}
				onSelect={() => {}}
				onCancel={() => {}}
			/>
		));
		expect(oneQueuedSetup.captureCharFrame()).toContain(
			"Discard 1 local queued message and switch to “Pending session”?",
		);

		let declined = 0;
		const declineSetup = await mount(() => (
			<SessionSelector
				state={{ kind: "success", choices: [choice] }}
				streaming
				pending={choice}
				onSelect={() => {}}
				onCancel={() => {}}
				onConfirm={() => {}}
				onDecline={() => {
					declined += 1;
				}}
			/>
		));
		declineSetup.mockInput.pressKey("n");
		await declineSetup.flush();
		expect(declined).toBe(1);
	});

	test("selector selection and cancellation restore keyboard input to the chat editor", async () => {
		const models = [{ provider: "anthropic", id: "beta", name: "Beta" }];
		let modelEditor: TextareaRenderable | undefined;
		const [modelOpen, setModelOpen] = createSignal(true);
		const closeModel = () => {
			setModelOpen(false);
			queueMicrotask(() => modelEditor?.focus());
		};
		const modelSetup = await mount(() => (
			<box flexDirection="column">
				<textarea
					ref={(value) => {
						modelEditor = value;
					}}
					focused={!modelOpen()}
					height={1}
				/>
				<Show when={modelOpen()}>
					<ModelSelectorDialog
						models={models}
						onSelect={closeModel}
						onCancel={closeModel}
					/>
				</Show>
			</box>
		));
		await modelSetup.mockInput.typeText("beta");
		modelSetup.mockInput.pressEnter();
		await modelSetup.flush();
		await modelSetup.mockInput.typeText("chat after model");
		expect(modelEditor?.plainText).toBe("chat after model");

		const choice: SessionChoice = {
			path: "/tmp/session",
			id: "session",
			name: "Planning",
			modified: new Date(),
			messageCount: 1,
			firstMessage: "Planning",
		};
		let sessionEditor: TextareaRenderable | undefined;
		const [sessionOpen, setSessionOpen] = createSignal(true);
		const closeSession = () => {
			setSessionOpen(false);
			queueMicrotask(() => sessionEditor?.focus());
		};
		const sessionSetup = await mount(() => (
			<box flexDirection="column">
				<textarea
					ref={(value) => {
						sessionEditor = value;
					}}
					focused={!sessionOpen()}
					height={1}
				/>
				<Show when={sessionOpen()}>
					<SessionSelector
						state={{ kind: "success", choices: [choice] }}
						onSelect={closeSession}
						onCancel={closeSession}
					/>
				</Show>
			</box>
		));
		sessionSetup.mockInput.pressEscape();
		await Bun.sleep(30);
		await sessionSetup.flush();
		await sessionSetup.mockInput.typeText("chat after session");
		expect(sessionEditor?.plainText).toBe("chat after session");
	});
});
