import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { DiagnosticLogger } from "../src/diagnostics/logger.ts";
import type { OptionalIntegrationStatus } from "../src/integrations/detect.ts";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import type { StartupPhase } from "../src/state/startup.ts";
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
