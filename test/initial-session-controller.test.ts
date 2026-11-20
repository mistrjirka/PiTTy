import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { DiagnosticLogger } from "../src/diagnostics/logger.ts";
import type { OptionalIntegrationStatus } from "../src/integrations/detect.ts";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import { startupPhaseForRuntime, type StartupPhase } from "../src/state/startup.ts";
import { createInputActions } from "../src/tabs/input-actions.ts";
import {
	type InitialSessionPorts,
	startInitialSession,
} from "../src/tabs/initial-session.ts";
import { createTabRuntime } from "../src/tabs/runtime.ts";
import type { RpcSessionState } from "../src/types.ts";
import type { CommandChoice } from "../src/ui/command-suggestions.tsx";
import type { ModelChoice } from "../src/ui/model-selector.tsx";

const readyState: RpcSessionState = {
	sessionFile: "/tmp/initial.jsonl",
	sessionId: "fixture",
	thinkingLevel: "low",
	isStreaming: false,
	isCompacting: false,
	steeringMode: "all",
	followUpMode: "all",
	autoCompactionEnabled: true,
	messageCount: 0,
	pendingMessageCount: 0,
};

class InitialSessionClient extends PiRpcClient {
	readonly calls: string[] = [];
	state: RpcSessionState = readyState;
	constructor(private readonly failState: boolean) {
		super({ cwd: process.cwd() });
	}
	override async start(): Promise<void> {
		this.calls.push("start");
	}
	override async getState(): Promise<RpcSessionState> {
		this.calls.push("getState");
		if (this.failState) throw new Error("fixture state failed");
		return this.state;
	}
	override async getMessages(): Promise<unknown[]> {
		this.calls.push("getMessages");
		return [];
	}
}

function fixture(failState: boolean) {
	const client = new InitialSessionClient(failState);
	const runtime = createTabRuntime({ id: "main", cwd: process.cwd(), client });
	const logger = new DiagnosticLogger({ enabled: false });
	const [phase, setStartupPhase] = createSignal<StartupPhase>({
		kind: "starting",
	});
	const [, setCommandChoices] = createSignal<CommandChoice[]>([]);
	const statuses: string[] = [];
	const events: string[] = [];
	const optional = { packageName: "fixture", installed: true, detectedBy: [] };
	const integrations: OptionalIntegrationStatus = {
		subagents: optional,
		todos: optional,
		memory: optional,
		mcpAdapter: optional,
		mcpBuiltin: { supported: true, disabledBySettings: false, disabledBy: [] },
		doppelclaude: optional,
	};
	const ports: InitialSessionPorts = {
		runtime,
		logger,
		cwd: process.cwd(),
		sidebar: true,
		themeWarning: undefined,
		integrations,
		openSessionSelectorOnStartup: false,
		startupPhase: phase,
		setStartupPhase,
		setStatus: (value) => {
			statuses.push(value);
		},
		setExtensionStatus: (value) => {
			events.push("stderr:" + value);
		},
		setRpcAvailable: (value) => {
			events.push("available:" + value);
		},
		isRuntimeActive: (id) => id === runtime.id,
		commandCatalog: {
			refresh: async () => {
				events.push("commands");
				return [];
			},
		},
		setCommandChoices,
		resetMessageWindow: (count) => {
			events.push("window:" + count);
		},
		rememberThinkingLevel: () => {
			events.push("thinking");
		},
		fetchAvailableModels: async (): Promise<ModelChoice[]> => [],
		touch: () => {
			events.push("touch");
		},
		conversationTouch: () => {
			events.push("conversation");
		},
		scrollToLatest: () => {
			events.push("scroll");
		},
		openSessionSelector: () => {
			events.push("session-selector");
		},
		focusPrompt: () => {
			events.push("prompt-focus");
		},
		discoverCurrentSessions: async () => {
			events.push("discover");
		},
		refreshState: async () => {
			events.push("refresh");
			return true;
		},
		toast: (message) => {
			events.push("toast:" + message);
		},
		sessionLoadTimeoutMs: 1000,
		startupDeadlineMs: 1000,
		updateEnvironment: { PITTY_NO_UPDATE_CHECK: "1" },
	};
	return { ports, runtime, phase, client, statuses, events };
}

