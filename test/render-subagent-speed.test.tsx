import { expect, test } from "bun:test";
import { Sidebar, sidebarScopeForTarget } from "../src/ui/sidebar.tsx";
import type { SubagentTarget } from "../src/subagents/targets.ts";
import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";
useRenderTestEnv();

test("scoped sidebar displays the selected child's measured speed and first-token delay", async () => {
	const target: SubagentTarget = {
		key: "child", label: "child", state: "running", active: true, canSteer: true, model: "speed-fixture/child",
		run: { runId: "child", mode: "profiled", state: "running", steps: [], lastRequestPerformance: {
			provider: "speed-fixture", modelId: "child", ttftMs: 800, generationMs: 1200, outputTokens: 48,
		} },
	};
	const setup = await mount(() => <Sidebar runs={[]} scope={sidebarScopeForTarget(target)} height={24} />, 60, 24);
	try {
		const frame = setup.captureCharFrame();
		expect(frame).toContain("40 tok/s");
		expect(frame).toContain("first 800ms");
	} finally { setup.renderer.destroy(); }
});
