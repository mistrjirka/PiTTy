import { describe, expect, test } from "bun:test";
import { type ScrollBoxRenderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { Sidebar, sidebarScopeForTarget } from "../src/ui/sidebar.tsx";
import { SubagentInspector } from "../src/ui/subagent-inspector.tsx";
import { subagentSelectorOptions } from "../src/ui/subagent-selector.tsx";
import { subagentTargets, type SubagentTarget } from "../src/subagents/targets.ts";
import type { ConversationItem, SubagentRun } from "../src/types.ts";

import { mount } from "./render-helpers/mount.tsx";

describe("profiled command visibility", () => {
	test("renders independent command clocks until actual completion, including unknown timeouts", async () => {
		const startedAt = 1_000;
		const first = {
			toolCallId: "a",
			toolName: "bash",
			startedAt,
			timeoutSeconds: 2100,
		};
		const second = {
			toolCallId: "b",
			toolName: "read",
			startedAt: startedAt + 60_000,
		};
		const initial: SubagentRun = {
			runId: "profiled:joy",
			mode: "profiled",
			runtime: "profiled-subagents",
			control: "profiled",
			agentId: "joy",
			profile: "general",
			state: "running",
			startedAt,
			steps: [],
			activeTools: [first, second],
		};
		const [run, setRun] = createSignal(initial);
		const [now, setNow] = createSignal(startedAt + 1_293_000);
		const target = (): SubagentTarget => ({
			key: "joy",
			run: run(),
			label: "Joy",
			state: run().state,
			active: run().state === "running",
			canSteer: false,
			startedAt,
		});
		const setup = await mount(
			() => <SubagentInspector target={target()} items={[]} now={now()} />,
			120,
			24,
		);
		const flush = async () => {
			await setup.flush();
			await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		};
		let frame = setup.captureCharFrame();
		expect(frame).toContain("↳ bash 21m 33s of 35m 0s · 13m 27s left");
		expect(frame).toContain("↳ read 20m 33s · no timeout");
		setNow(startedAt + 2_101_000);
		await flush();
		frame = setup.captureCharFrame();
		expect(frame).toContain("of 35m 0s · timed out, waiting for exit");
		setRun({ ...initial, activeTools: [second] });
		await flush();
		frame = setup.captureCharFrame();
		expect(frame).not.toContain("of 35m 0s");
		expect(frame).toContain("· no timeout");
		setRun({ ...initial, activeTools: undefined });
		await flush();
		expect(setup.captureCharFrame()).not.toContain("· no timeout");
		for (const state of ["idle", "completed", "unresponsive"]) {
			setRun({ ...initial, state });
			await flush();
			expect(setup.captureCharFrame()).not.toContain("· no timeout");
		}
	});
});

describe("OpenTUI components", () => {
	test("subagent chooser projects the same recursive hierarchy as the sidebar", () => {
		const target = (
			agentId: string,
			parentAgentId: string,
			profile: string,
			startedAt: number,
		): SubagentTarget => ({
			key: `selector-${agentId}`,
			run: {
				runId: `selector-${agentId}`,
				runtime: "profiled-subagents",
				control: "profiled",
				controlDir: `/tmp/selector-${agentId}`,
				treeId: "tree-selector",
				agentId,
				parentAgentId,
				profile,
				label: profile,
				mode: parentAgentId === "root" ? "profiled" : "nested",
				state: "completed",
				startedAt,
				steps: [],
			},
			label: `@${agentId} · ${profile}`,
			state: "completed",
			active: false,
			canSteer: false,
			startedAt,
		});
		const parent = target("cai", "root", "implementer", 100);
		const first = target("theo", "cai", "explore", 110);
		const second = target("aki", "cai", "explore", 120);
		const options = subagentSelectorOptions([second, first, parent]);
		// Name column first; the state follows after the padding.
		expect(options.map((option) => option.name.slice(0, 44).trimEnd())).toEqual([
			"✓ @cai · implementer",
			"├─ ✓ @theo · explore",
			"└─ ✓ @aki · explore",
		]);
		expect(options[0]!.name).toContain("finished");
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
		// The "Main" breadcrumb is the close target.
		const y = lines.findIndex((line) => line.includes("Main ›"));
		const x = y >= 0 ? lines[y]!.indexOf("Main ›") + 1 : -1;
		expect(y).toBeGreaterThanOrEqual(0);
		expect(x).toBeGreaterThanOrEqual(0);
		await setup.mockMouse.click(x, y);
		await Bun.sleep(60);
		await setup.flush();
		expect(closed).toBeGreaterThan(0);
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
		const scoped = await mount(
			() => <Sidebar runs={[]} scope={sidebarScopeForTarget(target)} inspecting />,
			42,
			24,
		);
		expect(scoped.captureCharFrame()).not.toContain("\u001b");
		expect(scoped.captureCharFrame()).not.toContain("\u0007");
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
		expect(queued).toContain("◐ working");
		const waiting = await frameFor("waiting");
		expect(waiting).toContain("◷ waiting for parent");
		expect(waiting).not.toContain("working");
		for (const glyph of glyphs) expect(waiting).not.toContain(glyph);
		const idle = await frameFor("idle");
		expect(idle).toContain("○ resident");
		expect(idle).not.toContain("working");
		for (const glyph of glyphs) expect(idle).not.toContain(glyph);
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
				<SubagentInspector
					target={activeTarget}
					items={[toolItem]}
					now={61_000}
				/>
			),
			100,
			30,
		);
		const toolRow = (frame: string) =>
			frame.split("\n").find((line) => line.includes(" bash")) ?? "";
		expect(toolRow(activeView.captureCharFrame())).toContain("1m 0s");
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
		// A finished target freezes item time: no live `1m 0s`, and the
		// zero-length call shows no duration at all.
		expect(toolRow(finishedView.captureCharFrame())).not.toContain("1m 0s");
		expect(toolRow(finishedView.captureCharFrame())).not.toContain("0ms");
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
		expect(runningView.captureCharFrame()).toContain("⏸ pause");
		expect(runningView.captureCharFrame()).toContain("⏹ stop");
		const queuedView = await mount(
			() => <SubagentInspector target={queued} items={[]} now={1} />,
			100,
			24,
		);
		expect(queuedView.captureCharFrame()).toContain("⏹ stop");
		expect(queuedView.captureCharFrame()).toContain("ctrl+shift+a stop");
		expect(queuedView.captureCharFrame()).not.toContain("⏸ pause");
		expect(queuedView.captureCharFrame()).not.toContain("ctrl+a pause");
		const pausedView = await mount(
			() => <SubagentInspector target={paused} items={[]} now={1} />,
			100,
			24,
		);
		expect(pausedView.captureCharFrame()).toContain("▶ resume");
		expect(pausedView.captureCharFrame()).toContain("⏹ stop");
		expect(pausedView.captureCharFrame()).toContain("ctrl+shift+a stop");
		expect(pausedView.captureCharFrame()).not.toContain("⏸ pause");
		expect(pausedView.captureCharFrame()).not.toContain("ctrl+a pause");
		const finishedView = await mount(
			() => <SubagentInspector target={finished} items={[]} now={1} />,
			100,
			24,
		);
		expect(finishedView.captureCharFrame()).not.toContain("⏹ stop");
		const foregroundView = await mount(
			() => <SubagentInspector target={foreground} items={[]} now={1} />,
			100,
			24,
		);
		expect(foregroundView.captureCharFrame()).not.toContain("⏹ stop");
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
});

describe("batch A data truth", () => {
	test("inspector rows resolve an honest clock and timing renders empty without one", async () => {
		const { inspectorItemNow } = await import(
			"../src/ui/subagent-inspector.tsx"
		);
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
		expect(toolTiming(tool, 500)).toBe("400ms");
	});
});
