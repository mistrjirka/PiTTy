/** Typed dependencies shared by the main terminal screen and modal screens. */

import type {
	MouseEvent,
	ScrollBoxRenderable,
	TextareaRenderable,
} from "@opentui/core";
import type { Accessor } from "solid-js";
import type { AppSignals } from "../state/app-signals.ts";
import type {
	BackgroundOutputPage,
	BackgroundTaskSelection,
} from "../state/background-tasks.ts";
import type { LocalQueuedMessage } from "../state/input-continuity.ts";
import type { StartupPhase } from "../state/startup.ts";
import type { InspectorProjection } from "../subagents/inspector-projection.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { AppRuntimeScope } from "../tabs/app-runtime-scope.ts";
import type { AppSessionProjections } from "../tabs/app-session-projections.ts";
import type { AppSettingsCoordinatorActions } from "../tabs/app-settings-coordinator.ts";
import type { AppTranscriptControls } from "../tabs/app-transcript-controls.ts";
import type { AppTranscriptScroll } from "../tabs/app-transcript-scroll.ts";
import type { AppUiActions } from "../tabs/app-ui-actions.ts";
import type { BackgroundActions } from "../tabs/background-actions.ts";
import type { ConversationSelectors } from "../tabs/conversation-selectors.ts";
import type { InputActions } from "../tabs/input-actions.ts";
import type { ModalNavigationActions } from "../tabs/modal-navigation.ts";
import type { PromptDraftActions } from "../tabs/prompt-draft-actions.ts";
import type { NotificationRecord, Toast } from "../types.ts";

export interface AppScreenExtras {
	dimensions: Accessor<{ width: number; height: number }>;
	startupPhase: Accessor<StartupPhase>;
	startupStartedAt: number;
	backgroundSelection: Accessor<BackgroundTaskSelection | undefined>;
	backgroundOutput: Accessor<BackgroundOutputPage | undefined>;
	backgroundOutputBusy: Accessor<boolean>;
	backgroundOutputError: Accessor<string | undefined>;
	notificationHistory: Accessor<NotificationRecord[]>;
	notificationDetailId: Accessor<string | undefined>;
	todoDetailId: Accessor<string | undefined>;
	toasts: Accessor<Toast[]>;
	queuedFollowUps: () => LocalQueuedMessage[];
	steeringQueue: Accessor<string[]>;
	followUpQueue: Accessor<string[]>;
	contextWindowForModel: (modelName: string | undefined) => number | undefined;
	closeSubagentInspector: () => void;
	selectSubagentTarget: (target: SubagentTarget) => void;
	focusMainPrompt: () => void;
	openNotification: (id: string) => void;
	closeNotification: () => void;
	openTodo: (id: string) => void;
	closeTodo: () => void;
	getPrompt: () => TextareaRenderable | undefined;
	getScroll: () => ScrollBoxRenderable | undefined;
	toast: (text: string, tone?: Toast["tone"], durationMs?: number) => void;
	onPromptEditor: (editor: TextareaRenderable) => void;
	onPromptMouseDown: (event: MouseEvent) => void;
	onPromptContentChange: () => void;
	onPromptCursorChange: () => void;
	getSubagentScroll: () => ScrollBoxRenderable | undefined;
	setSubagentScroll: (value: ScrollBoxRenderable) => void;
	setScroll: (value: ScrollBoxRenderable) => void;
}

export interface AppScreenContext {
	signals: AppSignals;
	runtime: AppRuntimeScope;
	session: AppSessionProjections;
	scroll: AppTranscriptScroll;
	transcript: AppTranscriptControls;
	selectors: ConversationSelectors;
	inspector: InspectorProjection;
	draft: PromptDraftActions;
	input: InputActions;
	background: BackgroundActions;
	settings: AppSettingsCoordinatorActions;
	modal: ModalNavigationActions;
	subagent: AppUiActions;
	extras: AppScreenExtras;
}
