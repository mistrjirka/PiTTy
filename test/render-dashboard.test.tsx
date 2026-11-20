import { describe, expect, test } from "bun:test";
import { type TextareaRenderable } from "@opentui/core";
import { EmptyDashboard } from "../src/ui/empty-dashboard.tsx";
import type { SessionChoice, SessionDiscoveryState } from "../src/sessions.ts";

import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("OpenTUI components", () => {
	test("renders the empty dashboard states and keeps constrained content inside the viewport", async () => {
		const choice: SessionChoice = {
			path: "/tmp/dashboard",
			id: "dashboard",
			name: "Dashboard work",
			modified: new Date(),
			messageCount: 2,
			firstMessage: "Dashboard work",
		};
		const states: SessionDiscoveryState[] = [
			{ kind: "loading" },
			{ kind: "success", choices: [choice] },
			{ kind: "empty", choices: [] },
			{ kind: "error", error: "permission denied" },
		];
		for (const state of states) {
			const setup = await mount(
				() => (
					<EmptyDashboard sessionState={state} onSelectSession={() => {}} />
				),
				44,
				16,
			);
			const frame = setup.captureCharFrame();
			expect(frame).toContain("PiTTy");
			expect(frame).not.toContain("undefined");
			const expectedText =
				state.kind === "loading"
					? "Loading recent sessions…"
					: state.kind === "success"
						? "Dashboard work"
						: state.kind === "empty"
							? "No recent sessions in this directory."
							: "Unable to load recent sessions:";
			expect(frame).toContain(expectedText);
			for (const line of frame.split("\n"))
				expect(line.length).toBeLessThanOrEqual(44);
		}
	});

	test("shows the production session row limits at each dashboard tier", async () => {
		const choices: SessionChoice[] = Array.from({ length: 6 }, (_, index) => ({
			path: `/tmp/dashboard-${index}`,
			id: `dashboard-${index}`,
			name: `Unique session ${index}`,
			modified: new Date(),
			messageCount: index + 1,
			firstMessage: `Unique session ${index}`,
		}));
		const cases = [
			{ width: 100, height: 30, visible: 5 },
			{ width: 44, height: 16, visible: 4 },
			{ width: 44, height: 10, visible: 2 },
		];
		for (const { width, height, visible } of cases) {
			const setup = await mount(
				() => (
					<EmptyDashboard
						sessionState={{ kind: "success", choices }}
						onSelectSession={() => {}}
					/>
				),
				width,
				height,
			);
			const frame = setup.captureCharFrame();
			expect(frame).toContain(`Unique session ${visible - 1}`);
			expect(frame).not.toContain(`Unique session ${visible}`);
		}
	});

	test("keeps the wordmark and session state readable at constrained height", async () => {
		const setup = await mount(
			() => (
				<EmptyDashboard
					sessionState={{ kind: "loading" }}
					width={44}
					height={10}
					onSelectSession={() => {}}
				/>
			),
			44,
			10,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("PiTTy");
		expect(frame).toContain("Loading recent sessions");
		expect(frame).not.toContain("■───╮");
		for (const line of frame.split("\n"))
			expect(line.length).toBeLessThanOrEqual(44);
	});

	test("dashboard leaves the prompt editor focusable", async () => {
		let editor: TextareaRenderable | undefined;
		const setup = await mount(
			() => (
				<box flexDirection="column" width="100%" height="100%">
					<box flexGrow={1}>
						<EmptyDashboard
							sessionState={{ kind: "loading" }}
							onSelectSession={() => {}}
						/>
					</box>
					<textarea
						ref={(value) => {
							editor = value;
						}}
						focused
						height={2}
					/>
				</box>
			),
			70,
			16,
		);
		await setup.mockInput.typeText("draft while dashboard is visible");
		expect(editor?.plainText).toBe("draft while dashboard is visible");
	});

	test("dashboard session rows use the shared choice callback", async () => {
		const choice: SessionChoice = {
			path: "/tmp/dashboard",
			id: "dashboard",
			name: "Dashboard work",
			modified: new Date(),
			messageCount: 2,
			firstMessage: "Dashboard work",
		};
		let selected: SessionChoice | undefined;
		const setup = await mount(() => (
			<EmptyDashboard
				sessionState={{ kind: "success", choices: [choice] }}
				onSelectSession={(value) => {
					selected = value;
				}}
			/>
		));
		const frame = setup.captureCharFrame();
		const y = frame
			.split("\n")
			.findIndex((line) => line.includes("Dashboard work"));
		expect(y).toBeGreaterThanOrEqual(0);
		await setup.mockMouse.click(
			Math.max(0, frame.split("\n")[y]!.indexOf("Dashboard work")),
			y,
		);
		await setup.flush();
		expect(selected).toEqual(choice);
	});
});