describe("initial session extraction", () => {
	test("loads RPC state and history before marking the UI ready", async () => {
		const f = fixture(false);
		await startInitialSession(f.ports);
		expect(f.client.calls).toEqual(["start", "getState", "getMessages"]);
		expect(f.phase()).toEqual({ kind: "ready" });
		expect(f.runtime.sessionState?.sessionId).toBe("fixture");
		expect(f.runtime.startupResolved).toBe(true);
		expect(f.events).toContain("commands");
		expect(f.events).toContain("window:0");
		expect(f.events).toContain("refresh");
		expect(f.events).toContain("prompt-focus");
		expect(f.statuses.at(-1)).toBe("ready");
		f.client.emit("stderr", "extension started\n");
		expect(f.events).toContain("stderr:extension started");
	});

	test("finishing background startup does not replace the new tab's viewport or commands", async () => {
		const f = fixture(false);
		let activeTabId = f.runtime.id;
		let windowStart = 0;
		let scrollTop = 10;
		let status = "starting";
		let commands: CommandChoice[] = [];
		let releaseHistory!: (messages: unknown[]) => void;
		let markRequested!: () => void;
		const history = new Promise<unknown[]>((resolve) => { releaseHistory = resolve; });
		const requested = new Promise<void>((resolve) => { markRequested = resolve; });
		f.client.getMessages = () => { markRequested(); return history; };
		const startup = startInitialSession({
			...f.ports,
			isRuntimeActive: (id) => id === activeTabId,
			resetMessageWindow: (count) => { windowStart = Math.max(0, count - 120); },
			scrollToLatest: () => { scrollTop = 999; },
			setCommandChoices: (value) => {
				commands = typeof value === "function" ? value(commands) : value;
				return commands;
			},
			setStatus: (value) => { status = value; },
		});
		await requested;
		// The user opens another tab while the first Pi process is still loading.
		activeTabId = "new-tab";
		commands = [{ name: "new-tab-command" }];
		status = "working";
		releaseHistory(Array.from({ length: 200 }, (_, index) => ({
			role: "user", content: [{ type: "text", text: "Old request " + index }],
			timestamp: index + 1,
		})));
		await startup;
		expect(f.runtime.conversation.items).toHaveLength(200);
		expect(f.runtime.startupResolved).toBe(true);
		expect(f.phase()).toEqual({ kind: "ready" });
		expect(windowStart).toBe(0);
		expect(scrollTop).toBe(10);
		expect(commands).toEqual([{ name: "new-tab-command" }]);
		expect(status).toBe("working");
		expect(f.events).not.toContain("prompt-focus");
		expect(f.events).not.toContain("session-selector");
	});

	test("checks the active tab again when the startup scroll runs", async () => {
		const f = fixture(false);
		let activeTabId = f.runtime.id;
		await startInitialSession({
			...f.ports,
			isRuntimeActive: (id) => id === activeTabId,
			conversationTouch: () => {
				queueMicrotask(() => { activeTabId = "new-tab"; });
			},
		});
		expect(f.runtime.startupResolved).toBe(true);
		expect(f.events).not.toContain("scroll");
	});

	test("restores pending messages and compaction state before enabling the editor", async () => {
		const f = fixture(false);
		f.client.state = {
			...readyState,
			isCompacting: true,
			queue: { revision: 4, messages: [
				{ id: "steering", mode: "steer", message: "first pending" },
				{ id: "follow-up", mode: "followUp", message: "second pending" },
			] },
		};
		await startInitialSession(f.ports);
		expect(f.phase()).toEqual({ kind: "ready" });
		expect(f.runtime.conversation.isCompacting).toBe(true);
		expect(f.runtime.conversation.queue).toEqual(f.client.state.queue);
		expect(f.runtime.conversation.steering).toEqual(["first pending"]);
		expect(f.runtime.conversation.followUp).toEqual(["second pending"]);
	});

	test("does not restore a pending message consumed while startup history loads", async () => {
		const f = fixture(false);
		f.client.state = {
			...readyState,
			queue: { revision: 4, messages: [{ id: "consumed", mode: "steer", message: "first" }] },
		};
		f.client.getMessages = async () => {
			f.client.emit("event", { type: "queue_update", steering: [], followUp: [], revision: 5, messages: [] });
			return [];
		};
		await startInitialSession(f.ports);
		expect(f.phase()).toEqual({ kind: "ready" });
		expect(f.runtime.conversation.queue).toEqual({ revision: 5, messages: [] });
		expect(f.runtime.conversation.steering).toEqual([]);
	});

	test("a late background history failure does not mark the active tab disconnected", async () => {
		const f = fixture(false);
		let activeTabId = f.runtime.id;
		let status = "starting";
		let rejectHistory!: (error: Error) => void;
		let markRequested!: () => void;
		const history = new Promise<unknown[]>((_resolve, reject) => { rejectHistory = reject; });
		const requested = new Promise<void>((resolve) => { markRequested = resolve; });
		f.client.getMessages = () => { markRequested(); return history; };
		const startup = startInitialSession({
			...f.ports,
			isRuntimeActive: (id) => id === activeTabId,
			setStatus: (value) => { status = value; },
		});
		await requested;
		activeTabId = "new-tab";
		status = "working";
		rejectHistory(new Error("Old tab history failed"));
		await startup;
		expect(f.phase()).toEqual({ kind: "failed", reason: "error" });
		expect(f.runtime.startupResolved).toBe(false);
		expect(f.runtime.conversation.items).toContainEqual(expect.objectContaining({
			kind: "system", text: "Old tab history failed", tone: "error",
		}));
		expect(status).toBe("working");
		expect(f.events).not.toContain("available:false");
		expect(f.events).not.toContain("touch");
		expect(f.events).not.toContain("conversation");
	});

	test("a ready new tab submits after initial startup fails while waiting and failed tabs stay blocked", async () => {
		const f = fixture(false);
		const next = createTabRuntime({ id: "new-tab", cwd: process.cwd() });
		let active = f.runtime;
		let draft = "New tab request";
		const sent: string[] = [];
		const notices: string[] = [];
		f.runtime.client.prompt = async (text) => { sent.push("main:" + text); };
		next.client.prompt = async (text) => { sent.push("new-tab:" + text); };
		const activePhase = () => startupPhaseForRuntime(f.phase(), active, f.runtime);
		const input = createInputActions({
			logger: f.ports.logger, activeRuntime: () => active, startupPhase: activePhase,
			tabRuntimeIsActive: (id) => id === active.id,
			trimMessageWindowIfFollowingLatest() {}, conversationTouch() {}, scrollToBottom() {},
			clearRuntimeMainDraftIfMatches(runtime, text) { if (runtime === active && draft === text) draft = ""; },
			toast: (text) => { notices.push(text); }, dialog: () => undefined,
			expandedPromptText: () => draft, handleSlashCommand: async () => false,
			clearMainDraft: () => { draft = ""; }, syncMainDraft: (text) => { draft = text; },
			syncRuntimeMainDraft() {}, touch() {}, getPrompt: () => undefined,
			queuedFollowUps: () => active.queuedFollowUps,
		});
		let rejectHistory!: (error: Error) => void;
		let markRequested!: () => void;
		const history = new Promise<unknown[]>((_resolve, reject) => { rejectHistory = reject; });
		const requested = new Promise<void>((resolve) => { markRequested = resolve; });
		f.client.getMessages = () => { markRequested(); return history; };
		const startup = startInitialSession({ ...f.ports, isRuntimeActive: (id) => id === active.id });
		await requested;
		await input.submit();
		expect(sent).toEqual([]);
		expect(draft).toBe("New tab request");

		active = next;
		expect(activePhase()).toEqual({ kind: "starting" });
		await input.submit();
		expect(sent).toEqual([]);
		expect(draft).toBe("New tab request");

		next.startupResolved = true;
		rejectHistory(new Error("Old tab history failed"));
		await startup;
		expect(f.phase()).toEqual({ kind: "failed", reason: "error" });
		expect(activePhase()).toEqual({ kind: "ready" });
		await input.submit();
		await input.submit();
		expect(sent).toEqual(["new-tab:New tab request"]);
		expect(draft).toBe("");

		active = f.runtime;
		draft = "First tab request";
		expect(activePhase()).toEqual({ kind: "failed", reason: "error" });
		await input.submit();
		expect(sent).toEqual(["new-tab:New tab request"]);
		expect(draft).toBe("First tab request");
		expect(notices.at(-1)).toContain("Pi is unavailable");

		// A new tab does not inherit readiness from an already ready first tab.
		f.ports.setStartupPhase({ kind: "ready" });
		active = createTabRuntime({ id: "loading-tab", cwd: process.cwd() });
		expect(activePhase()).toEqual({ kind: "starting" });
		await input.submit();
		expect(sent).toEqual(["new-tab:New tab request"]);
		expect(draft).toBe("First tab request");
	});

	test("reports a failed state request without enabling controls", async () => {
		const f = fixture(true);
		await startInitialSession(f.ports);
		expect(f.client.calls).toEqual(["start", "getState"]);
		expect(f.phase()).toEqual({ kind: "failed", reason: "error" });
		expect(f.runtime.startupResolved).toBe(false);
		expect(f.statuses.at(-1)).toBe("failed to start Pi");
		expect(f.events).not.toContain("refresh");
	});
});
