import { describe, expect, test } from "bun:test";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { handleSuggestionKey } from "../src/tabs/app-keyboard-suggestions.ts";

function keyboardEvent(name: string) {
	let prevented = false;
	let stopped = false;
	const event = {
		name,
		eventType: "press",
		ctrl: false,
		meta: false,
		option: false,
		shift: false,
		super: false,
		preventDefault() {
			prevented = true;
		},
		stopPropagation() {
			stopped = true;
		},
	} as unknown as KeyEvent;
	return { event, prevented: () => prevented, stopped: () => stopped };
}

function fixture() {
	const inserted: string[] = [];
	const [selected, setSelected] = createSignal(0);
	const commands = [{ name: "help" }, { name: "model" }];
	const ports: Parameters<typeof handleSuggestionKey>[1] = {
		commandSuggestions: () => commands,
		commandSuggestionIndex: selected,
		setCommandSuggestionIndex: setSelected,
		inspectSubagent: () => false,
		insertSuggestedCommand: (command) => inserted.push(command.name),
	};
	return { ports, inserted, selected, commands };
}

describe("keyboard slash suggestions", () => {
	test("Tab inserts the selected command and consumes the key", () => {
		const f = fixture();
		const key = keyboardEvent("tab");
		expect(handleSuggestionKey(key.event, f.ports, undefined)).toBe("handled");
		expect(f.inserted).toEqual(["help"]);
		expect(key.prevented()).toBe(true);
		expect(key.stopped()).toBe(true);
	});

	test("Enter for a complete command passes to normal native submission", () => {
		const f = fixture();
		const key = keyboardEvent("enter");
		const prompt = { plainText: "/model openai/gpt" } as TextareaRenderable;
		expect(handleSuggestionKey(key.event, f.ports, prompt)).toBe("pass");
		expect(f.inserted).toEqual([]);
		expect(key.prevented()).toBe(false);
	});

	test("Enter for a partial slash inserts the suggestion instead of submitting", () => {
		const f = fixture();
		const key = keyboardEvent("enter");
		const prompt = { plainText: "/mod" } as TextareaRenderable;
		expect(handleSuggestionKey(key.event, f.ports, prompt)).toBe("handled");
		expect(f.inserted).toEqual(["help"]);
		expect(key.prevented()).toBe(true);
	});

	test("Arrow Up wraps the full discovered command list", () => {
		const f = fixture();
		const key = keyboardEvent("up");
		expect(handleSuggestionKey(key.event, f.ports, undefined)).toBe("handled");
		expect(f.selected()).toBe(1);
		expect(key.prevented()).toBe(true);
	});

	test("Ignores suggestions while inspecting a child", () => {
		const f = fixture();
		const key = keyboardEvent("tab");
		const ports = { ...f.ports, inspectSubagent: () => true };
		expect(handleSuggestionKey(key.event, ports, undefined)).toBe("continue");
		expect(f.inserted).toEqual([]);
		expect(key.prevented()).toBe(false);
	});
});
