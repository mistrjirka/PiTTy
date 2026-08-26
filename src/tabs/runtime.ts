import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import { PiRpcClient, type PiRpcClientOptions } from "../rpc/pi-rpc-client.ts";
import { ConversationModel } from "../state/conversation.ts";
import { EntryIndex } from "./entry-index.ts";
import { ToolEventCoalescer } from "../state/tool-event-coalescer.ts";
import { PromptHistory } from "../state/prompt-history.ts";
import type { DraftState } from "../state/input-continuity.ts";
import type { RpcExtensionUIRequest, RpcSessionState, SessionStats, SubagentRun, PiEvent } from "../types.ts";

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
};

export type ConversationTabRuntime = {
	id: string;
	client: PiRpcClient;
	coalescer: ToolEventCoalescer;
	conversation: ConversationModel;
	entryIndex: EntryIndex;
	pendingExtensionRequests: RpcExtensionUIRequest[];
	promptHistory: PromptHistory;
	drafts: DraftState;
	expandedToolIds: Set<string>;
	expandedDiffIds: Set<string>;
	thinkingExpansionOverrides: Map<string, boolean>;
	sessionState?: RpcSessionState;
	sessionStats?: SessionStats;
	runs: SubagentRun[];
	startupResolved: boolean;
	lastError?: Error;
};

export function createTabRuntime(options: TabRuntimeOptions): ConversationTabRuntime {
	const clientOptions: PiRpcClientOptions = {
		cwd: options.cwd,
		...(options.executable ? { executable: options.executable } : {}),
		...(options.args ? { args: [...options.args] } : {}),
		...(options.logger ? { logger: options.logger } : {}),
	};
	const client = options.client ?? new PiRpcClient({
		...clientOptions,
		...(options.sessionFile ? { args: [...(options.args ?? []), "--session", options.sessionFile] } : {}),
	});
	const conversation = options.conversation ?? new ConversationModel([], options.cwd);
	let runtime: ConversationTabRuntime;
	const coalescer = new ToolEventCoalescer({
		applyEvent: (event) => {
			runtime.conversation.apply(event);
			options.onEvent?.(event, runtime);
		},
	});
	runtime = {
		id: options.id,
		client,
		coalescer,
		conversation,
		entryIndex: new EntryIndex(),
		pendingExtensionRequests: [],
		promptHistory: new PromptHistory(),
		drafts: new Map(),
		expandedToolIds: new Set(),
		expandedDiffIds: new Set(),
		thinkingExpansionOverrides: new Map(),
		runs: [],
		startupResolved: false,
	};
	runtime.client.onEvent((event) => {
		runtime.coalescer.handle(event);
		if (event.type === "agent_settled") void refreshRuntimeEntries(runtime);
	});
	runtime.client.on("protocol-error", (error: Error) => {
		runtime.lastError = error;
		runtime.conversation.system(error.message, "error");
	});
	runtime.client.on("exit", (error: Error) => {
		runtime.lastError = error;
		runtime.conversation.system(error.message, "error");
	});
	return runtime;
}

export async function refreshRuntimeEntries(runtime: ConversationTabRuntime): Promise<void> {
	const users = runtime.conversation.items.filter((item) => item.kind === "user").map((item) => ({ text: item.text }));
	const messages = await runtime.client.getForkMessages();
	runtime.entryIndex.refresh(messages, users);
	runtime.conversation.assignEntryIds(runtime.entryIndex.idsFor(users));
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
