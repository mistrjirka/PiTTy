import { afterEach, describe, expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import type { JSX } from "solid-js";
import { BackgroundTaskDialog } from "../src/ui/background-task-dialog.tsx";
import { Sidebar } from "../src/ui/sidebar.tsx";
import type { BackgroundOutputPage, BackgroundTask } from "../src/state/background-tasks.ts";

const active: TestRendererSetup[] = [];
afterEach(() => {
	for (const setup of active.splice(0)) setup.renderer.destroy();
});
async function mount(node: () => JSX.Element, width = 110, height = 35) {
	const setup = await testRender(node, { width, height, useMouse: true, enableMouseMovement: true });
	active.push(setup);
	await setup.flush();
	await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 60 });
	return setup;
}
async function clickText(setup: TestRendererSetup, text: string) {
	const lines = setup.captureCharFrame().split("\n");
	const y = lines.findIndex((line) => line.includes(text));
	const x = y >= 0 ? lines[y]!.indexOf(text) : -1;
	expect(y).toBeGreaterThanOrEqual(0);
	expect(x).toBeGreaterThanOrEqual(0);
	await setup.mockMouse.click(x, y);
	await setup.flush();
}

const task: BackgroundTask = {
	id: "bg-1",
	command: "bun test --conditions=browser test",
	commandTruncated: false,
	cwd: "/home/dev/project",
	state: "running",
	startedAt: 1234,
};
const logPage: BackgroundOutputPage = {
	text: "test output\nline two\nline three",
	page: 0, maxPage: 2, startByte: 65536, endByte: 131072,
	totalBytes: 131072, compressed: false, available: true,
};

describe("background jobs in sidebar and viewer", () => {
	test("uses no extra sidebar rows when background jobs are absent", async () => {
		const setup = await mount(() => <Sidebar runs={[]} />, 45, 28);
		expect(setup.captureCharFrame()).not.toContain("Background (");
		expect(setup.renderer.root.findDescendantById("background-panel")).toBeUndefined();
	});
	test("lists jobs with a bounded panel and opens the clicked original command", async () => {
		const clicked: string[] = [];
		const setup = await mount(() => (
			<Sidebar
				runs={[]}
				backgroundTasks={[task, { ...task, id: "bg-2", state: "exited", exitCode: 1, command: "npm run build" }]}
				onOpenBackgroundTask={(id) => clicked.push(id)}
				height={28}
			/>
		), 45, 29);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Background (1 active");
		expect(frame).toContain("bg-1");
		expect(frame).toContain("bg-2");
		expect(setup.renderer.root.findDescendantById("background-scroll")).toBeDefined();
		await clickText(setup, "bg-1");
		expect(clicked).toEqual(["bg-1"]);
	});
	test("scrolls through a long background output without truncating the selected page", async () => {
		const longPage: BackgroundOutputPage = {
			...logPage,
			text: Array.from({ length: 400 }, (_, i) => `test line ${i.toString().padStart(3, "0")}`).join("\n"),
		};
		const setup = await mount(() => (
			<BackgroundTaskDialog
				task={() => task}
				output={() => longPage}
				busy={false}
				onPage={() => {}}
				onAnalyze={() => {}}
				onClose={() => {}}
			/>
		), 110, 30);
		const scroll = setup.renderer.root.findDescendantById("background-output-scroll") as import("@opentui/core").ScrollBoxRenderable;
		expect(scroll).toBeDefined();
		const before = scroll.scrollTop;
		scroll.scrollBy(40);
		await setup.flush();
		expect(scroll.scrollTop).toBeGreaterThan(before);
	});

	test("shows the command, scrollable output and navigation without running analysis automatically", async () => {
		const pages: number[] = [];
		let analyzed = 0;
		let closed = 0;
		const setup = await mount(() => (
			<BackgroundTaskDialog
				task={() => task}
				output={() => logPage}
				busy={false}
				onPage={(page) => pages.push(page)}
				onAnalyze={() => analyzed++}
				onClose={() => closed++}
			/>
		), 114, 32);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Original command");
		expect(frame).toContain(task.command);
		expect(frame).toContain("test output");
		expect(setup.renderer.root.findDescendantById("background-output-scroll")).toBeDefined();
		await clickText(setup, "Older");
		expect(pages).toEqual([1]);
		await clickText(setup, "Analyze with Pi");
		expect(analyzed).toBe(1);
		await clickText(setup, "× Close");
		expect(closed).toBe(1);
	});
});
