import type {
	AgentSessionEvent,
	RpcCommand as PiRpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState as PiRpcSessionState,
	SessionStats,
} from "@earendil-works/pi-coding-agent";

import type { QueueCommand, QueueState } from "./rpc/queue-types.ts";

export type CompactionMethod = "cache-aware" | "extension";
export type CacheMaintenanceMode = "compact" | "keep-warm" | "off";
export type RpcCommand = PiRpcCommand | QueueCommand | { type: "refresh_provider_models"; providerId: string } |
 { type: "get_provider_usage" } |
 { type: "set_compaction_method"; method: CompactionMethod } |
 { type: "set_cache_maintenance"; mode: CacheMaintenanceMode } |
 { type: "set_input_active"; active: boolean } |
 (Extract<PiRpcCommand, { type: "prompt" | "steer" | "follow_up" }> & { messageId: string });
export type RpcSessionState = PiRpcSessionState & {
 queue?: QueueState;
 compactionMethod?: CompactionMethod;
 cacheMaintenance?: CacheMaintenanceMode;
 compactionMethods?: Array<{ id: CompactionMethod; available: boolean; reason?: string }>;
 cacheMaintenanceStatus?: { state: string; reason?: string; action?: string; nextWarmAt?: number };
};

export type PiEvent =
	| AgentSessionEvent
	| RpcExtensionUIRequest
	| Record<string, unknown>;
export type {
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	SessionStats,
};

export type MessageStatus = "pending" | "streaming" | "done" | "error";

export type UserItem = {
	kind: "user";
	id: string;
	/** Persisted Pi session entry used when forking this message. */
	entryId?: string;
	text: string;
	timestamp: number;
	optimistic: boolean;
};

export type AssistantItem = {
	kind: "assistant";
	id: string;
	text: string;
	thinking: string;
	timestamp: number;
	status: MessageStatus;
	stopReason?: string;
	/** 1-based assistant-message sequence from persisted Pi session order. */
	sourceMessageSeq?: number;
	/** Persisted Pi session entry identity, when available. */
	sourceEntryId?: string;
	/** Persisted Pi parent entry identity, when available. */
	sourceParentId?: string;
	/** This visible turn absorbed a directly-parented thinking-only failed attempt. */
	retriedAfterInterruptedThinking?: boolean;
};

export type ToolItem = {
	kind: "tool";
	id: string;
	toolCallId: string;
	name: string;
	args: unknown;
	output: string;
	details?: unknown;
	diff?: string | undefined;
	diffPath?: string | undefined;
	timestamp: number;
	startedAt?: number | undefined;
	endedAt?: number | undefined;
	/** Execution timeout, when the tool exposes one in known units. */
	timeoutMs?: number | undefined;
	/** Polling or yield window. Expiry does not stop the underlying task. */
	waitMs?: number | undefined;
	status: MessageStatus;
	isError: boolean;
};

export type SystemItem = {
	kind: "system";
	id: string;
	text: string;
	timestamp: number;
	tone: "muted" | "info" | "warning" | "error" | "success";
};

export type CustomItem = {
	kind: "custom";
	id: string;
	customType: string;
	text: string;
	details?: unknown;
	timestamp: number;
};

export type ConversationItem = UserItem | AssistantItem | ToolItem | SystemItem | CustomItem;

/** Token accounting for a subagent run or step, including the live context-window size. */
export type SubagentTokenBreakdown = {
	total?: number | undefined;
	input?: number | undefined;
	output?: number | undefined;
	/** Current context size (input + cache-read tokens of the latest turn). */
	window?: number | undefined;
	/** Largest window observed in this scope. */
	windowPeak?: number | undefined;
};

export type SubagentStep = {
	index: number;
	agent: string;
	workflowKey?: string | undefined;
	parentWorkflowRunId?: string | undefined;
	runId?: string | undefined;
	status: string;
	phase?: string | undefined;
	label?: string | undefined;
	model?: string | undefined;
	thinking?: string | undefined;
	contextWindow?: number | undefined;
	activityState?: string | undefined;
	lastActivityAt?: number | undefined;
	currentTool?: string | undefined;
	currentToolStartedAt?: number | undefined;
	currentPath?: string | undefined;
	currentToolArgs?: string | undefined;
	recentOutput?: string[] | undefined;
	transcriptPath?: string | undefined;
	transcriptError?: string | undefined;
	startedAt?: number | undefined;
	endedAt?: number | undefined;
	timeoutMs?: number | undefined;
	deadlineAt?: number | undefined;
	turnCount?: number | undefined;
	toolCount?: number | undefined;
	durationMs?: number | undefined;
	tokens?: SubagentTokenBreakdown | undefined;
	sessionFile?: string | undefined;
	error?: string | undefined;
};

