import { afterEach, describe, expect, test } from "bun:test";
import {
	KeyEvent,
	RGBA,
	Renderable,
	type BoxRenderable,
	type MarkdownRenderable,
	type ScrollBoxRenderable,
	type TextareaRenderable,
} from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { createDynamic, testRender } from "@opentui/solid";
import { For, Show, createSignal } from "solid-js";
import {
	cleanThinkingText,
	MessageView,
	toolOutputExpandable,
} from "../src/ui/message.tsx";
import {
	filterModelChoices,
	formatContextWindow,
	ModelSelectorDialog,
	normalizeModelChoices,
} from "../src/ui/model-selector.tsx";
import { PromptMapDialog } from "../src/ui/prompt-map.tsx";
import { allocateSidebarPanels, Sidebar } from "../src/ui/sidebar.tsx";
import { NotificationDialog } from "../src/ui/notification-dialog.tsx";
import { SubagentInspector } from "../src/ui/subagent-inspector.tsx";
import { SubagentSelectorDialog } from "../src/ui/subagent-selector.tsx";
import { subagentTargets } from "../src/subagents/targets.ts";
import type {
	ConversationItem,
	NotificationRecord,
	RpcSessionState,
	SessionStats,
	SubagentRun,
} from "../src/types.ts";
import { registerBundledParsers } from "../src/ui/parsers.ts";
import {
	CommandSuggestions,
	filterCommandChoices,
	selectCommandChoice,
} from "../src/ui/command-suggestions.tsx";
import { SessionSelector } from "../src/ui/session-selector.tsx";
import { EmptyDashboard } from "../src/ui/empty-dashboard.tsx";
import { Logo } from "../src/ui/logo.tsx";
import {
	appendNotificationHistory,
	isUnmodifiedEnterKey,
	streamingCtrlCDecision,
	subagentInspectDecision,
} from "../src/app.tsx";
import {
	preserveEquivalentTodos,
	preserveReferencedList,
} from "../src/ui/list-stability.ts";
import type { SessionChoice, SessionDiscoveryState } from "../src/sessions.ts";
import { deriveTodos, type TodoViewItem } from "../src/ui/todos.tsx";
import { nextDetailToggle } from "../src/app.tsx";
import { PendingInputPanel } from "../src/ui/pending-input-panel.tsx";
import { appVersion } from "../src/version.ts";
import { ConversationModel } from "../src/state/conversation.ts";
import type { PendingSteerEntry } from "../src/state/input-continuity.ts";
import type { PiEvent } from "../src/types.ts";
import {
	colors,
	createThemeController,
	effectiveTheme,
} from "../src/ui/theme.ts";

registerBundledParsers();

const active: TestRendererSetup[] = [];
afterEach(() => {
	for (const setup of active.splice(0)) setup.renderer.destroy();
});

