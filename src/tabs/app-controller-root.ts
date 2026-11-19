/** Root session, draft signals, notification state, and live conversation selectors. */

import type {
	Renderable,
	ScrollBoxRenderable,
	TextareaRenderable,
} from "@opentui/core";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type {
	BackgroundOutputPage,
	BackgroundTaskSelection,
} from "../state/background-tasks.ts";
import { appendNotificationHistory } from "../state/notification-history.ts";
import type { StartupPhase } from "../state/startup.ts";
import { createInspectorProjection } from "../subagents/inspector-projection.ts";
import type {
	NotificationRecord,
	RpcExtensionUIRequest,
	Toast,
} from "../types.ts";
import { attachTranscriptSelectionCache } from "../ui/transcript-selection-cache.ts";
import type {
	AppControllerRoot,
	AppControllerRootPorts,
} from "./app-controller-root-types.ts";
import { createAppRuntimeScope } from "./app-runtime-scope.ts";
import { createSessionProjections } from "./app-session-projections.ts";
import { createConversationSelectors } from "./conversation-selectors.ts";
import { cachedAvailableModels } from "./model-catalog-actions.ts";
import { createPromptDraftActions } from "./prompt-draft-actions.ts";

export function contextWindowForModel(
	modelName: string | undefined,
): number | undefined {
	const models = cachedAvailableModels();
	if (!modelName || !models) return undefined;
	const exact = models.find(
		(model) => `${model.provider}/${model.id}` === modelName,
	);
	if (exact) return exact.contextWindow;
	return models.find((model) => model.id === modelName)?.contextWindow;
}
function isExtensionUiRequest(value: unknown): value is RpcExtensionUIRequest {
	return (
		value !== null &&
		typeof value === "object" &&
		"type" in value &&
		value.type === "extension_ui_request"
	);
}

