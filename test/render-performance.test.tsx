import { describe, expect, test } from "bun:test";
import { Renderable, type ScrollBoxRenderable } from "@opentui/core";
import { For, createSignal } from "solid-js";
import { MessageView } from "../src/ui/message.tsx";
import { Sidebar } from "../src/ui/sidebar.tsx";
import type { ConversationItem, SessionStats, SubagentRun } from "../src/types.ts";
import { ConversationModel } from "../src/state/conversation.ts";
import type { PiEvent } from "../src/types.ts";

import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("duration and sidebar repaint regressions", () => {
	test("keeps native renderables bounded through 5,000 assistant updates", async () => {
		const conversation = new ConversationModel([
			{
				kind: "assistant",
				id: "live-assistant",
				text: "",
				thinking: "",
				timestamp: 1,
				status: "streaming",
			},
		]);
		const initialAssistant = conversation.items[0];
		if (!initialAssistant || initialAssistant.kind !== "assistant")
			throw new Error("stress fixture missing assistant");
		const [ids, setIds] = createSignal<string[]>(["live-assistant"]);
		const [renderedItem, setRenderedItem] =
			createSignal<ConversationItem>(initialAssistant);
		let transcriptScroll: ScrollBoxRenderable | undefined;
		const event = <T extends Record<string, unknown>>(value: T): PiEvent =>
			value;
		const Transcript = () => {
			return (
				<scrollbox
					ref={(value) => {
						transcriptScroll = value;
					}}
					width="100%"
					height="100%"
				>
					<For each={ids()}>
						{(_id) => {
							return (
								<MessageView
									item={renderedItem}
									showThinking
									thinkingExpanded
									toolExpanded={false}
								/>
							);
						}}
					</For>
				</scrollbox>
			);
		};
		const setup = await mount(() => <Transcript />, 100, 30);
		const baseline = Renderable.renderablesByNumber.size;
		let peak = baseline;
		try {
			conversation.apply(
				event({
					type: "message_start",
					message: { role: "assistant", content: [] },
				}),
			);
			for (let update = 1; update <= 5_000; update += 1) {
				const isThinking = update <= 40;
				conversation.apply(
					event({
						type: "message_update",
						assistantMessageEvent: {
							type: isThinking ? "thinking_delta" : "text_delta",
							contentIndex: isThinking ? 0 : 1,
							delta: isThinking
								? `thought ${update} `
								: update === 5_000
									? " FINAL_STREAMED_TEXT "
									: `stream ${update} `,
						},
					}),
				);
				setIds(conversation.items.map((item) => item.id));
				const currentItem = conversation.items[0];
				if (currentItem) setRenderedItem(currentItem);
				if (update % 100 === 0) {
					await Bun.sleep(0);
					await setup.flush();
					peak = Math.max(peak, Renderable.renderablesByNumber.size);
				}
			}
			conversation.apply(
				event({
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "FINAL_STREAMED_TEXT" }],
					},
				}),
			);
			setIds(conversation.items.map((item) => item.id));
			await Bun.sleep(0);
			await setup.flush();
			peak = Math.max(peak, Renderable.renderablesByNumber.size);
			transcriptScroll?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER });
			await setup.flush();
			expect(
				conversation.items[0]?.kind === "assistant" &&
					conversation.items[0].text,
			).toContain("FINAL_STREAMED_TEXT");
			expect(setup.captureCharFrame()).toContain("FINAL_STREAMED_TEXT");
			expect(Renderable.renderablesByNumber.size).toBeLessThanOrEqual(
				baseline + 40,
			);
			expect(peak).toBeLessThanOrEqual(baseline + 40);
		} finally {
			setup.renderer.destroy();
			const cleanupDeadline = Date.now() + 2_000;
			while (
				Renderable.renderablesByNumber.size > baseline &&
				Date.now() < cleanupDeadline
			) {
				await Bun.sleep(10);
			}
			expect(Renderable.renderablesByNumber.size).toBeLessThanOrEqual(baseline);
		}
	}, 15_000);

	test("fits a large sidebar agent list in a 253x78 pane", async () => {
		const runs: SubagentRun[] = Array.from({ length: 40 }, (_, index) => ({
			runId: `geometry-${index}`,
			asyncDir: `/tmp/geometry-${index}`,
			mode: "single",
			state: index % 3 === 0 ? "running" : "completed",
			agent: `worker-${index}`,
			steps: [],
			startedAt: index,
		}));
		const stats = {
			sessionFile: "/tmp/session.jsonl",
			sessionId: "geometry",
			userMessages: 1,
			assistantMessages: 1,
			toolCalls: 1,
			toolResults: 1,
			totalMessages: 4,
			tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
			cost: 0,
			contextUsage: { tokens: 30, contextWindow: 400, percent: 7.5 },
		} as SessionStats;
		const [height, setHeight] = createSignal(78);
		const setup = await mount(
			() => <Sidebar runs={runs} stats={stats} height={height} />,
			253,
			78,
		);
		const assertBounds = (expectedHeight: number) => {
			for (const id of ["subagent-panel", "subagent-scroll"]) {
				const renderable = setup.renderer.root.findDescendantById(id);
				if (!renderable)
					throw new Error(`sidebar geometry fixture missing: ${id}`);
				expect(renderable.screenY + renderable.height).toBeLessThanOrEqual(
					expectedHeight,
				);
			}
		};
		assertBounds(78);
		setup.resize(253, 60);
		setHeight(60);
		await setup.flush();
		assertBounds(60);
		setup.resize(253, 14);
		setHeight(14);
		await setup.flush();
		assertBounds(14);
		setup.resize(253, 78);
		setHeight(78);
		await setup.flush();
		assertBounds(78);
		const frame = setup.captureCharFrame();
		expect(frame.split("\n")).toHaveLength(79);
		expect(frame).toContain("worker-39");
		for (const line of frame.split("\n"))
			expect(line.length).toBeLessThanOrEqual(253);
	});
});
