/** User input focus, clipboard, inspector selection and editor event handlers. */
import type {
	CliRenderer,
	MouseEvent,
	ScrollBoxRenderable,
	TextareaRenderable,
} from "@opentui/core";
import type { Accessor, Setter } from "solid-js";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import type { AppSignals } from "../state/app-signals.ts";
import type { BackgroundTaskSelection } from "../state/background-tasks.ts";
import type { SessionDrafts } from "../state/input-continuity.ts";
import { clearTargetDraft } from "../state/input-continuity.ts";
import {
	prunePromptPasteBlocks,
	stripCollapsedPromptPasteFragments,
} from "../state/paste-blocks.ts";
import type { StartupPhase } from "../state/startup.ts";
import {
	createSubagentControlActions,
	type SubagentControlActions,
} from "../subagents/action-controller.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { NotificationRecord, Toast } from "../types.ts";
import { inspectedTargetScrollY } from "../ui/subagent-inspector.tsx";
import type { TranscriptSelectionCache } from "../ui/transcript-selection-cache.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

export interface AppUiActionsPorts {
	signals: AppSignals;
	renderer: CliRenderer;
	logger: DiagnosticLogger;
	transcriptSelectionCache: TranscriptSelectionCache;
	getPrompt: () => TextareaRenderable | undefined;
	setPrompt: (editor: TextareaRenderable) => void;
	getSubagentScroll: () => ScrollBoxRenderable | undefined;
	startupPhase: Accessor<StartupPhase>;
	backgroundSelection: Accessor<BackgroundTaskSelection | undefined>;
	setNotificationHistory: Setter<NotificationRecord[]>;
	setNotificationDetailId: Setter<string | undefined>;
	setTodoDetailId: Setter<string | undefined>;
	notificationDetailId: Accessor<string | undefined>;
	todoDetailId: Accessor<string | undefined>;
	inspectSubagent: () => boolean;
	selectedTargetKey: () => string | undefined;
	setSelectedTargetKey: (key: string | undefined) => void;
	setInspectSubagent: (open: boolean) => void;
	displaySubagentTargets: Accessor<SubagentTarget[]>;
	selectedSubagentTarget: Accessor<SubagentTarget | undefined>;
	subagentsAvailable: Accessor<boolean>;
	activeRuntime: () => ConversationTabRuntime;
	currentDrafts: () => SessionDrafts;
	syncPromptPlaceholder: (text: string) => void;
	expandCollapsedPromptPaste: (blockId: string) => void;
	isDraftSwitchGuard: () => boolean;
	touch: () => void;
	toast: (text: string, tone: Toast["tone"], durationMs?: number) => void;
}
export interface AppUiActions extends SubagentControlActions {
	copySelection: () => boolean;
	focusMainPrompt: () => void;
	openNotification: (id: string) => void;
	closeNotification: () => void;
	openTodo: (id: string) => void;
	closeTodo: () => void;
	closeSubagentInspector: () => void;
	selectSubagentTarget: (target: SubagentTarget) => void;
	cycleSubagent: (direction: 1 | -1) => void;
	onPromptEditor: (value: TextareaRenderable) => void;
	onPromptMouseDown: (event: MouseEvent) => void;
	onPromptContentChange: () => void;
	onPromptCursorChange: () => void;
}
export function createAppUiActions(ports: AppUiActionsPorts): AppUiActions {
	const {
		renderer,
		transcriptSelectionCache,
		startupPhase,
		notificationDetailId,
		todoDetailId,
		inspectSubagent,
		selectedTargetKey,
		setSelectedTargetKey,
		setInspectSubagent,
		displaySubagentTargets,
		selectedSubagentTarget,
		subagentsAvailable,
		activeRuntime,
		currentDrafts,
		syncPromptPlaceholder,
		expandCollapsedPromptPaste,
		touch,
		toast,
		setNotificationHistory,
		setNotificationDetailId,
		setTodoDetailId,
	} = ports;
	const {
		dialog: [dialog],
		modelSelectorOpen: [modelSelectorOpen],
		sessionSelectorOpen: [sessionSelectorOpen],
		promptMapOpen: [promptMapOpen],
		memoryBrowserOpen: [memoryBrowserOpen],
		subagentSelectorOpen: [subagentSelectorOpen, setSubagentSelectorOpen],
		forkPickerOpen: [forkPickerOpen],
		skillSelectorOpen: [skillSelectorOpen],
		settingsRoute: [settingsRoute],
	} = ports.signals;
	const backgroundSelection = ports.backgroundSelection;
	const {
		pendingSteers: [, setPendingSteers],
		promptText: [, setPromptText],
		promptCursorOffset: [, setPromptCursorOffset],
		commandSuggestionIndex: [, setCommandSuggestionIndex],
	} = ports.signals;
	const copySelection = (): boolean => {
		if (!renderer.getSelection()) {
			transcriptSelectionCache.clear();
			return false;
		}
		const text = transcriptSelectionCache.getCopyText();
		if (!text) return false;
		const copied = renderer.copyToClipboardOSC52(text);
		renderer.clearSelection();
		transcriptSelectionCache.clear();
		toast(
			copied ? "Copied selection" : "Terminal does not support OSC52 clipboard",
			copied ? "success" : "warning",
		);
		return true;
	};

	const focusMainPrompt = () => {
		if (
			startupPhase().kind !== "ready" ||
			dialog() ||
			backgroundSelection() ||
			notificationDetailId() ||
			todoDetailId() ||
			modelSelectorOpen() ||
			sessionSelectorOpen() ||
			promptMapOpen() ||
			memoryBrowserOpen() ||
			subagentSelectorOpen() ||
			forkPickerOpen() ||
			skillSelectorOpen() ||
			inspectSubagent() ||
			settingsRoute() !== "closed"
		)
			return;
		queueMicrotask(() => {
			if (
				!dialog() &&
				!backgroundSelection() &&
				!modelSelectorOpen() &&
				!sessionSelectorOpen() &&
				!forkPickerOpen() &&
				!promptMapOpen() &&
				!memoryBrowserOpen() &&
				!subagentSelectorOpen() &&
				!skillSelectorOpen() &&
				!inspectSubagent()
			)
				ports.getPrompt()?.focus();
		});
	};

	const openNotification = (recordId: string) => {
		setNotificationHistory((current) =>
			current.map((record) =>
				record.id === recordId ? { ...record, read: true } : record,
			),
		);
		setNotificationDetailId(recordId);
	};

	const closeNotification = () => {
		setNotificationDetailId(undefined);
		queueMicrotask(focusMainPrompt);
	};

	const openTodo = (id: string) => {
		setTodoDetailId(id);
	};

	const closeTodo = () => {
		setTodoDetailId(undefined);
		queueMicrotask(focusMainPrompt);
	};

	const closeSubagentInspector = () => {
		setSubagentSelectorOpen(false);
		setInspectSubagent(false);
		queueMicrotask(() => ports.getPrompt()?.focus());
	};

	const selectSubagentTarget = (target: SubagentTarget) => {
		setSelectedTargetKey(target.key);
		setSubagentSelectorOpen(false);
		setInspectSubagent(true);
		queueMicrotask(() =>
			ports.getSubagentScroll()?.scrollTo(inspectedTargetScrollY(target)),
		);
	};

	const cycleSubagent = (direction: 1 | -1) => {
		const all = displaySubagentTargets();
		if (!all.length) return;
		const index = Math.max(
			0,
			all.findIndex((target) => target.key === selectedTargetKey()),
		);
		const nextIndex = (index + direction + all.length) % all.length;
		const next = all[nextIndex];
		setSelectedTargetKey(next?.key);
		if (inspectSubagent())
			queueMicrotask(() =>
				ports.getSubagentScroll()?.scrollTo(inspectedTargetScrollY(next)),
			);
	};

	const subagentActions = createSubagentControlActions({
		selectedTarget: selectedSubagentTarget,
		inspectorOpen: inspectSubagent,
		runtimeAvailable: subagentsAvailable,
		setPendingSteers,
		clearDraft: (key) => clearTargetDraft(currentDrafts(), key),
		touch,
		logger: ports.logger,
		toast,
	});

	const {
		sendSubagentSteer,
		requestPauseSubagent,
		requestResumeSubagent,
		requestStopSubagent,
	} = subagentActions;

	const onPromptEditor = (value: TextareaRenderable) => {
		ports.setPrompt(value);
		const valueText = currentDrafts().main;
		if (value.plainText !== valueText) value.setText(valueText);
		syncPromptPlaceholder(valueText);
	};

	const onPromptMouseDown = (event: MouseEvent) => {
		const prompt = ports.getPrompt();
		const blocks = currentDrafts().mainPastes;
		if (!blocks.length || !prompt) return;
		const localX = Math.floor(event.x - prompt.x);
		const localY = Math.floor(event.y - prompt.y);
		const viewport = prompt.editorView.getViewport();
		if (
			localX < 0 ||
			localY < 0 ||
			localX >= prompt.width ||
			localY >= prompt.height
		)
			return;
		// Mouse events report visual rows; getTextRangeByCoords expects logical
		// rows. Map through the editor view's per-visual-line source line and
		// wrap-start columns so clicks on wrapped lines resolve to the text
		// actually under the cursor (or fail closed).
		const visualRow = localY + Math.floor(viewport.offsetY);
		const lineInfo = prompt.editorView.getLineInfo();
		const logicalRow = lineInfo.lineSources[visualRow];
		if (logicalRow === undefined || logicalRow < 0) return;
		const column =
			localX +
			Math.floor(viewport.offsetX) +
			Math.floor(lineInfo.lineStartCols[visualRow] ?? 0);
		const line = prompt.getTextRangeByCoords(logicalRow, 0, logicalRow, 8192);
		if (!line) return;
		const block = blocks.find((entry) => {
			const start = line.indexOf(entry.token);
			return (
				start >= 0 && column >= start && column < start + entry.token.length
			);
		});
		if (!block) return;
		event.preventDefault();
		event.stopPropagation();
		expandCollapsedPromptPaste(block.id);
	};

	const onPromptContentChange = () => {
		const prompt = ports.getPrompt();
		if (ports.isDraftSwitchGuard()) return;
		const drafts = currentDrafts();
		const rawText = prompt?.plainText ?? "";
		const text = stripCollapsedPromptPasteFragments(rawText, drafts.mainPastes);
		if (prompt && text !== rawText) prompt.replaceText(text);
		drafts.main = text;
		syncPromptPlaceholder(text);
		drafts.mainPastes = prunePromptPasteBlocks(text, drafts.mainPastes);
		activeRuntime().promptHistory.noteEditorChange(text);
		setPromptText(text);
		setPromptCursorOffset(prompt?.cursorOffset ?? text.length);
		setCommandSuggestionIndex(0);
	};

	const onPromptCursorChange = () => {
		const prompt = ports.getPrompt();
		setPromptCursorOffset(prompt?.cursorOffset ?? 0);
	};
	return {
		copySelection,
		focusMainPrompt,
		openNotification,
		closeNotification,
		openTodo,
		closeTodo,
		closeSubagentInspector,
		selectSubagentTarget,
		cycleSubagent,
		sendSubagentSteer,
		requestPauseSubagent,
		requestResumeSubagent,
		requestStopSubagent,
		onPromptEditor,
		onPromptMouseDown,
		onPromptContentChange,
		onPromptCursorChange,
	};
}
