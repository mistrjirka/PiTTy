import { expect, test } from "bun:test";
import { ExtensionSettingsList } from "../src/ui/extension-settings.tsx";
import { compactionTargetRows } from "../src/ui/compaction-policy.ts";
import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";
useRenderTestEnv();

test("compaction target picker shows the current target and activates a different preset", async () => {
	const selected: string[] = [];
	const setup = await mount(() => <ExtensionSettingsList title="Target after compaction" backLabel="esc ‹ compaction"
		rows={compactionTargetRows(20_000)} selectedId="target:20000" busy={false}
		onSelected={() => {}} onOpen={(id) => selected.push(id)} onCancel={() => {}} />, 80, 25);
	try {
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Target after compaction");
		expect(frame).toContain("20k tokens");
		expect(frame).toContain("Current · soft target");
		expect(frame).toContain("50k tokens");
		setup.mockInput.pressArrow("down");
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(selected).toEqual(["target:30000"]);
	} finally { setup.renderer.destroy(); }
});
