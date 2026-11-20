/** Transcript tools, group cards, slash dispatch and model-thinking actions. */

import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { type Accessor, createMemo, type JSX } from "solid-js";
import type { AppSignals } from "../state/app-signals.ts";
import type { CompactionCompletion } from "../state/compaction-telemetry.ts";
import type {
	OwnedSubagentTargets,
	SubagentTarget,
} from "../subagents/targets.ts";
import type { ConversationItem, Toast } from "../types.ts";
import type { CommandChoice } from "../ui/command-suggestions.tsx";
import { createMessageRenderer } from "../ui/message-renderer.tsx";
import type { ModelChoice } from "../ui/model-selector.tsx";
import { computeSpawnGroups, type SpawnGroup } from "../ui/spawn-group.tsx";
import { inspectedTargetScrollY } from "../ui/subagent-inspector.tsx";
import type { ConversationTabRuntime } from "./runtime.ts";
import type { SessionController } from "./session-controller.ts";
import { isThinkingLevel, SlashCommandController } from "./slash-commands.ts";

type SetUpdater<T> = T | ((current: T) => T);
export interface AppTranscriptControlsPorts {
	signals: AppSignals;
	activeRuntime: () => ConversationTabRuntime;
	revision: Accessor<number>;
	setExpandedToolIds: (value: SetUpdater<Set<string>>) => void;
	setExpandedDiffIds: (value: SetUpdater<Set<string>>) => void;
	setSelectedTargetKey: (key: string | undefined) => void;
	setInspectSubagent: (value: boolean) => void;
	availableSubagentTargets: Accessor<SubagentTarget[]>;
	getSubagentScroll: () => ScrollBoxRenderable | undefined;
	getPrompt: () => TextareaRenderable | undefined;
	visibleItems: Accessor<ConversationItem[]>;
	ownedVisibleSubagentTargets: Accessor<OwnedSubagentTargets>;
	lastCompactionCompletion: Accessor<CompactionCompletion | undefined>;
	thinkingIsExpanded: (id: string) => boolean;
	toggleThinkingItem: (id: string) => void;
	streaming: Accessor<boolean>;
	forkAt: (id: string, item?: ConversationItem) => Promise<void>;
	clockNow: Accessor<number>;
	viewportHeight: () => number;
	isRuntimeActive: (id: string) => boolean;
	trimMessageWindowIfFollowingLatest: () => void;
	conversationTouch: (reason?: "stream" | "structure") => void;
	scrollToBottom: () => void;
	syncMainDraft: (text: string) => void;
	refreshState: (runtime: ConversationTabRuntime) => Promise<boolean>;
	rememberThinkingLevel: (
		runtime: ConversationTabRuntime,
		level?: import("../rpc/pi-rpc-client.ts").ThinkingLevel,
	) => void;
	toast: (text: string, tone: Toast["tone"], durationMs?: number) => void;
	resetMessageWindow: (count: number) => void;
	sessionController: SessionController;
	sessionLoadTimeoutMs: number;
	openSessionSelector: () => void;
	openSettings: () => void;
	openProviders: () => void;
	openMemoryBrowser: () => void;
	fetchAvailableModels: () => Promise<ModelChoice[]>;
	refreshCommandChoices: (
		runtime: ConversationTabRuntime,
		force: boolean,
	) => Promise<CommandChoice[]>;
	applyRememberedThinkingLevel: (
		runtime: ConversationTabRuntime,
		provider: string,
		modelId: string,
	) => Promise<void>;
	setAllThinkingExpanded: (expanded: boolean) => void;
	promptMapEntries: () => import("../ui/prompt-map.tsx").PromptMapEntry[];
}
export interface AppTranscriptControls {
	toolExpanded: (id: string) => boolean;
	toggleTool: (id: string) => void;
	diffExpanded: (id: string) => boolean;
	toggleDiff: (id: string) => void;
	inspectSubagentTarget: (targetKey: string) => void;
	spawnGroupByFirstId: Accessor<Map<string, SpawnGroup>>;
	spawnGroupMemberIds: Accessor<Set<string>>;
	renderItemEntry: (id: string) => JSX.Element | null;
	addSystemToRuntime: (
		runtime: ConversationTabRuntime,
		text: string,
		tone?: "muted" | "info" | "warning" | "error" | "success",
	) => void;
	insertSuggestedCommand: (command: CommandChoice) => void;
	cycleThinkingEffort: () => Promise<void>;
	afterSessionLoaded: (
		runtime: ConversationTabRuntime,
		historyLength: number,
	) => Promise<void>;
	loadCurrentSession: (runtime?: ConversationTabRuntime) => Promise<void>;
	handleSlashCommand: (
		text: string,
		runtime?: ConversationTabRuntime,
	) => Promise<boolean>;
}
export function createAppTranscriptControls(
	ports: AppTranscriptControlsPorts,
): AppTranscriptControls {
	const {
		activeRuntime,
		revision,
		setExpandedToolIds,
		setExpandedDiffIds,
		setSelectedTargetKey,
		setInspectSubagent,
		availableSubagentTargets,
		visibleItems,
		ownedVisibleSubagentTargets,
		lastCompactionCompletion,
		thinkingIsExpanded,
		toggleThinkingItem,
		streaming,
		forkAt,
		clockNow,
		isRuntimeActive: tabRuntimeIsActive,
		trimMessageWindowIfFollowingLatest,
		conversationTouch,
		scrollToBottom,
		syncMainDraft,
		refreshState,
		rememberThinkingLevel,
		toast,
		resetMessageWindow,
		sessionController,
		applyRememberedThinkingLevel,
		setAllThinkingExpanded,
		promptMapEntries,
	} = ports;
	const {
		expandedTools: [expandedTools, setExpandedTools],
		compactionSummaryExpanded: [
			compactionSummaryExpanded,
			setCompactionSummaryExpanded,
		],
		commandSuggestionIndex: [, setCommandSuggestionIndex],
		skillSelectorOpen: [, setSkillSelectorOpen],
		sidebarEnabled: [sidebarEnabled, setSidebarEnabled],
		autoRetryEnabled: [autoRetryEnabled, setAutoRetryEnabled],
		thinkingExpanded: [thinkingExpanded],
		promptMapOpen: [, setPromptMapOpen],
	} = ports.signals;
	const dimensions = () => ({ height: ports.viewportHeight() });
	const refreshCommandChoices = ports.refreshCommandChoices;
	const toolExpanded = (toolId: string): boolean => {
		revision();
		return expandedTools() || activeRuntime().expandedToolIds.has(toolId);
	};
	const toggleTool = (toolId: string) => {
		setExpandedToolIds((current) => {
			const next = new Set(current);
			if (next.has(toolId)) next.delete(toolId);
			else next.add(toolId);
			return next;
		});
	};

	const diffExpanded = (toolId: string): boolean => {
		revision();
		return activeRuntime().expandedDiffIds.has(toolId);
	};
	const toggleDiff = (toolId: string) => {
		setExpandedDiffIds((current) => {
			const next = new Set(current);
			if (next.has(toolId)) next.delete(toolId);
			else next.add(toolId);
			return next;
		});
	};

	const inspectSubagentTarget = (targetKey: string) => {
		setSelectedTargetKey(targetKey);
		setInspectSubagent(true);
		const target = availableSubagentTargets().find(
			(entry) => entry.key === targetKey,
		);
		queueMicrotask(() =>
			ports.getSubagentScroll()?.scrollTo(inspectedTargetScrollY(target)),
		);
	};

	// Contiguous parallel-spawn batches collapse into one grouped card (see
	// `./ui/spawn-group.tsx`). Group keys are synthetic `group:<firstItemId>`
	// ids that cannot collide with real item ids, so the existing per-runtime
	// `expandedToolIds` plumbing (reset per session like the other expansion
	// state) is reused without a second store.
	const spawnGroups = createMemo(() =>
		computeSpawnGroups(visibleItems(), ownedVisibleSubagentTargets()),
	);
	const spawnGroupByFirstId = createMemo(() => {
		const map = new Map<string, SpawnGroup>();
		for (const group of spawnGroups()) {
			const first = group.memberIds[0];
			if (first !== undefined) map.set(first, group);
		}
		return map;
	});
	const spawnGroupMemberIds = createMemo(() => {
		const ids = new Set<string>();
		for (const group of spawnGroups())
			for (const memberId of group.memberIds.slice(1)) ids.add(memberId);
		return ids;
	});

	// Today's per-item transcript path, shared by standalone items and by
	// expanded group members so the raw cards stay exactly reachable.
	const renderItemEntry = createMessageRenderer({
		visibleItems,
		activeRuntime,
		lastCompactionCompletion,
		compactionSummaryExpanded,
		setCompactionSummaryExpanded,
		viewportHeight: () => dimensions().height,
		ownedVisibleSubagentTargets,
		thinkingIsExpanded,
		toggleThinkingItem,
		toolExpanded,
		toggleTool,
		diffExpanded,
		toggleDiff,
		streaming,
		forkAt,
		inspectSubagentTarget,
		clockNow,
	});

	const addSystemToRuntime = (
		runtime: ConversationTabRuntime,
		text: string,
		tone: "muted" | "info" | "warning" | "error" | "success" = "info",
	): void => {
		runtime.conversation.system(text, tone);
		if (!tabRuntimeIsActive(runtime.id)) return;
		trimMessageWindowIfFollowingLatest();
		conversationTouch();
		queueMicrotask(scrollToBottom);
	};

	const insertSuggestedCommand = (command: CommandChoice) => {
		const value = `/${command.name} `;
		syncMainDraft(value);
		setCommandSuggestionIndex(0);
		queueMicrotask(() => ports.getPrompt()?.focus());
	};

	const cycleThinkingEffort = async () => {
		try {
			const runtime = activeRuntime();
			const result = await runtime.client.cycleThinkingLevel();
			await refreshState(runtime);
			const level =
				result?.level ?? runtime.sessionState?.thinkingLevel ?? "unknown";
			rememberThinkingLevel(
				runtime,
				isThinkingLevel(level) ? level : undefined,
			);
			toast(`Thinking effort: ${level}`, "success", 1600);
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), "error");
		}
	};

	const afterSessionLoaded = async (
		runtime: ConversationTabRuntime,
		historyLength: number,
	) => {
		rememberThinkingLevel(runtime);
		if (tabRuntimeIsActive(runtime.id)) {
			resetMessageWindow(historyLength);
			conversationTouch();
			queueMicrotask(scrollToBottom);
		}
		await refreshState(runtime);
	};
	const loadCurrentSession = async (
		runtime: ConversationTabRuntime = activeRuntime(),
	) => {
		const historyLength = await sessionController.loadCurrent(
			runtime,
			ports.sessionLoadTimeoutMs,
		);
		await afterSessionLoaded(runtime, historyLength);
	};

	const slashCommandController =
		new SlashCommandController<ConversationTabRuntime>({
			addSystem: addSystemToRuntime,
			openSessionSelector: () => ports.openSessionSelector(),
			openSettings: () => ports.openSettings(),
			openProviders: () => ports.openProviders(),
			expandedTools,
			setExpandedTools,
			setExpandedToolIds: (ids) => setExpandedToolIds(ids),
			sidebarEnabled,
			setSidebarEnabled,
			refreshState,
			autoRetryEnabled,
			setAutoRetryEnabled,
			refreshCommands: (runtime) => refreshCommandChoices(runtime, true),
			rememberThinkingLevel,
			applyRememberedThinkingLevel,
			fetchAvailableModels: () => ports.fetchAvailableModels(),
			loadCurrentSession,
			setSkillSelectorOpen,
			setAllThinkingExpanded,
			thinkingExpanded,
			promptMapCount: () => promptMapEntries().length,
			setPromptMapOpen,
			openMemoryBrowser: () => ports.openMemoryBrowser(),
		});
	const handleSlashCommand = (
		text: string,
		runtime: ConversationTabRuntime = activeRuntime(),
	): Promise<boolean> => slashCommandController.handle(text, runtime);

	return {
		toolExpanded,
		toggleTool,
		diffExpanded,
		toggleDiff,
		inspectSubagentTarget,
		spawnGroupByFirstId,
		spawnGroupMemberIds,
		renderItemEntry,
		addSystemToRuntime,
		insertSuggestedCommand,
		cycleThinkingEffort,
		afterSessionLoaded,
		loadCurrentSession,
		handleSlashCommand,
	};
}
