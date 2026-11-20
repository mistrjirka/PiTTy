import { describe, expect, test } from "bun:test";
import { ForkPicker } from "../src/ui/fork-picker.tsx";
import { TabStrip } from "../src/ui/tab-strip.tsx";
import { forkPickerOptions } from "../src/tabs/entry-index.ts";

import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("OpenTUI components", () => {
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
					onSelect={(entryId) => {
						selectedEntry = entryId;
					}}
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
		expect(frame).toContain("enter fork");

		let firstArrowSelected: string | undefined;
		const firstArrow = await mount(
			() => (
				<ForkPicker
					options={choices}
					onSelect={(entryId) => {
						firstArrowSelected = entryId;
					}}
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
					onSelect={(entryId) => {
						mouseSelected = entryId;
					}}
					onCancel={() => {}}
				/>
			),
			80,
			18,
		);
		const mouseFrame = mouse.captureCharFrame();
		const row = mouseFrame
			.split("\n")
			.findIndex((line) => line.includes("2. Second message"));
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
					onSelect={(entryId) => {
						scrolledMouseSelection = entryId;
					}}
					onCancel={() => {}}
				/>
			),
			80,
			24,
		);
		scrolled.mockInput.pressArrow("down");
		for (let index = 0; index < 22; index++)
			scrolled.mockInput.pressArrow("down");
		await scrolled.flush();
		const scrolledFrame = scrolled.captureCharFrame();
		const scrolledLines = scrolledFrame.split("\n");
		const scrolledRow = scrolledLines.findIndex((line) =>
			/\d+\. Message \d+/.test(line),
		);
		const visibleMatch =
			scrolledLines[scrolledRow]?.match(/(\d+)\. Message \d+/);
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
					onActivate={(id) => {
						activated = id;
					}}
					onClose={() => {}}
					onCreate={() => {
						created = true;
					}}
					onOpenForkPicker={() => {
						forkOpened = true;
					}}
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
		expect(frame).toContain("✓ Forked");
		const forkColumn = tabLines[0]!.indexOf("⑂");
		const plusColumn = tabLines[0]!.indexOf("+");
		expect(forkColumn).toBeGreaterThan(tabLines[0]!.indexOf("Forked"));
		expect(plusColumn).toBe(forkColumn + 3);
		for (const line of frame.split("\n"))
			expect(line.length).toBeLessThanOrEqual(42);
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
					onCreate={() => {
						created = true;
					}}
					onOpenForkPicker={() => {
						forkOpened = true;
					}}
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
					tabs={[
						{
							id: "narrow",
							sessionName: "a very long session title",
							badges: 0,
						},
					]}
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
});
