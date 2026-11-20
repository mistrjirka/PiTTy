import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { active } from "./test-env.ts";

export async function mount(
	node: () => unknown,
	width = 100,
	height = 30,
): Promise<TestRendererSetup> {
	const setup = await testRender(node as () => never, {
		width,
		height,
		useMouse: true,
		enableMouseMovement: true,
	});
	active.push(setup);
	await setup.flush();
	await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
	return setup;
}
