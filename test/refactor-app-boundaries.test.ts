import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { DiagnosticLogger } from "../src/diagnostics/logger.ts";
import { CommandCatalogService } from "../src/tabs/command-catalog.ts";
import { ExtensionRequestRouter } from "../src/tabs/extension-router.ts";
import { TabManager, type TabManagerState } from "../src/tabs/manager.ts";
import {
	createPromptDraftActions,
	type PromptDraftPorts,
} from "../src/tabs/prompt-draft-actions.ts";
import { createTabRuntime } from "../src/tabs/runtime.ts";
import {
	createTabLifecycle,
	type TabLifecyclePorts,
} from "../src/tabs/tab-lifecycle.ts";
import type { RpcExtensionUIRequest } from "../src/types.ts";
import type { CommandChoice } from "../src/ui/command-suggestions.tsx";

describe("extracted tab lifecycle", () => {
	test("activates the existing session without starting a new process", () => {
		const cwd = process.cwd();
		const first = createTabRuntime({ id: "first", cwd });
		const second = createTabRuntime({ id: "second", cwd });
		const manager = new TabManager({ id: "first", badges: 0 });
		manager.create({ id: "second", badges: 2 });
		manager.activate("first");
		const [tabState, setTabState] = createSignal<TabManagerState>(
			manager.snapshot,
		);
		const [activeTabId, setActiveTabId] = createSignal("first");
		const [runtimeMap, setRuntimeMap] = createSignal(
			new Map([
				["first", first],
				["second", second],
			]),
		);
		const [commandChoices, setCommandChoices] = createSignal<CommandChoice[]>(
			[],
		);
		const [, setCompactionRevision] = createSignal(0);
		const [, setDialog] = createSignal<RpcExtensionUIRequest>();
		const [dialogOwnerRuntimeId, setDialogOwnerRuntimeId] =
			createSignal<string>();
		const [, setModelSelectorOpen] = createSignal(false);
		const [, setPromptMapOpen] = createSignal(false);
		const [, setForkPickerOptions] = createSignal<
			import("../src/tabs/entry-index.ts").ForkPickerOption[]
		>([]);
		const [, setForkPickerOpen] = createSignal(false);
		let lastStatus = "";
		let resetCount = -1;
		let refreshes = 0;
		const logger = new DiagnosticLogger({ enabled: false });
		const ports: TabLifecyclePorts = {
			cwd,
			piArgs: [],
			piExecutable: undefined,
			claudeLaunchEnv: undefined,
			logger,
			renderer: { setTerminalTitle: () => {} },
			tabManager: manager,
			tabState,
			setTabState,
			extensionRouter: new ExtensionRequestRouter(),
			runtimeMap,
			setRuntimeMap,
			activeTabId,
			setActiveTabId,
			activeRuntime: () => runtimeMap().get(activeTabId()) ?? first,
			isRuntimeActive: (id) => activeTabId() === id,
			setCommandChoices,
			commandCatalog: new CommandCatalogService(),
			setCompactionRevision,
			setExtensionStatus: () => {},
			setStatus: (value) => {
				lastStatus = value;
			},
			dialogOwnerRuntimeId,
			setDialogOwnerRuntimeId,
			setDialog,
			setModelSelectorOpen,
			setPromptMapOpen,
			toast: () => {},
			touch: () => {},
			backgroundSelection: () => undefined,
			closeBackgroundTask: () => {},
			dropRefreshCoordinator: () => {},
			refreshCommandChoices: async () => [],
			resetMessageWindow: (count) => {
				resetCount = count;
			},
			selectedSubagentTarget: () => undefined,
			subagentScroll: () => undefined,
			scrollToBottom: () => {},
			prompt: () => undefined,
			setDraftSwitchGuard: () => {},
			syncMainDraft: () => {},
			loadRuntimeHistory: async () => {},
			refreshState: async () => {
				refreshes++;
				return true;
			},
			conversationTouch: () => {},
			notifyCacheWarning: () => {},
			flushQueuedFollowUp: async () => {},
			isExtensionUiRequest: (_event): _event is RpcExtensionUIRequest => false,
			provisionalRuntimes: new Set(),
			setForkPickerOptions,
			setForkPickerOpen,
		};
		const actions = createTabLifecycle(ports);
		actions.activateTab("second");
		expect(activeTabId()).toBe("second");
		expect(tabState().activeId).toBe("second");
		expect(tabState().tabs.find((tab) => tab.id === "second")?.badges).toBe(0);
		expect(resetCount).toBe(0);
		expect(refreshes).toBe(0);
		expect(commandChoices().some((choice) => choice.name === "help")).toBe(
			true,
		);
		actions.routeRuntimeEvent({ type: "agent_start" }, second);
		expect(lastStatus).toBe("working");
		actions.routeRuntimeEvent({ type: "agent_settled" }, second);
		expect(lastStatus).toBe("ready");
	});
});

describe("extracted prompt draft editing", () => {
	test("preserves a mismatched draft and clears only the matching submitted text", () => {
		const cwd = process.cwd();
		const runtime = createTabRuntime({ id: "first", cwd });
		const [promptText, setPromptText] = createSignal("");
		const [, setPromptCursorOffset] = createSignal(0);
		const [, setCommandSuggestionIndex] = createSignal(0);
		const ports: PromptDraftPorts = {
			cwd,
			currentSessionKey: () => "session-one",
			revision: () => 0,
			activeRuntime: () => runtime,
			isRuntimeActive: (id) => id === runtime.id,
			getPrompt: () => undefined,
			setPromptText,
			setPromptCursorOffset,
			setCommandSuggestionIndex,
			toast: () => {},
		};
		const actions = createPromptDraftActions(ports);
		actions.syncMainDraft("Keep this draft");
		expect(actions.currentDrafts().main).toBe("Keep this draft");
		expect(actions.expandedPromptText()).toBe("Keep this draft");
		actions.clearRuntimeMainDraftIfMatches(runtime, "Different request");
		expect(actions.currentDrafts().main).toBe("Keep this draft");
		// The runtime's own draft uses its session-id key, not the UI session key above.
		runtime.sessionState = {
			sessionId: "session-one",
			thinkingLevel: "low",
			isStreaming: false,
			isCompacting: false,
			steeringMode: "all",
			followUpMode: "all",
			autoCompactionEnabled: true,
			messageCount: 0,
			pendingMessageCount: 0,
		};
		actions.clearRuntimeMainDraftIfMatches(runtime, "Keep this draft");
		expect(actions.currentDrafts().main).toBe("");
		expect(promptText()).toBe("");
	});
});