async function mount(
	node: () => unknown,
	width = 100,
	height = 30,
): Promise<TestRendererSetup> {
	const setup = await testRender(node as () => never, {
		width,
		height,
		useMouse: true,
		enableMouseMovement: true,
	});
	active.push(setup);
	await setup.flush();
	await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
	return setup;
}

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

	test("renders responsive logo variants without clipping", async () => {
		const wide = await mount(() => <Logo />, 100, 24);
		expect(wide.captureCharFrame()).toContain("█████████▀");
		const compact = await mount(() => <Logo compact />, 40, 20);
		expect(compact.captureCharFrame()).toContain("▄███████");
		const micro = await mount(() => <Logo />, 20, 20);
		expect(micro.captureCharFrame()).toContain("[> π <]");
		const short = await mount(() => <Logo />, 20, 8);
		expect(short.captureCharFrame()).toContain("[> π <]");
		expect(short.captureCharFrame()).not.toContain("■");
		for (const [frame, width] of [
			[wide.captureCharFrame(), 100],
			[compact.captureCharFrame(), 40],
			[micro.captureCharFrame(), 20],
		] as const) {
			for (const line of frame.split("\n"))
				expect(line.length).toBeLessThanOrEqual(width);
		}
	});

	test("renders the wordmark-only logo variant", async () => {
		const setup = await mount(() => <Logo wordmarkOnly />, 20, 8);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("PiTTy");
		expect(frame).not.toContain("■");
	});

	test("renders the empty dashboard states and keeps constrained content inside the viewport", async () => {
		const choice: SessionChoice = {
			path: "/tmp/dashboard",
			id: "dashboard",
			name: "Dashboard work",
			modified: new Date(),
			messageCount: 2,
			firstMessage: "Dashboard work",
		};
		const states: SessionDiscoveryState[] = [
			{ kind: "loading" },
			{ kind: "success", choices: [choice] },
			{ kind: "empty", choices: [] },
			{ kind: "error", error: "permission denied" },
		];
		for (const state of states) {
			const setup = await mount(
				() => (
					<EmptyDashboard sessionState={state} onSelectSession={() => {}} />
				),
				44,
				16,
			);
			const frame = setup.captureCharFrame();
			expect(frame).toContain("PiTTy");
			expect(frame).not.toContain("undefined");
			const expectedText =
				state.kind === "loading"
					? "Loading recent sessions…"
					: state.kind === "success"
						? "Dashboard work"
						: state.kind === "empty"
							? "No recent sessions in this directory."
							: "Unable to load recent sessions:";
			expect(frame).toContain(expectedText);
			for (const line of frame.split("\n"))
				expect(line.length).toBeLessThanOrEqual(44);
		}
	});

	test("shows the production session row limits at each dashboard tier", async () => {
		const choices: SessionChoice[] = Array.from({ length: 6 }, (_, index) => ({
			path: `/tmp/dashboard-${index}`,
			id: `dashboard-${index}`,
			name: `Unique session ${index}`,
			modified: new Date(),
			messageCount: index + 1,
			firstMessage: `Unique session ${index}`,
		}));
		const cases = [
			{ width: 100, height: 30, visible: 5 },
			{ width: 44, height: 16, visible: 4 },
			{ width: 44, height: 10, visible: 2 },
		];
		for (const { width, height, visible } of cases) {
			const setup = await mount(
				() => (
					<EmptyDashboard
						sessionState={{ kind: "success", choices }}
						onSelectSession={() => {}}
					/>
				),
				width,
				height,
			);
			const frame = setup.captureCharFrame();
			expect(frame).toContain(`Unique session ${visible - 1}`);
			expect(frame).not.toContain(`Unique session ${visible}`);
		}
	});

	test("keeps the wordmark and session state readable at constrained height", async () => {
		const setup = await mount(
			() => (
				<EmptyDashboard
					sessionState={{ kind: "loading" }}
					width={44}
					height={10}
					onSelectSession={() => {}}
				/>
			),
			44,
			10,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("PiTTy");
		expect(frame).toContain("Loading recent sessions");
		expect(frame).not.toContain("■───╮");
		for (const line of frame.split("\n"))
			expect(line.length).toBeLessThanOrEqual(44);
	});

	test("dashboard leaves the prompt editor focusable", async () => {
		let editor: TextareaRenderable | undefined;
		const setup = await mount(
			() => (
				<box flexDirection="column" width="100%" height="100%">
					<box flexGrow={1}>
						<EmptyDashboard
							sessionState={{ kind: "loading" }}
							onSelectSession={() => {}}
						/>
					</box>
					<textarea
						ref={(value) => {
							editor = value;
						}}
						focused
						height={2}
					/>
				</box>
			),
			70,
			16,
		);
		await setup.mockInput.typeText("draft while dashboard is visible");
		expect(editor?.plainText).toBe("draft while dashboard is visible");
	});

	test("dashboard session rows use the shared choice callback", async () => {
		const choice: SessionChoice = {
			path: "/tmp/dashboard",
			id: "dashboard",
			name: "Dashboard work",
			modified: new Date(),
			messageCount: 2,
			firstMessage: "Dashboard work",
		};
		let selected: SessionChoice | undefined;
		const setup = await mount(() => (
			<EmptyDashboard
				sessionState={{ kind: "success", choices: [choice] }}
				onSelectSession={(value) => {
					selected = value;
				}}
			/>
		));
		const frame = setup.captureCharFrame();
		const y = frame
			.split("\n")
			.findIndex((line) => line.includes("Dashboard work"));
		expect(y).toBeGreaterThanOrEqual(0);
		await setup.mockMouse.click(
			Math.max(0, frame.split("\n")[y]!.indexOf("Dashboard work")),
			y,
		);
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
				onSelect={(model) => {
					selectedModel = model.id;
				}}
				onCancel={() => {}}
			/>
		));
		await modelSetup.mockInput.typeText("beta");
		await modelSetup.flush();
		expect(modelSetup.captureCharFrame()).toContain("anthropic/beta");
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

	test("model selector selects a row on mouse click", async () => {
		const models = [
			{ provider: "openai", id: "alpha", name: "Alpha" },
			{ provider: "anthropic", id: "beta", name: "Beta" },
		];
		let selectedModel: string | undefined;
		const setup = await mount(() => (
			<ModelSelectorDialog
				models={models}
				onSelect={(model) => {
					selectedModel = model.id;
				}}
				onCancel={() => {}}
			/>
		));
		await setup.flush();
		const frame = setup.captureCharFrame();
		const y = frame
			.split("\n")
			.findIndex((line) => line.includes("anthropic/beta"));
		expect(y).toBeGreaterThanOrEqual(0);
		await setup.mockMouse.click(
			Math.max(0, frame.split("\n")[y]!.indexOf("anthropic/beta")),
			y,
		);
		await setup.flush();
		expect(selectedModel).toBe("beta");
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

	test("removes repeated provider thinking headings without changing prose", () => {
		expect(cleanThinkingText("Thinking:\nThinking: **Planning work**")).toBe(
			"**Planning work**",
		);
		expect(cleanThinkingText("Reasoning\nThinking: inspect files")).toBe(
			"inspect files",
		);
		expect(cleanThinkingText("Thinking about the safest approach")).toBe(
			"Thinking about the safest approach",
		);
	});

	test("renders main and subagent thinking as sanitized Markdown", async () => {
		const assistant: ConversationItem = {
			kind: "assistant",
			id: "markdown-thinking",
			text: "",
			thinking:
				"\u001b[38;2;34;211;238mThinking:\u001b[39m **Planning validation**\n\n- inspect tests\n- run typecheck",
			timestamp: 1,
			status: "done",
		};
		const run: SubagentRun = {
			runId: "run-markdown",
			asyncDir: "/tmp/run-markdown",
			mode: "single",
			state: "running",
			agent: "implementer",
			steps: [],
		};
		const tool: ConversationItem = {
			kind: "tool",
			id: "subagent-tool",
			toolCallId: "subagent-tool",
			name: "bash",
			args: "bun test",
			output: "5 pass\n0 fail",
			timestamp: 2,
			startedAt: 2,
			endedAt: 349,
			status: "done",
			isError: false,
		};

		const main = await mount(() => (
			<MessageView
				item={assistant}
				showThinking
				thinkingExpanded
				toolExpanded={false}
			/>
		));
		const mainFrame = main.captureCharFrame();
		expect(mainFrame).toContain("Planning validation");
		expect(mainFrame).toContain("inspect tests");
		expect(mainFrame).not.toContain("[38;2;");
		expect(mainFrame).not.toContain("**Planning");

		const subagent = await mount(
			() => (
				<SubagentInspector
					run={run}
					items={[assistant, tool]}
					now={1_000}
					thinkingExpanded={() => true}
					toolExpanded={() => false}
					diffExpanded={() => false}
				/>
			),
			110,
			30,
		);
		const subagentFrame = subagent.captureCharFrame();
		expect(subagentFrame).toContain("Planning validation");
		expect(subagentFrame).toContain("TOOL · bash");
		expect(subagentFrame).toContain("5 pass");
		expect(subagentFrame).not.toContain("[38;2;");
	});

	test("synchronizes subagent drafts when the owner restores or clears them", async () => {
		const run: SubagentRun = {
			runId: "draft-run",
			asyncDir: "/tmp/draft-run",
			mode: "single",
			state: "running",
			agent: "worker",
			steps: [],
		};
		const target = {
			key: "draft-target",
			run,
			label: "worker",
			state: "running",
			active: true,
			canSteer: true,
		};
		const [draft, setDraft] = createSignal("unfinished steer");
		const setup = await mount(
			() => (
				<SubagentInspector target={target} items={[]} now={1} draft={draft} />
			),
			100,
			24,
		);
		const editor = setup.renderer.root.findDescendantById(
			"subagent-inspector-steer",
		) as TextareaRenderable;
		expect(editor.plainText).toBe("unfinished steer");
		setDraft("");
		await setup.flush();
		expect(editor.plainText).toBe("");
		setDraft("restored for this target");
		await setup.flush();
		expect(editor.plainText).toBe("restored for this target");
	});

	test("shows queued subagent guidance while retaining a writable steer editor", async () => {
		const run: SubagentRun = {
			runId: "queued-steer-run",
			asyncDir: "/tmp/queued-steer-run",
			mode: "single",
			state: "running",
			agent: "worker",
			steps: [],
		};
		const target = {
			key: "queued-steer-target",
			run,
			label: "worker",
			state: "running",
			active: true,
			canSteer: true,
		};
		const pending: PendingSteerEntry[] = [
			{
				requestId: "fresh",
				targetKey: target.key,
				runId: run.runId,
				text: "check the failing test",
				submittedAt: 20_000,
				baselineSteerCount: 0,
			},
			{
				requestId: "stale",
				targetKey: target.key,
				runId: run.runId,
				text: "preserve this draft",
				submittedAt: 1,
				baselineSteerCount: 0,
			},
		];
		const setup = await mount(
			() => (
				<SubagentInspector
					target={target}
					items={[]}
					now={130_000}
					pendingSteers={pending}
				/>
			),
			100,
			24,
		);
		const editor = setup.renderer.root.findDescendantById(
			"subagent-inspector-steer",
		) as TextareaRenderable;
		expect(setup.captureCharFrame()).toContain(
			"Queued for delivery · check the failing test",
		);
		expect(setup.captureCharFrame()).toContain(
			"Waiting (over 120s) · preserve this draft",
		);
		await setup.mockInput.typeText("new guidance");
		expect(editor.plainText).toBe("new guidance");
	});

	test("clears the destroyed steering editor when a subagent completes", async () => {
		const running: SubagentRun = {
			runId: "lifecycle-run",
			asyncDir: "/tmp/lifecycle-run",
			mode: "single",
			state: "running",
			agent: "worker",
			steps: [],
		};
		const target = {
			key: "lifecycle-target",
			run: running,
			label: "worker",
			state: "running" as const,
			active: true,
			canSteer: true,
		};
		const [draft, setDraft] = createSignal("queued guidance");
		const setup = await mount(
			() => (
				<SubagentInspector target={target} items={[]} now={1} draft={draft} />
			),
			100,
			24,
		);
		const editor = setup.renderer.root.findDescendantById(
			"subagent-inspector-steer",
		) as TextareaRenderable;
		expect(editor.plainText).toBe("queued guidance");

		editor.destroy();
		target.canSteer = false;
		setDraft("must not read the destroyed editor");
		await setup.flush();
		expect(editor.isDestroyed).toBe(true);
	});

	test("only makes tool output expandable when it actually needs more space", () => {
		expect(toolOutputExpandable("5 pass\n0 fail")).toBe(false);
		expect(toolOutputExpandable("one\ntwo\nthree\nfour\nfive")).toBe(true);
		expect(toolOutputExpandable("x".repeat(321))).toBe(true);
	});

	test("renders distinct user, assistant, and tool messages", async () => {
		const items: ConversationItem[] = [
			{
				kind: "user",
				id: "u",
				text: "Please inspect the tests",
				timestamp: 1,
				optimistic: false,
			},
			{
				kind: "assistant",
				id: "a",
				text: "I found **two** relevant files.",
				thinking: "checking",
				timestamp: 2,
				status: "done",
			},
			{
				kind: "tool",
				id: "t",
				toolCallId: "tool-1",
				name: "bash",
				args: { command: "bun test" },
				output: "5 pass\n0 fail",
				timestamp: 3,
				status: "done",
				isError: false,
			},
		];
		const setup = await mount(() => (
			<box width="100%" height="100%" flexDirection="column">
				{items.map((item) => (
					<MessageView item={item} showThinking toolExpanded={false} />
				))}
			</box>
		));
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Please inspect the tests");
		expect(frame).toContain("two relevant files");
		expect(frame).toContain("bash");
		expect(frame).toContain("5 pass");
		expect(frame).not.toContain("click to expand");
		expect(frame).not.toContain("▶");
	});

	test("renders colorful tool cards with a collapsible diff", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "edit-diff",
			toolCallId: "edit-diff",
			name: "edit",
			args: { path: "src/app.ts", edits: [] },
			output: "Applied edit",
			diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old value\n+new value\n",
			diffPath: "src/app.ts",
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const collapsed = await mount(() => (
			<MessageView
				item={item}
				showThinking
				toolExpanded={false}
				diffExpanded={false}
			/>
		));
		const collapsedFrame = collapsed.captureCharFrame();
		expect(collapsedFrame).toContain("TOOL · edit");
		expect(collapsedFrame).toContain("Changes");
		expect(collapsedFrame).toContain("+1");
		expect(collapsedFrame).toContain("-1");
		expect(collapsedFrame).not.toContain("old value");

		const expanded = await mount(() => (
			<MessageView item={item} showThinking toolExpanded={false} diffExpanded />
		));
		const expandedFrame = expanded.captureCharFrame();
		expect(expandedFrame).toContain("old value");
		expect(expandedFrame).toContain("new value");
	});

	test("hides optional integration panels when packages are unavailable", async () => {
		const setup = await mount(
			() => (
				<Sidebar
					runs={[]}
					subagentsAvailable={false}
					todosAvailable={false}
					todos={[]}
				/>
			),
			42,
			28,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Session");
		expect(frame).not.toContain("Subagents");
		expect(frame).not.toContain("Todos");
		expect(frame).not.toContain("Ctrl+I inspect");
	});

	test("bounds notification history with oldest-first eviction", () => {
		const records = Array.from({ length: 101 }, (_, index) => ({
			id: `notification-${index}`,
			text: `notification ${index}`,
			tone: "info" as const,
			createdAt: index,
			read: false,
		}));

		const history = records.reduce<NotificationRecord[]>(
			(current, record) => appendNotificationHistory(current, record),
			[],
		);

		expect(history).toHaveLength(100);
		expect(history[0]?.id).toBe("notification-1");
		expect(history.at(-1)?.id).toBe("notification-100");
	});

	test("orders sidebar notifications unread-first and newest-first", async () => {
		const records: NotificationRecord[] = [
			{
				id: "read-old",
				text: "SEEN_EARLIER",
				tone: "info",
				createdAt: 1,
				read: true,
			},
			{
				id: "unread-old",
				text: "PENDING_EARLIER",
				tone: "warning",
				createdAt: 2,
				read: false,
			},
			{
				id: "read-new",
				text: "SEEN_LATEST",
				tone: "success",
				createdAt: 4,
				read: true,
			},
			{
				id: "unread-new",
				text: "PENDING_LATEST",
				tone: "error",
				createdAt: 3,
				read: false,
			},
		];
		const setup = await mount(
			() => (
				<Sidebar
					runs={[]}
					subagentsAvailable={false}
					todosAvailable={false}
					notifications={records}
					height={30}
				/>
			),
			42,
			30,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Notifications (4)");
		expect(frame.indexOf("PENDING_LATEST")).toBeLessThan(
			frame.indexOf("PENDING_EARLIER"),
		);
		expect(frame.indexOf("PENDING_EARLIER")).toBeLessThan(
			frame.indexOf("SEEN_LATEST"),
		);
		expect(frame.indexOf("SEEN_LATEST")).toBeLessThan(
			frame.indexOf("SEEN_EARLIER"),
		);
	});

	test("hides the notification panel when history is empty", async () => {
		const setup = await mount(
			() => (
				<Sidebar
					runs={[]}
					subagentsAvailable={false}
					todosAvailable={false}
					notifications={[]}
					height={30}
				/>
			),
			42,
			30,
		);
		expect(setup.captureCharFrame()).not.toContain("Notifications");
		expect(
			setup.renderer.root.findDescendantById("notification-panel"),
		).toBeUndefined();
	});

	test("opens a full Markdown notification detail from a sidebar row", async () => {
		const record: NotificationRecord = {
			id: "markdown-notification",
			text: "# FULL_TITLE\n\nParagraph **FULL_BOLD**\n\n```text\nFULL_CODE\n```",
			tone: "info",
			createdAt: 1,
			read: false,
		};
		const [selected, setSelected] = createSignal<string>();
		const setup = await mount(
			() => (
				<Sidebar
					runs={[]}
					subagentsAvailable={false}
					todosAvailable={false}
					notifications={[record]}
					height={30}
					onOpenNotification={setSelected}
				/>
			),
			42,
			30,
		);
		const before = setup.captureCharFrame();
		const row = before
			.split("\n")
			.findIndex((line) => line.includes("FULL_TITLE"));
		expect(row).toBeGreaterThanOrEqual(0);
		await setup.mockMouse.click(
			before.split("\n")[row]!.indexOf("FULL_TITLE") + 1,
			row,
		);
		await setup.flush();
		expect(selected()).toBe(record.id);

		const dialog = await mount(
			() => <NotificationDialog record={() => record} onClose={() => {}} />,
			42,
			30,
		);
		expect(dialog.captureCharFrame()).toContain("FULL_TITLE");
		expect(dialog.captureCharFrame()).toContain("FULL_CODE");
	});

	test("chooses abort first and force-exit while an abort is pending", () => {
		expect(streamingCtrlCDecision(false)).toBe("abort");
		expect(streamingCtrlCDecision(true)).toBe("force-exit");
	});

	test("routes explicit Ctrl+I decisions without implicit target selection", () => {
		expect(subagentInspectDecision(true, 2)).toBe("close");
		expect(subagentInspectDecision(false, 0)).toBe("warning");
		expect(subagentInspectDecision(false, 1)).toBe("direct");
		expect(subagentInspectDecision(false, 2)).toBe("choose");
	});

	test("keeps panel allocations stable when a target becomes inactive", async () => {
		const runningRun: SubagentRun = {
			runId: "reactive-row",
			asyncDir: "/tmp/reactive-row",
			mode: "single",
			state: "running",
			agent: "reactive-worker",
			steps: [],
		};
		const [runs, setRuns] = createSignal<SubagentRun[]>([runningRun]);
		const stats = {
			sessionFile: "/tmp/session.jsonl",
			sessionId: "session",
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			toolResults: 0,
			totalMessages: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			cost: 0,
			contextUsage: { tokens: 10, contextWindow: 100, percent: 50 },
		} as SessionStats;
		const setup = await mount(
			() => (
				<Sidebar
					runs={runs}
					now={1}
					stats={stats}
					todos={[{ id: "1", text: "one", status: "pending", done: false }]}
					height={40}
				/>
			),
			80,
			40,
		);
		const row = setup.renderer.root.findDescendantById("subagent-reactive-row");
		if (!row) throw new Error("reactive sidebar fixture missing");
		const subagentPanel =
			setup.renderer.root.findDescendantById("subagent-panel");
		const todoPanel = setup.renderer.root.findDescendantById("todo-panel");
		if (!subagentPanel || !todoPanel) throw new Error("sidebar panels missing");
		const initialSubagentHeight = subagentPanel.height;
		const initialTodoHeight = todoPanel.height;
		expect(row.height).toBe(3);

		setRuns([{ ...runningRun, state: "completed" }]);
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		const nextFrame = setup.captureCharFrame();
		expect(subagentPanel.height).toBe(initialSubagentHeight);
		expect(todoPanel.height).toBe(initialTodoHeight);
		expect(nextFrame).toContain("reactive-worker · completed");
		expect(nextFrame).not.toContain("running · 0t/0 tools");
		expect(nextFrame).not.toContain("Ctrl+Sh");
		expect(nextFrame.split("\n").length).toBeLessThanOrEqual(41);
	});

	test("renders inactive targets as one visible label-and-state row and accounts for context percent", async () => {
		const run: SubagentRun = {
			runId: "inactive-row",
			asyncDir: "/tmp/inactive-row",
			mode: "single",
			state: "completed",
			agent: "finished-worker",
			steps: [],
		};
		const stats = {
			sessionFile: "/tmp/session.jsonl",
			sessionId: "session",
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			toolResults: 0,
			totalMessages: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			cost: 0,
			contextUsage: { tokens: 10, contextWindow: 100, percent: 50 },
		} as SessionStats;
		const setup = await mount(
			() => (
				<Sidebar
					runs={[run]}
					stats={stats}
					todos={[{ id: "1", text: "one", status: "pending", done: false }]}
					height={30}
				/>
			),
			80,
			30,
		);
		const row = setup.renderer.root.findDescendantById("subagent-inactive-row");
		if (!row) throw new Error("inactive target row missing");
		expect(row.height).toBe(1);
		expect(setup.captureCharFrame()).toContain("finished-worker · completed");
		expect(row.screenY + row.height).toBeLessThanOrEqual(30);
	});

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
				content: "COLLAPSED_THINKING",
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
			expect(contentLine?.indexOf(content)).toBe(2);
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
				expect(answerLine?.indexOf(answerText)).toBe(2);
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

	test("renders session and subagent status in the sidebar", async () => {
		const state = {
			sessionId: "session-1",
			sessionName: "OpenCode UI work",
			thinkingLevel: "high",
			isStreaming: true,
			isCompacting: false,
			steeringMode: "all",
			followUpMode: "all",
			autoCompactionEnabled: true,
			messageCount: 8,
			pendingMessageCount: 0,
			model: {
				provider: "openai-codex",
				id: "gpt-5.6-sol",
				contextWindow: 400000,
			},
		} as RpcSessionState;
		const stats = {
			sessionFile: "/tmp/session.jsonl",
			sessionId: "session-1",
			userMessages: 2,
			assistantMessages: 2,
			toolCalls: 2,
			toolResults: 2,
			totalMessages: 8,
			tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
			cost: 0,
			contextUsage: { tokens: 33000, contextWindow: 400000, percent: 8.25 },
		} as SessionStats;
		const runs: SubagentRun[] = [
			{
				runId: "run-1",
				asyncDir: "/tmp/run-1",
				mode: "single",
				state: "running",
				agent: "implementer",
				totalTokens: 4200,
				currentTool: "bash",
				steps: [],
			},
		];
		const setup = await mount(
			() => (
				<Sidebar
					state={state}
					stats={stats}
					runs={runs}
					selectedRunId="run-1"
				/>
			),
			42,
			28,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("OpenCode UI work");
		expect(frame).toContain(`PiTTy v${appVersion}`);
		expect(frame).toContain("gpt-5.6-sol");
		expect(frame).toContain("implementer");
		expect(frame).toContain("running");
		expect(frame).not.toContain("Selected");
	});

	test("renders live assistant output as stable plain text and tool timing", async () => {
		const items: ConversationItem[] = [
			{
				kind: "assistant",
				id: "live",
				text: "Streaming **unfinished",
				thinking: "Thinking: checking",
				timestamp: 2,
				status: "streaming",
			},
			{
				kind: "tool",
				id: "tool-time",
				toolCallId: "tool-time",
				name: "bash",
				args: { command: "sleep 1", timeout: 30_000 },
				output: "running",
				timestamp: 3,
				startedAt: 1_000,
				timeoutMs: 30_000,
				status: "streaming",
				isError: false,
			},
		];
		const setup = await mount(() => (
			<box width="100%" height="100%" flexDirection="column">
				{items.map((item) => (
					<MessageView
						item={item}
						showThinking
						toolExpanded={false}
						now={6_000}
					/>
				))}
			</box>
		));
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Streaming **unfinished");
		expect(frame).toContain("checking");
		expect(frame.match(/Thinking/g)?.length).toBe(1);
		expect(frame).toContain("5s / timeout 30s");
	});
	test("global details toggle collapses mixed individual overrides", () => {
		expect(
			nextDetailToggle({
				toolsExpanded: false,
				thinkingExpanded: false,
				hasExpandedToolOverride: true,
			}),
		).toBe(false);
		expect(
			nextDetailToggle({ toolsExpanded: false, thinkingExpanded: false }),
		).toBe(true);
	});

	test("normalizes and renders the Ctrl+P model list", async () => {
		const models = normalizeModelChoices([
			{
				provider: "openai-codex",
				id: "gpt-5.6-terra",
				name: "GPT-5.6 Terra",
				contextWindow: 400000,
			},
			{
				provider: "openai-codex",
				id: "gpt-5.6-sol",
				name: "GPT-5.6 Sol",
				contextWindow: 1000000,
			},
			{ provider: "openai-codex", id: "gpt-5.6-sol", name: "duplicate" },
			null,
		]);
		expect(models).toHaveLength(2);
		const setup = await mount(
			() => (
				<ModelSelectorDialog
					models={models}
					currentProvider="openai-codex"
					currentModelId="gpt-5.6-terra"
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			90,
			24,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Select model");
		expect(frame).toContain("openai-codex/gpt-5.6-sol");
		expect(frame).toContain("openai-codex/gpt-5.6-terra");
		expect(frame).toContain("400k ctx");
		expect(frame).toContain("1M ctx");
		expect(formatContextWindow(128000)).toBe("128k ctx");
		expect(filterModelChoices(models, "SOL").map((model) => model.id)).toEqual([
			"gpt-5.6-sol",
		]);
		expect(
			filterModelChoices(models, "terra").map((model) => model.id),
		).toEqual(["gpt-5.6-terra"]);
		expect(filterModelChoices(models, "missing")).toEqual([]);
		const emptySetup = await mount(
			() => (
				<ModelSelectorDialog
					models={[]}
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			90,
			16,
		);
		expect(emptySetup.captureCharFrame()).toContain("Tab list");
		expect(emptySetup.captureCharFrame()).toContain("No matching models.");
	});

	test("keeps the main draft visible beneath the selector reservation", async () => {
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<box flexGrow={1} />
					<textarea
						ref={(value) => {
							value.setText("unsent draft");
						}}
						height={4}
						minHeight={4}
					/>
					<ModelSelectorDialog
						models={[{ provider: "local", id: "draft-model" }]}
						onSelect={() => {}}
						onCancel={() => {}}
					/>
				</box>
			),
			70,
			14,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("unsent draft");
		expect(frame).toContain("Search provider");
	});

	test("subagent inspector has a working mouse close target", async () => {
		let closed = 0;
		const run: SubagentRun = {
			runId: "run-close",
			asyncDir: "/tmp/run-close",
			mode: "single",
			state: "running",
			agent: "implementer",
			steps: [],
		};
		const setup = await mount(
			() => (
				<SubagentInspector
					run={run}
					items={[]}
					now={2_000}
					onClose={() => {
						closed += 1;
					}}
				/>
			),
			90,
			24,
		);
		const frame = setup.captureCharFrame();
		const lines = frame.split("\n");
		const y = lines.findIndex((line) => line.includes("Main chat"));
		const x = y >= 0 ? lines[y]!.indexOf("Main chat") + 2 : -1;
		expect(y).toBeGreaterThanOrEqual(0);
		expect(x).toBeGreaterThanOrEqual(0);
		await setup.mockMouse.click(x, y);
		await Bun.sleep(60);
		await setup.flush();
		expect(closed).toBeGreaterThan(0);
	});

	test("keeps one queued row and hint visible in an 80x14 layout", async () => {
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<box flexGrow={1} minHeight={1}>
						<text>conversation output</text>
					</box>
					<box flexGrow={0}>
						<PendingInputPanel
							queuedFollowUps={[{ id: "queued", text: "short queued" }]}
							steering={[]}
							followUps={[]}
							onEditQueuedFollowUp={() => {}}
						/>
					</box>
					<textarea height={4} minHeight={4} />
					<text>status</text>
				</box>
			),
			80,
			14,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Pending input");
		expect(frame).toContain("Alt+Up edits the last editable local follow-up.");
		expect(frame).toContain("1. editable later: short queued");
	});

	test("keeps sent header and steering row separate when space is available", async () => {
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<box flexGrow={1} minHeight={1}>
						<text>conversation output</text>
					</box>
					<box flexGrow={0}>
						<PendingInputPanel
							queuedFollowUps={[{ id: "queued", text: "short queued" }]}
							steering={["short steering"]}
							followUps={[]}
							onEditQueuedFollowUp={() => {}}
						/>
					</box>
					<textarea height={4} minHeight={4} />
					<text>status</text>
				</box>
			),
			80,
			14,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Already sent to Pi");
		expect(frame).not.toContain("Already sent to Pi — RPC cannot edit these:");
		expect(frame).toContain("steering: short steering");
	});

	test("keeps pending steering text intact in an 80x10 layout", async () => {
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<box flexGrow={1} minHeight={1}>
						<text>conversation output</text>
					</box>
					<PendingInputPanel
						queuedFollowUps={[]}
						steering={["after you do all the fixes release it as 0.3.3"]}
						followUps={[]}
						onEditQueuedFollowUp={() => {}}
					/>
					<textarea height={2} minHeight={2} />
				</box>
			),
			80,
			10,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain(
			"steering: after you do all the fixes release it as 0.3.3",
		);
		expect(frame).not.toContain(
			"steering: after you do all the fixes release it as 0.3.3conversation",
		);
	});

	test("bounds pending input rows while keeping the main textarea writable", async () => {
		let editor: TextareaRenderable | undefined;
		const queuedFollowUps = Array.from({ length: 12 }, (_, index) => ({
			id: `queued-${index}`,
			text: `queued follow-up ${index}`,
		}));
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<box flexGrow={1} minHeight={0} />
					<box flexGrow={1} minHeight={0}>
						<PendingInputPanel
							queuedFollowUps={queuedFollowUps}
							steering={[]}
							followUps={[]}
							onEditQueuedFollowUp={() => {}}
						/>
					</box>
					<textarea
						ref={(value) => {
							editor = value;
						}}
						focused
						height={2}
						minHeight={2}
						flexShrink={0}
					/>
				</box>
			),
			80,
			14,
		);
		editor?.focus();
		await setup.mockInput.typeText("draft remains writable");
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Pending input");
		expect(editor).toBeDefined();
		expect(editor?.plainText).toBe("draft remains writable");
		expect(frame.split("\n")).toHaveLength(15);
		expect(frame).not.toContain("queued follow-up 11");
	});

	test("renders separate parallel subagents and hides steering input for finished children", async () => {
		const run: SubagentRun = {
			runId: "parallel-run",
			asyncDir: "/tmp/parallel-run",
			mode: "parallel",
			state: "running",
			steps: [
				{
					index: 0,
					agent: "implementer",
					status: "running",
					sessionFile: "/tmp/impl.jsonl",
					model: "provider/child",
					contextWindow: 8192,
					thinking: "high",
					lastActivityAt: 1_000,
				},
				{
					index: 1,
					agent: "reviewer",
					status: "completed",
					lastActivityAt: 500,
				},
			],
		};
		const targets = subagentTargets([run]);
		const selector = await mount(
			() => (
				<SubagentSelectorDialog
					targets={targets}
					selectedKey={targets[0]?.key}
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			90,
			24,
		);
		const selectorFrame = selector.captureCharFrame();
		expect(selectorFrame).toContain("implementer");
		expect(selectorFrame).toContain("reviewer");
		expect(selectorFrame.indexOf("implementer")).toBeLessThan(
			selectorFrame.indexOf("reviewer"),
		);
		expect(selectorFrame).toContain("1 active");

		const finished = targets.find(
			(target) => target.step?.agent === "reviewer",
		)!;
		const inspector = await mount(
			() => <SubagentInspector target={finished} items={[]} now={2_000} />,
			100,
			24,
		);
		const inspectorFrame = inspector.captureCharFrame();
		expect(inspectorFrame).toContain("Steering input hidden");
		expect(inspectorFrame).toContain("model unknown");
		expect(inspectorFrame).toContain("context unknown");
		expect(inspectorFrame).toContain("thinking unknown");
		expect(inspectorFrame).not.toContain("Steer reviewer #2");
		expect(inspectorFrame).not.toContain("Ctrl+A pause");
		expect(inspectorFrame).not.toContain("Ctrl+Shift+A stop");

		const active = targets.find(
			(target) => target.step?.agent === "implementer",
		)!;
		const sidebar = await mount(
			() => <Sidebar runs={[run]} now={2_000} />,
			42,
			24,
		);
		expect(sidebar.captureCharFrame()).toContain("last activi");
		const tool = await mount(
			() => (
				<MessageView
					item={{
						kind: "tool",
						id: "tool",
						toolCallId: "call",
						name: "subagent",
						args: {},
						output: "",
						timestamp: 1,
						status: "done",
						isError: false,
					}}
					showThinking={false}
					toolExpanded={false}
					subagentTargets={targets}
					now={2_000}
				/>
			),
			100,
			24,
		);
		expect(tool.captureCharFrame()).toContain("last activi");
		const activeInspector = await mount(
			() => <SubagentInspector target={active} items={[]} now={2_000} />,
			100,
			24,
		);
		const activeFrame = activeInspector.captureCharFrame();
		expect(activeFrame).toContain("model provider/child");
		expect(activeFrame).toContain("8.2k ctx");
		expect(activeFrame).toContain("thinking high");
	});

	test("shows inspector actions only for applicable file-backed targets", async () => {
		const runningRun: SubagentRun = {
			runId: "hint-running",
			asyncDir: "/tmp/hint-running",
			mode: "single",
			state: "running",
			agent: "worker",
			steps: [],
		};
		const queuedRun: SubagentRun = {
			...runningRun,
			runId: "hint-queued",
			asyncDir: "/tmp/hint-queued",
			state: "queued",
		};
		const finishedRun: SubagentRun = {
			...runningRun,
			runId: "hint-finished",
			asyncDir: "/tmp/hint-finished",
			state: "completed",
		};
		const foregroundRun: SubagentRun = {
			...runningRun,
			runId: "hint-foreground",
			asyncDir: undefined,
			control: "foreground",
		};
		const running = subagentTargets([runningRun])[0];
		const queued = subagentTargets([queuedRun])[0];
		const finished = subagentTargets([finishedRun])[0];
		const foreground = subagentTargets([foregroundRun])[0];
		if (!running || !queued || !finished || !foreground)
			throw new Error("hint fixtures missing");
		const runningView = await mount(
			() => <SubagentInspector target={running} items={[]} now={1} />,
			100,
			24,
		);
		expect(runningView.captureCharFrame()).toContain(
			"Ctrl+A pause · Ctrl+Shift+A stop",
		);
		const queuedView = await mount(
			() => <SubagentInspector target={queued} items={[]} now={1} />,
			100,
			24,
		);
		expect(queuedView.captureCharFrame()).toContain("Ctrl+Shift+A stop");
		expect(queuedView.captureCharFrame()).not.toContain("Ctrl+A pause");
		const finishedView = await mount(
			() => <SubagentInspector target={finished} items={[]} now={1} />,
			100,
			24,
		);
		expect(finishedView.captureCharFrame()).not.toContain("Ctrl+Shift+A stop");
		const foregroundView = await mount(
			() => <SubagentInspector target={foreground} items={[]} now={1} />,
			100,
			24,
		);
		expect(foregroundView.captureCharFrame()).not.toContain(
			"Ctrl+Shift+A stop",
		);
	});

	test("keeps subagent transcript rendering uncullled", async () => {
		const run: SubagentRun = {
			runId: "inspector-culling",
			asyncDir: "/tmp/inspector-culling",
			mode: "single",
			state: "running",
			agent: "worker",
			steps: [],
		};
		const target = subagentTargets([run])[0];
		if (!target) throw new Error("inspector target fixture missing");
		const setup = await mount(
			() => (
				<SubagentInspector
					target={target}
					items={[
						{
							kind: "assistant",
							id: "inspector-first",
							text: "first update",
							thinking: "",
							timestamp: 1,
							status: "done",
						},
					]}
					now={2_000}
				/>
			),
			100,
			24,
		);
		const transcript = setup.renderer.root.findDescendantById(
			"subagent-inspector-transcript",
		) as ScrollBoxRenderable | undefined;
		if (!transcript) throw new Error("inspector transcript scrollbox missing");
		expect(transcript.viewportCulling).toBe(false);
		expect(setup.captureCharFrame()).toContain("first update");
	});

	test("uses lifecycle state for active target border colors", async () => {
		const runs: SubagentRun[] = [
			{
				runId: "border-running",
				asyncDir: "/tmp/border-running",
				mode: "single",
				state: "running",
				activityState: "active_long_running",
				agent: "running-worker",
				steps: [],
			},
			{
				runId: "border-queued",
				asyncDir: "/tmp/border-queued",
				mode: "single",
				state: "queued",
				activityState: "needs_attention",
				agent: "queued-worker",
				steps: [],
			},
			{
				runId: "border-failed",
				asyncDir: "/tmp/border-failed",
				mode: "single",
				state: "failed",
				activityState: "active_long_running",
				agent: "failed-worker",
				steps: [],
			},
		];
		const setup = await mount(() => <Sidebar runs={runs} />, 42, 24);
		const running = setup.renderer.root.findDescendantById(
			"subagent-border-running",
		) as BoxRenderable | undefined;
		const queued = setup.renderer.root.findDescendantById(
			"subagent-border-queued",
		) as BoxRenderable | undefined;
		const failed = setup.renderer.root.findDescendantById(
			"subagent-border-failed",
		) as BoxRenderable | undefined;
		if (!running || !queued || !failed)
			throw new Error("border target fixture missing");
		expect(running.borderColor.toInts().slice(0, 3)).toEqual(
			RGBA.fromHex(colors.green).toInts().slice(0, 3),
		);
		expect(queued.borderColor.toInts().slice(0, 3)).toEqual(
			RGBA.fromHex(colors.yellow).toInts().slice(0, 3),
		);
		expect(failed.borderColor.toInts().slice(0, 3)).toEqual(
			RGBA.fromHex(colors.red).toInts().slice(0, 3),
		);
	});

	test("collapses and expands thinking while keeping a visible preview", async () => {
		const item: ConversationItem = {
			kind: "assistant",
			id: "thinking-toggle",
			text: "Done.",
			thinking: `${"Inspect the files carefully and compare every relevant behavior. ".repeat(4)}\nUNIQUE_EXPANDED_DETAIL`,
			timestamp: 2,
			status: "done",
		};
		const collapsed = await mount(() => (
			<MessageView
				item={item}
				showThinking
				thinkingExpanded={false}
				toolExpanded={false}
			/>
		));
		const collapsedFrame = collapsed.captureCharFrame();
		expect(collapsedFrame).toContain("▶ Thinking");
		expect(collapsedFrame).toContain("Inspect the files carefully");
		expect(collapsedFrame).not.toContain("UNIQUE_EXPANDED_DETAIL");

		const expanded = await mount(() => (
			<MessageView
				item={item}
				showThinking
				thinkingExpanded
				toolExpanded={false}
			/>
		));
		const expandedFrame = expanded.captureCharFrame();
		expect(expandedFrame).toContain("▼ Thinking");
		expect(expandedFrame).toContain("UNIQUE_EXPANDED_DETAIL");
	});

	test("does not render a fake answer row when an assistant is only thinking", async () => {
		const item: ConversationItem = {
			kind: "assistant",
			id: "thinking-only",
			text: "",
			thinking: "Inspecting the branch state before changing anything.",
			timestamp: 2,
			status: "streaming",
		};
		const setup = await mount(() => (
			<MessageView
				item={item}
				showThinking
				thinkingExpanded
				toolExpanded={false}
			/>
		));
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Thinking");
		expect(frame).toContain("Inspecting the branch state");
		const thinkingLine = frame
			.split("\n")
			.find((line) => line.includes("Inspecting the branch state"));
		expect(thinkingLine?.indexOf("Inspecting the branch state")).toBe(2);
		expect(frame).not.toContain("▍");
	});

	test("filters and renders slash-command suggestions", async () => {
		const commands = [
			{
				name: "thinking",
				description: "Change reasoning effort",
				source: "ui",
			},
			{
				name: "thoughts",
				description: "Collapse thinking blocks",
				source: "ui",
			},
			{ name: "model", description: "Select a model", source: "ui" },
		];
		expect(
			filterCommandChoices(commands, "/th").map((item) => item.name),
		).toEqual(["thinking", "thoughts"]);
		expect(
			filterCommandChoices(
				Array.from({ length: 12 }, (_, index) => ({
					name: `command-${index}`,
				})),
				"/",
			),
		).toHaveLength(7);
		expect(filterCommandChoices(commands, "/thinking high")).toEqual([]);
		const setup = await mount(
			() => (
				<CommandSuggestions
					commands={() => filterCommandChoices(commands, "/th")}
					selectedIndex={() => 0}
					onSelect={() => {}}
				/>
			),
			90,
			12,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("/thinking");
		expect(frame).toContain("/thoughts");
		expect(frame).toContain("Tab/Enter insert");
	});

	test("keeps production-sized suggestions above a writable prompt with pending input", async () => {
		let editor: TextareaRenderable | undefined;
		const [selectedIndex, setSelectedIndex] = createSignal(0);
		const commands = Array.from({ length: 7 }, (_, index) => ({
			name: `overflow-command-${index}`,
			description: `Description ${index}`,
		}));
		const queuedFollowUps = Array.from({ length: 8 }, (_, index) => ({
			id: `queued-${index}`,
			text: `queued ${index}`,
		}));
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<PendingInputPanel
						queuedFollowUps={queuedFollowUps}
						steering={["sent steering"]}
						followUps={["sent follow-up"]}
						onEditQueuedFollowUp={() => {}}
					/>
					<CommandSuggestions
						commands={() => commands}
						selectedIndex={selectedIndex}
						onSelect={() => {}}
					/>
					<textarea
						ref={(value) => {
							editor = value;
						}}
						focused
						flexShrink={0}
						minHeight={2}
						height={2}
						placeholder="PROMPT_ANCHOR"
					/>
				</box>
			),
			80,
			14,
		);

		await setup.mockInput.typeText("PROMPT_ANCHOR");
		setSelectedIndex(6);
		await setup.flush();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		const downFrame = setup.captureCharFrame();
		const downLines = downFrame.split("\n");
		const downPromptLine = downLines.findIndex((line) =>
			line.includes("PROMPT_ANCHOR"),
		);
		const downSuggestionLines = downLines.flatMap((line, index) =>
			line.includes("/overflow-command-") ? [index] : [],
		);
		expect(editor?.plainText).toBe("PROMPT_ANCHOR");
		expect(downPromptLine).toBeGreaterThan(0);
		expect(downSuggestionLines.length).toBeGreaterThan(0);
		expect(Math.max(...downSuggestionLines)).toBeLessThan(downPromptLine);
		expect(downFrame).toContain("/overflow-command-6");
		expect(downFrame).toContain("Description 6");

		setSelectedIndex(0);
		await setup.flush();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		const upFrame = setup.captureCharFrame();
		const upLines = upFrame.split("\n");
		const upPromptLine = upLines.findIndex((line) =>
			line.includes("PROMPT_ANCHOR"),
		);
		const upSuggestionLines = upLines.flatMap((line, index) =>
			line.includes("/overflow-command-") ? [index] : [],
		);
		expect(editor?.plainText).toBe("PROMPT_ANCHOR");
		expect(upPromptLine).toBeGreaterThan(0);
		expect(upSuggestionLines.length).toBeGreaterThan(0);
		expect(Math.max(...upSuggestionLines)).toBeLessThan(upPromptLine);
		expect(upFrame).toContain("/overflow-command-0");
	});

	test("clamps highlighted command selection and accepts only unmodified Enter", () => {
		const commands = [{ name: "help" }, { name: "model" }];
		expect(selectCommandChoice(commands, -1)?.name).toBe("help");
		expect(selectCommandChoice(commands, 99)?.name).toBe("model");
		expect(selectCommandChoice([], 0)).toBeUndefined();

		const key = (
			modifiers: {
				ctrl?: boolean;
				meta?: boolean;
				shift?: boolean;
				option?: boolean;
				super?: boolean;
			} = {},
		) =>
			new KeyEvent({
				name: "enter",
				ctrl: modifiers.ctrl ?? false,
				meta: modifiers.meta ?? false,
				shift: modifiers.shift ?? false,
				option: modifiers.option ?? false,
				...(modifiers.super === undefined ? {} : { super: modifiers.super }),
				sequence: "\\r",
				number: false,
				raw: "\\r",
				eventType: "press",
				source: "raw",
			});
		expect(isUnmodifiedEnterKey(key())).toBe(true);
		expect(isUnmodifiedEnterKey(key({ shift: true }))).toBe(false);
		expect(isUnmodifiedEnterKey(key({ ctrl: true }))).toBe(false);
		expect(isUnmodifiedEnterKey(key({ option: true }))).toBe(false);
		expect(isUnmodifiedEnterKey(key({ meta: true }))).toBe(false);
		expect(isUnmodifiedEnterKey(key({ super: true }))).toBe(false);
	});

	test("derives active todos first and completed todos at the end", () => {
		const items: ConversationItem[] = [
			{
				kind: "tool",
				id: "todo-add-1",
				toolCallId: "todo-add-1",
				name: "todo",
				args: {
					action: "add",
					id: "1",
					text: "Inspect the RPC events",
					status: "in_progress",
				},
				output: "Created todo #1: Inspect the RPC events (in_progress)",
				timestamp: 1,
				status: "done",
				isError: false,
			},
			{
				kind: "tool",
				id: "todo-add-2",
				toolCallId: "todo-add-2",
				name: "todo",
				args: { action: "add", id: "2", text: "Add regression tests" },
				output: "Created todo #2: Add regression tests (pending)",
				timestamp: 2,
				status: "done",
				isError: false,
			},
			{
				kind: "tool",
				id: "todo-done-1",
				toolCallId: "todo-done-1",
				name: "todo",
				args: { action: "complete", id: "1" },
				output: "#1 -> completed",
				timestamp: 3,
				status: "done",
				isError: false,
			},
		];
		const todos = deriveTodos(items);
		expect(todos.map((todo) => todo.id)).toEqual(["2", "1"]);
		expect(todos[0]?.done).toBe(false);
		expect(todos[1]?.done).toBe(true);
	});

	test("omits deleted todos from authoritative task snapshots", () => {
		const items: ConversationItem[] = [
			{
				kind: "tool",
				id: "todo-delete-result",
				toolCallId: "todo-delete-result",
				name: "todo",
				args: { action: "delete", id: 7 },
				output: "Deleted todo #7",
				details: {
					tasks: [
						{ id: 7, subject: "Remove me", status: "deleted" },
						{ id: 8, subject: "Keep me", status: "pending" },
					],
				},
				timestamp: 1,
				status: "done",
				isError: false,
			},
		];
		expect(deriveTodos(items)).toEqual([
			{ id: "8", text: "Keep me", status: "pending", done: false },
		]);
	});

	test("removes deleted todos and preserves unchanged panel inputs", () => {
		const items: ConversationItem[] = [
			{
				kind: "tool",
				id: "todo-add",
				toolCallId: "todo-add",
				name: "todo",
				args: { action: "add", id: "1", text: "Remove me" },
				output: "Created todo #1: Remove me (pending)",
				timestamp: 1,
				status: "done",
				isError: false,
			},
			{
				kind: "tool",
				id: "todo-delete",
				toolCallId: "todo-delete",
				name: "todo",
				args: { action: "delete", id: "1" },
				output: "Deleted todo #1",
				timestamp: 2,
				status: "done",
				isError: false,
			},
		];
		expect(deriveTodos(items)).toEqual([]);

		const todo: TodoViewItem = {
			id: "2",
			text: "Keep me",
			status: "pending",
			done: false,
			activeForm: "keeping me",
		};
		const todos = [todo];
		expect(preserveEquivalentTodos(todos, [{ ...todo }])).toBe(todos);
		const changedTodos = [{ ...todo, text: "Changed" }];
		expect(preserveEquivalentTodos(todos, changedTodos)).toBe(changedTodos);
		const firstTool = items[0]!;
		const toolList = [firstTool];
		expect(preserveReferencedList(toolList, [firstTool])).toBe(toolList);
		const replacement = { ...firstTool };
		expect(preserveReferencedList(toolList, [replacement])).toBeInstanceOf(
			Array,
		);
		expect(preserveReferencedList(toolList, [replacement])).not.toBe(toolList);
	});

	test("renders a request map for jumping to previous prompts", async () => {
		const setup = await mount(
			() => (
				<PromptMapDialog
					entries={[
						{
							id: "u1",
							text: "Inspect the authentication flow",
							timestamp: 1_700_000_000_000,
						},
						{
							id: "u2",
							text: "Now add regression tests",
							timestamp: 1_700_000_060_000,
						},
					]}
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			100,
			24,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Your requests");
		expect(frame).toContain("Inspect the authentication flow");
		expect(frame).toContain("Now add regression tests");
	});
});

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
			expect(lightTool.backgroundColor.toInts().slice(0, 3)).toEqual([
				253, 246, 227,
			]);
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

describe("sidebar panel allocation", () => {
	test("allocates all panels proportionally", () => {
		expect(
			allocateSidebarPanels(100, {
				subagents: true,
				todos: true,
				notifications: true,
			}),
		).toEqual({ subagents: 50, todos: 30, notifications: 20 });
	});
	test("redistributes absent panel shares", () => {
		expect(
			allocateSidebarPanels(100, {
				subagents: false,
				todos: true,
				notifications: true,
			}),
		).toEqual({ subagents: 0, todos: 60, notifications: 40 });
		expect(
			allocateSidebarPanels(100, {
				subagents: true,
				todos: false,
				notifications: true,
			}),
		).toEqual({ subagents: 71, todos: 0, notifications: 29 });
	});
	test("keeps notifications no larger than higher-priority panels across available rows", () => {
		for (let rows = 0; rows <= 100; rows++) {
			const allocation = allocateSidebarPanels(rows, {
				subagents: true,
				todos: true,
				notifications: true,
			});
			expect(allocation.notifications).toBeLessThanOrEqual(
				allocation.subagents,
			);
			expect(allocation.notifications).toBeLessThanOrEqual(allocation.todos);
			expect(
				allocation.subagents + allocation.todos + allocation.notifications,
			).toBe(rows);
		}
	});
	test("never allocates more rows than a constrained sidebar owns", () => {
		const allocation = allocateSidebarPanels(5, {
			subagents: true,
			todos: true,
			notifications: true,
		});
		expect(allocation).toEqual({ subagents: 3, todos: 2, notifications: 0 });
	});
});

describe("duration and sidebar repaint regressions", () => {
	test("keeps native renderables bounded through 5,000 assistant updates", async () => {
		const conversation = new ConversationModel([
			{
				kind: "assistant",
				id: "live-assistant",
				text: "",
				thinking: "",
				timestamp: 1,
				status: "streaming",
			},
		]);
		const initialAssistant = conversation.items[0];
		if (!initialAssistant || initialAssistant.kind !== "assistant")
			throw new Error("stress fixture missing assistant");
		const [ids, setIds] = createSignal<string[]>(["live-assistant"]);
		const [renderedItem, setRenderedItem] =
			createSignal<ConversationItem>(initialAssistant);
		let transcriptScroll: ScrollBoxRenderable | undefined;
		const event = <T extends Record<string, unknown>>(value: T): PiEvent =>
			value;
		const Transcript = () => {
			return (
				<scrollbox
					ref={(value) => {
						transcriptScroll = value;
					}}
					width="100%"
					height="100%"
				>
					<For each={ids()}>
						{(_id) => {
							return (
								<MessageView
									item={renderedItem}
									showThinking
									thinkingExpanded
									toolExpanded={false}
								/>
							);
						}}
					</For>
				</scrollbox>
			);
		};
		const setup = await mount(() => <Transcript />, 100, 30);
		const baseline = Renderable.renderablesByNumber.size;
		let peak = baseline;
		try {
			conversation.apply(
				event({
					type: "message_start",
					message: { role: "assistant", content: [] },
				}),
			);
			for (let update = 1; update <= 5_000; update += 1) {
				const isThinking = update <= 40;
				conversation.apply(
					event({
						type: "message_update",
						message: { role: "assistant", content: [] },
						assistantMessageEvent: {
							type: isThinking ? "thinking_delta" : "text_delta",
							delta: isThinking
								? `thought ${update} `
								: update === 5_000
									? " FINAL_STREAMED_TEXT "
									: `stream ${update} `,
						},
					}),
				);
				setIds(conversation.items.map((item) => item.id));
				const currentItem = conversation.items[0];
				if (currentItem) setRenderedItem(currentItem);
				if (update % 100 === 0) {
					await Bun.sleep(0);
					await setup.flush();
					peak = Math.max(peak, Renderable.renderablesByNumber.size);
				}
			}
			conversation.apply(
				event({
					type: "message_end",
					message: { role: "assistant", content: [] },
				}),
			);
			setIds(conversation.items.map((item) => item.id));
			await Bun.sleep(0);
			await setup.flush();
			peak = Math.max(peak, Renderable.renderablesByNumber.size);
			transcriptScroll?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER });
			await setup.flush();
			expect(
				conversation.items[0]?.kind === "assistant" &&
					conversation.items[0].text,
			).toContain("FINAL_STREAMED_TEXT");
			expect(setup.captureCharFrame()).toContain("FINAL_STREAMED_TEXT");
			expect(Renderable.renderablesByNumber.size).toBeLessThanOrEqual(
				baseline + 40,
			);
			expect(peak).toBeLessThanOrEqual(baseline + 40);
		} finally {
			setup.renderer.destroy();
			const cleanupDeadline = Date.now() + 2_000;
			while (
				Renderable.renderablesByNumber.size > baseline &&
				Date.now() < cleanupDeadline
			) {
				await Bun.sleep(10);
			}
			expect(Renderable.renderablesByNumber.size).toBeLessThanOrEqual(baseline);
		}
	}, 15_000);
	test("fits a large sidebar list and Todo panel in a 253x78 pane", async () => {
		const runs: SubagentRun[] = Array.from({ length: 40 }, (_, index) => ({
			runId: `geometry-${index}`,
			asyncDir: `/tmp/geometry-${index}`,
			mode: "single",
			state: index % 3 === 0 ? "running" : "completed",
			agent: `worker-${index}`,
			steps: [],
			startedAt: index,
		}));
		const todos: TodoViewItem[] = Array.from({ length: 12 }, (_, index) => ({
			id: String(index),
			text: `Todo item ${index}`,
			status: index % 2 === 0 ? "pending" : "completed",
			done: index % 2 === 1,
		}));
		const stats = {
			sessionFile: "/tmp/session.jsonl",
			sessionId: "geometry",
			userMessages: 1,
			assistantMessages: 1,
			toolCalls: 1,
			toolResults: 1,
			totalMessages: 4,
			tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
			cost: 0,
			contextUsage: { tokens: 30, contextWindow: 400, percent: 7.5 },
		} as SessionStats;
		const [height, setHeight] = createSignal(78);
		const setup = await mount(
			() => <Sidebar runs={runs} stats={stats} todos={todos} height={height} />,
			253,
			78,
		);
		const assertBounds = (expectedHeight: number) => {
			for (const id of ["subagent-panel", "subagent-scroll", "todo-panel"]) {
				const renderable = setup.renderer.root.findDescendantById(id);
				if (!renderable)
					throw new Error(`sidebar geometry fixture missing: ${id}`);
				expect(renderable.screenY + renderable.height).toBeLessThanOrEqual(
					expectedHeight,
				);
			}
		};
		assertBounds(78);
		setup.resize(253, 60);
		setHeight(60);
		await setup.flush();
		assertBounds(60);
		setup.resize(253, 14);
		setHeight(14);
		await setup.flush();
		assertBounds(14);
		setup.resize(253, 78);
		setHeight(78);
		await setup.flush();
		assertBounds(78);
		const frame = setup.captureCharFrame();
		expect(frame.split("\n")).toHaveLength(79);
		expect(frame).toContain("worker-0");
		expect(frame).toContain("Todos");
		for (const line of frame.split("\n"))
			expect(line.length).toBeLessThanOrEqual(253);
	});

	test("shows sub-second tool durations in milliseconds", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "fast-tool",
			toolCallId: "fast-tool",
			name: "bash",
			args: { command: "true" },
			output: "done",
			timestamp: 1,
			startedAt: 1_000,
			endedAt: 1_347,
			status: "done",
			isError: false,
		};
		const setup = await mount(() => (
			<MessageView item={item} showThinking toolExpanded={false} now={2_000} />
		));
		expect(setup.captureCharFrame()).toContain("took 347ms");
	});

	test("clips and sanitizes long subagent rows without stale suffixes", async () => {
		const run: SubagentRun = {
			runId: "run-long",
			asyncDir: "/tmp/run-long",
			mode: "parallel",
			state: "failed",
			agents: [
				"impl-check-logic",
				"impl-check-types",
				"impl-check-smell",
				"impl-check-architecture",
			],
			totalTokens: 231000,
			currentTool: "\u001b[31mbash\u001b[0m",
			currentPath:
				"/a/very/long/path/that/should/not/bleed/into/the/next/row.ts",
			steps: [],
		};
		const setup = await mount(
			() => <Sidebar runs={[run]} selectedRunId="run-long" now={2_000} />,
			42,
			28,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("impl-check-logic");
		expect(frame).toContain("impl-check-logic");
		expect(frame).not.toContain("\u001b");
		expect(frame).not.toContain("should/not/bleed/into/the/next/row.ts");
	});
});
