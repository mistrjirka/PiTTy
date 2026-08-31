import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import { PiRpcClient, type PiRpcClientOptions } from "../rpc/pi-rpc-client.ts";
import { ConversationModel, initialItems, isConversationEvent } from "../state/conversation.ts";
import { EntryIndex } from "./entry-index.ts";
import { ToolEventCoalescer } from "../state/tool-event-coalescer.ts";
import type {
	CompactionCompletion,
	CompactionTelemetry,
} from "../state/compaction-telemetry.ts";
import { MessageUpdateBatcher } from "../state/message-update-batcher.ts";
import { PromptHistory } from "../state/prompt-history.ts";
import type { DraftState, DispatchGate, LocalQueuedMessage } from "../state/input-continuity.ts";
import { RequestPerformanceTracker, type RequestPerformance } from "./request-metrics.ts";
import {
	MAX_REQUEST_TIMING_HISTORY,
	RequestTimingTracker,
	type RequestTiming,
} from "./request-timing.ts";
import {
	recordModelPerformanceSample,
	loadModelPerformanceHistory,
	saveModelPerformanceHistory,
} from "./model-performance-history.ts";
import type { RpcSessionState, SessionStats, SubagentRun, PiEvent } from "../types.ts";
import type { ThinkingLevel } from "../rpc/pi-rpc-client.ts";

export type TabRuntimeOptions = {
	id: string;
	cwd: string;
	executable?: string;
	args?: string[];
	logger?: DiagnosticLogger;
	sessionFile?: string;
	client?: PiRpcClient;
	conversation?: ConversationModel;
	onEvent?: (event: PiEvent, runtime: ConversationTabRuntime) => void;
	onConversationChange?: (runtime: ConversationTabRuntime) => void;
};

export function blankTabPiArgs(args: readonly string[]): string[] {
	const result: string[] = [];
	let parseOptions = true;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === undefined) continue;
		if (parseOptions && arg === "--") {
			parseOptions = false;
			result.push(arg);
			continue;
		}
		if (parseOptions && (arg === "--continue" || arg === "-c")) continue;
		if (parseOptions && (arg === "--session" || arg === "-s")) {
			const value = args[index + 1];
			if (value !== undefined && value !== "--") index += 1;
			continue;
		}
		if (parseOptions && (arg.startsWith("--session=") || arg.startsWith("-s="))) continue;
		result.push(arg);
	}
	return result;
}

export function sessionFilePiArgs(args: readonly string[], sessionFile: string): string[] {
	// A forced session file is authoritative; drop continue/resume flags that
	// would otherwise let Pi resolve a different session for this process.
	const withoutContinue = args.filter(
		(arg) => arg !== "--continue" && arg !== "-c" && arg !== "--resume" && arg !== "-r",
	);
	const result = [...withoutContinue];
	const separatorIndex = result.indexOf("--");
	result.splice(separatorIndex === -1 ? result.length : separatorIndex, 0, "--session", sessionFile);
	return result;
}

export type ForkedTabSessionState = RpcSessionState & { sessionFile: string };

export type ConversationTabRuntime = {
	id: string;
	client: PiRpcClient;
	coalescer: ToolEventCoalescer;
	messageUpdates: MessageUpdateBatcher;
	onConversationChange: () => void;
	conversation: ConversationModel;
	entryIndex: EntryIndex;
	promptHistory: PromptHistory;
	drafts: DraftState;
	expandedToolIds: Set<string>;
	expandedDiffIds: Set<string>;
	thinkingExpansionOverrides: Map<string, boolean>;
	sessionState?: RpcSessionState;
	sessionStats?: SessionStats;
	runs: SubagentRun[];
	inspectSubagent: boolean;
	selectedTargetKey?: string;
	forkInProgress: boolean;
	startupResolved: boolean;
	lastError?: Error;
	requestPerformance: RequestPerformanceTracker;
	lastRequestPerformance?: RequestPerformance;
	requestTiming: RequestTimingTracker;
	lastRequestTiming?: RequestTiming;
	timingHistory: RequestTiming[];
	compactionTelemetry?: CompactionTelemetry;
	smartCompactProgress?: string;
	compactionAttempt: number;
	lastCompactionCompletion?: CompactionCompletion;
	queuedFollowUps: LocalQueuedMessage[];
	dispatchGate: DispatchGate;
	eventVersion: number;
	abortInFlight?: Promise<void>;
	effectiveThinkingLevels: Map<string, ThinkingLevel>;
};

