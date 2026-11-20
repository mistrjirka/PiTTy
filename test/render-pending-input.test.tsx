import { describe, expect, test } from "bun:test";
import { type TextareaRenderable } from "@opentui/core";
import { PendingInputPanel } from "../src/ui/pending-input-panel.tsx";

import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("OpenTUI components", () => {
	test("keeps one queued row and hint visible in an 80x14 layout", async () => {
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<box flexGrow={1} minHeight={1}>
						<text>conversation output</text>
					</box>
					<box flexGrow={0}>
						<PendingInputPanel
							queuedFollowUps={[{ id: "queued", text: "short queued" }]}
							steering={[]}
							followUps={[]}
							onEditQueuedFollowUp={() => {}}
						/>
					</box>
					<textarea height={4} minHeight={4} />
					<text>status</text>
				</box>
			),
			80,
			14,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Pending input");
		expect(frame).toContain("Alt+Up edits the last editable local follow-up.");
		expect(frame).toContain("1. editable later: short queued");
	});

	test("keeps pending-in-Pi header and steering row separate when space is available", async () => {
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<box flexGrow={1} minHeight={1}>
						<text>conversation output</text>
					</box>
					<box flexGrow={0}>
						<PendingInputPanel
							queuedFollowUps={[{ id: "queued", text: "short queued" }]}
							steering={["short steering"]}
							followUps={[]}
							onEditQueuedFollowUp={() => {}}
						/>
					</box>
					<textarea height={4} minHeight={4} />
					<text>status</text>
				</box>
			),
			80,
			14,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Queued in Pi, not yet delivered to the model");
		expect(frame).not.toContain("Already sent to Pi");
		expect(frame).toContain("steering: short steering");
	});

	test("renders repeated identical pending messages separately", async () => {
		const setup = await mount(
			() => (
				<PendingInputPanel
					queuedFollowUps={[]}
					steering={[".", "."]}
					followUps={[]}
					onEditQueuedFollowUp={() => {}}
				/>
			),
			80,
			12,
		);
		const frame = setup.captureCharFrame();
		expect(frame.match(/steering: \./g)).toHaveLength(2);
	});

	test("keeps pending steering text intact in an 80x10 layout", async () => {
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<box flexGrow={1} minHeight={1}>
						<text>conversation output</text>
					</box>
					<PendingInputPanel
						queuedFollowUps={[]}
						steering={["after you do all the fixes release it as 0.3.3"]}
						followUps={[]}
						onEditQueuedFollowUp={() => {}}
					/>
					<textarea height={2} minHeight={2} />
				</box>
			),
			80,
			10,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain(
			"steering: after you do all the fixes release it as 0.3.3",
		);
		expect(frame).not.toContain(
			"steering: after you do all the fixes release it as 0.3.3conversation",
		);
	});

	test("bounds pending input rows while keeping the main textarea writable", async () => {
		let editor: TextareaRenderable | undefined;
		const queuedFollowUps = Array.from({ length: 12 }, (_, index) => ({
			id: `queued-${index}`,
			text: `queued follow-up ${index}`,
		}));
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<box flexGrow={1} minHeight={0} />
					<box flexGrow={1} minHeight={0}>
						<PendingInputPanel
							queuedFollowUps={queuedFollowUps}
							steering={[]}
							followUps={[]}
							onEditQueuedFollowUp={() => {}}
						/>
					</box>
					<textarea
						ref={(value) => {
							editor = value;
						}}
						focused
						height={2}
						minHeight={2}
						flexShrink={0}
					/>
				</box>
			),
			80,
			14,
		);
		editor?.focus();
		await setup.mockInput.typeText("draft remains writable");
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Pending input");
		expect(editor).toBeDefined();
		expect(editor?.plainText).toBe("draft remains writable");
		expect(frame.split("\n")).toHaveLength(15);
		expect(frame).not.toContain("queued follow-up 11");
	});
});
