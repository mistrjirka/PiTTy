import { describe, expect, test } from "bun:test";
import { DiagnosticLogger } from "../src/diagnostics/logger.ts";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import { ExtensionWidgetController, type ExtensionWidgetRuntime } from "../src/tabs/extension-widget-controller.ts";
import { createTabRuntime, prepareForkedTabRuntime, startTabRuntime } from "../src/tabs/runtime.ts";
import { SessionController } from "../src/tabs/session-controller.ts";
import type { RpcSessionState } from "../src/types.ts";

const widget = (widgetKey: string, widgetLines?: unknown, widgetPlacement?: unknown) => ({
	type: "extension_ui_request", id: "widget-event", method: "setWidget",
	widgetKey, widgetLines, widgetPlacement,
});

describe("generic extension text widgets", () => {
	test("replaces arbitrary keys without reordering and supports both placements", () => {
		const changes: string[] = [];
		const runtime: ExtensionWidgetRuntime = { id: "tab" };
		const controller = new ExtensionWidgetController((target) => changes.push(target.id));
		controller.handle(widget("unlisted extension/key", ["first"]), runtime);
		controller.handle(widget("", ["second"], "belowEditor"), runtime);
		controller.handle(widget("unlisted extension/key", ["new", "answer"], "belowEditor"), runtime);
		expect([...runtime.extensionWidgets?.values() ?? []]).toEqual([
			{ key: "unlisted extension/key", lines: ["new", "answer"], placement: "belowEditor" },
			{ key: "", lines: ["second"], placement: "belowEditor" },
		]);
		controller.handle(widget("unlisted extension/key", ["default again"]), runtime);
		expect(runtime.extensionWidgets?.get("unlisted extension/key")?.placement).toBe("aboveEditor");
		expect(changes).toEqual(["tab", "tab", "tab", "tab"]);
	});

	test("retains empty arrays, exact large text and deletes only omitted or undefined lines", () => {
		const runtime: ExtensionWidgetRuntime = { id: "tab" };
		let changes = 0;
		const controller = new ExtensionWidgetController(() => changes++);
		const long = "long line 😀\t\u001b[31mred\u001b[0m\n".repeat(9000);
		const lines = [long, "", "tail"];
		controller.handle(widget("large", lines), runtime);
		expect(runtime.extensionWidgets?.get("large")?.lines).toEqual(lines);
		lines.push("caller mutation");
		expect(runtime.extensionWidgets?.get("large")?.lines).toEqual([long, "", "tail"]);
		controller.handle(widget("large", []), runtime);
		expect(runtime.extensionWidgets?.get("large")?.lines).toEqual([]);
		controller.handle(widget("other", ["keep"]), runtime);
		controller.handle({ type: "extension_ui_request", method: "setWidget", widgetKey: "large" }, runtime);
		expect(runtime.extensionWidgets?.has("large")).toBe(false);
		expect(runtime.extensionWidgets?.has("other")).toBe(true);
		controller.handle(widget("other", undefined), runtime);
		expect(runtime.extensionWidgets?.size).toBe(0);
		controller.handle(widget("absent", undefined), runtime);
		expect(changes).toBe(5);
	});

	test("consumes malformed wire widgets without changing state or turning them into dialogs", () => {
		const runtime: ExtensionWidgetRuntime = { id: "tab" };
		let changes = 0;
		const controller = new ExtensionWidgetController(() => changes++);
		controller.handle(widget("keep", ["safe"]), runtime);
		for (const lines of [null, "text", 42, {}, ["text", 1], [null], [undefined]]) {
			expect(controller.handle(widget("keep", lines), runtime)).toBe(true);
		}
		for (const placement of [null, 7, "floating", {}]) {
			expect(controller.handle(widget("keep", ["bad"], placement), runtime)).toBe(true);
		}
		expect(controller.handle({ ...widget("keep", ["bad"]), widgetKey: 42 }, runtime)).toBe(true);
		expect(controller.handle({ ...widget("keep", ["bad"]), widgetKey: undefined }, runtime)).toBe(true);
		expect(runtime.extensionWidgets?.get("keep")?.lines).toEqual(["safe"]);
		expect(changes).toBe(1);
		for (const other of [null, 1, [], { method: "setWidget" }, { type: "extension_ui_request", method: "confirm" }])
			expect(controller.handle(other, runtime)).toBe(false);
	});
});

const state = (sessionId: string): RpcSessionState => ({
	sessionId, sessionFile: "/tmp/" + sessionId + ".jsonl",
	thinkingLevel: "low", isStreaming: false, isCompacting: false,
	steeringMode: "all", followUpMode: "all", autoCompactionEnabled: true,
	messageCount: 0, pendingMessageCount: 0,
});