export function createTabRuntime(options: TabRuntimeOptions): ConversationTabRuntime {
	const clientArgs = options.sessionFile
		? sessionFilePiArgs(options.args ?? [], options.sessionFile)
		: [...(options.args ?? [])];
	const clientOptions: PiRpcClientOptions = {
		cwd: options.cwd,
		...(options.executable ? { executable: options.executable } : {}),
		...(clientArgs.length > 0 ? { args: clientArgs } : {}),
		...(options.logger ? { logger: options.logger } : {}),
	};
	const client = options.client ?? new PiRpcClient(clientOptions);
	const conversation = options.conversation ?? new ConversationModel([], options.cwd);
	let runtime: ConversationTabRuntime;
	const applyConversationEvent = (event: PiEvent): void => {
		runtime.conversation.apply(event);
		options.onEvent?.(event, runtime);
	};
	const notifyConversationChange = (): void => options.onConversationChange?.(runtime);
	const coalescer = new ToolEventCoalescer({
		applyEvent: (event) => {
			applyConversationEvent(event);
			if (isConversationEvent(event)) notifyConversationChange();
		},
	});
	const messageUpdates = new MessageUpdateBatcher({
		applyEvent: applyConversationEvent,
		onBatchComplete: notifyConversationChange,
	});
	runtime = {
		id: options.id,
		client,
		coalescer,
		messageUpdates,
		onConversationChange: notifyConversationChange,
		conversation,
		entryIndex: new EntryIndex(),
		promptHistory: new PromptHistory(),
		drafts: new Map(),
		expandedToolIds: new Set(),
		expandedDiffIds: new Set(),
		thinkingExpansionOverrides: new Map(),
		runs: [],
		inspectSubagent: false,
		compactionAttempt: 0,
		forkInProgress: false,
		startupResolved: false,
		requestPerformance: new RequestPerformanceTracker(),
		requestTiming: new RequestTimingTracker(),
		timingHistory: [],
		queuedFollowUps: [],
		dispatchGate: { inFlight: false, suppressNextSettled: false },
		eventVersion: 0,
		effectiveThinkingLevels: new Map(),
	};
	runtime.client.onEvent((event) => {
		runtime.eventVersion += 1;
		const receivedAt = Date.now();
		const performance = runtime.requestPerformance.handle(
			event,
			receivedAt,
			event.type === "message_start" ? runtime.sessionState?.model : undefined,
		);
		const timing = runtime.requestTiming.handle(
			event,
			receivedAt,
			runtime.sessionState?.model,
		);
		if (timing) {
			runtime.lastRequestTiming = timing;
			runtime.timingHistory = [
				...runtime.timingHistory,
				timing,
			].slice(-MAX_REQUEST_TIMING_HISTORY);
		}
		if (event.type === "message_end" && performance) {
			runtime.lastRequestPerformance = performance;
			if (performance.provider && performance.modelId) {
				const history = loadModelPerformanceHistory();
				const nextHistory = recordModelPerformanceSample(
					history,
					performance.provider,
					performance.modelId,
					performance,
				);
				saveModelPerformanceHistory(nextHistory);
			}
		}
		if (event.type === "message_update") runtime.messageUpdates.handle(event);
		else {
			runtime.messageUpdates.flush();
			runtime.coalescer.handle(event);
		}
		if (event.type === "agent_settled") {
			void refreshRuntimeEntries(runtime).catch((error) =>
				options.logger?.warn("tabs.entry_refresh_failed", error),
			);
		}
	});
	const recordRuntimeFailure = (error: Error): void => {
		runtime.eventVersion += 1;
		runtime.lastError = error;
		runtime.messageUpdates.flush();
		runtime.coalescer.flush();
		runtime.conversation.system(error.message, "error");
	};
	const handleProtocolError = (error: Error): void => {
		recordRuntimeFailure(error);
		notifyConversationChange();
	};
	const handleProcessExit = (error: Error): void => {
		recordRuntimeFailure(error);
		runtime.conversation.apply({ type: "agent_settled" });
		runtime.conversation.isCompacting = false;
		delete runtime.compactionTelemetry;
		delete runtime.smartCompactProgress;
		notifyConversationChange();
	};
	runtime.client.on("protocol-error", handleProtocolError);
	runtime.client.on("exit", handleProcessExit);
	return runtime;
}

export async function refreshRuntimeEntries(runtime: ConversationTabRuntime): Promise<void> {
	const version = runtime.eventVersion;
	const messages = await runtime.client.getForkMessages();
	if (runtime.eventVersion !== version) return;
	const users = runtime.conversation.items
		.filter((item) => item.kind === "user")
		.map((item) => ({ text: item.text }));
	runtime.entryIndex.refresh(messages, users);
	if (runtime.conversation.assignEntryIds(runtime.entryIndex.idsFor(users)))
		runtime.onConversationChange();
}

export type TabDraftSwitch = {
	editorText: string;
};

export function resolveTabDraftSwitch(_prevEditorText: string, targetDraft: string): TabDraftSwitch {
	return { editorText: targetDraft };
}

export type ForkTabPlan = {
	canCreate: boolean;
	originalSessionFile: string;
	branchedSessionFile: string;
};

export function planForkTab(originalSessionFile: string, branchedSessionFile: string, existingTabCount: number, maxTabs = 8): ForkTabPlan {
	return { canCreate: existingTabCount < maxTabs, originalSessionFile, branchedSessionFile };
}

export async function startTabRuntime(runtime: ConversationTabRuntime): Promise<RpcSessionState> {
	await runtime.client.start();
	const state = await runtime.client.getState(240_000);
	runtime.sessionState = state;
	runtime.startupResolved = true;
	return state;
}

export async function prepareForkedTabRuntime(
	runtime: ConversationTabRuntime,
	entryId: string,
	timeoutMs = 240_000,
): Promise<ForkedTabSessionState> {
	await startTabRuntime(runtime);
	const result = await runtime.client.fork(entryId, timeoutMs);
	if (result.cancelled) throw new Error("Fork cancelled.");
	const [state, messages] = await Promise.all([
		runtime.client.getState(timeoutMs),
		runtime.client.getMessages(timeoutMs),
	]);
	if (!state.sessionFile) throw new Error("Fork did not return a session file.");
	runtime.sessionState = state;
	runtime.conversation.items.splice(
		0,
		runtime.conversation.items.length,
		...initialItems(messages),
	);
	await refreshRuntimeEntries(runtime);
	return { ...state, sessionFile: state.sessionFile };
}
