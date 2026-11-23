import { expect, test } from "bun:test";
import { MessageView } from "../src/ui/message.tsx";
import { taskGist } from "../src/ui/subagent-format.ts";
import { toolCallArgSummary, structuredToolOutput } from "../src/ui/tool-input-format.ts";
import type { ToolItem } from "../src/types.ts";
import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

function tool(name: string, args: unknown, output = "", id = "example"): ToolItem {
	return { kind: "tool", id, toolCallId: id, name, args, output,
		timestamp: 1, status: "done", isError: false };
}

test("code arguments show an accurate summary and reveal the original script on click", async () => {
	const item = tool("code", { code: "ids = []\nfor key in ['a', 'b']:\n    ids.append(key)\nprint(ids)" }, "spawn via tool");
	const setup = await mount(() => <MessageView item={item} showThinking toolExpanded={false} />, 102, 30);
	try {
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Python · 4 lines");
		expect(frame).toContain("▸ details");
		expect(frame).not.toContain("ids.append");
		const toggle = setup.renderer.root.findDescendantById("example-tool-toggle");
		expect(toggle).toBeDefined();
		if (!toggle) return;
		await setup.mockMouse.click(toggle.x + 1, toggle.y);
		await setup.flush();
		const expanded = setup.captureCharFrame();
		expect(expanded).toContain("Python source");
		expect(expanded).toContain("ids.append(key)");
		expect(expanded).not.toContain("\\nfor key");
	} finally { setup.renderer.destroy(); }
});

test("spawn cards use the real role and scope, not JSON or a duplicate receipt", async () => {
	const prompt = "Implementation review (read-only). Repo: /home/jirka/programovani/SBHG-Buddy. " +
		"Do your assigned check groups only (B1–B12).";
	const item = { ...tool("agent_spawn", {
		agent: "impl-check-behavior", label: "ic-behavior", prompt,
	}, "Started background agent @mio. Completion arrives in the next tool result or notification.", "spawn"),
		details: { runtime: "profiled-subagents", agentId: "mio", profile: "impl-check-behavior",
			label: "ic-behavior" } };
	const setup = await mount(() => <MessageView item={item} showThinking toolExpanded={false} />, 142, 28);
	try {
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Spawn @mio");
		expect(frame).toContain("impl-check-behavior");
		expect(frame).toContain("checks B1–B12");
		expect(frame).not.toContain("Started background agent");
		expect(frame).toContain("▸ details");
		expect(taskGist({ prompt })).toContain("checks B1–B12");
	} finally { setup.renderer.destroy(); }
});

test("JSON results and wait calls show concise structured summaries", async () => {
	expect(toolCallArgSummary("agent_wait", { agent_id: "@mio", timeout_seconds: 900 })).toBe("for @mio");
	expect(toolCallArgSummary("custom", { foo: "bar", nested: { a: 1 } })).toBe("foo=bar · nested=object");
	expect(structuredToolOutput('{"status":"ok","items":[1,2]}')?.preview).toBe("JSON · 2 fields · status: ok");
	const item = tool("custom", { command: "fetch" }, '{"status":"ok","items":[1,2]}');
	const setup = await mount(() => <MessageView item={item} showThinking toolExpanded={false} />, 98, 22);
	try {
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("JSON · 2 fields · status: ok");
		expect(frame).not.toContain('{"status":');
	} finally { setup.renderer.destroy(); }
});

test("narrow tool rows keep the full tool name and one details action", async () => {
	const command = "cd /home/jirka/programovani/SBHG-Buddy; " +
		"grep -rni \"check-unavailable\" apps/frontend/web/src " +
		"apps/frontend/mobile/src --exclude-dir=node_modules --exclude=*.map | head -100";
	const item = {
		...tool("bash", { command }, "apps/frontend/web/src/content/copy.ts:18: " + "value ".repeat(11) + "\nnext matched line", "narrow-bash"),
		startedAt: 1_000, endedAt: 1_330,
	};
	for (const width of [76, 94, 126]) {
		const setup = await mount(() => (
			<MessageView item={item} showThinking toolExpanded={false} />
		), width, 26);
		try {
			const frame = setup.captureCharFrame();
			const row = frame.split("\n").find((line) => line.includes("330ms")) ?? "";
			expect(row).toContain("✓ bash");
			expect(row).toContain("330ms  ▸ details");
			expect(row).not.toContain("view input");
			expect(frame).not.toContain("expand");
			expect(frame).toContain("↳ apps/frontend/web/src");
			const button = setup.renderer.root.findDescendantById("narrow-bash-tool-toggle");
			expect(button).toBeDefined();
			if (!button) continue;
			await setup.mockMouse.click(button.x + 2, button.y);
			await setup.flush();
			let expanded = setup.captureCharFrame();
			expect(expanded).toContain("▾ hide");
			expect(expanded).toContain("Command");
			expect(expanded).toContain("Output");
			const preview = setup.renderer.root.findDescendantById("narrow-bash-output-preview");
			expect(preview?.height).toBeLessThan(6);
			await setup.mockMouse.click(button.x + 1, button.y);
			await setup.flush();
			expanded = setup.captureCharFrame();
			expect(expanded).toContain("▸ details");
			expect(expanded).toContain("↳ apps/frontend/web/src");
			expect(expanded).not.toContain("Command\n");
		} finally {
			setup.renderer.destroy();
		}
	}
});

test("successful commands without output do not waste a row on a placeholder", async () => {
	const item = tool("bash", { command: "true" }, "(no output)", "silent-command");
	const setup = await mount(() => (
		<MessageView item={item} showThinking toolExpanded={false} />
	), 95, 16);
	try {
		const frame = setup.captureCharFrame();
		expect(frame).toContain("✓ bash  true");
		expect(frame).not.toContain("(no output)");
		expect(frame).not.toContain("▸ details");
		const occupied = frame.split("\n").filter((line) => line.trim() !== "");
		expect(occupied).toHaveLength(1);
	} finally {
		setup.renderer.destroy();
	}
});

test("short results use the same preview and the details button toggles both ways", async () => {
	const item = tool("bash", { command: "echo ready" }, "ready", "short-result");
	const setup = await mount(() => <MessageView item={item}
		showThinking toolExpanded={true} />, 85, 16);
	try {
		let frame = setup.captureCharFrame();
		expect(frame).toContain("▾ hide");
		expect(frame).toContain("Output");
		const button = setup.renderer.root.findDescendantById("short-result-tool-toggle");
		expect(button).toBeDefined();
		if (!button) return;
		await setup.mockMouse.click(button.x + 1, button.y);
		await setup.flush();
		frame = setup.captureCharFrame();
		expect(frame).toContain("▸ details");
		expect(frame).toContain("↳ ready");
		expect(frame).not.toContain("Output\n");
		await setup.mockMouse.click(button.x + 1, button.y);
		await setup.flush();
		expect(setup.captureCharFrame()).toContain("▾ hide");
	} finally {
		setup.renderer.destroy();
	}
});
