import { describe, expect, test } from "bun:test";
import { StartupPanel } from "../src/ui/startup-panel.tsx";
import { Logo } from "../src/ui/logo.tsx";
import { PiRpcTimeoutError } from "../src/rpc/pi-rpc-client.ts";
import {
	createSingleFlight,
	StartupDeadlineError,
	startupExplanation,
	startupFailureReason,
	startupHeading,
	withStartupDeadline,
} from "../src/state/startup.ts";

import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("OpenTUI components", () => {
	test("renders truthful startup progress", async () => {
		const setup = await mount(
			() => (
				<StartupPanel
					phase={{ kind: "starting" }}
					elapsedMs={42_000}
					spinner="◐"
				/>
			),
			52,
			12,
		);
		const starting = setup.captureCharFrame();
		expect(starting).toContain("Starting Pi runtime");
		expect(starting).toContain("Large histories can take a");
		expect(starting).toContain("42s");
		expect(startupHeading({ kind: "history" })).toBe("Loading conversation");
		expect(startupExplanation({ kind: "history" })).toContain(
			"Restoring the conversation",
		);
		expect(startupHeading({ kind: "failed", reason: "timeout" })).toBe(
			"Pi startup timed out",
		);
		expect(startupExplanation({ kind: "failed", reason: "timeout" })).toContain(
			"clean up old sessions",
		);
	});

	test("bounds startup waits and joins overlapping refreshes", async () => {
		let calls = 0;
		let release: ((value: string) => void) | undefined;
		const coordinator = createSingleFlight(() => {
			calls += 1;
			if (calls > 1) return Promise.resolve("next");
			return new Promise<string>((resolve) => {
				release = resolve;
			});
		});
		const first = coordinator.run();
		const second = coordinator.run();
		expect(second).toBe(first);
		await Promise.resolve();
		expect(calls).toBe(1);
		release?.("done");
		await expect(first).resolves.toBe("done");
		await expect(coordinator.run()).resolves.toBe("next");
		expect(calls).toBe(2);

		await expect(
			withStartupDeadline(new Promise<never>(() => {}), 20),
		).rejects.toBeInstanceOf(StartupDeadlineError);
		expect(
			startupFailureReason(new PiRpcTimeoutError("get_state", 20), {
				kind: "starting",
			}),
		).toBe("timeout");
		expect(
			startupFailureReason(new Error("unexpected"), {
				kind: "failed",
				reason: "exit",
			}),
		).toBe("exit");
	});

	test("renders responsive logo variants without clipping", async () => {
		const wide = await mount(() => <Logo />, 100, 24);
		expect(wide.captureCharFrame()).toContain("█████████▀");
		const compact = await mount(() => <Logo compact />, 40, 20);
		expect(compact.captureCharFrame()).toContain("▄███████");
		const micro = await mount(() => <Logo />, 20, 20);
		expect(micro.captureCharFrame()).toContain("[> π <]");
		const short = await mount(() => <Logo />, 20, 8);
		expect(short.captureCharFrame()).toContain("[> π <]");
		expect(short.captureCharFrame()).not.toContain("■");
		for (const [frame, width] of [
			[wide.captureCharFrame(), 100],
			[compact.captureCharFrame(), 40],
			[micro.captureCharFrame(), 20],
		] as const) {
			for (const line of frame.split("\n"))
				expect(line.length).toBeLessThanOrEqual(width);
		}
	});

	test("renders the wordmark-only logo variant", async () => {
		const setup = await mount(() => <Logo wordmarkOnly />, 20, 8);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("PiTTy");
		expect(frame).not.toContain("■");
	});
});
