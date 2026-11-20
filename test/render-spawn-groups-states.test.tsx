import { describe, expect, test } from "bun:test";
import { MessageView } from "../src/ui/message.tsx";
import type { SubagentTarget } from "../src/subagents/targets.ts";
import { computeSpawnGroups, spawnGroupRowText, spawnGroupSummary } from "../src/ui/spawn-group.tsx";
import type { ToolItem } from "../src/types.ts";

import { mount } from "./render-helpers/mount.tsx";

describe("duration and sidebar repaint regressions", () => {
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
		const child = (
			key: string,
			state: string,
			extra: Partial<SubagentTarget> = {},
		): SubagentTarget => ({
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
		const working = child("w1", "running", {
			run: {
				runId: "w1",
				mode: "single",
				state: "running",
				agent: "explore",
				steps: [],
				toolCount: 3,
			},
		});
		expect(spawnGroupRowText(working, 2_000)).toBe(
			`● @w1 — helper · working · 1s ago · 3 tools`,
		);
		// Working child without usage yet: honestly `starting…`, once.
		const starting = child("w2", "running");
		const startingRow = spawnGroupRowText(starting, 2_000);
		expect(startingRow).toBe(`● @w2 — helper · working · 1s ago · starting…`);
		expect(startingRow.split("starting…").length - 1).toBe(1);
		// Finished / resident / unresponsive children: the state word appears
		// exactly once — the usage line stays empty instead of restating it.
		const finished = child("done-1", "completed");
		expect(spawnGroupRowText(finished, 2_000)).toBe(
			`✓ @done-1 — helper · finished · 1s ago`,
		);
		// A resident (`idle`) child is live-but-idle: the status-file timestamp
		// is not an age of anything the user did, so the row names the state
		// on its own. A waiting child reads the same way.
		const resident = child("res-1", "idle");
		expect(spawnGroupRowText(resident, 2_000)).toBe(
			`○ @res-1 — helper · resident`,
		);
		expect(spawnGroupRowText(resident, 2_000)).not.toContain("ago");
		const waiting = child("wait-1", "waiting");
		expect(spawnGroupRowText(waiting, 2_000)).toBe(
			`◷ @wait-1 — helper · waiting for parent`,
		);
		expect(spawnGroupRowText(waiting, 2_000)).not.toContain("ago");
		const unresponsive = child("st-1", "unresponsive");
		expect(spawnGroupRowText(unresponsive, 2_000)).toBe(
			`○ @st-1 — helper · unresponsive · 1s ago`,
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
		const odd: SubagentTarget = {
			...finished,
			key: "odd-1",
			label: "@odd-1 — mystery",
			state: "bogus",
		};
		expect(spawnGroupSummary([finished, odd])).toBe("1 finished");
	});
});
