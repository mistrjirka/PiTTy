import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { MessageView } from "../src/ui/message.tsx";
import { Sidebar } from "../src/ui/sidebar.tsx";
import { NotificationDialog } from "../src/ui/notification-dialog.tsx";
import type { ConversationItem, NotificationRecord } from "../src/types.ts";
import { appendNotificationHistory } from "../src/app.tsx";

import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("OpenTUI components", () => {
	test("renders profiled notifications as bounded identity cards", async () => {
		const result = `${"visible-result\n".repeat(20)}UNIQUE_TAIL`;
		const setup = await mount(
			() => (
				<MessageView
					item={{
						kind: "custom",
						id: "profiled-notification",
						customType: "subagent-notification",
						text: JSON.stringify({
							agent_id: "jett",
							status: "completed",
							result,
						}),
						timestamp: 1,
						details: {
							label: "@jett — bounded task",
							model: "provider/model",
							thinking: "high",
							usage: { tokens: 42, toolUses: 3, durationMs: 1200 },
							sessionPath: "/tmp/very-long-session-path.jsonl",
						},
					}}
					showThinking
					toolExpanded={false}
				/>
			),
			120,
			8,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("@jett — bounded task");
		expect(frame).toContain("42 cumulative tokens (incl. cache)");
		expect(frame).not.toContain("UNIQUE_TAIL");
		expect(frame).toContain("20 more lines");
		expect(frame.split("\n").length).toBeLessThanOrEqual(9);

		const fallback = await mount(
			() => (
				<MessageView
					item={{
						kind: "custom",
						id: "fallback-notification",
						customType: "subagent-notification",
						text: JSON.stringify({
							agent_id: "zoe",
							status: "failed",
							result: "fallback result",
						}),
						timestamp: 1,
					}}
					showThinking
					toolExpanded={false}
				/>
			),
			60,
			8,
		);
		expect(fallback.captureCharFrame()).toContain("@zoe");
		const spawn = await mount(
			() => (
				<MessageView
					item={{
						kind: "tool",
						id: "spawn",
						toolCallId: "spawn-call",
						name: "agent_spawn",
						args: { agent: "explore", prompt: "secret prompt" },
						output: "",
						details: {
							runtime: "profiled-subagents",
							agentId: "jett",
							profile: "explore",
							label: "launch task",
						},
						timestamp: 1,
						status: "done",
						isError: false,
					}}
					showThinking
					toolExpanded={false}
				/>
			),
			80,
			8,
		);
		expect(spawn.captureCharFrame()).toContain("@jett · explore — launch task");
	});

	test("notification usage counters remain distinct and readable at 70 columns", async () => {
		const setup = await mount(
			() => (
				<MessageView
					item={{
						kind: "custom",
						id: "usage-card",
						customType: "subagent-notification",
						text: "",
						timestamp: 1,
						details: {
							agent_id: "una",
							status: "completed",
							result: "done",
							usage: {
								tokens: 844771,
								outputTokens: 6603,
								contextTokens: 73739,
							},
						},
					}}
					showThinking
					toolExpanded={false}
				/>
			),
			70,
			12,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("844,771 cumulative tokens (incl. cache)");
		expect(frame).toContain("6,603 generated");
		expect(frame).toContain("73,739 context tokens");
	});

	test("renders supervisor questions, custom notices, and supervisor tool labels", async () => {
		const items: ConversationItem[] = [
			{
				kind: "custom",
				id: "question",
				customType: "subagent_supervisor_request",
				text: 'Choose the safer approach.\nReply with: subagent_supervisor({ action: \\"reply\\" })',
				details: { agent: "worker", reason: "need decision" },
				timestamp: 1,
			},
			{
				kind: "custom",
				id: "profiled-question",
				customType: "subagent-question",
				text: '{"agent_id":"@max","question":"Which behavior should I preserve?"}',
				details: {
					agentId: "max",
					profile: "implementer",
					label: "backend",
					question: "Which behavior should I preserve?",
					context: "The task and existing tests disagree.",
				},
				timestamp: 2,
			},
			{
				kind: "custom",
				id: "notice",
				customType: "other_event",
				text: "visible notice",
				timestamp: 2,
			},
			{
				kind: "tool",
				id: "supervisor-tool",
				toolCallId: "supervisor-tool",
				name: "subagent_supervisor",
				args: {
					action: "reply",
					agent: "worker",
					message: "Full supervisor reply body",
				},
				output: "",
				timestamp: 3,
				status: "done",
				isError: false,
			},
		];
		const setup = await mount(
			() => (
				<box flexDirection="column">
					{items.map((item) => (
						<MessageView item={item} showThinking toolExpanded={false} />
					))}
				</box>
			),
			120,
			20,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("◇ Child question · worker · need decision");
		expect(frame).toContain("Choose the safer approach.");
		expect(frame).toContain("◇ Child question · implementer");
		expect(frame).toContain("Which behavior should I preserve?");
		expect(frame).toContain("Context: The task and existing tests disagree.");
		expect(frame).toContain("Reply with: subagent_supervisor");
		expect(frame).toContain("· other_event  visible notice");
		expect(frame).toContain("✓ → reply worker");
		expect(frame).toContain("Full supervisor reply body");
		for (const line of frame.split("\n"))
			expect(line.length).toBeLessThanOrEqual(120);
	});

	test("bounds notification history with oldest-first eviction", () => {
		const records = Array.from({ length: 101 }, (_, index) => ({
			id: `notification-${index}`,
			text: `notification ${index}`,
			tone: "info" as const,
			createdAt: index,
			read: false,
		}));

		const history = records.reduce<NotificationRecord[]>(
			(current, record) => appendNotificationHistory(current, record),
			[],
		);

		expect(history).toHaveLength(100);
		expect(history[0]?.id).toBe("notification-1");
		expect(history.at(-1)?.id).toBe("notification-100");
	});

	test("opens a full Markdown notification detail from a sidebar row", async () => {
		const record: NotificationRecord = {
			id: "markdown-notification",
			text: "# FULL_TITLE\n\nParagraph **FULL_BOLD**\n\n```text\nFULL_CODE\n```",
			tone: "info",
			createdAt: 1,
			read: false,
		};
		const [selected, setSelected] = createSignal<string>();
		const setup = await mount(
			() => (
				<Sidebar
					runs={[]}
					subagentsAvailable={false}
					notifications={[record]}
					height={30}
					onOpenNotification={setSelected}
				/>
			),
			42,
			30,
		);
		const before = setup.captureCharFrame();
		const row = before
			.split("\n")
			.findIndex((line) => line.includes("FULL_TITLE"));
		expect(row).toBeGreaterThanOrEqual(0);
		await setup.mockMouse.click(
			before.split("\n")[row]!.indexOf("FULL_TITLE") + 1,
			row,
		);
		await setup.flush();
		expect(selected()).toBe(record.id);

		const dialog = await mount(
			() => <NotificationDialog record={() => record} onClose={() => {}} />,
			42,
			30,
		);
		expect(dialog.captureCharFrame()).toContain("FULL_TITLE");
		expect(dialog.captureCharFrame()).toContain("FULL_CODE");
	});
});
