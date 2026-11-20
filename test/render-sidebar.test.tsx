import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { Sidebar } from "../src/ui/sidebar.tsx";
import type { NotificationRecord, RpcSessionState, SessionStats, SubagentRun } from "../src/types.ts";

import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("OpenTUI components", () => {
	test("hides optional integration panels when packages are unavailable", async () => {
		const setup = await mount(
			() => (
				<Sidebar
					runs={[]}
					subagentsAvailable={false}
				/>
			),
			42,
			28,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Context");
		expect(frame).not.toContain("Agents");
		expect(frame).not.toContain("Todos");
		expect(frame).not.toContain("Ctrl+I inspect");
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
					notifications={records}
					height={30}
				/>
			),
			42,
			30,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Notices");
		expect(frame).toContain("2 new");
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
					notifications={[]}
					height={30}
				/>
			),
			42,
			30,
		);
		expect(setup.captureCharFrame()).not.toContain("Notices");
		expect(
			setup.renderer.root.findDescendantById("notification-panel"),
		).toBeUndefined();
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
		if (!subagentPanel) throw new Error("sidebar panels missing");
		const initialSubagentHeight = subagentPanel.height;
		// Active agents take two rows: name, then what they are doing.
		expect(row.height).toBe(2);

		setRuns([{ ...runningRun, state: "completed" }]);
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		const nextFrame = setup.captureCharFrame();
		expect(subagentPanel.height).toBe(initialSubagentHeight);
		expect(nextFrame).toContain("✓ reactive-worker");
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
		expect(frame).toContain("✓ finished-worker");
		expect(frame).not.toContain("ago");
		expect(row.screenY + row.height).toBeLessThanOrEqual(30);
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
		// The session name lives in the tab strip now, not the sidebar.
		expect(frame).toContain("gpt-5.6-sol");
		expect(frame).toContain("● implementer");
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
				tokens: {
					total: 497506,
					input: 480012,
					output: 17494,
					window: 168187,
					windowPeak: 168187,
				},
				currentTool: "bash",
				steps: [
					{
						index: 0,
						agent: "implementer",
						status: "running",
						contextWindow: 1048576,
						tokens: {
							total: 497506,
							input: 480012,
							output: 17494,
							window: 168187,
							windowPeak: 168187,
						},
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

	test("renders profiled descendants beneath their parent in the sidebar", async () => {
		const profiledRun = (
			agentId: string,
			parentAgentId: string,
			profile: string,
			startedAt: number,
		): SubagentRun => ({
			runId: `profiled-${agentId}`,
			runtime: "profiled-subagents",
			control: "profiled",
			treeId: "tree-sidebar",
			agentId,
			parentAgentId,
			profile,
			label: profile,
			mode: parentAgentId === "root" ? "profiled" : "nested",
			state: "completed",
			startedAt,
			endedAt: startedAt + 1,
			steps: [],
		});
		const setup = await mount(
			() => (
				<Sidebar
					runs={[
						profiledRun("cai", "root", "implementer", 100),
						profiledRun("theo", "cai", "explore", 110),
						profiledRun("aki", "cai", "explore", 120),
					]}
					height={32}
				/>
			),
			42,
			32,
		);
		const frame = setup.captureCharFrame();
		const parent = frame.indexOf("@cai · implementer");
		const firstChild = frame.indexOf("├─ ✓ @theo · explore");
		const secondChild = frame.indexOf("└─ ✓ @aki · explore");
		expect(parent).toBeGreaterThanOrEqual(0);
		expect(firstChild).toBeGreaterThan(parent);
		expect(secondChild).toBeGreaterThan(firstChild);
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

	test("sidebar spends no rows on provider usage", async () => {
		const frame = (
			await mount(() => <Sidebar runs={[]} />, 42, 40)
		).captureCharFrame();
		expect(frame).not.toContain("OpenCode Go");
		expect(frame).not.toContain("Claude limits");
		expect(frame).not.toContain("Codex");
	});

	test("mcp hover floats the server list without shifting panels", async () => {
		// Right-align like the app does: the floating card needs room on the
		// left of the 38-column sidebar, which it always has at real widths.
		const setup = await mount(
			() => (
				<box width={100} flexDirection="row">
					<box flexGrow={1} />
					<Sidebar
						runs={[]}
						notifications={[{ id: "anchor", text: "ANCHOR_NOTICE", tone: "info", createdAt: 1, read: false }]}
						mcpStatus={() => ({
							version: 1,
							servers: [
								{
									name: "github",
									status: "connected",
									toolCount: 4,
									disabled: false,
								},
								{
									name: "postgres",
									status: "connected",
									toolCount: 2,
									disabled: false,
								},
							],
							totalTools: 6,
							connectedCount: 2,
							disabledCount: 0,
						})}
						height={40}
					/>
				</box>
			),
			100,
			40,
		);
		const rowOf = (frame: string, text: string) =>
			frame.split("\n").findIndex((line) => line.includes(text));
		const before = setup.captureCharFrame();
		expect(before).toContain("MCP 2/2 connected");
		expect(before).not.toContain("github");
		const subagentsBefore = rowOf(before, "ANCHOR_NOTICE");
		expect(subagentsBefore).toBeGreaterThanOrEqual(0);
		const mcpRow = rowOf(before, "MCP 2/2 connected");
		await setup.mockMouse.moveTo(70, mcpRow);
		await setup.flush();
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		const hovered = setup.captureCharFrame();
		expect(hovered).toContain("github");
		expect(hovered).toContain("postgres");
		expect(rowOf(hovered, "ANCHOR_NOTICE")).toBe(subagentsBefore);
		await setup.mockMouse.moveTo(4, 0);
		await setup.flush();
		await new Promise((resolve) => setTimeout(resolve, 400));
		await setup.flush();
		const after = setup.captureCharFrame();
		expect(after).not.toContain("github");
		expect(rowOf(after, "ANCHOR_NOTICE")).toBe(subagentsBefore);
	});
});
