import { expect, test } from "bun:test";
import {
	BTW_MIN_VISIBLE_MS,
	BTW_WIDGET_KEY,
	TransientWidgetDismissController,
} from "../src/state/extension-widgets.ts";
import { ExtensionWidgetController, type ExtensionWidgetRuntime } from "../src/tabs/extension-widget-controller.ts";

const HELP = [
	"BTW",
	"/btw <question>  Ask using the current conversation.",
	"/btw cancel  Cancel this side question.",
	"/btw clear  Hide the panel. The answer remains in memory.",
];
const ANSWER = ["BTW · Answer", "> Question", "", "**Formatted** answer"];
const RUNNING = ["BTW · Answering", "> Question", "", "Still **working**"];
const publish = (controller: ExtensionWidgetController, runtime: ExtensionWidgetRuntime, key: string, lines: string[]) =>
	controller.handle({ type: "extension_ui_request", id: "widget", method: "setWidget", widgetKey: key, widgetLines: lines }, runtime);

function fixture() {
	let now = 1_000;
	let changes = 0;
	const runtime: ExtensionWidgetRuntime = { id: "tab" };
	const controller = new ExtensionWidgetController(() => { changes++; }, () => now);
	const dismiss = new TransientWidgetDismissController(() => { changes++; }, () => now);
	return { runtime, controller, dismiss, setNow: (value: number) => { now = value; }, changes: () => changes };
}

test("/btw help and completed answers dismiss on an edit after 30 seconds, other widgets remain", () => {
	const f = fixture();
	publish(f.controller, f.runtime, BTW_WIDGET_KEY, HELP);
	publish(f.controller, f.runtime, "another", HELP);
	expect(f.runtime.extensionWidgets?.get(BTW_WIDGET_KEY)?.dismissOnTypingAt).toBe(1_000 + BTW_MIN_VISIBLE_MS);
	expect(f.runtime.extensionWidgets?.get("another")?.dismissOnTypingAt).toBeUndefined();
	f.setNow(31_000);
	f.dismiss.onUserTyped(f.runtime);
	expect(f.runtime.extensionWidgets?.has(BTW_WIDGET_KEY)).toBe(false);
	expect(f.runtime.extensionWidgets?.has("another")).toBe(true);
	publish(f.controller, f.runtime, BTW_WIDGET_KEY, ANSWER);
	expect(f.runtime.extensionWidgets?.get(BTW_WIDGET_KEY)?.dismissOnTypingAt).toBe(31_000 + BTW_MIN_VISIBLE_MS);
	f.setNow(61_000);
	f.dismiss.onUserTyped(f.runtime);
	expect(f.runtime.extensionWidgets?.has(BTW_WIDGET_KEY)).toBe(false);
	expect(f.runtime.extensionWidgets?.has("another")).toBe(true);
});

test("errors, cancellation, output limits and idle messages dismiss by the same rule", () => {
	const f = fixture();
	for (const [index, head] of [
		"BTW · Error", "BTW · Cancelled", "BTW · Output limit reached",
		"BTW · Tool request was not executed", "BTW",
	].entries()) {
		const created = 1_000 + index * 50_000;
		f.setNow(created);
		publish(f.controller, f.runtime, BTW_WIDGET_KEY, [head, "Message"]);
		expect(f.runtime.extensionWidgets?.get(BTW_WIDGET_KEY)?.dismissOnTypingAt).toBe(created + BTW_MIN_VISIBLE_MS);
		f.setNow(created + BTW_MIN_VISIBLE_MS);
		f.dismiss.onUserTyped(f.runtime);
		expect(f.runtime.extensionWidgets?.has(BTW_WIDGET_KEY)).toBe(false);
	}
});

test("an edit before 30 seconds does not dismiss now or silently arm later dismissal", () => {
	const f = fixture();
	publish(f.controller, f.runtime, BTW_WIDGET_KEY, ANSWER);
	publish(f.controller, f.runtime, "background", ["Job still running"]);
	f.setNow(11_000);
	f.dismiss.onUserTyped(f.runtime);
	expect(f.runtime.extensionWidgets?.has(BTW_WIDGET_KEY)).toBe(true);
	f.setNow(90_000);
	expect(f.runtime.extensionWidgets?.has(BTW_WIDGET_KEY)).toBe(true);
	f.dismiss.onUserTyped(f.runtime);
	expect(f.runtime.extensionWidgets?.has(BTW_WIDGET_KEY)).toBe(false);
	expect(f.runtime.extensionWidgets?.get("background")?.lines).toEqual(["Job still running"]);
});

test("without typing, an old answer stays visible for review", () => {
	const f = fixture();
	publish(f.controller, f.runtime, BTW_WIDGET_KEY, ANSWER);
	f.setNow(200_000);
	expect(f.runtime.extensionWidgets?.get(BTW_WIDGET_KEY)?.lines).toEqual(ANSWER);
});

test("running answers never dismiss, and the 30-second clock begins on completion", () => {
	const f = fixture();
	publish(f.controller, f.runtime, BTW_WIDGET_KEY, RUNNING);
	f.setNow(300_000);
	f.dismiss.onUserTyped(f.runtime);
	expect(f.runtime.extensionWidgets?.get(BTW_WIDGET_KEY)?.lines).toEqual(RUNNING);
	expect(f.runtime.extensionWidgets?.get(BTW_WIDGET_KEY)?.dismissOnTypingAt).toBeUndefined();
	publish(f.controller, f.runtime, BTW_WIDGET_KEY, ANSWER);
	f.dismiss.onUserTyped(f.runtime);
	expect(f.runtime.extensionWidgets?.has(BTW_WIDGET_KEY)).toBe(true);
	f.setNow(330_000);
	f.dismiss.onUserTyped(f.runtime);
	expect(f.runtime.extensionWidgets?.has(BTW_WIDGET_KEY)).toBe(false);
});

test("publishing a newer answer resets the 30-second clock", () => {
	const f = fixture();
	publish(f.controller, f.runtime, BTW_WIDGET_KEY, ANSWER);
	f.setNow(29_000);
	publish(f.controller, f.runtime, BTW_WIDGET_KEY, ["BTW · Error", "Retry failed"]);
	f.setNow(31_000);
	f.dismiss.onUserTyped(f.runtime);
	expect(f.runtime.extensionWidgets?.get(BTW_WIDGET_KEY)?.lines[0]).toBe("BTW · Error");
	f.setNow(59_000);
	f.dismiss.onUserTyped(f.runtime);
	expect(f.runtime.extensionWidgets?.has(BTW_WIDGET_KEY)).toBe(false);
});

test("clearing a widget does not leave any delayed dismissal", () => {
	const f = fixture();
	publish(f.controller, f.runtime, BTW_WIDGET_KEY, ANSWER);
	const changes = f.changes();
	f.controller.handle({ type: "extension_ui_request", id: "clear", method: "setWidget", widgetKey: BTW_WIDGET_KEY }, f.runtime);
	f.setNow(300_000);
	f.dismiss.onUserTyped(f.runtime);
	expect(f.changes()).toBe(changes + 1);
	expect(f.runtime.extensionWidgets?.has(BTW_WIDGET_KEY)).toBe(false);
});
