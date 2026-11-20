import { describe, expect, test } from "bun:test";
import { SkillSelector, skillDisplayName } from "../src/ui/skill-selector.tsx";

import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("OpenTUI components", () => {
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
			<SkillSelector
				commands={commands}
				onSelect={() => {}}
				onCancel={() => {}}
			/>
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
					{
						name: "review-pr",
						description: "Extension command",
						source: "extension",
					},
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
});
