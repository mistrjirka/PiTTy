import { describe, expect, test } from "bun:test";
import { type TextareaRenderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { SubagentInspector } from "../src/ui/subagent-inspector.tsx";
import type { SubagentRun } from "../src/types.ts";
import type { PendingSteerEntry } from "../src/state/input-continuity.ts";

import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("OpenTUI components", () => {
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
			"◷ queued  check the failing test",
		);
		expect(setup.captureCharFrame()).toContain(
			"◷ still queued  preserve this draft",
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
});