export function createAppControllerRoot(
	ports: AppControllerRootPorts,
): AppControllerRoot {
	const {
		props,
		appSignals,
		renderer,
		dimensions,
		client,
		conversation,
		claudeLaunchEnv,
	} = ports;
	const {
		revision: [revision],
		conversationRevision: [conversationRevision],
		conversationStructureRevision: [conversationStructureRevision],
		compactionRevision: [compactionRevision],
		messageWindowStart: [messageWindowStart],
		sidebarEnabled: [sidebarEnabled],
		clockNow: [clockNow],
		thinkingExpanded: [thinkingExpanded, setThinkingExpanded],
		promptText: [promptText, setPromptText],
		promptCursorOffset: [promptCursorOffset, setPromptCursorOffset],
		commandChoices: [commandChoices],
		commandSuggestionIndex: [, setCommandSuggestionIndex],
		toasts: [toasts, setToasts],
	} = appSignals;
	const queuedFollowUps = () => {
		revision();
		return activeRuntime().queuedFollowUps;
	};
	let draftSwitchGuard = false;

	const runtimeScope = createAppRuntimeScope({
		props,
		signals: appSignals,
		renderer,
		dimensions,
		client,
		conversation,
		claudeLaunchEnv,
		status: () => status(),
		setStatus: (value) => setStatus(value),
		toast: (text, tone, durationMs) => toast(text, tone, durationMs),
		streaming: () => streaming(),
		availableSubagentTargets: () => availableSubagentTargets(),
		touch: () => touch(),
		getPrompt: () => prompt,
		getSubagentScroll: () => subagentScroll,
		backgroundSelection: () => backgroundSelection(),
		closeBackgroundTask: () => ports.closeBackgroundTask(),
		dropRefreshCoordinator: (id) => ports.dropRefreshCoordinator(id),
		resetMessageWindow: (count) => ports.resetMessageWindow(count),
		selectedSubagentTarget: () => selectedSubagentTarget(),
		scrollToBottom: () => ports.scrollToBottom(),
		syncMainDraft: (text) => syncMainDraft(text),
		refreshState: (runtime) => ports.refreshState(runtime),
		conversationTouch: (reason) => conversationTouch(reason),
		flushQueuedFollowUp: (runtime) => ports.flushQueuedFollowUp(runtime),
		isExtensionUiRequest,
		setDraftSwitchGuard: (value) => {
			draftSwitchGuard = value;
		},
	});
	const {
		activeRuntime,
		refreshCommandChoices,
		selectedTargetKey,
		inspectSubagent,
		tabRuntimeIsActive,
		setThinkingExpansionOverrides,
	} = runtimeScope;
	const [notificationHistory, setNotificationHistory] = createSignal<
		NotificationRecord[]
	>([]);
	const [notificationDetailId, setNotificationDetailId] =
		createSignal<string>();
	const [backgroundSelection, setBackgroundSelection] = createSignal<
		BackgroundTaskSelection | undefined
	>();
	const [backgroundOutput, setBackgroundOutput] =
		createSignal<BackgroundOutputPage>();
	const [backgroundOutputError, setBackgroundOutputError] =
		createSignal<string>();
	const [backgroundOutputBusy, setBackgroundOutputBusy] = createSignal(false);
	const [todoDetailId, setTodoDetailId] = createSignal<string>();
	const [status, setStatus] = createSignal("starting Pi…");
	const startupStartedAt = Date.now();
	const [startupPhase, setStartupPhase] = createSignal<StartupPhase>({
		kind: "starting",
	});
	let prompt: TextareaRenderable | undefined;
	let scroll: ScrollBoxRenderable | undefined;
	let subagentScroll: ScrollBoxRenderable | undefined;
	// Snapshot of the last finished transcript mouse selection. Stream chunks
	// or node swaps between mouse-up and Ctrl+C would otherwise make the live
	// query resolve against mutated content.
	const isTranscriptSelectionContainer = (
		container: Renderable | null,
	): boolean => {
		let current: Renderable | null = container;
		while (current) {
			// The prompt editor owns its selection (prompt.getSelection()); never
			// route it through the transcript cache.
			if (prompt && current === prompt) return false;
			if (current === scroll || current === subagentScroll) return true;
			current = current.parent;
		}
		return false;
	};
	const transcriptSelectionCache = attachTranscriptSelectionCache(
		renderer,
		isTranscriptSelectionContainer,
	);
	onCleanup(() => transcriptSelectionCache.dispose());

	const sessionProjections = createSessionProjections({
		cwd: props.cwd,
		signals: appSignals,
		activeRuntime,
	});
	const { touch, conversationTouch, runs, currentSessionKey } =
		sessionProjections;
	const draftActions = createPromptDraftActions({
		cwd: props.cwd,
		currentSessionKey,
		revision,
		activeRuntime,
		isRuntimeActive: tabRuntimeIsActive,
		getPrompt: () => prompt,
		setPromptText,
		setPromptCursorOffset,
		setCommandSuggestionIndex,
		toast: (text, tone, duration) => toast(text, tone, duration),
	});
	const { currentDrafts, syncMainDraft } = draftActions;
	createEffect(() => {
		if (inspectSubagent()) {
			prompt = undefined;
			return;
		}
		const value = currentDrafts().main;
		if (prompt && prompt.plainText !== value) prompt.setText(value);
		setPromptText(value);
		setPromptCursorOffset(prompt?.cursorOffset ?? value.length);
	});

	const conversationSelectors = createConversationSelectors({
		sidebarEnabled,
		dimensions,
		conversationRevision,
		conversationStructureRevision,
		messageWindowStart,
		activeRuntime,
		subagentsInstalled: props.integrations.subagents.installed,
		todosInstalled: props.integrations.todos.installed,
		runs,
		promptText,
		promptCursorOffset,
		commandChoices,
		clockNow,
		startupPhase,
		refreshCommandChoices,
		revision,
		thinkingExpanded,
		setThinkingExpanded,
		setThinkingExpansionOverrides,
		compactionRevision,
	});
	const { structureItems, visibleItems, streaming } = conversationSelectors;
	const inspectorProjection = createInspectorProjection({
		cwd: props.cwd,
		clockNow,
		runs,
		structureItems,
		visibleItems,
		contextWindowForModel,
		activeRuntime,
		selectedTargetKey,
		inspectSubagent,
	});
	const { availableSubagentTargets, selectedSubagentTarget } =
		inspectorProjection;
	// Pi publishes queue_update before consuming a queued user message. Do not
	// filter by recent transcript text: repeated inputs are separate messages.
	const steeringQueue = createMemo(() => {
		conversationRevision();
		return [...activeRuntime().conversation.steering];
	});
	const followUpQueue = createMemo(() => {
		conversationRevision();
		return [...activeRuntime().conversation.followUp];
	});

	const toast = (
		text: string,
		tone: Toast["tone"] = "info",
		duration = 2800,
	) => {
		const createdAt = Date.now();
		const entry: Toast = {
			id: crypto.randomUUID(),
			text,
			tone,
			expiresAt: createdAt + duration,
		};
		const record: NotificationRecord = {
			id: entry.id,
			text,
			tone: entry.tone,
			createdAt,
			read: false,
		};
		setNotificationHistory((current) =>
			appendNotificationHistory(current, record),
		);
		setToasts((current) => [...current.slice(-2), entry]);
		setTimeout(
			() =>
				setToasts((current) => current.filter((item) => item.id !== entry.id)),
			duration,
		).unref?.();
	};
	return {
		runtimeScope,
		sessionProjections,
		draftActions,
		conversationSelectors,
		inspectorProjection,
		state: {
			notificationHistory: [notificationHistory, setNotificationHistory],
			notificationDetailId: [notificationDetailId, setNotificationDetailId],
			backgroundSelection: [backgroundSelection, setBackgroundSelection],
			backgroundOutput: [backgroundOutput, setBackgroundOutput],
			backgroundOutputError: [backgroundOutputError, setBackgroundOutputError],
			backgroundOutputBusy: [backgroundOutputBusy, setBackgroundOutputBusy],
			todoDetailId: [todoDetailId, setTodoDetailId],
			status: [status, setStatus],
			startupPhase: [startupPhase, setStartupPhase],
			startupStartedAt,
			getPrompt: () => prompt,
			setPrompt: (value) => {
				prompt = value;
			},
			getScroll: () => scroll,
			setScroll: (value) => {
				scroll = value;
			},
			getSubagentScroll: () => subagentScroll,
			setSubagentScroll: (value) => {
				subagentScroll = value;
			},
			draftSwitchGuard: () => draftSwitchGuard,
			setDraftSwitchGuard: (value) => {
				draftSwitchGuard = value;
			},
			transcriptSelectionCache,
			queuedFollowUps,
			steeringQueue,
			followUpQueue,
			toasts: [toasts, setToasts],
			toast,
		},
	};
}
