import { describe, expect, test } from "bun:test";
import { TabManager, resolveTabTitle, type ConversationTab } from "../src/tabs/manager.ts";

const tab = (id: string): ConversationTab => ({ id, badges: 0 });

describe("TabManager", () => {
	test("creates, activates, cycles, and refuses closing the last tab", () => {
		const manager = new TabManager(tab("one"), 2);
		expect(manager.create(tab("two"))).toBe(true);
		expect(manager.create(tab("three"))).toBe(false);
		expect(manager.cycle(-1)).toBe("one");
		expect(manager.close("two")).toBe(true);
		expect(manager.close("one")).toBe(false);
	});

	test("resolves explicit, prompt, and blank titles", () => {
		expect(resolveTabTitle({ sessionName: " Named ", firstPrompt: "ignored" })).toBe("Named");
		expect(resolveTabTitle({ firstPrompt: "hello\nworld" })).toBe("hello world");
		expect(resolveTabTitle({})).toBe("New conversation");
	});

	test("tracks and clears background badges", () => {
		const manager = new TabManager(tab("one"));
		manager.incrementBadge("one", "extension");
		expect(manager.snapshot.tabs[0]?.badges).toBe(1);
		manager.clearBadges("one");
		expect(manager.snapshot.tabs[0]?.badges).toBe(0);
	});
});
