import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ConversationModel, initialItems } from "../src/state/conversation.ts";
import { toolTimeLimits } from "../src/state/conversation-shared.ts";
import type { PiEvent, ToolItem } from "../src/types.ts";
import { MessageView, toolTiming } from "../src/ui/message.tsx";

function liveTool(name: string, args: unknown): ToolItem {
	const model = new ConversationModel();
	model.apply({ type: "tool_execution_start", toolCallId: "timed", toolName: name, args } as PiEvent);
	const item = model.items[0];
	if (item?.kind !== "tool") throw new Error("Expected a tool item");
	return { ...item, startedAt: 1_000 };
}

describe("tool timeout units and wait windows", () => {
	test.each([7200, 500, 0.5])("converts bash timeout %s seconds without a magnitude heuristic", (seconds) => {
		const args = { command: "benchmark", timeout: seconds };
		const item = liveTool("bash", args);
		expect(item.timeoutMs).toBe(seconds * 1000);
		expect(item.waitMs).toBeUndefined();
		expect(item.args).toBe(args);
		expect(args.timeout).toBe(seconds);
	});

	test("keeps explicit milliseconds and declines unknown bare timeout units", () => {
		expect(toolTimeLimits("custom", { timeoutMs: 500 }).timeoutMs).toBe(500);
		expect(toolTimeLimits("custom", { timeout_ms: 500 }).timeoutMs).toBe(500);
		expect(toolTimeLimits("custom", { timeout: 7200 }).timeoutMs).toBeUndefined();
		// The known bash schema does not accept timeoutMs as an execution limit.
		expect(toolTimeLimits("bash", { timeoutMs: 500 }).timeoutMs).toBeUndefined();
	});

	test("labels agent_wait as a wait window, never a child execution timeout", () => {
		const item = liveTool("agent_wait", { agent_id: "worker", timeout_seconds: 150 });
		expect(item.timeoutMs).toBeUndefined();
		expect(item.waitMs).toBe(150_000);
		expect(toolTiming(item, 6_000)).toBe("5s / wait up to 2m 30s");
		expect(toolTiming({ ...item, status: "done", endedAt: 6_000 })).toBe("5s · wait up to 2m 30s");
		// Under 100ms elapsed and a limit under 10s: nothing worth a column.
		expect(toolTiming(liveTool("agent_wait", { timeout_seconds: 0 }), 1_000)).toBe("");
		expect(toolTiming(liveTool("bash", { command: "x", timeout: 10 }), 1_050)).toBe("");
		expect(toolTiming(liveTool("bash", { command: "x", timeout: 11 }), 1_050)).toBe("timeout 11s");
	});

	test("keeps an explicit execution limit separate from a polling wait", () => {
		const item = liveTool("custom", { timeoutMs: 60_000, yield_time_ms: 500 });
		expect(toolTiming(item, 2_000)).toBe("1s / timeout 1m 0s");
		expect(liveTool("custom", { wait_seconds: 10 }).waitMs).toBe(10_000);
	});

	test("does not fabricate missing, malformed, or infinite time budgets", () => {
		for (const value of [undefined, "7200", -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(toolTimeLimits("bash", { timeout: value }).timeoutMs).toBeUndefined();
			expect(toolTimeLimits("agent_wait", { timeout_seconds: value }).waitMs).toBeUndefined();
		}
		expect(toolTimeLimits("bash", { timeout: Number.MAX_VALUE }).timeoutMs).toBeUndefined();
		expect(toolTimeLimits("bash", null)).toEqual({});
		expect(toolTimeLimits("agent_wait", {}).waitMs).toBeUndefined();
	});

	test("restores the same command and wait budgets from persisted tool calls", () => {
		const items = initialItems([
			{ role: "assistant", content: [
				{ type: "toolCall", id: "bash", name: "bash", arguments: { command: "benchmark", timeout: 7200 } },
				{ type: "toolCall", id: "wait", name: "agent_wait", arguments: { timeout_seconds: 150 } },
			], timestamp: 1_000 },
			{ role: "toolResult", toolCallId: "bash", toolName: "bash", content: [], timestamp: 2_000 },
			{ role: "toolResult", toolCallId: "wait", toolName: "agent_wait", content: [], timestamp: 3_000 },
		]).filter((item): item is ToolItem => item.kind === "tool");
		expect(items[0]?.timeoutMs).toBe(7_200_000);
		expect(items[1]?.waitMs).toBe(150_000);
		expect(items[1]?.timeoutMs).toBeUndefined();
	});

	test("renders a fifteen-minute command with its actual two-hour timeout", async () => {
		const item = liveTool("bash", { command: "benchmark", timeout: 7200 });
		const setup = await testRender(() => (
			<MessageView item={item} showThinking={false} toolExpanded={false} now={901_000} />
		), { width: 100, height: 12 });
		try {
			await setup.flush();
			await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
			const frame = setup.captureCharFrame();
			expect(frame).toContain("15m 0s / timeout 2h 0m");
			expect(frame).not.toContain("timeout 7s");
		} finally {
			setup.renderer.destroy();
		}
	});
});
