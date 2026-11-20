import { afterEach, describe, expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import type { CustomItem } from "../src/types.ts";
import { parseBackgroundCompletion } from "../src/ui/message-background-notice.tsx";
import { CustomMessage } from "../src/ui/message-custom-card.tsx";

const COMPLETION = [
	"Background task bg-14 finished: exited (code 0), ran 28.0s.",
	"Command: pnpm exec oxfmt apps/backend",
	"Last output:",
	"$ pnpm run openapi:export",
	"$ ts-node scripts/export-openapi.ts",
	"$ tsc -p tsconfig.build.json",
	"$ tsc --noEmit",
].join("\n");

const open: TestRendererSetup[] = [];
afterEach(() => {
	for (const setup of open.splice(0)) setup.renderer.destroy();
});

describe("background job notices", () => {
	test("reads pi-bg-bash completions and rejects anything else", () => {
		expect(parseBackgroundCompletion(COMPLETION, 0)).toEqual({
			taskId: "bg-14",
			state: "exited (code 0)",
			ok: true,
			runtime: "28.0s",
			command: "pnpm exec oxfmt apps/backend",
			output: [
				"$ pnpm run openapi:export",
				"$ ts-node scripts/export-openapi.ts",
				"$ tsc -p tsconfig.build.json",
				"$ tsc --noEmit",
			],
		});
		// Without an exit code in details, the state text decides.
		expect(parseBackgroundCompletion(COMPLETION.replace("exited (code 0)", "killed"), undefined)?.ok).toBe(false);
		expect(parseBackgroundCompletion("Some other extension text", 0)).toBeUndefined();
	});

	test("shows a job as one row with the last output lines under it", async () => {
		const item: CustomItem = {
			kind: "custom",
			id: "bg",
			customType: "pi-bg-bash",
			text: COMPLETION,
			details: { id: "bg-14", exitCode: 0, state: "exited" },
			timestamp: 1,
		};
		const setup = await testRender(() => <CustomMessage item={item} />, { width: 90, height: 10 });
		open.push(setup);
		await setup.flush();
		const lines = setup.captureCharFrame().split("\n");
		expect(lines[0]).toMatch(/✓ bg-14 {2}pnpm exec oxfmt apps\/backend\s+28\.0s/);
		expect(lines[1]).toContain("+1 lines");
		expect(lines[2]).toContain("$ ts-node scripts/export-openapi.ts");
		expect(lines.join("\n")).not.toContain("Last output");
	});
});
