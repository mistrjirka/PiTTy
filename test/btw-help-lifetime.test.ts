import { expect, test } from "bun:test";
import {
	BTW_HELP_MIN_VISIBLE_MS,
	BTW_HELP_WIDGET_KEY,
	TransientWidgetDismissController,
} from "../src/state/extension-widgets.ts";
import { ExtensionWidgetController, type ExtensionWidgetRuntime } from "../src/tabs/extension-widget-controller.ts";

const HELP = [
	"BTW",
	"/btw <question>  Ask using the current conversation.",
	"/btw cancel  Cancel this side question.",
	"/btw clear  Hide the panel. The answer remains in memory.",
];
const ANSWER = ["BTW · Answer", "> Question", "", "This answer stays visible."];
const publish = (controller: ExtensionWidgetController, runtime: ExtensionWidgetRuntime, key: string, lines: string[]) =>
	controller.handle({ type: "extension_ui_request", id: "widget", method: "setWidget", widgetKey: key, widgetLines: lines }, runtime);

function fixture() {
	let now = 1_000;
	let changes = 0;
	const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
	const runtime: ExtensionWidgetRuntime = { id: "tab" };
	const controller = new ExtensionWidgetController(() => { changes++; }, () => now);
	const dismiss = new TransientWidgetDismissController(() => { changes++; }, () => now,
		(callback, delayMs) => {
			scheduled.push({ callback, delayMs });
			return setTimeout(() => {}, 60_000);
		});
	return { runtime, controller, dismiss, scheduled, setNow: (value: number) => { now = value; }, changes: () => changes };
}

test("/btw help is temporary, while side-question answers and other widgets are permanent", () => {
	const f = fixture();
	try {
		publish(f.controller, f.runtime, BTW_HELP_WIDGET_KEY, HELP);
		publish(f.controller, f.runtime, "another", HELP);
		expect(f.runtime.extensionWidgets?.get(BTW_HELP_WIDGET_KEY)?.dismissOnTypingAt).toBe(1_000 + BTW_HELP_MIN_VISIBLE_MS);
		expect(f.runtime.extensionWidgets?.get("another")?.dismissOnTypingAt).toBeUndefined();
		f.setNow(31_000);
		f.dismiss.onUserTyped(f.runtime);
		expect(f.runtime.extensionWidgets?.has(BTW_HELP_WIDGET_KEY)).toBe(false);
		expect(f.runtime.extensionWidgets?.has("another")).toBe(true);
		publish(f.controller, f.runtime, BTW_HELP_WIDGET_KEY, ANSWER);
		expect(f.runtime.extensionWidgets?.get(BTW_HELP_WIDGET_KEY)?.dismissOnTypingAt).toBeUndefined();
		f.setNow(300_000);
		f.dismiss.onUserTyped(f.runtime);
		expect(f.runtime.extensionWidgets?.get(BTW_HELP_WIDGET_KEY)?.lines).toEqual(ANSWER);
		expect(f.scheduled).toHaveLength(0);
	} finally { f.dismiss.dispose(); }
});

test("typing early keeps the guide for 30 seconds, then removes only the guide", () => {
	const f = fixture();
	try {
		publish(f.controller, f.runtime, BTW_HELP_WIDGET_KEY, HELP);
		publish(f.controller, f.runtime, "background", ["Job still running"]);
		f.setNow(11_000);
		f.dismiss.onUserTyped(f.runtime);
		expect(f.runtime.extensionWidgets?.has(BTW_HELP_WIDGET_KEY)).toBe(true);
		expect(f.scheduled).toHaveLength(1);
		expect(f.scheduled[0]?.delayMs).toBe(20_000);
		f.dismiss.onUserTyped(f.runtime);
		expect(f.scheduled).toHaveLength(1);
		f.setNow(31_000);
		f.scheduled[0]?.callback();
		expect(f.runtime.extensionWidgets?.has(BTW_HELP_WIDGET_KEY)).toBe(false);
		expect(f.runtime.extensionWidgets?.get("background")?.lines).toEqual(["Job still running"]);
	} finally { f.dismiss.dispose(); }
});

test("without typing, the help remains available even after 30 seconds", () => {
	const f = fixture();
	try {
		publish(f.controller, f.runtime, BTW_HELP_WIDGET_KEY, HELP);
		f.setNow(90_000);
		expect(f.runtime.extensionWidgets?.get(BTW_HELP_WIDGET_KEY)?.lines).toEqual(HELP);
		f.dismiss.onUserTyped(f.runtime);
		expect(f.runtime.extensionWidgets?.has(BTW_HELP_WIDGET_KEY)).toBe(false);
	} finally { f.dismiss.dispose(); }
});

test("an old typing timer never hides a newer help panel or answer", () => {
	const f = fixture();
	try {
		publish(f.controller, f.runtime, BTW_HELP_WIDGET_KEY, HELP);
		f.dismiss.onUserTyped(f.runtime);
		expect(f.scheduled).toHaveLength(1);
		f.setNow(10_000);
		publish(f.controller, f.runtime, BTW_HELP_WIDGET_KEY, ANSWER);
		f.scheduled[0]?.callback();
		expect(f.runtime.extensionWidgets?.get(BTW_HELP_WIDGET_KEY)?.lines).toEqual(ANSWER);
		publish(f.controller, f.runtime, BTW_HELP_WIDGET_KEY, HELP);
		f.setNow(11_000);
		f.dismiss.onUserTyped(f.runtime);
		expect(f.scheduled).toHaveLength(2);
		f.scheduled[1]?.callback();
		expect(f.runtime.extensionWidgets?.has(BTW_HELP_WIDGET_KEY)).toBe(false);
	} finally { f.dismiss.dispose(); }
});

test("clearing the widget before the timer expires is safe", () => {
	const f = fixture();
	try {
		publish(f.controller, f.runtime, BTW_HELP_WIDGET_KEY, HELP);
		f.dismiss.onUserTyped(f.runtime);
		const changes = f.changes();
		f.controller.handle({ type: "extension_ui_request", id: "clear", method: "setWidget", widgetKey: BTW_HELP_WIDGET_KEY }, f.runtime);
		f.scheduled[0]?.callback();
		expect(f.changes()).toBe(changes + 1);
		expect(f.runtime.extensionWidgets?.has(BTW_HELP_WIDGET_KEY)).toBe(false);
	} finally { f.dismiss.dispose(); }
});
