import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { MessageView } from "../src/ui/message.tsx";
import { subagentTargets, type SubagentTarget } from "../src/subagents/targets.ts";
import {
	computeSpawnGroups,
	SPAWN_GROUP_ID_PREFIX,
	spawnGroupId,
	spawnGroupRowText,
	SpawnGroupCard,
} from "../src/ui/spawn-group.tsx";
import type { ConversationItem, SubagentRun, ToolItem } from "../src/types.ts";

import { mount } from "./render-helpers/mount.tsx";

describe("duration and sidebar repaint regressions", () => {
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
		// Children render as tree rows under the spawn row.
		expect(frame).toMatch(/├ . /);
		expect(frame).toMatch(/└ . /);
		expect(frame).toContain("1s ago");
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
			{
				key: "w1",
				run: {
					runId: "w1",
					mode: "single",
					state: "running",
					agent: "explore",
					steps: [],
				},
				label: "@w1 — worker one",
				state: "running",
				active: true,
				canSteer: false,
				lastUpdate: 1_000,
			},
			{
				key: "w2",
				run: {
					runId: "w2",
					mode: "single",
					state: "running",
					agent: "explore",
					steps: [],
				},
				label: "@w2 — worker two",
				state: "running",
				active: true,
				canSteer: false,
				lastUpdate: 1_000,
			},
			{
				key: "f1",
				run: {
					runId: "f1",
					mode: "single",
					state: "completed",
					agent: "explore",
					steps: [],
				},
				label: "@f1 — finisher one",
				state: "completed",
				active: false,
				canSteer: false,
				lastUpdate: 1_000,
			},
			{
				key: "f2",
				run: {
					runId: "f2",
					mode: "single",
					state: "completed",
					agent: "explore",
					steps: [],
				},
				label: "@f2 — finisher two",
				state: "completed",
				active: false,
				canSteer: false,
				lastUpdate: 1_000,
			},
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
			{
				key: "w1",
				run: {
					runId: "w1",
					mode: "single",
					state: "running",
					agent: "explore",
					steps: [],
				},
				label: "@w1 — worker one",
				state: "running",
				active: true,
				canSteer: false,
				lastUpdate: 1_000,
			},
			{
				key: "w2",
				run: {
					runId: "w2",
					mode: "single",
					state: "running",
					agent: "explore",
					steps: [],
				},
				label: "@w2 — worker two",
				state: "running",
				active: true,
				canSteer: false,
				lastUpdate: 1_000,
			},
			{
				key: "f1",
				run: {
					runId: "f1",
					mode: "single",
					state: "completed",
					agent: "explore",
					steps: [],
				},
				label: "@f1 — finisher one",
				state: "completed",
				active: false,
				canSteer: false,
				lastUpdate: 1_000,
			},
			{
				key: "f2",
				run: {
					runId: "f2",
					mode: "single",
					state: "completed",
					agent: "explore",
					steps: [],
				},
				label: "@f2 — finisher two",
				state: "completed",
				active: false,
				canSteer: false,
				lastUpdate: 1_000,
			},
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
		// Each spawn card owns one child and draws it as a tree row.
		expect(
			frame.split("\n").filter((line) => /^\s*└ . /.test(line)).length,
		).toBe(4);
		// The collapsed one-line rows are gone; each child now renders its
		// own two-row tree block.
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
		const middle: ToolItem = {
			...spawn("bash-1"),
			name: "bash",
			args: { command: "ls" },
		};
		const right = [spawn("s3"), spawn("s4")];
		const items: ConversationItem[] = [...left, middle, ...right];
		const owned = new Map<string, SubagentTarget[]>(
			[...left, ...right].map((tool) => [
				tool.id,
				[
					{
						key: tool.id,
						run: {
							runId: tool.id,
							mode: "single",
							state: "running",
							agent: "explore",
							steps: [],
						},
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

	test("spawn group keys cannot collide with real item ids", () => {
		// Real item ids are `prefix-base36time-random` (history-tool-…, tool-…)
		// and never contain a colon, so the `group:` prefix cannot match one.
		expect(SPAWN_GROUP_ID_PREFIX).toContain(":");
		expect(spawnGroupId("tool-abc-123")).toBe("group:tool-abc-123");
		expect(spawnGroupId("history-tool-abc")).not.toBe("history-tool-abc");
		expect(spawnGroupId("a")).not.toBe(spawnGroupId("b"));
	});
});
