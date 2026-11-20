import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { TestRendererSetup } from "@opentui/core/testing";
import {
	type FoundersRunResult,
	foundersFailureMessage,
	parseFoundersPlan,
} from "../src/tabs/founders-setup-runner.ts";
import { RecommendedPlugins } from "../src/ui/recommended-plugins.tsx";

const DRY_RUN = `Pi agent directory: /home/u/.pi/agent
Present: git:github.com/mistrjirka/pi-subagent
Install: git:https://github.com/mistrjirka/PiTTy-BTW.git
Configure: npm:pi-code-tool@0.6.2
Outdated: /home/u/pi-doppelclaude-fork
  Replace equivalent package: npm:pi-code-tool
Dry run. No files were changed.
`;

const open: TestRendererSetup[] = [];
afterEach(() => {
	for (const setup of open.splice(0)) setup.renderer.destroy();
});

describe("recommended plugins", () => {
	test("reads the founder setup plan and names each package briefly", () => {
		expect(parseFoundersPlan(DRY_RUN)).toEqual([
			{ action: "present", source: "git:github.com/mistrjirka/pi-subagent", name: "pi-subagent" },
			{ action: "install", source: "git:https://github.com/mistrjirka/PiTTy-BTW.git", name: "PiTTy-BTW" },
			{ action: "configure", source: "npm:pi-code-tool@0.6.2", name: "pi-code-tool" },
			{ action: "outdated", source: "/home/u/pi-doppelclaude-fork", name: "pi-doppelclaude-fork" },
		]);
		expect(foundersFailureMessage("x\nPiTTy founders setup failed: Node 24 needed.\n")).toBe("Node 24 needed.");
	});

	test("installs only after the plan is shown and Enter confirms it", async () => {
		const calls: string[] = [];
		const result = (output: string, exitCode = 0): FoundersRunResult => ({ exitCode, output, logPath: "/tmp/log" });
		const setup = await testRender(
			() => (
				<RecommendedPlugins
					onBack={() => {}}
					run={async (mode) => {
						calls.push(mode);
						return mode === "dry-run" ? result(DRY_RUN) : result("PiTTy founders setup failed: network down", 1);
					}}
				/>
			),
			{ width: 90, height: 24 },
		);
		open.push(setup);
		await Bun.sleep(0);
		await setup.flush();
		const plan = setup.captureCharFrame();
		expect(calls).toEqual(["dry-run"]);
		// The outdated checkout is the user's to update; Enter does not count it.
		expect(plan).toContain("2 to install · 1 outdated");
		expect(plan).toContain("update checkout");
		expect(plan).toContain("PiTTy-BTW");
		setup.mockInput.pressEnter();
		await Bun.sleep(0);
		await setup.flush();
		expect(calls).toEqual(["dry-run", "install"]);
		// A failed run shows the script's own reason and where the log is.
		expect(setup.captureCharFrame()).toContain("network down");
		expect(setup.captureCharFrame()).toContain("/tmp/log");
	});
});