export type SubagentActiveTool = {
	toolCallId: string;
	toolName: string;
	startedAt: number;
	timeoutSeconds?: number | undefined;
};

export type SubagentRun = {
	runId: string;
	asyncId?: string | undefined;
	asyncDir?: string | undefined;
	/** Direct-control directory exposed by @mistrjirka/pi-subagent. */
	controlDir?: string | undefined;
	statusPath?: string | undefined;
	/** Live event stream (`events.jsonl`) inside the profiled control directory. */
	eventsPath?: string | undefined;
	runtime?: "profiled-subagents" | undefined;
	treeId?: string | undefined;
	parentAgentId?: string | undefined;
	agentId?: string | undefined;
	profile?: string | undefined;
	label?: string | undefined;
	workflowKey?: string | undefined;
	parentWorkflowRunId?: string | undefined;
	control?: "file" | "foreground" | "mission" | "profiled" | undefined;
	sessionId?: string | undefined;
	sessionFile?: string | undefined;
	mode: string;
	state: string;
	/** Current ask_parent question while this child is waiting, from the live status file. */
	pendingQuestion?: string | undefined;
	pendingQuestionContext?: string | undefined;
	startedAt?: number | undefined;
	lastUpdate?: number | undefined;
	endedAt?: number | undefined;
	pid?: number | undefined;
	cwd?: string | undefined;
	agent?: string | undefined;
	/** True only while a status-less profiled spawn tool call is in flight. */
	profiledToolInFlight?: boolean | undefined;
	/** True when the run was read from a currently existing profiled status file. */
	profiledStatusBacked?: boolean | undefined;
	/** Actual executions reported by the child, separate from the agent deadline. */
	activeTools?: SubagentActiveTool[] | undefined;
	agents?: string[] | undefined;
	model?: string | undefined;
	thinking?: string | undefined;
	contextWindow?: number | undefined;
	activityState?: string | undefined;
	lastActivityAt?: number | undefined;
	currentTool?: string | undefined;
	currentToolStartedAt?: number | undefined;
	currentPath?: string | undefined;
	transcriptPath?: string | undefined;
	transcriptError?: string | undefined;
	currentStep?: number | undefined;
	chainStepCount?: number | undefined;
	pendingAppends?: number | undefined;
	turnCount?: number | undefined;
	toolCount?: number | undefined;
	steerCount?: number | undefined;
	totalTokens?: number | undefined;
	tokens?: SubagentTokenBreakdown | undefined;
	totalCost?: number | undefined;
	timeoutMs?: number | undefined;
	deadlineAt?: number | undefined;
	timedOut?: boolean | undefined;
	steps: SubagentStep[];
	error?: string | undefined;
};

export type SubagentTranscriptEntry = {
	id: string;
	timestamp?: number | undefined;
	kind:
		| "user"
		| "assistant"
		| "thinking"
		| "tool"
		| "toolResult"
		| "stderr"
		| "system";
	label?: string | undefined;
	text: string;
	isError?: boolean | undefined;
};

export type ForkMessage = {
	entryId: string;
	text: string;
};

export type ForkResult = {
	text: string;
	cancelled: boolean;
};

export type CloneResult = {
	cancelled: boolean;
};

export type SessionSwitchResult = {
	cancelled: boolean;
};

export type SessionEntry = {
	id: string;
	type: string;
	[key: string]: unknown;
};

export type SessionEntries = {
	entries: SessionEntry[];
	leafId: string | null;
};

export type RpcEntriesOptions = {
	since?: string;
};

export type Toast = {
	id: string;
	text: string;
	tone: "info" | "warning" | "error" | "success";
	expiresAt: number;
};

export type NotificationRecord = {
	id: string;
	text: string;
	tone: Toast["tone"];
	createdAt: number;
	read: boolean;
};
