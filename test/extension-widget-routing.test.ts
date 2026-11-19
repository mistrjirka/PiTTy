import { expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { DiagnosticLogger } from "../src/diagnostics/logger.ts";
import { CommandCatalogService } from "../src/tabs/command-catalog.ts";
import { ExtensionRequestRouter } from "../src/tabs/extension-router.ts";
import { TabManager, type TabManagerState } from "../src/tabs/manager.ts";
import { createTabRuntime } from "../src/tabs/runtime.ts";
import { createTabLifecycle, type TabLifecyclePorts } from "../src/tabs/tab-lifecycle.ts";
import type { RpcExtensionUIRequest } from "../src/types.ts";

test("streams widgets around an open dialog without acknowledgements, transcript rows or inactive-tab badges", () => {
	const cwd = process.cwd();
	const first = createTabRuntime({ id: "first", cwd });
	const second = createTabRuntime({ id: "second", cwd });
	let acknowledgements = 0;
	first.client.sendExtensionUiResponse = second.client.sendExtensionUiResponse = async () => { acknowledgements++; };
	const manager = new TabManager({ id: "first", badges: 0 });
	manager.create({ id: "second", badges: 0 });
	const [tabState, setTabState] = createSignal<TabManagerState>(manager.snapshot);
	const [activeTabId, setActiveTabId] = createSignal("first");
	const [runtimeMap, setRuntimeMap] = createSignal(new Map([["first", first], ["second", second]]));
	const [, setCommandChoices] = createSignal<import("../src/ui/command-suggestions.tsx").CommandChoice[]>([]);
	const [, setCompactionRevision] = createSignal(0);
	const [dialog, setDialog] = createSignal<RpcExtensionUIRequest>();
	const [dialogOwnerRuntimeId, setDialogOwnerRuntimeId] = createSignal<string>();
	const [, setModelSelectorOpen] = createSignal(false);
	const [, setPromptMapOpen] = createSignal(false);
	const [, setForkPickerOptions] = createSignal<import("../src/tabs/entry-index.ts").ForkPickerOption[]>([]);
	const [, setForkPickerOpen] = createSignal(false);
	let touches = 0;
	const router = new ExtensionRequestRouter();
	const ports: TabLifecyclePorts = {
		cwd, piArgs: [], piExecutable: undefined, claudeLaunchEnv: undefined,
		logger: new DiagnosticLogger({ enabled: false }),
		renderer: { setTerminalTitle: () => {} },
		tabManager: manager, tabState, setTabState, extensionRouter: router,
		runtimeMap, setRuntimeMap, activeTabId, setActiveTabId,
		activeRuntime: () => runtimeMap().get(activeTabId()) ?? first,
		isRuntimeActive: (id) => activeTabId() === id,
		setCommandChoices, commandCatalog: new CommandCatalogService(),
		setCompactionRevision, setExtensionStatus: () => {}, setStatus: () => {},
		dialogOwnerRuntimeId, setDialogOwnerRuntimeId, setDialog,
		setModelSelectorOpen, setPromptMapOpen,
		toast: () => {}, touch: () => { touches++; },
		backgroundSelection: () => undefined, closeBackgroundTask: () => {},
		dropRefreshCoordinator: () => {}, refreshCommandChoices: async () => [],
		resetMessageWindow: () => {}, selectedSubagentTarget: () => undefined,
		subagentScroll: () => undefined, scrollToBottom: () => {},
		prompt: () => undefined, setDraftSwitchGuard: () => {}, syncMainDraft: () => {},
		loadRuntimeHistory: async () => {}, refreshState: async () => true,
		conversationTouch: () => {}, notifyCacheWarning: () => {},
		flushQueuedFollowUp: async () => {},
		isExtensionUiRequest: (event): event is RpcExtensionUIRequest =>
			Boolean(event && typeof event === "object" && "type" in event && event.type === "extension_ui_request"),
		provisionalRuntimes: new Set(), setForkPickerOptions, setForkPickerOpen,
	};
	const actions = createTabLifecycle(ports);
	first.client.onEvent((event) => actions.routeRuntimeEvent(event, first));
	second.client.onEvent((event) => actions.routeRuntimeEvent(event, second));
	actions.activateTab("first");
	const confirm: RpcExtensionUIRequest = {
		type: "extension_ui_request", id: "modal", method: "confirm", title: "Continue?", message: "Waiting",
	};
	first.client.emit("event", confirm);
	expect(dialog()).toEqual(confirm);
	const publish = (runtime: typeof first, lines: unknown) => runtime.client.emit("event", {
		type: "extension_ui_request", id: "widget", method: "setWidget",
		widgetKey: "any extension", widgetLines: lines,
	});
	publish(first, ["stream 1"]);
	publish(first, ["stream 2"]);
	publish(second, ["other tab"]);
	publish(first, ["invalid", 1]);
	expect(first.extensionWidgets?.get("any extension")?.lines).toEqual(["stream 2"]);
	expect(second.extensionWidgets?.get("any extension")?.lines).toEqual(["other tab"]);
	expect(touches).toBe(2);
	expect(dialog()).toEqual(confirm);
	expect(router.pending("first")).toBe(1);
	expect(router.pending("second")).toBe(0);
	expect(tabState().tabs.find((tab) => tab.id === "second")?.badges).toBe(0);
	expect(acknowledgements).toBe(0);
	expect(first.conversation.items).toEqual([]);
	expect(second.conversation.items).toEqual([]);
	actions.routeRuntimeEvent({ type: "compaction_start" }, first);
	actions.routeRuntimeEvent({ type: "compaction_end" }, first);
	expect(first.extensionWidgets?.get("any extension")?.lines).toEqual(["stream 2"]);
	actions.activateTab("second");
	expect(second.extensionWidgets?.get("any extension")?.lines).toEqual(["other tab"]);
	actions.activateTab("first");
	expect(first.extensionWidgets?.get("any extension")?.lines).toEqual(["stream 2"]);
	expect(dialog()).toEqual(confirm);
	expect(acknowledgements).toBe(0);
});
