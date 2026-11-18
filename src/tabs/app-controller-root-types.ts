/** Explicit state contract between the App root and downstream controllers. */

import type {
	CliRenderer,
	ScrollBoxRenderable,
	TextareaRenderable,
} from "@opentui/core";
import type { Accessor, Signal } from "solid-js";
import type { AppOptions } from "../app.tsx";
import type { PiRpcClient } from "../rpc/pi-rpc-client.ts";
import type { AppSignals } from "../state/app-signals.ts";
import type {
	BackgroundOutputPage,
	BackgroundTaskSelection,
} from "../state/background-tasks.ts";
import type { ConversationModel } from "../state/conversation.ts";
import type { LocalQueuedMessage } from "../state/input-continuity.ts";
import type { StartupPhase } from "../state/startup.ts";
import type { InspectorProjection } from "../subagents/inspector-projection.ts";
import type { NotificationRecord, Toast } from "../types.ts";
import type { TranscriptSelectionCache } from "../ui/transcript-selection-cache.ts";
import type { AppRuntimeScope } from "./app-runtime-scope.ts";
import type { AppSessionProjections } from "./app-session-projections.ts";
import type { ConversationSelectors } from "./conversation-selectors.ts";
import type { PromptDraftActions } from "./prompt-draft-actions.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

export interface AppControllerRootPorts {
	props: AppOptions;
	appSignals: AppSignals;
	renderer: CliRenderer;
	dimensions: Accessor<{ width: number; height: number }>;
	client: PiRpcClient;
	conversation: ConversationModel;
	claudeLaunchEnv: NodeJS.ProcessEnv | undefined;
	closeBackgroundTask: () => void;
	dropRefreshCoordinator: (id: string) => void;
	resetMessageWindow: (count: number) => void;
	scrollToBottom: () => void;
	syncMainDraft: (value: string) => void;
	refreshState: (runtime: ConversationTabRuntime) => Promise<boolean>;
	flushQueuedFollowUp: (runtime: ConversationTabRuntime) => Promise<void>;
}

export interface AppControllerRootState {
	notificationHistory: Signal<NotificationRecord[]>;
	notificationDetailId: Signal<string | undefined>;
	backgroundSelection: Signal<BackgroundTaskSelection | undefined>;
	backgroundOutput: Signal<BackgroundOutputPage | undefined>;
	backgroundOutputError: Signal<string | undefined>;
	backgroundOutputBusy: Signal<boolean>;
	todoDetailId: Signal<string | undefined>;
	status: Signal<string>;
	startupPhase: Signal<StartupPhase>;
	startupStartedAt: number;
	getPrompt: () => TextareaRenderable | undefined;
	setPrompt: (value: TextareaRenderable | undefined) => void;
	getScroll: () => ScrollBoxRenderable | undefined;
	setScroll: (value: ScrollBoxRenderable) => void;
	getSubagentScroll: () => ScrollBoxRenderable | undefined;
	setSubagentScroll: (value: ScrollBoxRenderable) => void;
	draftSwitchGuard: () => boolean;
	setDraftSwitchGuard: (value: boolean) => void;
	transcriptSelectionCache: TranscriptSelectionCache;
	queuedFollowUps: () => LocalQueuedMessage[];
	steeringQueue: Accessor<string[]>;
	followUpQueue: Accessor<string[]>;
	toasts: Signal<Toast[]>;
	toast: (text: string, tone?: Toast["tone"], duration?: number) => void;
}

export interface AppControllerRoot {
	runtimeScope: AppRuntimeScope;
	sessionProjections: AppSessionProjections;
	draftActions: PromptDraftActions;
	conversationSelectors: ConversationSelectors;
	inspectorProjection: InspectorProjection;
	state: AppControllerRootState;
}
