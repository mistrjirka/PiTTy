import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type ScrollBoxRenderable } from "@opentui/core";
import { Sidebar, sidebarScopeForTarget } from "../src/ui/sidebar.tsx";
import { friendlyTargetState } from "../src/ui/model-context.tsx";
import { SubagentInspector, inspectedTargetScrollY } from "../src/ui/subagent-inspector.tsx";
import { subagentTargets, type SubagentTarget } from "../src/subagents/targets.ts";
import type { ConversationItem, SubagentRun, ToolItem } from "../src/types.ts";

import { mount } from "./render-helpers/mount.tsx";
import { tempDirs, useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("OpenTUI components", () => {
	test("inspectedTargetScrollY opens finished runs at the top and keeps live runs at the tail", () => {
		expect(inspectedTargetScrollY({ active: true })).toBe(
			Number.MAX_SAFE_INTEGER,
		);
		expect(inspectedTargetScrollY({ active: false })).toBe(0);
		expect(inspectedTargetScrollY(undefined)).toBe(0);
	});

	test("a finished inspector transcript shows the first thinking at the top and the tail at the bottom", async () => {
		const items: ConversationItem[] = [
			{
				kind: "user",
				id: "scroll-user",
				text: "task",
				timestamp: 1,
				optimistic: false,
			},
			{
				kind: "assistant",
				id: "scroll-first",
				text: "",
				thinking: "FIRST thinking section",
				timestamp: 2,
				status: "done",
			},
			...Array.from(
				{ length: 6 },
				(_, index): ConversationItem => ({
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
				}),
			),
			{
				kind: "assistant",
				id: "scroll-second",
				text: "",
				thinking: "SECOND thinking section",
				timestamp: 20,
				status: "done",
			},
		];
		const run: SubagentRun = {
			runId: "scroll-run",
			mode: "single",
			state: "completed",
			steps: [],
		};
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
			{
				kind: "assistant",
				id: `mount-first`,
				text: "",
				thinking: first,
				timestamp: 2,
				status: "done",
			},
			...Array.from(
				{ length: 12 },
				(_, index): ConversationItem => ({
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
				}),
			),
			{
				kind: "assistant",
				id: `mount-last`,
				text: "",
				thinking: last,
				timestamp: 99,
				status: "done",
			},
		];
		const finishedRun: SubagentRun = {
			runId: "mount-finished",
			mode: "single",
			state: "completed",
			steps: [],
		};
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
		const root = fs.mkdtempSync(
			path.join(base, "pi-profiled-subagents-mount-"),
		);
		tempDirs.push(root);
		const treeId = `tree-mount-${Date.now()}`;
		const controlDir = path.join(root, "mount-live-");
		fs.mkdirSync(path.join(controlDir, "control", "steer-requests"), {
			recursive: true,
		});
		fs.mkdirSync(path.join(controlDir, "control", "acks"), { recursive: true });
		const statusPath = path.join(controlDir, "status.json");
		fs.writeFileSync(
			statusPath,
			JSON.stringify({
				version: 1,
				runtime: "profiled-subagents",
				treeId,
				updatedAt: now,
				agentId: "mount-liver",
				profile: "explore",
				parentAgentId: "root",
				label: "mount-liver",
				state: "running",
				startedAt: now - 1000,
			}),
		);
		const liveTool: ToolItem = {
			kind: "tool",
			id: "spawn-mount-liver",
			toolCallId: "spawn-mount-liver-call",
			name: "agent_spawn",
			args: { agent: "explore" },
			output: "",
			details: {
				runtime: "profiled-subagents",
				treeId,
				parentAgentId: "root",
				agentId: "mount-liver",
				profile: "explore",
				label: "mount-liver",
				state: "running",
				controlDir,
				statusPath,
			},
			timestamp: now,
			status: "done",
			isError: false,
		};
		const liveTarget = subagentTargets([], [liveTool]).find(
			(target) => target.run.agentId === "mount-liver",
		)!;
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

	test("inspector header shows activity once and leaves model/context to the sidebar", async () => {
		// Model and context for an open agent live in the sidebar scope, so the
		// inspector header must not repeat them; the cumulative token string
		// stays out of the header too.
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
		expect(frame).not.toContain("Context");
		expect(frame).not.toContain("Model");
		expect(frame.split("↳ bash").length - 1).toBe(1);
		expect(frame).not.toContain("4K tok");
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
		expect(parentFrame).toContain("@theo · explore");
		expect(parentFrame).toContain("inspect");
		expect(parentFrame).not.toContain("\nSubagents\n");

		let inspected: string | undefined;
		const childView = await mount(
			() => (
				<SubagentInspector
					target={child}
					allTargets={[parent, child]}
					items={[]}
					now={4}
					onInspectSubagentTarget={(key) => {
						inspected = key;
					}}
				/>
			),
			100,
			24,
		);
		const childFrame = childView.captureCharFrame();
		expect(childFrame).toContain("Main › @cai · implementer › @theo · explore");
		// The parent crumb replaces the old "← parent" link.
		const crumbRow = childFrame.split("\n").findIndex((line) => line.includes("@cai"));
		await childView.mockMouse.click(
			childFrame.split("\n")[crumbRow]!.indexOf("@cai") + 1,
			crumbRow,
		);
		expect(inspected).toBe(parent.key);
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
		expect(frame).toContain("◓ working");
		expect(frame).not.toContain("profiled/running");
		// The child's model and window render in the sidebar scope, once.
		expect(frame).not.toContain("anthropic/claude-opus");
		const sidebar = await mount(
			() => (
				<Sidebar
					runs={[run]}
					scope={sidebarScopeForTarget(target)}
					inspecting
					selectedTargetKey={target.key}
				/>
			),
			42,
			24,
		);
		const sidebarFrame = sidebar.captureCharFrame();
		expect(sidebarFrame).toContain("50K / 200K");
		expect(sidebarFrame).toContain("25%");
		expect(sidebarFrame).toContain("anthropic/claude-opus");
		expect(sidebarFrame).toContain("THINK HIGH");
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
		expect(frame).toContain("○ resident");
		expect(frame).not.toContain("working");
		expect(frame).not.toContain("◐");
		expect(frame).not.toContain("◓");
		expect(frame).not.toContain("◑");
		expect(frame).not.toContain("◒");
		expect(frame).not.toContain("% used");
		expect(frame).not.toContain("profiled/idle");
		expect(frame).not.toContain("▤");
	});

	test("inspector shows the pending ask_parent question without a duplicate model message", async () => {
		const run: SubagentRun = {
			runId: "question-1",
			control: "profiled",
			controlDir: "/tmp/question-1",
			mode: "profiled",
			state: "waiting",
			agent: "implementer",
			startedAt: 1_000,
			steps: [],
			pendingQuestion: "Approve the retention hold?",
			pendingQuestionContext: "Delete is blocked",
		};
		const target = subagentTargets([run])[0]!;
		const setup = await mount(
			() => <SubagentInspector target={target} items={[]} now={2_000} />,
			100,
			24,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("asked main  Approve the retention hold?");
		expect(frame).toContain("Delete is blocked");
	});
});
