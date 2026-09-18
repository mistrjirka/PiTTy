import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	KeyEvent,
	RGBA,
	Renderable,
	type BoxRenderable,
	type TextRenderable,
	type MarkdownRenderable,
	type ScrollBoxRenderable,
	type TextareaRenderable,
} from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { createDynamic, testRender } from "@opentui/solid";
import { For, Show, createMemo, createSignal } from "solid-js";
import {
	cleanThinkingText,
	MessageView,
	toolOutputExpandable,
} from "../src/ui/message.tsx";
import {
	CompactedSummary,
	CompactionPanel,
	compactionContextPercent,
	determinateContextBar,
	indeterminateCompactionBar,
	laneTailLines,
} from "../src/ui/compaction-panel.tsx";
import type {
	CompactionCompletion,
	CompactionTelemetry,
	OneRoundLaneTexts,
	OneRoundProgress,
} from "../src/state/compaction-telemetry.ts";
import {
	filterModelChoices,
	formatContextWindow,
	ModelSelectorDialog,
	normalizeModelChoices,
} from "../src/ui/model-selector.tsx";
import { PromptMapDialog } from "../src/ui/prompt-map.tsx";
import { MemoryBrowserDialog } from "../src/ui/memory-browser.tsx";
import type { MemorySnapshot } from "../src/integrations/memory-store.ts";
import { allocateSidebarPanels, Sidebar, targetToolActivity, targetToolUsage } from "../src/ui/sidebar.tsx";
import { friendlyTargetState } from "../src/ui/model-context.tsx";
import {
	REQUEST_TIMING_VERSION,
	type RequestTiming,
} from "../src/tabs/request-timing.ts";
import { NotificationDialog } from "../src/ui/notification-dialog.tsx";
import { SubagentInspector, inspectedTargetScrollY } from "../src/ui/subagent-inspector.tsx";
import { ForkPicker } from "../src/ui/fork-picker.tsx";
import { TabStrip } from "../src/ui/tab-strip.tsx";
import { forkPickerOptions } from "../src/tabs/entry-index.ts";
import { SubagentSelectorDialog } from "../src/ui/subagent-selector.tsx";
import { subagentTargets, type SubagentTarget } from "../src/subagents/targets.ts";
import {
	computeSpawnGroups,
	SPAWN_GROUP_ID_PREFIX,
	spawnGroupId,
	spawnGroupRowText,
	spawnGroupSummary,
	SpawnGroupCard,
} from "../src/ui/spawn-group.tsx";
import { readSubagentConversation } from "../src/subagents/transcript.ts";
import type {
	ConversationItem,
	NotificationRecord,
	RpcSessionState,
	SessionStats,
	SubagentRun,
	ToolItem,
} from "../src/types.ts";
import type { CodexUsage } from "../src/integrations/codex-usage.ts";
import type { OpencodeUsage } from "../src/integrations/opencode-usage.ts";
import type { UsageStats } from "../src/integrations/codex-usage-history.ts";
import { registerBundledParsers } from "../src/ui/parsers.ts";
import {
	CommandSuggestions,
	filterCommandChoices,
	selectCommandChoice,
} from "../src/ui/command-suggestions.tsx";
import { SessionSelector } from "../src/ui/session-selector.tsx";
import { SkillSelector, skillDisplayName } from "../src/ui/skill-selector.tsx";
import { EmptyDashboard } from "../src/ui/empty-dashboard.tsx";
import { StartupPanel } from "../src/ui/startup-panel.tsx";
import { Logo } from "../src/ui/logo.tsx";
import {
	appendNotificationHistory,
	attachTranscriptSelectionCache,
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
import { PiRpcTimeoutError } from "../src/rpc/pi-rpc-client.ts";
import type { PendingSteerEntry } from "../src/state/input-continuity.ts";
import {
	createSingleFlight,
	StartupDeadlineError,
	startupExplanation,
	startupFailureReason,
	startupHeading,
	withStartupDeadline,
} from "../src/state/startup.ts";
import type { PiEvent } from "../src/types.ts";
import {
	colors,
	createThemeController,
	effectiveTheme,
} from "../src/ui/theme.ts";

registerBundledParsers();

const active: TestRendererSetup[] = [];
const tempDirs: string[] = [];
// Isolate profiled fallback discovery: some suites render subagent targets,
// which scans runtime roots. Point it at an empty isolated base so host /tmp
// leftovers never leak into rendered rows. Literal env name keeps this file
// importing cleanly when src is stashed for a failing-before proof.
const ORIGINAL_PROFILED_ROOT = process.env.PI_PITTY_PROFILED_ROOT;
beforeEach(() => {
	const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-profiled-isolated-"));
	tempDirs.push(isolated);
	process.env.PI_PITTY_PROFILED_ROOT = isolated;
});
afterEach(() => {
	for (const setup of active.splice(0)) setup.renderer.destroy();
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	if (ORIGINAL_PROFILED_ROOT === undefined) delete process.env.PI_PITTY_PROFILED_ROOT;
	else process.env.PI_PITTY_PROFILED_ROOT = ORIGINAL_PROFILED_ROOT;
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
	test("renders truthful startup progress", async () => {
		const setup = await mount(
			() => (
				<StartupPanel
					phase={{ kind: "starting" }}
					elapsedMs={42_000}
					spinner="◐"
				/>
			),
			52,
			12,
		);
		const starting = setup.captureCharFrame();
		expect(starting).toContain("Starting Pi runtime");
		expect(starting).toContain("Large histories can take a");
		expect(starting).toContain("42s");
		expect(startupHeading({ kind: "history" })).toBe("Loading conversation");
		expect(startupExplanation({ kind: "history" })).toContain(
			"Restoring the conversation",
		);
		expect(startupHeading({ kind: "failed", reason: "timeout" })).toBe(
			"Pi startup timed out",
		);
		expect(startupExplanation({ kind: "failed", reason: "timeout" })).toContain(
			"clean up old sessions",
		);
	});

	test("bounds startup waits and joins overlapping refreshes", async () => {
		let calls = 0;
		let release: ((value: string) => void) | undefined;
		const coordinator = createSingleFlight(() => {
			calls += 1;
			if (calls > 1) return Promise.resolve("next");
			return new Promise<string>((resolve) => {
				release = resolve;
			});
		});
		const first = coordinator.run();
		const second = coordinator.run();
		expect(second).toBe(first);
		await Promise.resolve();
		expect(calls).toBe(1);
		release?.("done");
		await expect(first).resolves.toBe("done");
		await expect(coordinator.run()).resolves.toBe("next");
		expect(calls).toBe(2);

		await expect(
			withStartupDeadline(new Promise<never>(() => {}), 20),
		).rejects.toBeInstanceOf(StartupDeadlineError);
		expect(
			startupFailureReason(new PiRpcTimeoutError("get_state", 20), {
				kind: "starting",
			}),
		).toBe("timeout");
		expect(
			startupFailureReason(new Error("unexpected"), {
				kind: "failed",
				reason: "exit",
			}),
		).toBe("exit");
	});
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
		expect(modelSetup.captureCharFrame()).toContain("Turn 2s · Tool 2s");
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

	test("skill selector lists only skills, strips the prefix for display, and sends with the prefix", async () => {
		expect(skillDisplayName("skill:brave-search")).toBe("brave-search");
		expect(skillDisplayName("plain-name")).toBe("plain-name");
		const commands = [
			{
				name: "skill:brave-search",
				description: "Search the web",
				source: "skill",
				location: "user",
			},
			{
				name: "skill:deploy-app",
				description: "Deploy the app",
				source: "skill",
				location: "project",
			},
			{
				name: "review-pr",
				description: "Extension command",
				source: "extension",
			},
			{
				name: "weekly-report",
				description: "Prompt-template command",
				source: "template",
			},
		];
		const sent: string[] = [];
		let cancelled = 0;
		const setup = await mount(() => (
			<SkillSelector
				commands={commands}
				onSelect={(invocation) => {
					sent.push(invocation);
				}}
				onCancel={() => {
					cancelled += 1;
				}}
			/>
		));
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("brave-search");
		expect(frame).toContain("deploy-app");
		expect(frame).toContain("Search the web · user");
		expect(frame).toContain("Deploy the app · project");
		expect(frame).toContain("2 of 2");
		expect(frame).not.toContain("skill:");
		expect(frame).not.toContain("review-pr");
		expect(frame).not.toContain("weekly-report");
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(sent).toEqual(["/skill:brave-search"]);
		expect(cancelled).toBe(0);
	});

	test("skill selector filters by query and shows the no-match state", async () => {
		const commands = [
			{
				name: "skill:brave-search",
				description: "Search the web",
				source: "skill",
				location: "user",
			},
			{
				name: "skill:deploy-app",
				description: "Deploy the app",
				source: "skill",
				location: "project",
			},
		];
		const setup = await mount(() => (
			<SkillSelector commands={commands} onSelect={() => {}} onCancel={() => {}} />
		));
		await setup.mockInput.typeText("deploy");
		await setup.flush();
		const filtered = setup.captureCharFrame();
		expect(filtered).toContain("deploy-app");
		expect(filtered).not.toContain("brave-search");
		expect(filtered).toContain("1 of 2");
		await setup.mockInput.typeText("zzz");
		await setup.flush();
		expect(setup.captureCharFrame()).toContain("No skills match");
	});

	test("skill selector sends the highlighted entry on enter", async () => {
		const commands = [
			{ name: "skill:alpha", description: "Alpha skill", source: "skill" },
			{ name: "skill:beta", description: "Beta skill", source: "skill" },
			{ name: "skill:gamma", description: "Gamma skill", source: "skill" },
		];
		const sent: string[] = [];
		const setup = await mount(() => (
			<SkillSelector
				commands={commands}
				onSelect={(invocation) => {
					sent.push(invocation);
				}}
				onCancel={() => {}}
			/>
		));
		await setup.flush();
		setup.mockInput.pressArrow("down");
		await setup.flush();
		setup.mockInput.pressArrow("down");
		await setup.flush();
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(sent).toEqual(["/skill:beta"]);
	});

	test("skill selector shows the empty state when Pi reports zero skills", async () => {
		const setup = await mount(() => (
			<SkillSelector
				commands={[
					{ name: "review-pr", description: "Extension command", source: "extension" },
				]}
				onSelect={() => {}}
				onCancel={() => {}}
			/>
		));
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("No skills reported by Pi.");
		expect(frame).not.toContain("review-pr");
	});

	test("skill selector escape closes without sending", async () => {
		const sent: string[] = [];
		let cancelled = 0;
		const setup = await mount(() => (
			<SkillSelector
				commands={[
					{
						name: "skill:brave-search",
						description: "Search the web",
						source: "skill",
						location: "user",
					},
				]}
				onSelect={(invocation) => {
					sent.push(invocation);
				}}
				onCancel={() => {
					cancelled += 1;
				}}
			/>
		));
		await setup.flush();
		setup.mockInput.pressEscape();
		await Bun.sleep(30);
		await setup.flush();
		expect(cancelled).toBe(1);
		expect(sent).toEqual([]);
	});

	test("model selector arrows move one row from the highlighted model", async () => {
		const models = [
			{ provider: "openai", id: "alpha", name: "Alpha" },
			{ provider: "openai", id: "beta", name: "Beta" },
			{ provider: "openai", id: "gamma", name: "Gamma" },
			{ provider: "openai", id: "delta", name: "Delta" },
		];
		let selectedModel: string | undefined;
		const setup = await mount(() => (
			<ModelSelectorDialog
				models={models}
				currentProvider="openai"
				currentModelId="gamma"
				onSelect={(model) => {
					selectedModel = model.id;
				}}
				onCancel={() => {}}
			/>
		));
		await setup.flush();
		const selectedLine = (frame: string, id: string) =>
			frame.split("\n").find((line) => line.includes(`openai/${id}`));
		expect(selectedLine(setup.captureCharFrame(), "gamma") ?? "").toContain("▶");
		setup.mockInput.pressArrow("down");
		await setup.flush();
		const afterDown = setup.captureCharFrame();
		expect(selectedLine(afterDown, "delta") ?? "").toContain("▶");
		expect(selectedLine(afterDown, "gamma") ?? "").not.toContain("▶");
		setup.mockInput.pressArrow("up");
		setup.mockInput.pressArrow("up");
		await setup.flush();
		const afterUp = setup.captureCharFrame();
		expect(selectedLine(afterUp, "beta") ?? "").toContain("▶");
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(selectedModel).toBe("beta");
	});

	test("model selector enter selects the highlighted model from the search box", async () => {
		const models = [
			{ provider: "openai", id: "alpha", name: "Alpha" },
			{ provider: "openai", id: "beta", name: "Beta" },
			{ provider: "openai", id: "gamma", name: "Gamma" },
		];
		let selectedModel: string | undefined;
		const setup = await mount(() => (
			<ModelSelectorDialog
				models={models}
				currentProvider="openai"
				currentModelId="gamma"
				onSelect={(model) => {
					selectedModel = model.id;
				}}
				onCancel={() => {}}
			/>
		));
		await setup.flush();
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(selectedModel).toBe("gamma");
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

	test("renders fenced code with default Markdown rendering when copy is absent", async () => {
		const assistant: ConversationItem = {
			kind: "assistant",
			id: "markdown-code",
			text: "```ts\nconst x = 1;\n```",
			thinking: "",
			timestamp: 1,
			status: "done",
		};
		const setup = await mount(() => (
			<MessageView item={assistant} showThinking toolExpanded={false} />
		));
		expect(setup.captureCharFrame()).toContain("const x = 1;");
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

	test("inspectedTargetScrollY opens finished runs at the top and keeps live runs at the tail", () => {
		expect(inspectedTargetScrollY({ active: true })).toBe(Number.MAX_SAFE_INTEGER);
		expect(inspectedTargetScrollY({ active: false })).toBe(0);
		expect(inspectedTargetScrollY(undefined)).toBe(0);
	});

	test("a finished inspector transcript shows the first thinking at the top and the tail at the bottom", async () => {
		const items: ConversationItem[] = [
			{ kind: "user", id: "scroll-user", text: "task", timestamp: 1, optimistic: false },
			{ kind: "assistant", id: "scroll-first", text: "", thinking: "FIRST thinking section", timestamp: 2, status: "done" },
			...Array.from({ length: 6 }, (_, index): ConversationItem => ({
				kind: "tool",
				id: `scroll-tool-${index}`,
				toolCallId: `scroll-call-${index}`,
				name: "bash",
				args: "ls",
				output: `output ${index}`,
				timestamp: 3 + index,
				startedAt: 3 + index,
				endedAt: 3 + index,
				status: "done",
				isError: false,
			})),
			{ kind: "assistant", id: "scroll-second", text: "", thinking: "SECOND thinking section", timestamp: 20, status: "done" },
		];
		const run: SubagentRun = { runId: "scroll-run", mode: "single", state: "completed", steps: [] };
		let scroll: ScrollBoxRenderable | undefined;
		const setup = await mount(
			() => (
				<SubagentInspector
					run={run}
					items={items}
					now={1_000}
					scrollRef={(value) => {
						scroll = value;
					}}
					thinkingExpanded={() => true}
					toolExpanded={() => false}
					diffExpanded={() => false}
				/>
			),
			100,
			18,
		);
		if (!scroll) throw new Error("inspector transcript scrollbox missing");
		// Finished runs open at the top: the first thinking section is on screen.
		scroll.scrollTo(inspectedTargetScrollY({ active: false }));
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		const top = setup.captureCharFrame();
		expect(top).toContain("FIRST thinking section");
		// Live runs keep the tail: the last thinking is on screen instead.
		scroll.scrollTo(inspectedTargetScrollY({ active: true }));
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		const bottom = setup.captureCharFrame();
		expect(bottom).toContain("SECOND thinking section");
		expect(bottom).not.toContain("FIRST thinking section");
	});

	test("inspector mounts at the top for finished runs and at the tail for live runs", async () => {
		// No explicit scrollTo: this guards the mount position itself, which the
		// app's queued scrollTo races and loses on first open (the transcript
		// box pins to stickyStart="bottom" by default).
		const tallItems = (first: string, last: string): ConversationItem[] => [
			{ kind: "assistant", id: `mount-first`, text: "", thinking: first, timestamp: 2, status: "done" },
			...Array.from({ length: 12 }, (_, index): ConversationItem => ({
				kind: "tool",
				id: `mount-tool-${index}`,
				toolCallId: `mount-call-${index}`,
				name: "bash",
				args: "ls",
				output: `output ${index}`,
				timestamp: 3 + index,
				startedAt: 3 + index,
				endedAt: 3 + index,
				status: "done",
				isError: false,
			})),
			{ kind: "assistant", id: `mount-last`, text: "", thinking: last, timestamp: 99, status: "done" },
		];
		const finishedRun: SubagentRun = { runId: "mount-finished", mode: "single", state: "completed", steps: [] };
		const finishedTarget = subagentTargets([finishedRun])[0]!;
		expect(finishedTarget.active).toBe(false);
		const finishedView = await mount(
			() => (
				<SubagentInspector
					target={finishedTarget}
					items={tallItems("MOUNT-FIRST", "MOUNT-LAST")}
					now={1_000}
					thinkingExpanded={() => true}
					toolExpanded={() => false}
					diffExpanded={() => false}
				/>
			),
			100,
			18,
		);
		const finishedFrame = finishedView.captureCharFrame();
		expect(finishedFrame).toContain("MOUNT-FIRST");
		expect(finishedFrame).not.toContain("MOUNT-LAST");
		// A genuinely live target (fresh profiled heartbeat behind a spawn
		// tool, as the app holds it) keeps the tail so the stream is followed.
		const now = Date.now();
		const base = process.env.PI_PITTY_PROFILED_ROOT?.trim() || os.tmpdir();
		const root = fs.mkdtempSync(path.join(base, "pi-profiled-subagents-mount-"));
		tempDirs.push(root);
		const treeId = `tree-mount-${Date.now()}`;
		const controlDir = path.join(root, "mount-live-");
		fs.mkdirSync(path.join(controlDir, "control", "steer-requests"), { recursive: true });
		fs.mkdirSync(path.join(controlDir, "control", "acks"), { recursive: true });
		const statusPath = path.join(controlDir, "status.json");
		fs.writeFileSync(statusPath, JSON.stringify({
			version: 1, runtime: "profiled-subagents", treeId, updatedAt: now,
			agentId: "mount-liver", profile: "explore", parentAgentId: "root", label: "mount-liver",
			state: "running", startedAt: now - 1000,
		}));
		const liveTool: ToolItem = {
			kind: "tool", id: "spawn-mount-liver", toolCallId: "spawn-mount-liver-call", name: "agent_spawn",
			args: { agent: "explore" }, output: "", details: {
				runtime: "profiled-subagents", treeId, parentAgentId: "root", agentId: "mount-liver", profile: "explore",
				label: "mount-liver", state: "running", controlDir, statusPath,
			}, timestamp: now, status: "done", isError: false,
		};
		const liveTarget = subagentTargets([], [liveTool]).find((target) => target.run.agentId === "mount-liver")!;
		expect(liveTarget.active).toBe(true);
		const liveView = await mount(
			() => (
				<SubagentInspector
					target={liveTarget}
					items={tallItems("MOUNT-LIVE-FIRST", "MOUNT-LIVE-LAST")}
					now={now}
					thinkingExpanded={() => true}
					toolExpanded={() => false}
					diffExpanded={() => false}
				/>
			),
			100,
			18,
		);
		const liveFrame = liveView.captureCharFrame();
		expect(liveFrame).toContain("MOUNT-LIVE-LAST");
		expect(liveFrame).not.toContain("MOUNT-LIVE-FIRST");
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
		expect(toolOutputExpandable("one\ntwo\nthree\nfour\nfive")).toBe(false);
		expect(toolOutputExpandable(Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n"))).toBe(true);
		expect(toolOutputExpandable("x".repeat(200))).toBe(true);
		expect(toolOutputExpandable(`${"alpha ".repeat(30)}\nshort`)).toBe(true);
		expect(toolOutputExpandable("x".repeat(321))).toBe(true);
	});

	test("renders truthful compaction activity and context-size gauges", async () => {
		expect(compactionContextPercent({ version: 1, phase: "preparing", tokensBefore: 150_000, contextWindow: 200_000 })).toBe(75);
		expect(determinateContextBar(50, 8)).toBe("████░░░░");
		expect(indeterminateCompactionBar(2, 8)).toHaveLength(8);
		const setup = await mount(
			() => (
				<CompactionPanel
					telemetry={{
						version: 1,
						phase: "preparing",
						reason: "threshold",
						tokensBefore: 150_000,
						contextWindow: 200_000,
						summarizingContextMessages: 186,
						plannedRetainedContextMessages: 23,
						startedAt: 1_000,
					}}
					now={13_000}
					spinner="◐"
					frame={2}
					smartCompactProgress="Smart Compact 1/5 · Extract"
				/>
			),
			100,
			8,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Compacting · threshold · 12s elapsed");
		expect(frame).toContain("Activity [");
		expect(frame).toContain("indeterminate");
		expect(frame).toContain("Smart Compact 1/5 · Extract");
		expect(frame).toContain("Context size [");
		expect(frame).toContain("150K / 200K · 75% full");
		expect(frame).toContain("Plan: summarize 186 context messages");
		expect(frame).toContain("keep 23 recent context messages");
	});
	test("renders live one-round lane text as tail windows", async () => {
		expect(laneTailLines("")).toEqual([]);
		expect(laneTailLines("one\ntwo\nthree\n")).toEqual(["one", "two", "three"]);
		// The streamed window shows the newest 6 rows by default: an ellipsis row
		// plus the newest 5 lines, so live text stays readable without overflowing.
		expect(laneTailLines("l1\nl2\nl3\nl4\nl5")).toEqual(["l1", "l2", "l3", "l4", "l5"]);
		expect(laneTailLines("l1\nl2\nl3\nl4\nl5", 3)).toEqual(["…", "l4", "l5"]);
		expect(laneTailLines(Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join("\n"))).toEqual([
			"…",
			...Array.from({ length: 5 }, (_, i) => `line ${i + 10}`),
		]);
		expect(laneTailLines(Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join("\n"), 12)).toEqual([
			"…",
			...Array.from({ length: 11 }, (_, i) => `line ${i + 4}`),
		]);
		const [expanded, setExpanded] = createSignal(false);
		const setup = await mount(
			() => (
				<CompactionPanel
					telemetry={{ version: 1, phase: "preparing", reason: "manual", startedAt: 1_000 }}
					now={4_000}
					spinner="◐"
					frame={1}
					oneRoundProgress={{
						v: 2,
						runId: "run-1",
						seq: 3,
						phase: "streaming",
						reason: "manual",
						elapsedMs: 3000,
						retainedTurns: 2,
						estimatedRetainedTokens: 30_000,
						keepRecentTokens: 32_000,
						targetPostCompactTokens: 40_000,
						effectiveRecentTokenBudget: 30_250,
						boundaryMode: "whole-turn",
						lanes: {
							audit: { role: "audit", state: "streaming", chars: 900, elapsedMs: 2500 },
							execution: { role: "execution", state: "queued", chars: 0 },
						},
					}}
					laneTexts={{
						runId: "run-1",
						intent: "",
						audit:
							"line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten",
						execution: "",
					}}
					expanded={expanded}
					onToggle={() => setExpanded((value) => !value)}
				/>
			),
			100,
			30,
		);
		let frame = setup.captureCharFrame();
		expect(frame).toContain("◐ audit · streaming · 900 chars");
		expect(frame).toContain("line nine");
		expect(frame).toContain("line ten");
		expect(frame).not.toContain("line one");
		expect(frame).toContain("execution · queued · 0 chars");
		expect(frame).toContain("expand");
		const toggle = setup.renderer.root.findDescendantById("compaction-panel-toggle") as TextRenderable | undefined;
		expect(toggle).toBeDefined();
		if (!toggle) throw new Error("compaction panel toggle missing");
		await setup.mockMouse.click(toggle.x, toggle.y);
		await setup.flush();
		expect(expanded()).toBe(true);
		frame = setup.captureCharFrame();
		expect(frame).toContain("collapse");
		expect(frame).toContain("line one");
	});

	test("bounds live one-round lane text to fixed terminal rows at narrow width", async () => {
		// A long wrapping logical line must not monopolize the fixed 6-row lane
		// window: the tail (newest streamed lines) has to stay visible, and the
		// fixed rows below the lane must stay at their bounded locations.
		const audit = `${"x".repeat(200)}\nmid line\nCLOSING_MARKER_ZETA`;
		const setup = await mount(
			() => (
				<box flexDirection="column" width="100%" height="100%">
					<CompactionPanel
						telemetry={{ version: 1, phase: "preparing", reason: "manual", startedAt: 1_000 }}
						now={4_000}
						spinner="◐"
						frame={1}
						oneRoundProgress={{
							v: 2,
							runId: "run-1",
							seq: 3,
							phase: "streaming",
							reason: "manual",
							elapsedMs: 3000,
							retainedTurns: 2,
							estimatedRetainedTokens: 30_000,
							keepRecentTokens: 32_000,
							targetPostCompactTokens: 40_000,
							effectiveRecentTokenBudget: 30_250,
							boundaryMode: "whole-turn",
							lanes: {
								audit: { role: "audit", state: "streaming", chars: 900, elapsedMs: 2500 },
								execution: { role: "execution", state: "queued", chars: 0 },
							},
						}}
						laneTexts={{ runId: "run-1", intent: "", audit, execution: "" }}
					/>
					<text>MARKER_AFTER_PANEL</text>
				</box>
			),
			40,
			30,
		);
		const frame = setup.captureCharFrame();
		const lines = frame.split("\n");
		const executionRow = lines.findIndex((line) => line.includes("execution · queued"));
		const markerRow = lines.findIndex((line) => line.includes("MARKER_AFTER_PANEL"));
		// Collapsed lane window: header(1) + audit lane(1) + 6 lane rows, so the
		// execution lane must stay on row 8 and never be pushed down by wrapping.
		expect(executionRow).toBe(8);
		expect(markerRow).toBeGreaterThanOrEqual(0);
		expect(markerRow).toBeLessThanOrEqual(13);
		expect(frame).toContain("MARKER_AFTER_PANEL");
		// The lane is a tail window: the newest streamed lines must win the fixed
		// terminal rows instead of being crowded out by one wrapping head line.
		expect(frame).toContain("CLOSING_MARKER_ZETA");
		expect(frame).toContain("mid line");
	});

	test("updates the mounted compaction panel when live progress arrives", async () => {
		const [revision, setRevision] = createSignal(0);
		const runtime: {
			telemetry: CompactionTelemetry | undefined;
			smartCompactProgress: string | undefined;
			oneRoundProgress: OneRoundProgress | undefined;
			laneTexts: OneRoundLaneTexts | undefined;
		} = {
			telemetry: { version: 1, phase: "preparing", reason: "manual", startedAt: 1_000 },
			smartCompactProgress: undefined,
			oneRoundProgress: undefined,
			laneTexts: undefined,
		};
		const compactionView = createMemo(() => {
			revision();
			return {
				telemetry: runtime.telemetry,
				smartCompactProgress: runtime.smartCompactProgress,
				oneRoundProgress: runtime.oneRoundProgress,
				laneTexts: runtime.laneTexts,
			};
		});
		const publish = () => setRevision((value) => value + 1);
		const progress: OneRoundProgress = {
			v: 2,
			runId: "run-1",
			seq: 1,
			phase: "streaming",
			reason: "manual",
			elapsedMs: 500,
			retainedTurns: 1,
			estimatedRetainedTokens: 10_000,
			keepRecentTokens: 12_000,
			targetPostCompactTokens: 40_000,
			effectiveRecentTokenBudget: 30_250,
			boundaryMode: "whole-turn",
			lanes: {
				audit: { role: "audit", state: "streaming", chars: 10 },
				execution: { role: "execution", state: "queued", chars: 0 },
			},
		};
		const setup = await mount(
			() => (
				<Show when={compactionView().telemetry?.phase === "preparing"}>
					<CompactionPanel
						telemetry={compactionView().telemetry!}
						now={2_000}
						spinner="◐"
						frame={1}
						smartCompactProgress={compactionView().smartCompactProgress}
						oneRoundProgress={compactionView().oneRoundProgress}
						laneTexts={compactionView().laneTexts}
					/>
				</Show>
			),
			100,
			10,
		);
		let frame = setup.captureCharFrame();
		expect(frame).toContain("Activity [");
		runtime.oneRoundProgress = progress;
		publish();
		await setup.flush();
		frame = setup.captureCharFrame();
		expect(frame).toContain("audit · streaming · 10 chars");
		expect(frame).not.toContain("Activity [");
		runtime.telemetry = undefined;
		runtime.oneRoundProgress = undefined;
		publish();
		await setup.flush();
		expect(setup.captureCharFrame()).not.toContain("Compacting");
	});

	test("renders the compacted summary collapsed and expanded with the markdown summary", async () => {
		const completion: CompactionCompletion = {
			tokensBefore: 152_000,
			estimatedTokensAfter: 32_000,
			reason: "threshold",
			durationMs: 2_300,
			retainedContextMessages: 41,
			summary: "The agent verified the release workflow and fixed one portability edge case.",
		};

		const collapsed = await mount(
			() => <CompactedSummary completion={completion} expanded={createSignal(false)[0]} onToggle={() => {}} />,
			100,
			10,
		);
		let frame = collapsed.captureCharFrame();
		expect(frame).toContain("── Compacted");
		expect(frame).toContain("152K → ~32K · threshold · 2.3s · kept 41 messages");
		expect(frame).toContain("▶ Show compaction summary");
		expect(frame).not.toContain("The agent verified");

		const expandedSetup = await mount(
			() => <CompactedSummary completion={completion} expanded={createSignal(true)[0]} onToggle={() => {}} />,
			100,
			10,
		);
		frame = expandedSetup.captureCharFrame();
		expect(frame).toContain("▼ Hide compaction summary");
		expect(frame).toContain("The agent verified the release workflow");

		// The toggle routes mouse-down to the parent's handler.
		const [expanded, setExpanded] = createSignal(false);
		const wired = await mount(
			() => (
				<CompactedSummary
					completion={completion}
					expanded={expanded}
					onToggle={() => setExpanded((value) => !value)}
				/>
			),
			100,
			10,
		);
		const toggle = wired.renderer.root.findDescendantById(
			"compacted-summary-toggle",
		) as TextRenderable | undefined;
		expect(toggle).toBeDefined();
		if (!toggle) throw new Error("compacted summary toggle missing");
		await wired.mockMouse.click(toggle.x, toggle.y);
		await wired.flush();
		expect(expanded()).toBe(true);
	});

	test("keeps wheel scrolling transcript-first until output scrolling is explicit", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "scroll-owner-tool",
			toolCallId: "scroll-owner-tool",
			name: "bash",
			args: {},
			output: Array.from({ length: 40 }, (_, index) => `OUTPUT_ROW_${index + 1}`).join("\n"),
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const [expanded, setExpanded] = createSignal(true);
		let transcript!: ScrollBoxRenderable;
		const setup = await mount(
			() => (
				<scrollbox
					id="scroll-owner-transcript"
					ref={(value) => {
						transcript = value;
					}}
					height={12}
					scrollY
					scrollX={false}
				>
					<MessageView
						item={item}
						showThinking
						toolExpanded={expanded}
						onToggleTool={() => setExpanded((value) => !value)}
					/>
				</scrollbox>
			),
			90,
			16,
		);
		let frame = setup.captureCharFrame();
		expect(frame).toContain("scroll output · collapse");
		const initiallyHiddenInner = setup.renderer.root.findDescendantById(
			"scroll-owner-tool-output-scroll",
		) as ScrollBoxRenderable | undefined;
		expect(initiallyHiddenInner).toBeDefined();
		expect(initiallyHiddenInner?.visible).toBe(false);
		const previewRow = frame
			.split("\n")
			.findIndex((line) => line.includes("OUTPUT_ROW_2"));
		expect(previewRow).toBeGreaterThanOrEqual(0);
		await setup.mockMouse.scroll(4, previewRow, "down");
		await setup.flush();
		expect(transcript.scrollTop).toBeGreaterThan(0);

		transcript.scrollTo(0);
		await setup.flush();
		frame = setup.captureCharFrame();
		const outputScrollToggle = setup.renderer.root.findDescendantById(
			"scroll-owner-tool-output-scroll-toggle",
		) as Renderable | undefined;
		expect(outputScrollToggle).toBeDefined();
		if (!outputScrollToggle) throw new Error("output scroll toggle missing");
		await setup.mockMouse.click(outputScrollToggle.x, outputScrollToggle.y);
		await setup.flush();
		const inner = setup.renderer.root.findDescendantById(
			"scroll-owner-tool-output-scroll",
		) as ScrollBoxRenderable | undefined;
		expect(inner).toBeDefined();
		if (!inner) throw new Error("inner output scrollbox missing");
		frame = setup.captureCharFrame();
		expect(frame).toContain("chat scroll · collapse");
		inner.scrollTo(10);
		await setup.flush();
		const innerBefore = inner.scrollTop;
		await setup.mockMouse.scroll(4, inner.y + 1, "up");
		await setup.flush();
		expect(inner.scrollTop).toBeLessThan(innerBefore);
		expect(transcript.scrollTop).toBe(0);

		frame = setup.captureCharFrame();
		const toolToggle = setup.renderer.root.findDescendantById(
			"scroll-owner-tool-tool-toggle",
		) as Renderable | undefined;
		expect(toolToggle).toBeDefined();
		if (!toolToggle) throw new Error("tool collapse toggle missing");
		await setup.mockMouse.click(toolToggle.x, toolToggle.y);
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 4, maxFrames: 300 });
		expect(expanded()).toBe(false);
		expect(setup.captureCharFrame()).toContain("expand");
		expect(inner.visible).toBe(false);
	});

	test("keeps wrapped transcript diff rows intrinsic and sequential", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "wrapped-diff-rows",
			toolCallId: "wrapped-diff-rows",
			name: "edit",
			args: {},
			output: "Applied edit",
			diff: "@@ -1,4 +1,4 @@\n context marker remains stable\n-this ordinary prose line contains enough words to wrap at this width and keep testing sequential rendering without overlap\n+that ordinary prose line contains enough words to wrap at this width and keep testing sequential rendering without overlap",
			diffPath: "src/example.ts",
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const setup = await mount(
			() => (
				<MessageView
					item={item}
					showThinking
					toolExpanded={false}
					diffExpanded
				/>
			),
			40,
			30,
		);
		const diffPreview = setup.renderer.root.findDescendantById("wrapped-diff-rows-diff-preview") as BoxRenderable | undefined;
		expect(diffPreview).toBeDefined();
		if (!diffPreview) throw new Error("diff preview missing");
		const rows = diffPreview.getChildren() as TextRenderable[];
		expect(rows.length).toBe(4);
		expect(rows.filter((row) => row.height > 1).length).toBeGreaterThanOrEqual(2);
		for (const [index, row] of rows.entries()) {
			expect(row.height).toBe(row.virtualLineCount);
			if (index > 0) {
				const previousRow = rows[index - 1];
				if (!previousRow) throw new Error("previous diff row missing");
				expect(row.y).toBeGreaterThanOrEqual(previousRow.y + previousRow.height);
			}
		}
	});
	test("keeps diff path and resets explicit diff scroll ownership on collapse", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "scroll-owner-diff",
			toolCallId: "scroll-owner-diff",
			name: "edit",
			args: {},
			output: "Applied edit",
			diff: Array.from({ length: 30 }, (_, index) => `${index % 2 ? "+" : "-"}DIFF_ROW_${index + 1}`).join("\n"),
			diffPath: "src/example.ts",
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const [diffExpanded, setDiffExpanded] = createSignal(true);
		const setup = await mount(
			() => (
				<MessageView
					item={item}
					showThinking
					toolExpanded={false}
					diffExpanded={diffExpanded}
					onToggleDiff={() => setDiffExpanded((value) => !value)}
				/>
			),
			100,
			30,
		);
		const diffPreview = setup.renderer.root.findDescendantById(
			"scroll-owner-diff-diff-preview",
		) as BoxRenderable | undefined;
		expect(diffPreview).toBeDefined();
		expect(diffPreview?.height).toBe(22);
		let frame = setup.captureCharFrame();
		expect(frame).toContain("src/example.ts");
		expect(frame).toContain("scroll diff · collapse");
		const diffScrollToggle = setup.renderer.root.findDescendantById(
			"scroll-owner-diff-diff-scroll-toggle",
		) as Renderable | undefined;
		expect(diffScrollToggle).toBeDefined();
		if (!diffScrollToggle) throw new Error("diff scroll toggle missing");
		await setup.mockMouse.click(diffScrollToggle.x, diffScrollToggle.y);
		await setup.flush();
		const diffInner = setup.renderer.root.findDescendantById(
			"scroll-owner-diff-diff-scroll",
		) as ScrollBoxRenderable | undefined;
		expect(diffInner).toBeDefined();
		if (!diffInner) throw new Error("diff scrollbox missing");
		expect(diffInner.visible).toBe(true);
		frame = setup.captureCharFrame();
		const diffToggle = setup.renderer.root.findDescendantById(
			"scroll-owner-diff-diff-toggle",
		) as Renderable | undefined;
		expect(diffToggle).toBeDefined();
		if (!diffToggle) throw new Error("diff collapse toggle missing");
		await setup.mockMouse.click(diffToggle.x, diffToggle.y);
		await setup.flush();
		expect(diffExpanded()).toBe(false);
		expect(setup.captureCharFrame()).toContain("view diff");
		setDiffExpanded(true);
		await setup.flush();
		expect(diffInner.visible).toBe(false);
		expect(setup.captureCharFrame()).toContain("scroll diff · collapse");

		const diffHeader = setup.renderer.root.findDescendantById(
			"scroll-owner-diff-diff-header",
		) as Renderable | undefined;
		expect(diffHeader).toBeDefined();
		if (!diffHeader) throw new Error("diff header missing");
		await setup.mockMouse.click(diffHeader.x, diffHeader.y);
		await setup.flush();
		expect(diffExpanded()).toBe(false);
		await setup.mockMouse.click(diffHeader.x, diffHeader.y);
		await setup.flush();
		expect(diffExpanded()).toBe(true);
	});

	test("keeps diff actions visible when the path is long", async () => {
		const longPath =
			"/home/jirka/.local/share/pi-work/projects/pitty/intents/a-very-long-workstream-name/src/example.ts";
		const item: ConversationItem = {
			kind: "tool",
			id: "long-diff-path",
			toolCallId: "long-diff-path",
			name: "edit",
			args: {},
			output: "Applied edit",
			diff: "-old\n+new",
			diffPath: longPath,
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const setup = await mount(
			() => (
				<MessageView
					item={item}
					showThinking
					toolExpanded={false}
					diffExpanded
				/>
			),
			80,
			16,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("scroll diff");
		expect(frame).toContain("collapse");
		expect(frame).not.toContain(longPath);
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

	test("completed profiled tools render one row with a Changes section", async () => {
		// The live event stream carries no diff; the session file's toolResult
		// `details` is authoritative (same derivation as `initialItems`). The
		// stream twin of an already-rendered session tool is skipped, so the
		// call renders once — with its Changes section intact.
		const now = Date.now();
		const base = process.env.PI_PITTY_PROFILED_ROOT?.trim() || os.tmpdir();
		const root = fs.mkdtempSync(path.join(base, "pi-profiled-subagents-stream-diff-"));
		tempDirs.push(root);
		const treeId = `tree-stream-diff-${Date.now()}`;
		const controlDir = path.join(root, "stream-diff-live");
		fs.mkdirSync(path.join(controlDir, "control", "steer-requests"), { recursive: true });
		fs.mkdirSync(path.join(controlDir, "control", "acks"), { recursive: true });
		const sessionFile = path.join(root, "stream-diff-session.jsonl");
		fs.writeFileSync(
			sessionFile,
			[
				JSON.stringify({
					message: {
						role: "assistant",
						content: [{ type: "toolCall", id: "call-edit-1", name: "edit", arguments: { path: "x" } }],
						timestamp: now - 500,
					},
				}),
				JSON.stringify({
					message: {
						role: "toolResult",
						toolCallId: "call-edit-1",
						toolName: "edit",
						content: "Applied edit",
						details: {
							diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n",
							path: "x",
						},
						timestamp: now - 400,
					},
				}),
				].join("\n") + "\n",
		);
		const statusPath = path.join(controlDir, "status.json");
		fs.writeFileSync(statusPath, JSON.stringify({
			version: 1, runtime: "profiled-subagents", treeId, updatedAt: now,
			agentId: "stream-differ", profile: "explore", parentAgentId: "root", label: "stream-differ",
			state: "running", startedAt: now - 1000, sessionPath: sessionFile,
		}));
		let seq = 0;
		const event = (line: Record<string, unknown>) =>
			JSON.stringify({ v: 1, seq: seq++, ts: now, runId: "stream-differ", ...line });
		fs.writeFileSync(
			path.join(controlDir, "events.jsonl"),
			[
				event({ kind: "tool_start", toolName: "edit", toolCallId: "call-edit-1" }),
				event({ kind: "tool_end", toolName: "edit", toolCallId: "call-edit-1" }),
			].join("\n") + "\n",
		);
		const tool: ToolItem = {
			kind: "tool", id: "spawn-stream-diff", toolCallId: "spawn-stream-diff-call", name: "agent_spawn",
			args: { agent: "explore" }, output: "", details: {
				runtime: "profiled-subagents", treeId, parentAgentId: "root", agentId: "stream-differ", profile: "explore",
				label: "stream-differ", state: "running", controlDir, statusPath,
			}, timestamp: now, status: "done", isError: false,
		};
		const target = subagentTargets([], [tool]).find((entry) => entry.run.agentId === "stream-differ")!;
		expect(target.active).toBe(true);
		// Exactly one row per call: no stream twin alongside the session row.
		const callTools = readSubagentConversation(target.run).filter(
			(item): item is ToolItem => item.kind === "tool" && item.toolCallId === "call-edit-1",
		);
		expect(callTools).toHaveLength(1);
		const streamTool = callTools[0]!;
		expect(streamTool.diff ?? "").toContain("-old");
		expect(streamTool.diffPath).toBe("x");
		const setup = await mount(() => (
			<MessageView item={streamTool} showThinking toolExpanded={false} diffExpanded={false} />
		));
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Changes");
		expect(frame).toContain("+1");
		expect(frame).toContain("-1");
	});

	test("idle residents show tool counts but no stale context usage", async () => {
		const resident: SubagentTarget = {
			key: "profiled:resident-idle",
			run: {
				runId: "profiled:resident-idle", control: "profiled", runtime: "profiled-subagents",
				mode: "profiled", state: "idle", steps: [], agentId: "ron", profile: "explore",
				label: "resident", toolCount: 3, tokens: { window: 168187 }, contextWindow: 1048576,
			},
			label: "@ron · explore",
			state: "idle",
			active: true,
			canSteer: true,
			startedAt: Date.now() - 1000,
			lastUpdate: Date.now(),
		};
		// Row choke point: tools stay, the stale K/M window drops.
		expect(targetToolUsage(resident)).toBe("3 tools");
		const row = spawnGroupRowText(resident, Date.now());
		expect(row).toContain("3 tools");
		expect(row).not.toContain("/");
		// Inspector header: the inline Context field drops, Model stays.
		const setup = await mount(() => (
			<SubagentInspector
				target={{ ...resident, model: "provider/model", thinking: "medium" }}
				items={[]}
				now={Date.now()}
				thinkingExpanded={() => true}
				toolExpanded={() => false}
				diffExpanded={() => false}
			/>
		));
		const frame = setup.captureCharFrame();
		expect(frame).not.toContain("Context");
		expect(frame).toContain("provider/model");
	});

	test("renders profiled notifications as bounded identity cards", async () => {
		const result = `${"visible-result\n".repeat(20)}UNIQUE_TAIL`;
		const setup = await mount(
			() => (
				<MessageView
					item={{
						kind: "custom", id: "profiled-notification", customType: "subagent-notification",
						text: JSON.stringify({ agent_id: "jett", status: "completed", result }), timestamp: 1,
						details: { label: "@jett — bounded task", model: "provider/model", thinking: "high", usage: { tokens: 42, toolUses: 3, durationMs: 1200 }, sessionPath: "/tmp/very-long-session-path.jsonl" },
					}}
					showThinking
					toolExpanded={false}
				/>
			),
			120,
			8,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("@jett — bounded task");
		expect(frame).toContain("42 tokens");
		expect(frame).not.toContain("UNIQUE_TAIL");
		expect(frame).toContain("20 more lines");
		expect(frame.split("\n").length).toBeLessThanOrEqual(9);

		const fallback = await mount(
			() => <MessageView item={{ kind: "custom", id: "fallback-notification", customType: "subagent-notification", text: JSON.stringify({ agent_id: "zoe", status: "failed", result: "fallback result" }), timestamp: 1 }} showThinking toolExpanded={false} />,
			60,
			8,
		);
		expect(fallback.captureCharFrame()).toContain("@zoe");
		const spawn = await mount(
			() => <MessageView item={{ kind: "tool", id: "spawn", toolCallId: "spawn-call", name: "agent_spawn", args: { agent: "explore", prompt: "secret prompt" }, output: "", details: { runtime: "profiled-subagents", agentId: "jett", profile: "explore", label: "launch task" }, timestamp: 1, status: "done", isError: false }} showThinking toolExpanded={false} />,
			80,
			8,
		);
		expect(spawn.captureCharFrame()).toContain("@jett · explore — launch task");
	});

	test("renders supervisor questions, custom notices, and supervisor tool labels", async () => {
		const items: ConversationItem[] = [
			{
				kind: "custom",
				id: "question",
				customType: "subagent_supervisor_request",
				text: "Choose the safer approach.\nReply with: subagent_supervisor({ action: \\\"reply\\\" })",
				details: { agent: "worker", reason: "need decision" },
				timestamp: 1,
			},
			{
				kind: "custom",
				id: "profiled-question",
				customType: "subagent-question",
				text: '{"agent_id":"@max","question":"Which behavior should I preserve?"}',
				details: {
					agentId: "max",
					profile: "implementer",
					label: "backend",
					question: "Which behavior should I preserve?",
					context: "The task and existing tests disagree.",
				},
				timestamp: 2,
			},
			{
				kind: "custom",
				id: "notice",
				customType: "other_event",
				text: "visible notice",
				timestamp: 2,
			},
			{
				kind: "tool",
				id: "supervisor-tool",
				toolCallId: "supervisor-tool",
				name: "subagent_supervisor",
				args: { action: "reply", agent: "worker", message: "Full supervisor reply body" },
				output: "",
				timestamp: 3,
				status: "done",
				isError: false,
			},
		];
		const setup = await mount(
			() => (
				<box flexDirection="column">
					{items.map((item) => <MessageView item={item} showThinking toolExpanded={false} />)}
				</box>
			),
			120,
			20,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("◇ Child question · worker · need decision");
		expect(frame).toContain("Choose the safer approach.");
		expect(frame).toContain("◇ Child question · implementer");
		expect(frame).toContain("Which behavior should I preserve?");
		expect(frame).toContain("Context: The task and existing tests disagree.");
		expect(frame).toContain("Reply with: subagent_supervisor");
		expect(frame).toContain("other_event: visible notice");
		expect(frame).toContain("TOOL · → reply worker");
		expect(frame).toContain("Full supervisor reply body");
		for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(120);
	});

	test("renders and selects fork points by keyboard and mouse", async () => {
		const choices = forkPickerOptions([
			{ entryId: "entry-1", text: "First message" },
			{ entryId: "entry-2", text: "Second message" },
		]);
		let selectedEntry: string | undefined;
		const setup = await mount(
			() => (
				<ForkPicker
					options={choices}
					onSelect={(entryId) => { selectedEntry = entryId; }}
					onCancel={() => {}}
				/>
			),
			80,
			18,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Search messages…");
		expect(frame).toContain("1. First message");
		expect(frame).toContain("2. Second message");
		expect(frame).toContain("Enter select");

		let firstArrowSelected: string | undefined;
		const firstArrow = await mount(
			() => (
				<ForkPicker
					options={choices}
					onSelect={(entryId) => { firstArrowSelected = entryId; }}
					onCancel={() => {}}
				/>
			),
			80,
			18,
		);
		firstArrow.mockInput.pressArrow("down");
		firstArrow.mockInput.pressEnter();
		await firstArrow.flush();
		expect(firstArrowSelected).toBe("entry-2");
		await setup.mockInput.typeText("Second");
		await setup.flush();
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(selectedEntry).toBe("entry-2");

		let mouseSelected: string | undefined;
		const mouse = await mount(
			() => (
				<ForkPicker
					options={choices}
					onSelect={(entryId) => { mouseSelected = entryId; }}
					onCancel={() => {}}
				/>
			),
			80,
			18,
		);
		const mouseFrame = mouse.captureCharFrame();
		const row = mouseFrame.split("\n").findIndex((line) => line.includes("2. Second message"));
		expect(row).toBeGreaterThanOrEqual(0);
		await mouse.mockMouse.click(
			Math.max(0, mouseFrame.split("\n")[row]!.indexOf("2. Second message")),
			row,
		);
		await mouse.flush();
		expect(mouseSelected).toBe("entry-2");

		const longChoices = forkPickerOptions(
			Array.from({ length: 30 }, (_, index) => ({
				entryId: `entry-${index + 1}`,
				text: `Message ${index + 1}`,
			})),
		);
		let scrolledMouseSelection: string | undefined;
		const scrolled = await mount(
			() => (
				<ForkPicker
					options={longChoices}
					onSelect={(entryId) => { scrolledMouseSelection = entryId; }}
					onCancel={() => {}}
				/>
			),
			80,
			24,
		);
		scrolled.mockInput.pressArrow("down");
		for (let index = 0; index < 22; index++) scrolled.mockInput.pressArrow("down");
		await scrolled.flush();
		const scrolledFrame = scrolled.captureCharFrame();
		const scrolledLines = scrolledFrame.split("\n");
		const scrolledRow = scrolledLines.findIndex((line) => /\d+\. Message \d+/.test(line));
		const visibleMatch = scrolledLines[scrolledRow]?.match(/(\d+)\. Message \d+/);
		if (!visibleMatch) throw new Error("scrolled fork option missing");
		await scrolled.mockMouse.click(
			Math.max(0, scrolledLines[scrolledRow]!.indexOf(visibleMatch[0])),
			scrolledRow,
		);
		await scrolled.flush();
		expect(scrolledMouseSelection).toBe(`entry-${visibleMatch[1]}`);

		const empty = await mount(
			() => <ForkPicker options={[]} onSelect={() => {}} onCancel={() => {}} />,
			60,
			12,
		);
		expect(empty.captureCharFrame()).toContain("fork points");
	});

	test("renders a one-row tab strip without overflowing constrained panes", async () => {
		let activated: string | undefined;
		let created = false;
		let forkOpened = false;
		const setup = await mount(
			() => (
				<TabStrip
					tabs={[
						{ id: "one", sessionName: "Primary", badges: 0 },
						{ id: "two", sessionName: "Forked", badges: 2 },
					]}
					activeId="one"
					onActivate={(id) => { activated = id; }}
					onClose={() => {}}
					onCreate={() => { created = true; }}
					onOpenForkPicker={() => { forkOpened = true; }}
				/>
			),
			42,
			6,
		);
		const strip = setup.renderer.root.findDescendantById("tab-strip");
		if (!strip) throw new Error("tab strip missing");
		expect(strip.height).toBe(1);
		const frame = setup.captureCharFrame();
		const tabLines = frame.split("\n");
		expect(tabLines[0]).toContain("Primary");
		expect(tabLines[0]).toContain("⑂");
		expect(tabLines[0]).toContain("+");
		const controlsStart = tabLines[0]!.indexOf("⑂");
		expect(controlsStart).toBeGreaterThan(tabLines[0]!.indexOf("Forked"));
		expect(tabLines[0]!.slice(controlsStart)).toMatch(/^⑂ \+? ?/);
		expect(frame).toContain("Primary");
		expect(frame).toContain("Forked •2");
		const forkColumn = tabLines[0]!.indexOf("⑂");
		const plusColumn = tabLines[0]!.indexOf("+");
		expect(forkColumn).toBeGreaterThan(tabLines[0]!.indexOf("Forked"));
		expect(plusColumn).toBe(forkColumn + 3);
		for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(42);
		const row = frame.split("\n").findIndex((line) => line.includes("Forked"));
		await setup.mockMouse.click(
			Math.max(0, frame.split("\n")[row]!.indexOf("Forked")),
			row,
		);
		await setup.flush();
		expect(activated).toBe("two");
		await setup.mockMouse.click(frame.split("\n")[0]!.indexOf("+"), 0);
		await setup.flush();
		expect(created).toBe(true);
		await setup.mockMouse.click(frame.split("\n")[0]!.indexOf("⑂"), 0);
		await setup.flush();
		expect(forkOpened).toBe(true);
	});

	test("keeps tab controls visible beside long titles", async () => {
		let created = false;
		let forkOpened = false;
		const longTitle = "a session with an intentionally long title";
		const setup = await mount(
			() => (
				<TabStrip
					tabs={[{ id: "long", sessionName: longTitle, badges: 0 }]}
					activeId="long"
					onActivate={() => {}}
					onClose={() => {}}
					onCreate={() => { created = true; }}
					onOpenForkPicker={() => { forkOpened = true; }}
				/>
			),
			40,
			4,
		);
		const frame = setup.captureCharFrame();
		const row = frame.split("\n")[0] ?? "";
		expect(row).toContain("⑂");
		expect(row).toContain("+");
		expect(row).not.toContain(longTitle);
		await setup.mockMouse.click(row.indexOf("+"), 0);
		await setup.flush();
		expect(created).toBe(true);
		await setup.mockMouse.click(row.indexOf("⑂"), 0);
		await setup.flush();
		expect(forkOpened).toBe(true);
	});

	test("keeps both controls visible in a very narrow tab strip", async () => {
		const setup = await mount(
			() => (
				<TabStrip
					tabs={[{ id: "narrow", sessionName: "a very long session title", badges: 0 }]}
					activeId="narrow"
					onActivate={() => {}}
					onClose={() => {}}
					onCreate={() => {}}
					onOpenForkPicker={() => {}}
				/>
			),
			20,
			4,
		);
		const lines = setup.captureCharFrame().split("\n");
		expect(lines[0]).toContain("⑂");
		expect(lines[0]).toContain("+");
		expect(lines[0]!.indexOf("+")).toBe(lines[0]!.indexOf("⑂") + 3);
	});

	test("wraps long expanded diff lines instead of clipping them", async () => {
		const longToken =
			"LONG_DIFF_TOKEN_" + "abcdefghijklmnopqrstuvwxyz0123456789_".repeat(4);
		const item: ConversationItem = {
			kind: "tool",
			id: "edit-diff-wrap",
			toolCallId: "edit-diff-wrap",
			name: "edit",
			args: { path: "src/app.ts", edits: [] },
			output: "Applied edit",
			diff: `--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-short\n+${longToken}\n`,
			diffPath: "src/app.ts",
			timestamp: 1,
			status: "done",
			isError: false,
		};
		const width = 48;
		const setup = await mount(
			() => (
				<MessageView
					item={item}
					showThinking
					toolExpanded={false}
					diffExpanded
				/>
			),
			width,
			24,
		);
		const frame = setup.captureCharFrame();
		const lines = frame.split("\n");
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(width);
		expect(frame.replace(/\s+/g, "")).toContain("LONG_DIFF_TOKEN_");
		// Contiguous long tokens must continue on a following row, not vanish past the edge.
		const wrappedRows = lines.filter((line) =>
			/LONG_DIFF_TOKEN_|[a-z0-9_]{12,}/i.test(line),
		);
		expect(wrappedRows.length).toBeGreaterThan(1);
		expect(frame).not.toContain(longToken);
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
		expect(nextFrame).toContain("⚪ reactive-worker");
		expect(nextFrame).not.toContain("ago");
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
		const frame = setup.captureCharFrame();
		expect(frame).toContain("⚪ finished-worker");
		expect(frame).not.toContain("ago");
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
		expect(frame).toContain("🟢 implementer");
		expect(frame).toContain("bash");
		expect(frame).not.toContain("Selected");
	});

	test("shows subagent context-window usage instead of cumulative tokens", async () => {
		// The live context window (168187) against the 1048576 limit, not the
		// cumulative input+output total (497506) which re-counts re-sent context.
		const runs: SubagentRun[] = [
			{
				runId: "run-1",
				asyncDir: "/tmp/run-1",
				mode: "single",
				state: "running",
				agent: "implementer",
				totalTokens: 497506,
				tokens: { total: 497506, input: 480012, output: 17494, window: 168187, windowPeak: 168187 },
				currentTool: "bash",
				steps: [
					{
						index: 0,
						agent: "implementer",
						status: "running",
						contextWindow: 1048576,
						tokens: { total: 497506, input: 480012, output: 17494, window: 168187, windowPeak: 168187 },
					},
				],
			},
		];
		const setup = await mount(
			() => <Sidebar runs={runs} selectedRunId="run-1" />,
			42,
			28,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("168K / 1M");
		expect(frame).not.toContain("497K tok");
	});

	test("falls back to cumulative tokens when context window is unknown", async () => {
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
			() => <Sidebar runs={runs} selectedRunId="run-1" />,
			42,
			28,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("4K tok");
	});

	test("inspector shows shared model/context rows instead of duplicating usage strings", async () => {
		// With no window data there is nothing honest to show: the inspector's
		// inline row omits unknown fields instead of rendering the sidebar's
		// "— / —" placeholder (the sidebar keeps that placeholder; its own
		// fallback rows are pinned separately and unchanged). The empty-transcript
		// block keeps the tool/turn counts but must not duplicate the Model/Context
		// rows, so the old cumulative "4200 tok" usage string is gone.
		const run: SubagentRun = {
			runId: "run-1",
			asyncDir: "/tmp/run-1",
			mode: "single",
			state: "running",
			agent: "implementer",
			totalTokens: 4200,
			currentTool: "bash",
			steps: [],
		};
		const target = subagentTargets([run])[0]!;
		const inspector = await mount(
			() => <SubagentInspector target={target} items={[]} now={2_000} />,
			100,
			24,
		);
		const frame = inspector.captureCharFrame();
		expect(frame).not.toContain("— / —");
		expect(frame).not.toContain("Thinking:");
		expect(frame).not.toContain("Context");
		expect(frame).not.toContain("Model");
		expect(frame).toContain("⚙bash");
		expect(frame).not.toContain("4200 tok");
		expect(frame).not.toContain("▤");
		expect(frame).not.toContain("◆");
	});

	test("inspector shows recursive child spawns inline and a parent breadcrumb", async () => {
		const profiledTarget = (
			agentId: string,
			parentAgentId: string,
			profile: string,
			controlDir: string,
		): SubagentTarget => ({
			key: `profiled-${agentId}`,
			run: {
				runId: `profiled-${agentId}`,
				runtime: "profiled-subagents",
				control: "profiled",
				controlDir,
				treeId: "tree-inspector",
				agentId,
				parentAgentId,
				profile,
				label: profile,
				mode: parentAgentId === "root" ? "profiled" : "nested",
				state: "completed",
				startedAt: 1,
				steps: [],
			},
			label: `@${agentId} · ${profile}`,
			state: "completed",
			active: false,
			canSteer: false,
			startedAt: 1,
		});
		const parent = profiledTarget("cai", "root", "implementer", "/tmp/cai");
		const child = profiledTarget("theo", "cai", "explore", "/tmp/theo");
		const nestedSpawn: ToolItem = {
			kind: "tool",
			id: "nested-spawn-card",
			toolCallId: "nested-spawn-call",
			name: "agent_spawn",
			args: { agent: "explore", prompt: "Inspect the API." },
			output: "",
			details: {
				runtime: "profiled-subagents",
				treeId: "tree-inspector",
				parentAgentId: "cai",
				agentId: "theo",
				profile: "explore",
				label: "explore",
				controlDir: "/tmp/theo",
			},
			timestamp: 2,
			startedAt: 2,
			endedAt: 3,
			status: "done",
			isError: false,
		};
		const parentView = await mount(
			() => (
				<SubagentInspector
					target={parent}
					allTargets={[parent, child]}
					items={[nestedSpawn]}
					now={4}
					onInspectSubagentTarget={() => {}}
				/>
			),
			100,
			30,
		);
		const parentFrame = parentView.captureCharFrame();
		expect(parentFrame).toContain("Main › @cai · implementer");
		expect(parentFrame).toContain("Subagents");
		expect(parentFrame).toContain("@theo · explore");

		const childView = await mount(
			() => (
				<SubagentInspector
					target={child}
					allTargets={[parent, child]}
					items={[]}
					now={4}
					onInspectSubagentTarget={() => {}}
				/>
			),
			100,
			24,
		);
		const childFrame = childView.captureCharFrame();
		expect(childFrame).toContain("Main › @cai · implementer › @theo · explore");
		expect(childFrame).toContain("← @cai · implementer parent");
	});

	test("renders all six mission-backed workflow children in the subagent sidebar", async () => {
		const workflowRunId = "workflow-sidebar-call";
		const run: SubagentRun = {
			runId: workflowRunId,
			control: "mission",
			mode: "workflow",
			state: "active",
			startedAt: 1,
			steps: Array.from({ length: 6 }, (_, index) => ({
				index,
				agent: `impl-check-${index}`,
				workflowKey: `impl-check-${index}`,
				parentWorkflowRunId: workflowRunId,
				status: "running",
				lastActivityAt: 1,
			})),
		};
		const setup = await mount(
			() => <Sidebar runs={[run]} tools={[]} />,
			42,
			63,
		);
		const frame = setup.captureCharFrame();
		for (let index = 0; index < 6; index++)
			expect(frame).toContain(`impl-check-${index}`);
	});

	test("shows the average daily consumption line as soon as a rate exists", async () => {
		const state = {
			sessionId: "session-1",
			sessionName: "Codex avg test",
			thinkingLevel: "high",
			isStreaming: false,
			isCompacting: false,
			steeringMode: "all",
			followUpMode: "all",
			autoCompactionEnabled: true,
			messageCount: 0,
			pendingMessageCount: 0,
			model: { provider: "openai-codex", id: "gpt-5.6", contextWindow: 400000 },
		} as RpcSessionState;
		const stats = {
			sessionFile: "/tmp/session.jsonl",
			sessionId: "session-1",
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			toolResults: 0,
			totalMessages: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			cost: 0,
		} as SessionStats;
		const usage: CodexUsage = {
			windows: [
				{
					usedPercent: 30,
					windowSeconds: 604800,
					resetAfterSeconds: 9_000,
					resetAt: 1_000,
				},
			],
		};
		const codexUsageStats: Record<number, UsageStats> = {
			604800: { remainingPercent: 70, ratePercentPerHour: 2, rateSpanHours: 1 },
		};
		const setup = await mount(
			() => (
				<Sidebar
					state={state}
					stats={stats}
					runs={[]}
					codexUsage={usage}
					codexUsageStats={codexUsageStats}
					height={40}
				/>
			),
			42,
			40,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("+48.0%/day");
	});

	test("shows the tail of long collapsed thinking instead of its beginning", async () => {
		const thought =
			"opening marker alpha: restate the task, weigh the alternatives, and trace the data flow through the sidebar and the app state before deciding anything, " +
			"middle filler: several paragraphs of analysis about tradeoffs, reset epochs, and the history buffer accumulate here so the preview must choose an end, " +
			"the plan converges on compact rows and a focused render test, so closing marker zeta";
		const assistant: ConversationItem = {
			kind: "assistant",
			id: "tail-thinking",
			text: "done",
			thinking: thought,
			timestamp: 1,
			status: "done",
		};
		const setup = await mount(
			() => (
				<MessageView
					item={assistant}
					showThinking
					thinkingExpanded={false}
					toolExpanded={false}
				/>
			),
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("closing marker zeta");
		expect(frame).not.toContain("opening marker alpha");
		expect(frame).toContain("▶ Thinking");
	});
	test("renders and hides the OpenCode Go usage block", async () => {
		const usage: OpencodeUsage = {
			windows: [
				{
					usedPercent: 1,
					windowSeconds: 18_000,
					resetAfterSeconds: 120,
					resetAt: 1_000,
				},
				{
					usedPercent: 1,
					windowSeconds: 604_800,
					resetAfterSeconds: 120,
					resetAt: 1_000,
				},
				{
					usedPercent: 61,
					windowSeconds: 2_592_000,
					resetAfterSeconds: 120,
					resetAt: 1_000,
				},
			],
		};
		const withUsage = await mount(() => <Sidebar runs={[]} opencodeUsage={usage} />, 42, 40);
		const frame = withUsage.captureCharFrame();
		expect(frame).toContain("OpenCode Go");
		expect(frame).toContain("5h 1%");
		expect(frame).toContain("7d 1%");
		expect(frame).toContain("30d 61%");

		const withoutUsage = await mount(() => <Sidebar runs={[]} />, 42, 40);
		expect(withoutUsage.captureCharFrame()).not.toContain("OpenCode Go");
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
				compactionExpanded: true,
				hasExpandedToolOverride: true,
			}),
		).toBe(false);
		expect(
			nextDetailToggle({ toolsExpanded: false, thinkingExpanded: false }),
		).toBe(true);
		expect(
			nextDetailToggle({
				toolsExpanded: false,
				thinkingExpanded: false,
				compactionExpanded: true,
			}),
		).toBe(false);
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
					performanceHistory={{
						"openai-codex\u0000gpt-5.6-terra": [
							{
								timestamp: Date.now(),
								ttftMs: 800,
								outputTokensPerSecond: 42,
							},
						],
					}}
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
		expect(frame).toContain("{42 tok/s · 800ms TTFT}");
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

	test("keys timing summaries to the selected model and shows only two medians", async () => {
		const history: RequestTiming[] = [
			{
				timingVersion: REQUEST_TIMING_VERSION,
				provider: "openai",
				modelId: "gpt-5",
				turnMs: 6_200,
				modelToToolMs: 800,
				toolCallDurationsMs: [600, 700],
				toolCallCount: 1,
				toolWallMs: 900,
			},
			{
				timingVersion: REQUEST_TIMING_VERSION,
				provider: "openai",
				modelId: "gpt-5",
				turnMs: 8_400,
				modelToToolMs: 1_200,
				toolCallDurationsMs: [800, 900, 1_000],
				toolCallCount: 2,
				toolWallMs: 1_400,
			},
			{
				timingVersion: REQUEST_TIMING_VERSION,
				provider: "openai",
				modelId: "other-model",
				turnMs: 2_000,
				toolCallDurationsMs: [],
			},
		];
		const setup = await mount(
			() => (
				<Sidebar
					state={{
						sessionName: "Timing session",
						sessionId: "session",
						model: {
							provider: "openai",
							id: "gpt-5",
							contextWindow: 100_000,
						},
						thinkingLevel: "high",
					} as RpcSessionState}
					runs={[]}
					timingHistory={history}
					subagentsAvailable={false}
					todosAvailable={false}
					height={24}
				/>
			),
			80,
			24,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Timing");
		expect(frame).toContain("Turn 7s · Tool 5s");
		expect(frame).not.toContain("Turn 2s");
		expect(frame).not.toContain("other-model");
	});

	test("hides timing until the selected model has produced a request", async () => {
		const history: RequestTiming[] = [
			{
				timingVersion: REQUEST_TIMING_VERSION,
				provider: "openai",
				modelId: "gpt-5",
				turnMs: 8_400,
				modelToToolMs: 1_200,
				toolCallDurationsMs: [800],
				toolWallMs: 900,
			},
		];
		const setup = await mount(
			() => (
				<Sidebar
					state={{
						sessionName: "Timing session",
						sessionId: "session",
						model: {
							provider: "openai",
							id: "gpt-4",
							contextWindow: 100_000,
						},
						thinkingLevel: "high",
					} as RpcSessionState}
					runs={[]}
					timingHistory={history}
					subagentsAvailable={false}
					todosAvailable={false}
					height={24}
				/>
			),
			80,
			24,
		);
		const frame = setup.captureCharFrame();
		expect(frame).not.toContain("· Tool");
		expect(frame).not.toContain("Turn");
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

	test("inspector, selector and sidebar keep their per-child views for parallel subagents", async () => {
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
		// Unknown model/context/thinking are omitted from the inspector's inline
		// row — no sidebar-style placeholders here.
		expect(inspectorFrame).not.toContain("— / —");
		expect(inspectorFrame).not.toContain("Thinking:");
		expect(inspectorFrame).not.toContain("Context");
		expect(inspectorFrame).not.toContain("Model");
		expect(inspectorFrame).toContain("reviewer #2");
		expect(inspectorFrame).toContain("finished");
		expect(inspectorFrame).not.toContain("parallel/completed");
		expect(inspectorFrame).not.toContain("▤");
		expect(inspectorFrame).not.toContain("◆");
		expect(inspectorFrame).not.toContain("ctx?");
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
		expect(sidebar.captureCharFrame()).toContain("1s ago · working");
		const activeInspector = await mount(
			() => <SubagentInspector target={active} items={[]} now={2_000} />,
			100,
			24,
		);
		const activeFrame = activeInspector.captureCharFrame();
		expect(activeFrame).toContain("provider/child");
		expect(activeFrame).toContain("Thinking: high");
		expect(activeFrame).toContain("Working…");
		expect(activeFrame).toContain("working");
		expect(activeFrame).not.toContain("parallel/running");
		expect(activeFrame).not.toContain("▤");
		expect(activeFrame).not.toContain("◆");
		expect(activeFrame).not.toContain("8.2k ctx");
	});

	test("sanitizes subagent inspector metadata before terminal rendering", async () => {
		const evil = "\u001b[31mevil\u001b[0m";
		const thinking = "\u001b]8;;https://evil.example\u0007evil\u001b]8;;\u0007";
		const step = {
			index: 0,
			agent: evil,
			status: evil,
			thinking,
		};
		const run: SubagentRun = {
			runId: "inspector-sanitize",
			mode: evil,
			state: "running",
			agent: evil,
			steps: [step],
		};
		const target = {
			key: "inspector-sanitize-target",
			run,
			step,
			label: evil,
			state: evil,
			active: true,
			canSteer: true,
			model: evil,
			thinking,
		};
		const setup = await mount(
			() => <SubagentInspector target={target} items={[]} now={2_000} />,
			100,
			24,
		);
		expect(setup.captureCharFrame()).not.toContain("\u001b");
	});

	test("inspector uses one friendly state vocabulary", async () => {
		expect(friendlyTargetState("running")).toBe("working");
		expect(friendlyTargetState("queued")).toBe("working");
		expect(friendlyTargetState("waiting")).toBe("waiting for parent");
		expect(friendlyTargetState("idle")).toBe("resident");
		expect(friendlyTargetState("unresponsive")).toBe("unresponsive");
		expect(friendlyTargetState("completed")).toBe("finished");
		expect(friendlyTargetState("failed")).toBe("failed");
		expect(friendlyTargetState("error")).toBe("failed");
		expect(friendlyTargetState("paused")).toBe("paused");
		expect(friendlyTargetState("mystery-state")).toBe("mystery-state");
	});

	test("inspector renders the profiled child's own model and context usage", async () => {
		const run: SubagentRun = {
			runId: "profiled-child",
			control: "profiled",
			controlDir: "/tmp/profiled-child",
			mode: "profiled",
			state: "running",
			agent: "explore",
			model: "anthropic/claude-opus",
			thinking: "high",
			contextWindow: 200_000,
			tokens: {
				total: 60_000,
				input: 50_000,
				output: 10_000,
				window: 50_000,
				windowPeak: 50_000,
			},
			profiledToolInFlight: true,
			startedAt: 1_000,
			steps: [],
		};
		const target = subagentTargets([run])[0]!;
		const setup = await mount(
			() => (
				<SubagentInspector target={target} items={[]} now={2_000} spinner="◓" />
			),
			100,
			24,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("50K / 200K");
		expect(frame).toContain("25% used");
		expect(frame).toContain("anthropic/claude-opus");
		expect(frame).toContain("Thinking: high");
		expect(frame).toContain("◓ Working…");
		expect(frame).toContain("working");
		expect(frame).not.toContain("profiled/running");
		expect(frame).not.toContain("▤");
		expect(frame).not.toContain("◆");
	});

	test("inspector omits model/context rows when the child reports neither", async () => {
		const run: SubagentRun = {
			runId: "profiled-bare",
			control: "profiled",
			controlDir: "/tmp/profiled-bare",
			mode: "profiled",
			state: "idle",
			agent: "explore",
			profiledToolInFlight: true,
			startedAt: 1_000,
			steps: [],
		};
		const target = subagentTargets([run])[0]!;
		const setup = await mount(
			() => <SubagentInspector target={target} items={[]} now={2_000} />,
			100,
			24,
		);
		const frame = setup.captureCharFrame();
		// The inline inspector row omits unknown fields instead of falling back
		// to the sidebar's "— / —" / "Thinking: —" placeholders.
		expect(frame).not.toContain("— / —");
		expect(frame).not.toContain("Thinking:");
		expect(frame).not.toContain("Context");
		expect(frame).not.toContain("Model");
		expect(frame).toContain("◆ resident · idle");
		expect(frame).toContain("resident");
		expect(frame).not.toContain("Working…");
		expect(frame).not.toContain("◐");
		expect(frame).not.toContain("◓");
		expect(frame).not.toContain("◑");
		expect(frame).not.toContain("◒");
		expect(frame).not.toContain("% used");
		expect(frame).not.toContain("profiled/idle");
		expect(frame).not.toContain("▤");
	});

	test("inspector presence indicator follows state, not mere activity", async () => {
		const makeProfiled = (suffix: string, state: string): SubagentRun => ({
			runId: `presence-${suffix}`,
			control: "profiled",
			controlDir: `/tmp/presence-${suffix}`,
			mode: "profiled",
			state,
			agent: "explore",
			profiledToolInFlight: true,
			startedAt: 1_000,
			steps: [],
		});
		const frameFor = async (state: string) => {
			const target = subagentTargets([makeProfiled(state, state)])[0]!;
			const setup = await mount(
				() => <SubagentInspector target={target} items={[]} now={2_000} />,
				100,
				24,
			);
			return setup.captureCharFrame();
		};
		const glyphs = ["◐", "◓", "◑", "◒"];
		const queued = await frameFor("queued");
		expect(queued).toContain("◐ Working…");
		const waiting = await frameFor("waiting");
		expect(waiting).toContain("⏸ waiting for parent");
		expect(waiting).not.toContain("Working…");
		for (const glyph of glyphs) expect(waiting).not.toContain(glyph);
		const idle = await frameFor("idle");
		expect(idle).toContain("◆ resident · idle");
		expect(idle).not.toContain("Working…");
		for (const glyph of glyphs) expect(idle).not.toContain(glyph);
	});

	test("sidebar never reports working/starting for finished children", () => {
		const sidebarTarget = (state: string, runExtra: Partial<SubagentRun> = {}): SubagentTarget => {
			const run: SubagentRun = { runId: `sidebar-${state}`, mode: "profiled", state, agent: "explore", steps: [], ...runExtra };
			return { key: run.runId, run, label: "explore", state, active: false, canSteer: false };
		};
		// The usage line reports nothing when there is nothing to report —
		// the activity row already names the state, so restating it would
		// print the state word twice.
		const cases: Array<[string, string]> = [
			["completed", "finished"],
			["failed", "failed"],
			["idle", "resident"],
			["waiting", "waiting for parent"],
			["unresponsive", "unresponsive"],
		];
		for (const [state, activity] of cases) {
			const target = sidebarTarget(state);
			expect(targetToolActivity(target)).toBe(activity);
			expect(targetToolUsage(target)).toBe("");
			expect(targetToolActivity(target)).not.toMatch(/working|starting/);
			expect(targetToolUsage(target)).not.toMatch(/working|starting/);
		}
		// Genuinely working states keep today's strings.
		expect(targetToolActivity(sidebarTarget("running"))).toBe("working");
		expect(targetToolActivity(sidebarTarget("queued"))).toBe("working");
		expect(targetToolUsage(sidebarTarget("running"))).toBe("starting…");
		expect(targetToolUsage(sidebarTarget("queued"))).toBe("starting…");
		// A current tool still renders when present, even on a finished child.
		expect(targetToolActivity(sidebarTarget("completed", { currentTool: "bash" }))).toBe("bash");
		expect(targetToolActivity(sidebarTarget("running", { currentTool: "bash", currentPath: "src/a.ts" }))).toBe("bash · src/a.ts");
		// Real usage numbers win over every fallback.
		expect(targetToolUsage(sidebarTarget("completed", { toolCount: 3 }))).toBe("3 tools");
		expect(targetToolUsage(sidebarTarget("running", { toolCount: 3 }))).toBe("3 tools");
	});

	test("sidebar renders live waiting/resident children without working or starting", async () => {
		const now = Date.now();
		const makeLive = (suffix: string, state: string): SubagentRun => ({
			runId: `sidebar-live-${suffix}`,
			control: "profiled",
			mode: "profiled",
			state,
			agent: "explore",
			profiledStatusBacked: true,
			lastUpdate: now,
			startedAt: now - 1_000,
			steps: [],
		});
		const state = { sessionName: "stream-session" } as RpcSessionState;
		const sidebar = await mount(
			() => <Sidebar state={state} runs={[makeLive("waiting", "waiting"), makeLive("idle", "idle")]} now={now} />,
			42,
			30,
		);
		const frame = sidebar.captureCharFrame();
		expect(frame).toContain("waiting for parent");
		expect(frame).toContain("resident");
		expect(frame).not.toContain("working");
		expect(frame).not.toContain("starting");
	});

	test("profiled live child streams thinking, text and tool starts through MessageView", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-stream-render-"));
		tempDirs.push(dir);
		const now = Date.now();
		const eventsPath = path.join(dir, "events.jsonl");
		const lines = [
			{ kind: "thinking", blockId: "think-1", text: "considering the API" },
			{ kind: "thinking", blockId: "think-1", text: " surface" },
			{ kind: "text", blockId: "text-1", text: "drafting the reply" },
			{ kind: "tool_start", toolName: "bash", toolCallId: "call-t1" },
		];
		fs.writeFileSync(
			eventsPath,
			lines.map((line, seq) => JSON.stringify({ v: 1, seq, ts: now, runId: "stream-child", ...line })).join("\n") + "\n",
		);
		const run: SubagentRun = {
			runId: "profiled:stream-child",
			control: "profiled",
			runtime: "profiled-subagents",
			mode: "profiled",
			state: "running",
			agent: "explore",
			profiledStatusBacked: true,
			lastUpdate: now,
			startedAt: now - 1_000,
			eventsPath,
			steps: [],
		};
		const items = readSubagentConversation(run);
		expect(items).toHaveLength(3);
		expect(items.map((item) => item.kind === "assistant" || item.kind === "tool" ? item.status : undefined)).toEqual([
			"streaming",
			"streaming",
			"streaming",
		]);
		const setup = await mount(() => (
			<box width="100%" height="100%" flexDirection="column">
				{items.map((item) => (
					<MessageView item={item} showThinking toolExpanded={false} now={now} />
				))}
			</box>
		));
		const frame = setup.captureCharFrame();
		// Live thinking block, streaming answer text and streaming tool glyph.
		expect(frame).toContain("considering the API surface");
		expect(frame).toContain("drafting the reply");
		expect(frame).toContain("Thinking");
		expect(frame).toContain("◉");
		// A block opened by the stream but still waiting for its first chunk
		// (inside the writer's coalescing window) renders the cursor.
		const cursor = await mount(() => (
			<MessageView
				item={{ kind: "assistant", id: "stream-cursor", text: "", thinking: "", timestamp: now, status: "streaming" }}
				showThinking
				toolExpanded={false}
				now={now}
			/>
		));
		expect(cursor.captureCharFrame()).toContain("▍");
	});

	test("shared model/context rows keep the sidebar 32-char truncation", async () => {
		const full = "openai-codex/gpt-5.6-sol-very-long-model-identifier-xyz";
		const state = {
			sessionId: "session-1",
			thinkingLevel: "high",
			model: {
				provider: "openai-codex",
				id: "gpt-5.6-sol-very-long-model-identifier-xyz",
				contextWindow: 400000,
			},
		} as RpcSessionState;
		const stats = {
			sessionFile: "/tmp/session.jsonl",
			sessionId: "session-1",
			contextUsage: { tokens: 33000, contextWindow: 400000, percent: 8.25 },
		} as SessionStats;
		const sidebar = await mount(
			() => <Sidebar state={state} stats={stats} runs={[]} />,
			42,
			28,
		);
		const sidebarFrame = sidebar.captureCharFrame();
		expect(sidebarFrame).toContain("…");
		expect(sidebarFrame).not.toContain(full);
		// Finished child, so no Working… line contributes its own ellipsis.
		const run: SubagentRun = {
			runId: "truncate-child",
			mode: "single",
			state: "completed",
			agent: "worker",
			model: full,
			steps: [],
		};
		const target = subagentTargets([run])[0]!;
		const inspector = await mount(
			() => <SubagentInspector target={target} items={[]} now={2_000} />,
			100,
			24,
		);
		const inspectorFrame = inspector.captureCharFrame();
		// The wide inspector uses the full width (per-field caps, no 32-column
		// clip), so the long model renders in full on its single inline row.
		// The sidebar half above still pins the 32-char truncation.
		expect(inspectorFrame).toContain(full);
		expect(inspectorFrame).not.toContain("…");
	});

	test("inspector renders context, model and thinking side by side on one row", async () => {
		// 36 chars: longer than the sidebar's 32-column clip, so its presence
		// in full proves the inline row uses the full available width.
		const model = "opencode-go/muse-spark-1.3-extended";
		expect(model.length).toBeGreaterThan(32);
		const run: SubagentRun = {
			runId: "inline-rows",
			asyncDir: "/tmp/inline-rows",
			mode: "single",
			state: "running",
			agent: "implementer",
			model,
			thinking: "medium",
			tokens: { total: 40000, input: 33000, output: 7000, window: 33000, windowPeak: 33000 },
			contextWindow: 400000,
			currentTool: "bash",
			steps: [],
		};
		const target = subagentTargets([run])[0]!;
		const setup = await mount(
			() => <SubagentInspector target={target} items={[]} now={2_000} />,
			110,
			30,
		);
		const frame = setup.captureCharFrame();
		const detailLines = frame
			.split("\n")
			.filter((line) => line.includes("Context") || line.includes("Model") || line.includes("Thinking:"));
		// One row, not five: Context, Model and Thinking share a single line,
		// so the block above the transcript takes one row instead of five.
		expect(detailLines).toHaveLength(1);
		expect(detailLines[0]).toContain("Context 33K / 400K · 8% used");
		expect(detailLines[0]).toContain(`Model ${model}`);
		expect(detailLines[0]).toContain("Thinking: medium");
		expect(frame).toContain(model);
		expect(frame).not.toContain("— / —");
	});

	test("inspector passes live time to child items while the target is active", async () => {
		const toolItem = {
			kind: "tool" as const,
			id: "live-tool",
			toolCallId: "live-call",
			name: "bash",
			args: {},
			output: "",
			timestamp: 1_000,
			startedAt: 1_000,
			status: "done" as const,
			isError: false,
		};
		const makeRun = (suffix: string, state: string): SubagentRun => ({
			runId: `live-${suffix}`,
			asyncDir: `/tmp/live-${suffix}`,
			mode: "single",
			state,
			agent: "worker",
			steps: [],
		});
		const activeTarget = subagentTargets([makeRun("active", "running")])[0]!;
		const activeView = await mount(
			() => (
				<SubagentInspector target={activeTarget} items={[toolItem]} now={61_000} />
			),
			100,
			30,
		);
		expect(activeView.captureCharFrame()).toContain("took 1m 0s");
		const finishedTarget = subagentTargets([
			makeRun("finished", "completed"),
		])[0]!;
		const finishedView = await mount(
			() => (
				<SubagentInspector
					target={finishedTarget}
					items={[toolItem]}
					now={61_000}
				/>
			),
			100,
			30,
		);
		expect(finishedView.captureCharFrame()).toContain("took 0ms");
	});

	test("sidebar parent rows render context usage, model, and thinking level", async () => {
		const state = {
			sessionId: "session-1",
			sessionName: "OpenCode UI work",
			thinkingLevel: "high",
			model: {
				provider: "openai-codex",
				id: "gpt-5.6-sol",
				contextWindow: 400000,
			},
		} as RpcSessionState;
		const stats = {
			sessionFile: "/tmp/session.jsonl",
			sessionId: "session-1",
			contextUsage: { tokens: 33000, contextWindow: 400000, percent: 8.25 },
		} as SessionStats;
		const setup = await mount(
			() => <Sidebar state={state} stats={stats} runs={[]} />,
			42,
			28,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("33K / 400K");
		expect(frame).toContain("8% used");
		expect(frame).toContain("openai-codex/gpt-5.6-sol");
		expect(frame).toContain("Thinking: high");
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
		const pausedRun: SubagentRun = {
			...runningRun,
			runId: "hint-paused",
			asyncDir: "/tmp/hint-paused",
			state: "paused",
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
		const paused = subagentTargets([pausedRun])[0];
		const finished = subagentTargets([finishedRun])[0];
		const foreground = subagentTargets([foregroundRun])[0];
		if (!running || !queued || !paused || !finished || !foreground)
			throw new Error("hint fixtures missing");
		const runningView = await mount(
			() => <SubagentInspector target={running} items={[]} now={1} />,
			100,
			24,
		);
		expect(runningView.captureCharFrame()).toContain("⏸ Pause");
		expect(runningView.captureCharFrame()).toContain("⏹ Stop");
		const queuedView = await mount(
			() => <SubagentInspector target={queued} items={[]} now={1} />,
			100,
			24,
		);
		expect(queuedView.captureCharFrame()).toContain("⏹ Stop");
		expect(queuedView.captureCharFrame()).toContain("Ctrl+Shift+A stop");
		expect(queuedView.captureCharFrame()).not.toContain("⏸ Pause");
		expect(queuedView.captureCharFrame()).not.toContain("Ctrl+A pause");
		const pausedView = await mount(
			() => <SubagentInspector target={paused} items={[]} now={1} />,
			100,
			24,
		);
		expect(pausedView.captureCharFrame()).toContain("▶ Resume");
		expect(pausedView.captureCharFrame()).toContain("⏹ Stop");
		expect(pausedView.captureCharFrame()).toContain("Resume via click · Ctrl+Shift+A stop");
		expect(pausedView.captureCharFrame()).not.toContain("⏸ Pause");
		expect(pausedView.captureCharFrame()).not.toContain("Ctrl+A pause");
		const finishedView = await mount(
			() => <SubagentInspector target={finished} items={[]} now={1} />,
			100,
			24,
		);
		expect(finishedView.captureCharFrame()).not.toContain("⏹ Stop");
		const foregroundView = await mount(
			() => <SubagentInspector target={foreground} items={[]} now={1} />,
			100,
			24,
		);
		expect(foregroundView.captureCharFrame()).not.toContain("⏹ Stop");
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
			thinking: `HEAD_MARKER_ALPHA ${"neutral filler about file inspection ".repeat(8)}\nUNIQUE_EXPANDED_DETAIL`,
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
		expect(collapsedFrame).toContain("UNIQUE_EXPANDED_DETAIL");
		expect(collapsedFrame).toContain("expand");
		expect(collapsedFrame).not.toContain("HEAD_MARKER_ALPHA");

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
		expect(expandedFrame).toContain("collapse");
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
		expect(filterCommandChoices(commands, "/th", 7, 0)).toEqual([]);
		expect(
			filterCommandChoices(commands, "/th", 7, 3).map((item) => item.name),
		).toEqual(["thinking", "thoughts"]);
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

	test("renders a memory browser grouped by source with a search box", async () => {
		const snapshot: MemorySnapshot = {
			files: [],
			projectName: "PiTTy",
			entries: [
				{
					id: "memory:0",
					source: "memory",
					sourceLabel: "Memory",
					filePath: "/home/user/.pi/agent/pi-hermes-memory/MEMORY.md",
					index: 0,
					raw: "User prefers pnpm over npm. <!-- created=2026-07-01, last=2026-07-01 -->",
					text: "User prefers pnpm over npm.",
					category: undefined,
					created: "2026-07-01",
					lastReferenced: "2026-07-01",
					project: undefined,
				},
				{
					id: "failure:0",
					source: "failure",
					sourceLabel: "Failures",
					filePath: "/home/user/.pi/agent/pi-hermes-memory/failures.md",
					index: 0,
					raw: "[correction] Do not edit without authorization. <!-- created=2026-07-02, last=2026-07-02 -->",
					text: "[correction] Do not edit without authorization.",
					category: "correction",
					created: "2026-07-02",
					lastReferenced: "2026-07-02",
					project: undefined,
				},
			],
		};
		const setup = await mount(
			() => (
				<MemoryBrowserDialog
					snapshot={snapshot}
					onRemove={() => {}}
					onCancel={() => {}}
				/>
			),
			100,
			24,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Memory");
		expect(frame).toContain("Search memory");
		expect(frame).toContain("User prefers pnpm over npm.");
		expect(frame).toContain("correction] Do not edit without authorization.");
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
						assistantMessageEvent: {
							type: isThinking ? "thinking_delta" : "text_delta",
							contentIndex: isThinking ? 0 : 1,
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
					message: {
						role: "assistant",
						content: [{ type: "text", text: "FINAL_STREAMED_TEXT" }],
					},
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
		expect(frame).toContain("worker-39");
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

	test("a single spawn card keeps its inline block for multiple children", async () => {
		// One tool item owning two targets is a single spawn, not a group: it
		// renders exactly today's card with the friendly inline-block rows.
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
		const frame = tool.captureCharFrame();
		expect(frame).toContain("Subagents");
		expect(frame).toContain("last activity 1s ago");
		expect(frame).toContain("working");
		expect(frame).toContain("finished");
		expect(frame).not.toContain("◇ Agents ×");
	});

	test("groups a contiguous parallel spawn batch into one compact card", async () => {
		const tools = ["spawn-1", "spawn-2", "spawn-3", "spawn-4"].map(
			(id): ToolItem => ({
				kind: "tool",
				id,
				toolCallId: `call-${id}`,
				name: "agent_spawn",
				args: { prompt: `do ${id}` },
				output: "",
				timestamp: 1,
				status: "done",
				isError: false,
			}),
		);
		const targets: SubagentTarget[] = [
			{ key: "w1", run: { runId: "w1", mode: "single", state: "running", agent: "explore", steps: [] }, label: "@w1 — worker one", state: "running", active: true, canSteer: false, lastUpdate: 1_000 },
			{ key: "w2", run: { runId: "w2", mode: "single", state: "running", agent: "explore", steps: [] }, label: "@w2 — worker two", state: "running", active: true, canSteer: false, lastUpdate: 1_000 },
			{ key: "f1", run: { runId: "f1", mode: "single", state: "completed", agent: "explore", steps: [] }, label: "@f1 — finisher one", state: "completed", active: false, canSteer: false, lastUpdate: 1_000 },
			{ key: "f2", run: { runId: "f2", mode: "single", state: "completed", agent: "explore", steps: [] }, label: "@f2 — finisher two", state: "completed", active: false, canSteer: false, lastUpdate: 1_000 },
		];
		const owned = new Map<string, SubagentTarget[]>(
			tools.map((tool, index) => [tool.id, [targets[index]!]]),
		);
		const groups = computeSpawnGroups(tools, owned);
		expect(groups).toHaveLength(1);
		const group = groups[0]!;
		expect(group.memberIds).toEqual(tools.map((tool) => tool.id));
		const setup = await mount(
			() => (
				<SpawnGroupCard
					group={group}
					expanded={false}
					now={2_000}
					onToggle={() => {}}
					renderMember={() => null}
				/>
			),
			100,
			8,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("◇ Agents ×4 · 2 working · 2 finished");
		expect(frame).toContain("▸ spawn cards");
		for (const target of targets) expect(frame).toContain(target.label);
		expect(frame).toContain("finished");
		expect(frame).not.toContain("Subagents");
		expect(frame.split("\n").length).toBeLessThanOrEqual(10);
	});

	test("expanding a spawn group reveals today's per-spawn cards", async () => {
		const tools = ["spawn-1", "spawn-2", "spawn-3", "spawn-4"].map(
			(id): ToolItem => ({
				kind: "tool",
				id,
				toolCallId: `call-${id}`,
				name: "agent_spawn",
				args: { prompt: `do ${id}` },
				output: "",
				timestamp: 1,
				status: "done",
				isError: false,
			}),
		);
		const targets: SubagentTarget[] = [
			{ key: "w1", run: { runId: "w1", mode: "single", state: "running", agent: "explore", steps: [] }, label: "@w1 — worker one", state: "running", active: true, canSteer: false, lastUpdate: 1_000 },
			{ key: "w2", run: { runId: "w2", mode: "single", state: "running", agent: "explore", steps: [] }, label: "@w2 — worker two", state: "running", active: true, canSteer: false, lastUpdate: 1_000 },
			{ key: "f1", run: { runId: "f1", mode: "single", state: "completed", agent: "explore", steps: [] }, label: "@f1 — finisher one", state: "completed", active: false, canSteer: false, lastUpdate: 1_000 },
			{ key: "f2", run: { runId: "f2", mode: "single", state: "completed", agent: "explore", steps: [] }, label: "@f2 — finisher two", state: "completed", active: false, canSteer: false, lastUpdate: 1_000 },
		];
		const owned = new Map<string, SubagentTarget[]>(
			tools.map((tool, index) => [tool.id, [targets[index]!]]),
		);
		const byId = new Map(tools.map((tool) => [tool.id, tool] as const));
		const group = computeSpawnGroups(tools, owned)[0]!;
		const [expanded, setExpanded] = createSignal(false);
		const setup = await mount(
			() => (
				<SpawnGroupCard
					group={group}
					expanded={expanded()}
					now={2_000}
					onToggle={() => setExpanded((value) => !value)}
					onInspectSubagentTarget={() => {}}
					renderMember={(memberId) => (
						<MessageView
							item={byId.get(memberId)!}
							showThinking={false}
							toolExpanded={false}
							subagentTargets={owned.get(memberId) ?? []}
							now={2_000}
						/>
					)}
				/>
			),
			100,
			60,
		);
		expect(setup.captureCharFrame()).not.toContain("Subagents");
		setExpanded(true);
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		const frame = setup.captureCharFrame();
		expect(frame).toContain("▾ spawn cards");
		expect(frame.split("Subagents").length - 1).toBe(4);
		// The collapsed one-line rows are gone; each child now renders its
		// own 3-row inline block.
		for (const target of targets)
			expect(frame).not.toContain(spawnGroupRowText(target, 2_000));
	});

	test("a non-spawn tool between spawns keeps two separate groups", async () => {
		const spawn = (id: string): ToolItem => ({
			kind: "tool",
			id,
			toolCallId: `call-${id}`,
			name: "agent_spawn",
			args: { prompt: `do ${id}` },
			output: "",
			timestamp: 1,
			status: "done",
			isError: false,
		});
		const left = [spawn("s1"), spawn("s2")];
		const middle: ToolItem = { ...spawn("bash-1"), name: "bash", args: { command: "ls" } };
		const right = [spawn("s3"), spawn("s4")];
		const items: ConversationItem[] = [...left, middle, ...right];
		const owned = new Map<string, SubagentTarget[]>(
			[...left, ...right].map((tool) => [
				tool.id,
			[
					{
						key: tool.id,
						run: { runId: tool.id, mode: "single", state: "running", agent: "explore", steps: [] },
						label: `@${tool.id} — worker`,
						state: "running",
						active: true,
						canSteer: false,
						lastUpdate: 1_000,
					},
				],
				]),
		);
		const groups = computeSpawnGroups(items, owned);
		expect(groups).toHaveLength(2);
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					{groups.map((group) => (
						<SpawnGroupCard
							group={group}
							expanded={false}
							now={2_000}
							onToggle={() => {}}
							renderMember={() => null}
						/>
					))}
				</box>
			),
			100,
			12,
		);
		const frame = setup.captureCharFrame();
		expect(frame.split("◇ Agents ×").length - 1).toBe(2);
	});

	test("a spawn owning no targets renders as a card, never grouped", async () => {
		const spawn = (id: string): ToolItem => ({
			kind: "tool",
			id,
			toolCallId: `call-${id}`,
			name: "agent_spawn",
			args: { prompt: `do ${id}` },
			output: "",
			timestamp: 1,
				status: "done",
				isError: false,
			});
		const first = spawn("g1");
		const empty = spawn("g2");
		const third = spawn("g3");
		const child = (key: string, state: string): SubagentTarget => ({
			key,
			run: { runId: key, mode: "single", state, agent: "explore", steps: [] },
			label: `@${key} — worker`,
			state,
			active: state === "running",
			canSteer: false,
			lastUpdate: 1_000,
		});
		const owned = new Map([
			[first.id, [child("c1", "running")]],
			[third.id, [child("c3", "completed")]],
		]);
		// The target-less spawn breaks the run both ways: two lone spawns,
		// zero groups. Failures stay visible as plain cards.
		expect(computeSpawnGroups([first, empty, third], owned)).toEqual([]);
		const setup = await mount(
			() => (
				<MessageView
					item={empty}
					showThinking={false}
					toolExpanded={false}
					subagentTargets={[]}
					now={2_000}
				/>
			),
			100,
			24,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("agent_spawn");
		expect(frame).not.toContain("Subagents");
		expect(frame).not.toContain("◇ Agents ×");
	});

	test("grouped rows use the friendly state vocabulary exactly once", async () => {
		const child = (key: string, state: string, extra: Partial<SubagentTarget> = {}): SubagentTarget => ({
			key,
			run: { runId: key, mode: "single", state, agent: "explore", steps: [] },
			label: `@${key} — helper`,
			state,
			active: state === "running",
			canSteer: false,
			lastUpdate: 1_000,
			...extra,
		});
		// Working child with real usage: usage line shown after the state.
		const working = child("w1", "running", { run: { runId: "w1", mode: "single", state: "running", agent: "explore", steps: [], toolCount: 3 } });
		expect(spawnGroupRowText(working, 2_000)).toBe(
			`🟢 @w1 — helper · working · 1s ago · 3 tools`,
		);
		// Working child without usage yet: honestly `starting…`, once.
		const starting = child("w2", "running");
		const startingRow = spawnGroupRowText(starting, 2_000);
		expect(startingRow).toBe(`🟢 @w2 — helper · working · 1s ago · starting…`);
		expect(startingRow.split("starting…").length - 1).toBe(1);
		// Finished / resident / unresponsive children: the state word appears
		// exactly once — the usage line stays empty instead of restating it.
		const finished = child("done-1", "completed");
		expect(spawnGroupRowText(finished, 2_000)).toBe(
			`⚪ @done-1 — helper · finished · 1s ago`,
		);
		// A resident (`idle`) child is live-but-idle: the status-file timestamp
		// is not an age of anything the user did, so the row names the state
		// on its own. A waiting child reads the same way.
		const resident = child("res-1", "idle");
		expect(spawnGroupRowText(resident, 2_000)).toBe(
			`⚪ @res-1 — helper · resident`,
		);
		expect(spawnGroupRowText(resident, 2_000)).not.toContain("ago");
		const waiting = child("wait-1", "waiting");
		expect(spawnGroupRowText(waiting, 2_000)).toBe(
			`⚪ @wait-1 — helper · waiting for parent`,
		);
		expect(spawnGroupRowText(waiting, 2_000)).not.toContain("ago");
		const unresponsive = child("st-1", "unresponsive");
		expect(spawnGroupRowText(unresponsive, 2_000)).toBe(
			`⚪ @st-1 — helper · unresponsive · 1s ago`,
		);
		for (const [row, word] of [
			[spawnGroupRowText(finished, 2_000), "finished"],
			[spawnGroupRowText(resident, 2_000), "resident"],
			[spawnGroupRowText(unresponsive, 2_000), "unresponsive"],
		] as const) {
			expect(row.split(word).length - 1).toBe(1);
		}
		const finishedRow = spawnGroupRowText(finished, 2_000);
		expect(finishedRow).not.toContain("completed");
		expect(finishedRow).not.toContain("starting");
		expect(finishedRow).not.toContain("working");
		// Unknown states never leak raw into the header summary: counted in
		// ×N only.
		const odd: SubagentTarget = { ...finished, key: "odd-1", label: "@odd-1 — mystery", state: "bogus" };
		expect(spawnGroupSummary([finished, odd])).toBe("1 finished");
	});

	test("sidebar collapses a resident child to two rows without repeating the state", async () => {
		const now = Date.now();
		const run: SubagentRun = {
			runId: "resident-child",
			control: "profiled",
			mode: "profiled",
			state: "idle",
			agent: "explore",
			profiledStatusBacked: true,
			lastUpdate: now,
			startedAt: now - 1_000,
			steps: [],
		};
		const setup = await mount(
			() => <Sidebar runs={[run]} now={now} />,
			42,
			30,
		);
		const frame = setup.captureCharFrame();
		// A resident child is live-but-idle: the status-file timestamp is not
		// an age of anything the user did, so the row names the state on its
		// own and prints no age. The usage line stays empty instead of
		// restating the state. (The sidebar Session header's own "starting…"
		// placeholder is unrelated.)
		expect(frame).toContain("resident");
		expect(frame).not.toContain("ago");
		expect(frame.split("resident").length - 1).toBe(1);
		const box = setup.renderer.root.findDescendantById(
			"subagent-resident-child",
			) as BoxRenderable;
		expect(box.height).toBe(2);
	});

	test("sidebar keeps the active count visible next to the inspect hint", async () => {
		const now = Date.now();
		const run: SubagentRun = {
			runId: "profiled:count",
			control: "profiled",
			mode: "profiled",
			state: "running",
			agentId: "ron",
			profile: "implementer",
			label: "pitty-install-plugins",
			profiledStatusBacked: true,
			lastUpdate: now,
			startedAt: now - 1_000,
			steps: [],
		};
		const setup = await mount(() => <Sidebar runs={[run]} now={now} />, 42, 30);
		const frame = setup.captureCharFrame();
		// The count and the navigation hint share one row. The count is the
		// information, so it must survive the squeeze and the hint is what clips.
		expect(frame).toContain("Subagents (1 active)");
		expect(frame).toContain("Ctrl+I");
	});

	test("heartbeat-dead children read unresponsive on every surface, never stale", async () => {
		const run: SubagentRun = {
			runId: "dead-run",
			mode: "profiled",
			state: "unresponsive",
			agent: "explore",
			steps: [],
			lastUpdate: 1_500,
			startedAt: 500,
		};
		const targets = subagentTargets([run]);
		expect(targets).toHaveLength(1);
		const dead = targets[0]!;
		expect(dead.state).toBe("unresponsive");
		expect(dead.active).toBe(false);
		const spawn = (id: string): ToolItem => ({
			kind: "tool",
			id,
			toolCallId: `call-${id}`,
			name: "agent_spawn",
			args: { prompt: `do ${id}` },
			output: "",
			timestamp: 1,
			status: "done",
			isError: false,
		});
		const tools = [spawn("d1"), spawn("d2")];
		const owned = new Map<string, SubagentTarget[]>([
			[tools[0]!.id, [dead]],
			[tools[1]!.id, [dead]],
		]);
		const group = computeSpawnGroups(tools, owned)[0]!;
		const card = await mount(
			() => (
				<SpawnGroupCard
					group={group}
					expanded={false}
					now={2_000}
					onToggle={() => {}}
					renderMember={() => null}
				/>
			),
			100,
			8,
		);
		const selector = await mount(
			() => (
				<SubagentSelectorDialog
					targets={targets}
					selectedKey={dead.key}
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			90,
			24,
		);
		const sidebar = await mount(() => <Sidebar runs={[run]} now={2_000} />, 42, 30);
		const cardFrame = card.captureCharFrame();
		const selectorFrame = selector.captureCharFrame();
		const sidebarFrame = sidebar.captureCharFrame();
		// Wherever a state word is shown, it reads unresponsive…
		expect(cardFrame).toContain("unresponsive");
		expect(selectorFrame).toContain("UNRESPONSIVE");
		// …and the old word appears in no rendered frame. (The inactive
		// sidebar row shows icon + label only, so it names no state.)
		for (const frame of [cardFrame, selectorFrame, sidebarFrame]) {
			expect(frame).not.toMatch(/stale/i);
		}
	});

	test("transcript selection copy survives streaming mutations", async () => {
		const upper: ConversationItem = {
			kind: "assistant",
			id: "stale-upper",
			text: "UPPERFILLERALPHA",
			thinking: "",
			timestamp: 1,
			status: "done",
		};
		const [lower, setLower] = createSignal<ConversationItem>({
			kind: "assistant",
			id: "stale-lower",
			text: "LOWERORIGINALSTREAMING",
			thinking: "",
			timestamp: 2,
			status: "streaming",
		});
		const setup = await mount(() => (
			<scrollbox width="100%" height="100%" scrollY scrollX={false}>
				<MessageView item={upper} showThinking toolExpanded={false} />
				<MessageView item={lower} showThinking toolExpanded={false} />
			</scrollbox>
		));
		// No gate predicate: everything mounted here is transcript content and
		// the prompt editor is not mounted, so every finished selection is cached.
		const cache = attachTranscriptSelectionCache(setup.renderer);

		const frame = setup.captureCharFrame();
		const lines = frame.split("\n");
		const row = lines.findIndex((line) =>
			line.includes("LOWERORIGINALSTREAMING"),
		);
		expect(row).toBeGreaterThanOrEqual(0);
		const startX = lines[row]!.indexOf("LOWERORIGINALSTREAMING");
		await setup.mockMouse.drag(
			startX,
			row,
			startX + "LOWERORIGINALSTREAMING".length,
			row,
		);
		await setup.flush();

		const liveBefore =
			setup.renderer.getSelection()?.getSelectedText() ?? "";
		expect(liveBefore).toContain("LOWERORIGINALSTREAMING");
		const copiedBefore = cache.getCopyText();
		expect(copiedBefore).toContain("LOWERORIGINALSTREAMING");

		// A stream chunk mutates the selected buffer in place, then the final
		// render swaps the streaming Text node for the Markdown node.
		setLower((current) =>
			current.kind === "assistant"
				? { ...current, text: `${current.text} APPENDEDCHUNK` }
				: current,
		);
		await setup.flush();
		setLower((current) =>
			current.kind === "assistant"
				? { ...current, text: "FINALREPLACEMENTBETA", status: "done" }
				: current,
		);
		await setup.flush();

		// The copy path still yields the originally selected text …
		expect(cache.getCopyText()).toBe(copiedBefore);
		// … while the raw live query demonstrably resolves against the mutated
		// content, which is what Ctrl+C copied before the fix.
		const liveAfter = setup.renderer.getSelection()?.getSelectedText() ?? "";
		expect(liveAfter).not.toContain("LOWERORIGINALSTREAMING");

		// Clearing the cache falls back to the live query, and clearing the
		// selection behaves exactly as before (no text, no copy).
		cache.clear();
		expect(cache.getCopyText()).toBe(liveAfter);
		setup.renderer.clearSelection();
		cache.clear();
		expect(cache.getCopyText()).toBe("");
		cache.dispose();
	});

	test("non-transcript selections bypass the copy cache", async () => {
		const item: ConversationItem = {
			kind: "assistant",
			id: "gated",
			text: "GATEDTRANSCRIPTTEXT",
			thinking: "",
			timestamp: 1,
			status: "done",
		};
		const setup = await mount(() => (
			<MessageView item={item} showThinking toolExpanded={false} />
		));
		const cache = attachTranscriptSelectionCache(setup.renderer, () => false);
		const frame = setup.captureCharFrame();
		const lines = frame.split("\n");
		const row = lines.findIndex((line) =>
			line.includes("GATEDTRANSCRIPTTEXT"),
		);
		expect(row).toBeGreaterThanOrEqual(0);
		const startX = lines[row]!.indexOf("GATEDTRANSCRIPTTEXT");
		await setup.mockMouse.drag(
			startX,
			row,
			startX + "GATEDTRANSCRIPTTEXT".length,
			row,
		);
		await setup.flush();
		const live = setup.renderer.getSelection()?.getSelectedText() ?? "";
		expect(live).toContain("GATEDTRANSCRIPTTEXT");
		// Gated out (as the prompt editor is): the copy path falls back to the
		// live query.
		expect(cache.getCopyText()).toBe(live);
		cache.dispose();
	});

	test("spawn group keys cannot collide with real item ids", () => {
		// Real item ids are `prefix-base36time-random` (history-tool-…, tool-…)
		// and never contain a colon, so the `group:` prefix cannot match one.
		expect(SPAWN_GROUP_ID_PREFIX).toContain(":");
		expect(spawnGroupId("tool-abc-123")).toBe("group:tool-abc-123");
		expect(spawnGroupId("history-tool-abc")).not.toBe("history-tool-abc");
		expect(spawnGroupId("a")).not.toBe(spawnGroupId("b"));
	});
});

describe("batch A data truth", () => {
	test("task-shaped tools render the derived description, not raw JSON", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "task-1",
			toolCallId: "task-1-call",
			name: "task_fetch",
			args: { agent: "helper", task: "do it" },
			output: "",
			timestamp: 1,
			startedAt: 1,
			status: "done",
			isError: false,
		};
		const setup = await mount(() => (
			<box width="100%" height="100%" flexDirection="column">
				<MessageView item={item} showThinking toolExpanded={false} now={2_000} />
			</box>
		));
		const frame = setup.captureCharFrame();
		// The unified family rule derives the label from args…
		expect(frame).toContain("helper");
		// …shows the task gist…
		expect(frame).toContain("do it");
		// …and hides the redundant raw-args preview.
		expect(frame).not.toContain('"agent"');
	});

	test("subagent-family tools without a summary fall back to the args preview", async () => {
		const item: ConversationItem = {
			kind: "tool",
			id: "task-2",
			toolCallId: "task-2-call",
			name: "task_custom",
			args: { foo: "bar" },
			output: "",
			timestamp: 1,
			startedAt: 1,
			status: "done",
			isError: false,
		};
		const setup = await mount(() => (
			<box width="100%" height="100%" flexDirection="column">
				<MessageView item={item} showThinking toolExpanded={false} now={2_000} />
			</box>
		));
		const frame = setup.captureCharFrame();
		expect(frame).toContain("task_custom");
		expect(frame).toContain("bar");
	});

	test("inspector rows resolve an honest clock and timing renders empty without one", async () => {
		const { inspectorItemNow } = await import("../src/ui/subagent-inspector.tsx");
		const { toolTiming } = await import("../src/ui/message.tsx");
		const tool: ConversationItem = {
			kind: "tool",
			id: "t",
			toolCallId: "t-call",
			name: "bash",
			args: {},
			output: "",
			timestamp: 100,
			startedAt: 100,
			status: "done",
			isError: false,
		};
		const assistant: ConversationItem = {
			kind: "assistant",
			id: "a",
			text: "hi",
			thinking: "",
			timestamp: 100,
			status: "done",
		};
		// Active children and in-flight tools use the live clock.
		expect(inspectorItemNow(true, assistant, 500)).toBe(500);
		// A finished tool of an inactive child keeps its own timestamps.
		expect(inspectorItemNow(false, tool, 500)).toBe(100);
		// Finished tools of an inactive child resolve to their own end…
		expect(inspectorItemNow(false, { ...tool, endedAt: 250 }, 500)).toBe(250);
		// …while non-tool rows of an inactive child resolve to undefined,
		// never the epoch, and timing renders empty without a clock.
		expect(inspectorItemNow(false, assistant, 500)).toBeUndefined();
		expect(toolTiming(tool)).toBe("");
		expect(toolTiming(tool, 500)).toContain("took");
	});
});

describe("batch B render layer", () => {
	test("thinking/answer pairs keep exactly one alternative visible", async () => {
		const streaming: ConversationItem = {
			kind: "assistant",
			id: "pair-1",
			text: "draft reply",
			thinking: "considering it",
			timestamp: 1,
			status: "streaming",
		};
		const [item, setItem] = createSignal<ConversationItem>(streaming);
		const [expanded, setExpanded] = createSignal(true);
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<MessageView item={item} showThinking thinkingExpanded={expanded} toolExpanded={false} now={2_000} />
				</box>
			),
			100,
			30,
		);
		const visible = (id: string): boolean | undefined =>
			(setup.renderer.root.findDescendantById(id) as { visible?: boolean } | undefined)?.visible;
		// Streaming + expanded: the streaming text shows, its markdown
		// replacement stays hidden — never both, never neither.
		expect(visible("pair-1-thinking-stream")).toBe(true);
		expect(visible("pair-1-thinking-markdown")).toBe(false);
		expect(visible("pair-1-answer-stream")).toBe(true);
		expect(visible("pair-1-answer-markdown")).toBe(false);
		// Streaming -> done: exactly one alternative flips per pair.
		setItem({ ...streaming, status: "done" });
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		expect(visible("pair-1-thinking-stream")).toBe(false);
		expect(visible("pair-1-thinking-markdown")).toBe(true);
		expect(visible("pair-1-answer-stream")).toBe(false);
		expect(visible("pair-1-answer-markdown")).toBe(true);
	 // No frame duplicates the thought or the reply across the pair.
		const frame = setup.captureCharFrame();
		expect(frame.split("considering it").length - 1).toBe(1);
		expect(frame.split("draft reply").length - 1).toBe(1);
		// Collapsed -> expanded flip on the settled item: preview hides as
		// the markdown shows, still exactly one.
		setExpanded(false);
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		expect(visible("pair-1-thinking-markdown")).toBe(false);
		setExpanded(true);
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		expect(visible("pair-1-thinking-markdown")).toBe(true);
		expect(setup.captureCharFrame().split("considering it").length - 1).toBe(1);
	});
});
