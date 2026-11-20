import { describe, expect, test } from "bun:test";
import { type BoxRenderable } from "@opentui/core";
import {
	Sidebar,
	sidebarScopeForTarget,
	targetToolActivity,
	targetToolUsage,
} from "../src/ui/sidebar.tsx";
import { stateColor, stateIcon } from "../src/ui/model-context.tsx";
import { SubagentSelectorDialog } from "../src/ui/subagent-selector.tsx";
import { subagentTargets, type SubagentTarget } from "../src/subagents/targets.ts";
import { computeSpawnGroups, spawnGroupRowText, SpawnGroupCard } from "../src/ui/spawn-group.tsx";
import type { RpcSessionState, SessionStats, SubagentRun, ToolItem } from "../src/types.ts";
import { colors } from "../src/ui/theme.ts";

import { mount } from "./render-helpers/mount.tsx";

describe("OpenTUI components", () => {
	test("idle residents show tool counts but no stale context usage", async () => {
		const resident: SubagentTarget = {
			key: "profiled:resident-idle",
			run: {
				runId: "profiled:resident-idle",
				control: "profiled",
				runtime: "profiled-subagents",
				mode: "profiled",
				state: "idle",
				steps: [],
				agentId: "ron",
				profile: "explore",
				label: "resident",
				toolCount: 3,
				tokens: { window: 168187 },
				contextWindow: 1048576,
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
		// Sidebar scope for the open agent: the stale window drops, Model stays.
		const scope = sidebarScopeForTarget({
			...resident,
			model: "provider/model",
			thinking: "medium",
		});
		expect(scope.used).toBeUndefined();
		expect(scope.model).toBe("provider/model");
		expect(scope.thinking).toBe("medium");
	});

	test("sidebar never reports working/starting for finished children", () => {
		const sidebarTarget = (
			state: string,
			runExtra: Partial<SubagentRun> = {},
		): SubagentTarget => {
			const run: SubagentRun = {
				runId: `sidebar-${state}`,
				mode: "profiled",
				state,
				agent: "explore",
				steps: [],
				...runExtra,
			};
			return {
				key: run.runId,
				run,
				label: "explore",
				state,
				active: false,
				canSteer: false,
			};
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
		expect(
			targetToolActivity(sidebarTarget("completed", { currentTool: "bash" })),
		).toBe("bash");
		expect(
			targetToolActivity(
				sidebarTarget("running", {
					currentTool: "bash",
					currentPath: "src/a.ts",
				}),
			),
		).toBe("bash · src/a.ts");
		// Real usage numbers win over every fallback.
		expect(targetToolUsage(sidebarTarget("completed", { toolCount: 3 }))).toBe(
			"3 tools",
		);
		expect(targetToolUsage(sidebarTarget("running", { toolCount: 3 }))).toBe(
			"3 tools",
		);
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
			() => (
				<Sidebar
					state={state}
					runs={[makeLive("waiting", "waiting"), makeLive("idle", "idle")]}
					now={now}
				/>
			),
			42,
			30,
		);
		const frame = sidebar.captureCharFrame();
		expect(frame).toContain("waiting for parent");
		expect(frame).toContain("resident");
		expect(frame).not.toContain("working");
		expect(frame).not.toContain("starting");
	});

	test("sidebar model row keeps the 35-column truncation", async () => {
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
		expect(frame).toContain("367K left");
		expect(frame).toMatch(/Context\s+8%/);
		expect(frame).toContain("openai-codex/gpt-5.6-sol");
		expect(frame).toMatch(/Model\s+high/);
	});

	test("uses lifecycle state for agent row glyphs and colours", async () => {
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
		// Rows carry state in a single-cell glyph and its colour, not a border.
		const frame = (
			await mount(() => <Sidebar runs={runs} />, 42, 24)
		).captureCharFrame();
		expect(frame).toContain("● running-worker");
		expect(frame).toContain("◌ queued-worker");
		expect(frame).toContain("✗ failed-worker");
		expect(stateColor("running")).toBe(colors.accent);
		expect(stateColor("queued")).toBe(colors.yellow);
		expect(stateColor("failed")).toBe(colors.red);
		expect(stateColor("completed")).toBe(colors.green);
		expect(stateIcon("waiting")).toBe("◷");
	});
});

describe("duration and sidebar repaint regressions", () => {
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
		const setup = await mount(() => <Sidebar runs={[run]} now={now} />, 42, 30);
		const frame = setup.captureCharFrame();
		// A resident child is live-but-idle: the status-file timestamp is not
		// an age of anything the user did, so the row names the state on its
		// own and prints no age. The usage line stays empty instead of
		// restating the state. (The sidebar Session header's own "starting…"
		// placeholder is unrelated.)
		expect(frame).toContain("resident");
		expect(frame).not.toContain("ago");
		// Once in the row itself; the Agents header summary is separate.
		expect(
			frame
				.split("\n")
				.filter((line) => !line.includes("Agents"))
				.join("\n")
				.split("resident").length - 1,
		).toBe(1);
		const box = setup.renderer.root.findDescendantById(
			"subagent-resident-child",
		) as BoxRenderable;
		expect(box.height).toBe(2);
	});

	test("sidebar agents header shows the live count", async () => {
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
		// The Agents header carries the live count; the key hint moved to the
		// footer, so the header never has to squeeze it.
		expect(frame).toMatch(/Agents\s+1 working/);
		expect(frame).not.toContain("Ctrl+I");
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
		const sidebar = await mount(
			() => <Sidebar runs={[run]} now={2_000} />,
			42,
			30,
		);
		const cardFrame = card.captureCharFrame();
		const selectorFrame = selector.captureCharFrame();
		const sidebarFrame = sidebar.captureCharFrame();
		// Wherever a state word is shown, it reads unresponsive…
		expect(cardFrame).toContain("unresponsive");
		expect(selectorFrame).toContain("unresponsive");
		// …and the old word appears in no rendered frame. (The inactive
		// sidebar row shows icon + label only, so it names no state.)
		for (const frame of [cardFrame, selectorFrame, sidebarFrame]) {
			expect(frame).not.toMatch(/stale/i);
		}
	});
});