class WidgetSessionClient extends PiRpcClient {
	currentState = state("old");
	cancelled = false;
	onStart: () => void = () => {};
	onTransition: () => void = () => {};
	constructor() { super({ cwd: process.cwd() }); }
	override async start() { this.onStart(); }
	override async getState() { return this.currentState; }
	override async getMessages() { return []; }
	override async getForkMessages() { return []; }
	override async switchSession() {
		this.onTransition();
		if (!this.cancelled) this.currentState = state("new");
		return { cancelled: this.cancelled };
	}
	override async fork() {
		await this.switchSession();
		return { cancelled: this.cancelled, text: "" };
	}
	publish(key: string, lines: string[]) { this.emit("event", widget(key, lines)); }
}

function sessionFixture() {
	const client = new WidgetSessionClient();
	const widgets = new ExtensionWidgetController(() => {});
	const runtime = createTabRuntime({
		id: "tab", cwd: process.cwd(), client,
		onEvent: (event, target) => { widgets.handle(event, target); },
	});
	const sessions = new SessionController(new DiagnosticLogger({ enabled: false }));
	return { client, runtime, sessions };
}

describe("extension widget session lifetime", () => {
	test("keeps startup widgets and same-session history reloads", async () => {
		const { client, runtime, sessions } = sessionFixture();
		client.onStart = () => client.publish("startup", ["loaded"]);
		await startTabRuntime(runtime);
		expect(runtime.extensionWidgets?.get("startup")?.lines).toEqual(["loaded"]);
		await sessions.loadCurrent(runtime, 1000);
		await sessions.loadHistory(runtime, 1000);
		expect(runtime.extensionWidgets?.get("startup")?.lines).toEqual(["loaded"]);
	});

	test("removes old-session entries but preserves startup updates before switch acknowledgement", async () => {
		const { client, runtime, sessions } = sessionFixture();
		await startTabRuntime(runtime);
		client.publish("old only", ["stale"]);
		client.publish("shared", ["unchanged text"]);
		client.onTransition = () => {
			client.publish("shared", ["unchanged text"]);
			client.publish("new only", ["fresh"]);
		};
		expect(await sessions.switchAndLoad(runtime, "/tmp/new.jsonl", 1000)).toEqual({
			cancelled: false, historyLength: 0,
		});
		expect([...runtime.extensionWidgets?.keys() ?? []]).toEqual(["shared", "new only"]);
		expect(runtime.sessionState?.sessionId).toBe("new");
	});

	test("preserves widgets when switching is cancelled or fails and discards stale transition tracking", async () => {
		const { client, runtime, sessions } = sessionFixture();
		await startTabRuntime(runtime);
		client.publish("keep", ["old"]);
		client.cancelled = true;
		expect(await sessions.switchAndLoad(runtime, "/tmp/new.jsonl", 1000)).toEqual({ cancelled: true });
		expect(runtime.extensionWidgets?.get("keep")?.lines).toEqual(["old"]);
		client.onTransition = () => { throw new Error("switch failed"); };
		await expect(sessions.switchAndLoad(runtime, "/tmp/new.jsonl", 1000)).rejects.toThrow("switch failed");
		expect(runtime.extensionWidgets?.get("keep")?.lines).toEqual(["old"]);
		client.publish("late", ["old session"]);
		client.currentState = state("external change");
		await sessions.loadCurrent(runtime, 1000);
		expect(runtime.extensionWidgets?.size).toBe(0);
	});

	test("preserves fork startup widgets and drops the source session's widgets", async () => {
		const { client, runtime } = sessionFixture();
		client.onStart = () => client.publish("source", ["old"]);
		client.onTransition = () => client.publish("fork", ["new"]);
		await prepareForkedTabRuntime(runtime, "entry");
		expect([...runtime.extensionWidgets?.keys() ?? []]).toEqual(["fork"]);
	});

	test("clears only the exiting tab, while a recoverable protocol error preserves widgets", async () => {
		const first = sessionFixture();
		const second = sessionFixture();
		first.client.publish("one", ["first"]);
		second.client.publish("two", ["second"]);
		first.client.emit("protocol-error", new Error("bad frame"));
		expect(first.runtime.extensionWidgets?.size).toBe(1);
		first.client.emit("exit", new Error("disconnected"));
		expect(first.runtime.extensionWidgets?.size).toBe(0);
		expect(second.runtime.extensionWidgets?.get("two")?.lines).toEqual(["second"]);
	});
});
