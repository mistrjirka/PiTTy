import type {
	AgentSessionEvent,
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
	SessionStats,
} from "@earendil-works/pi-coding-agent";

export type PiEvent =
	| AgentSessionEvent
	| RpcExtensionUIRequest
	| Record<string, unknown>;
export type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
	SessionStats,
};

export type MessageStatus = "pending" | "streaming" | "done" | "error";

export type UserItem = {
	kind: "user";
	id: string;
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
	timeoutMs?: number | undefined;
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

export type ConversationItem = UserItem | AssistantItem | ToolItem | SystemItem;

export type SubagentStep = {
	index: number;
	agent: string;
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
	tokens?:
		| {
				total?: number | undefined;
				input?: number | undefined;
				output?: number | undefined;
		  }
		| undefined;
	sessionFile?: string | undefined;
	error?: string | undefined;
};

export type SubagentRun = {
	runId: string;
	asyncId?: string | undefined;
	asyncDir?: string | undefined;
	control?: "file" | "foreground" | undefined;
	sessionId?: string | undefined;
	sessionFile?: string | undefined;
	mode: string;
	state: string;
	startedAt?: number | undefined;
	lastUpdate?: number | undefined;
	endedAt?: number | undefined;
	pid?: number | undefined;
	cwd?: string | undefined;
	agent?: string | undefined;
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
