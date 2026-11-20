import { describe, expect, test } from "bun:test";
import { KeyEvent, type TextareaRenderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { CommandSuggestions, filterCommandChoices, selectCommandChoice } from "../src/ui/command-suggestions.tsx";
import { isUnmodifiedEnterKey, streamingCtrlCDecision, subagentInspectDecision } from "../src/app.tsx";
import { AppPromptDock } from "../src/ui/app-prompt-dock.tsx";

import { mount } from "./render-helpers/mount.tsx";

describe("OpenTUI components", () => {
	test("chooses abort first and force-exit while an abort is pending", () => {
		expect(streamingCtrlCDecision(false)).toBe("abort");
		expect(streamingCtrlCDecision(true)).toBe("force-exit");
	});

	test("routes explicit Ctrl+I decisions without implicit target selection", () => {
		expect(subagentInspectDecision(true, 2)).toBe("close");
		expect(subagentInspectDecision(false, 0)).toBe("warning");
		expect(subagentInspectDecision(false, 1)).toBe("direct");
		expect(subagentInspectDecision(false, 2)).toBe("choose");
	});

	test("filters and renders slash-command suggestions", async () => {
		const commands = [
			{
				name: "thinking",
				description: "Change reasoning effort",
				source: "ui",
			},
			{
				name: "thoughts",
				description: "Collapse thinking blocks",
				source: "ui",
			},
			{ name: "model", description: "Select a model", source: "ui" },
		];
		expect(
			filterCommandChoices(commands, "/th").map((item) => item.name),
		).toEqual(["thinking", "thoughts"]);
		expect(
			filterCommandChoices(
				Array.from({ length: 12 }, (_, index) => ({
					name: `command-${index}`,
				})),
				"/",
			),
		).toHaveLength(12);
		expect(filterCommandChoices(commands, "/thinking high")).toEqual([]);
		expect(filterCommandChoices(commands, "/th", 7, 0)).toEqual([]);
		expect(
			filterCommandChoices(commands, "/th", 7, 3).map((item) => item.name),
		).toEqual(["thinking", "thoughts"]);
		const setup = await mount(
			() => (
				<CommandSuggestions
					commands={() => filterCommandChoices(commands, "/th")}
					selectedIndex={() => 0}
					onSelect={() => {}}
				/>
			),
			90,
			12,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("/thinking");
		expect(frame).toContain("/thoughts");
		expect(frame).toContain("Tab/Enter insert");
	});

	test("keeps production-sized suggestions above a writable prompt with pending input", async () => {
		let editor: TextareaRenderable | undefined;
		const [selectedIndex, setSelectedIndex] = createSignal(0);
		const commands = Array.from({ length: 7 }, (_, index) => ({
			name: `overflow-command-${index}`,
			description: `Description ${index}`,
		}));
		const queuedFollowUps = Array.from({ length: 8 }, (_, index) => ({
			id: `queued-${index}`,
			text: `queued ${index}`,
		}));
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<AppPromptDock
						viewportRows={() => 14}
						enabled={() => true}
						queuedFollowUps={() => queuedFollowUps}
						steeringQueue={() => ["sent steering"]}
						followUpQueue={() => ["sent follow-up"]}
						editQueuedFollowUp={() => {}}
						commandSuggestions={() => commands}
						commandSuggestionIndex={selectedIndex}
						insertSuggestedCommand={() => {}}
					>
						<textarea
							ref={(value) => {
								editor = value;
							}}
							focused
							flexShrink={0}
							minHeight={2}
							height={2}
							placeholder="PROMPT_ANCHOR"
						/>
					</AppPromptDock>
				</box>
			),
			80,
			14,
		);

		await setup.mockInput.typeText("PROMPT_ANCHOR");
		setSelectedIndex(6);
		await setup.flush();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		const downFrame = setup.captureCharFrame();
		const downLines = downFrame.split("\n");
		const downPromptLine = downLines.findIndex((line) =>
			line.includes("PROMPT_ANCHOR"),
		);
		const downSuggestionLines = downLines.flatMap((line, index) =>
			line.includes("/overflow-command-") ? [index] : [],
		);
		expect(editor?.plainText).toBe("PROMPT_ANCHOR");
		expect(downPromptLine).toBeGreaterThan(0);
		expect(downSuggestionLines.length).toBeGreaterThan(0);
		expect(Math.max(...downSuggestionLines)).toBeLessThan(downPromptLine);
		expect(downFrame).toContain("/overflow-command-6");
		expect(downFrame).toContain("Description 6");

		setSelectedIndex(0);
		await setup.flush();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
		const upFrame = setup.captureCharFrame();
		const upLines = upFrame.split("\n");
		const upPromptLine = upLines.findIndex((line) =>
			line.includes("PROMPT_ANCHOR"),
		);
		const upSuggestionLines = upLines.flatMap((line, index) =>
			line.includes("/overflow-command-") ? [index] : [],
		);
		expect(editor?.plainText).toBe("PROMPT_ANCHOR");
		expect(upPromptLine).toBeGreaterThan(0);
		expect(upSuggestionLines.length).toBeGreaterThan(0);
		expect(Math.max(...upSuggestionLines)).toBeLessThan(upPromptLine);
		expect(upFrame).toContain("/overflow-command-0");
	});

	test("clamps highlighted command selection and accepts only unmodified Enter", () => {
		const commands = [{ name: "help" }, { name: "model" }];
		expect(selectCommandChoice(commands, -1)?.name).toBe("help");
		expect(selectCommandChoice(commands, 99)?.name).toBe("model");
		expect(selectCommandChoice([], 0)).toBeUndefined();

		const key = (
			modifiers: {
				ctrl?: boolean;
				meta?: boolean;
				shift?: boolean;
				option?: boolean;
				super?: boolean;
			} = {},
		) =>
			new KeyEvent({
				name: "enter",
				ctrl: modifiers.ctrl ?? false,
				meta: modifiers.meta ?? false,
				shift: modifiers.shift ?? false,
				option: modifiers.option ?? false,
				...(modifiers.super === undefined ? {} : { super: modifiers.super }),
				sequence: "\\r",
				number: false,
				raw: "\\r",
				eventType: "press",
				source: "raw",
			});
		expect(isUnmodifiedEnterKey(key())).toBe(true);
		expect(isUnmodifiedEnterKey(key({ shift: true }))).toBe(false);
		expect(isUnmodifiedEnterKey(key({ ctrl: true }))).toBe(false);
		expect(isUnmodifiedEnterKey(key({ option: true }))).toBe(false);
		expect(isUnmodifiedEnterKey(key({ meta: true }))).toBe(false);
		expect(isUnmodifiedEnterKey(key({ super: true }))).toBe(false);
	});
});
