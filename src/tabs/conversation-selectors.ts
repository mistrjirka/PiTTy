/** Stable, memoized render projections for the active conversation tab. */
import { createEffect, createMemo, type Accessor, type Setter } from "solid-js";
import type { ConversationItem, SubagentRun } from "../types.ts";
import type { ConversationTabRuntime } from "./runtime.ts";
import type { StartupPhase } from "../state/startup.ts";
import { clampMessageWindowStart } from "../ui/message-window.ts";
import { deriveTodos, type TodoViewItem } from "../ui/todos.tsx";
import { preserveEquivalentTodos } from "../ui/list-stability.ts";
import {
	filterCommandChoices,
	type CommandChoice,
} from "../ui/command-suggestions.tsx";
import type { PromptMapEntry } from "../ui/prompt-map.tsx";
import type {
	CompactionTelemetry,
	CompactionCompletion,
	OneRoundProgress,
	OneRoundLaneTexts,
} from "../state/compaction-telemetry.ts";

export interface ConversationSelectorsPorts {
	sidebarEnabled: Accessor<boolean>;
	dimensions: Accessor<{ width: number; height: number }>;
	conversationRevision: Accessor<number>;
	conversationStructureRevision: Accessor<number>;
	messageWindowStart: Accessor<number>;
	activeRuntime: () => ConversationTabRuntime;
	subagentsInstalled: boolean;
	todosInstalled: boolean;
	runs: () => SubagentRun[];
	promptText: Accessor<string>;
	promptCursorOffset: Accessor<number>;
	commandChoices: Accessor<CommandChoice[]>;
	clockNow: Accessor<number>;
	startupPhase: Accessor<StartupPhase>;
	refreshCommandChoices: (
		runtime: ConversationTabRuntime,
	) => Promise<CommandChoice[]>;
	revision: Accessor<number>;
	thinkingExpanded: Accessor<boolean>;
	setThinkingExpanded: Setter<boolean>;
	setThinkingExpansionOverrides: (
		value:
			| Map<string, boolean>
			| ((previous: Map<string, boolean>) => Map<string, boolean>),
	) => void;
	compactionRevision: Accessor<number>;
}

export interface ConversationSelectors {
	visibleSidebar: Accessor<boolean>;
	items: () => ConversationItem[];
	structureItems: () => ConversationItem[];
	visibleItems: Accessor<ConversationItem[]>;
	hiddenMessageCount: Accessor<number>;
	visibleMessageIds: Accessor<string[]>;
	promptMapEntries: Accessor<PromptMapEntry[]>;
	todos: Accessor<TodoViewItem[]>;
	subagentsAvailable: Accessor<boolean>;
	todosAvailable: Accessor<boolean>;
	commandSuggestions: Accessor<CommandChoice[]>;
	thinkingIsExpanded: (id: string) => boolean;
	setAllThinkingExpanded: (value: boolean) => void;
	toggleThinkingItem: (id: string) => void;
	streaming: Accessor<boolean>;
	compactionView: Accessor<{
		telemetry: CompactionTelemetry | undefined;
		smartCompactProgress: string | undefined;
		oneRoundProgress: OneRoundProgress | undefined;
		laneTexts: OneRoundLaneTexts | undefined;
	}>;
	lastCompactionCompletion: Accessor<CompactionCompletion | undefined>;
	showWorkingIndicator: Accessor<boolean>;
}

export function createConversationSelectors(
	ports: ConversationSelectorsPorts,
): ConversationSelectors {
	const visibleSidebar = createMemo(
		() => ports.sidebarEnabled() && ports.dimensions().width >= 104,
	);
	// Accessing the live array is O(1). The window memo below makes a fresh
	// slice for Solid so updated rows still render. Copying the *entire*
	// conversation on every stream batch scaled with session length.
	const items = (): ConversationItem[] => {
		ports.conversationRevision();
		return ports.activeRuntime().conversation.items;
	};
	const structureItems = (): ConversationItem[] => {
		ports.conversationStructureRevision();
		return ports.activeRuntime().conversation.items;
	};
	const visibleItems = createMemo(() => {
		const all = items();
		const start = clampMessageWindowStart(
			all.length,
			ports.messageWindowStart(),
		);
		return all.slice(start);
	});
	const hiddenMessageCount = createMemo(() =>
		clampMessageWindowStart(items().length, ports.messageWindowStart()),
	);
	const visibleMessageIds = createMemo(() =>
		visibleItems().map((item) => item.id),
	);
	const promptMapEntries = createMemo<PromptMapEntry[]>(() =>
		structureItems().flatMap((item) =>
			item.kind === "user"
				? [{ id: item.id, text: item.text, timestamp: item.timestamp }]
				: [],
		),
	);
	const todos = createMemo<TodoViewItem[]>((previous) =>
		preserveEquivalentTodos(previous, deriveTodos(structureItems())),
	);
	const subagentsAvailable = createMemo(
		() => ports.subagentsInstalled || ports.runs().length > 0,
	);
	const todosAvailable = createMemo(
		() => ports.todosInstalled || todos().length > 0,
	);
	const commandSuggestions = createMemo(() => {
		ports.revision();
		if (ports.activeRuntime().pendingInputEdit) return [];
		return filterCommandChoices(
			ports.commandChoices(),
			ports.promptText(),
			Number.POSITIVE_INFINITY,
			ports.promptCursorOffset(),
		);
	});
	const slashQueryActive = createMemo(() =>
		/^\/[^\s]*$/.test(ports.promptText()),
	);
	const commandSyncTick = createMemo(() =>
		Math.floor(ports.clockNow() / 30_000),
	);
	createEffect(() => {
		if (!slashQueryActive()) return;
		commandSyncTick();
		const runtime = ports.activeRuntime();
		if (
			ports.startupPhase().kind !== "ready" ||
			!runtime.startupResolved ||
			runtime.conversation.isStreaming ||
			runtime.conversation.isCompacting
		)
			return;
		void ports.refreshCommandChoices(runtime);
	});
	const thinkingIsExpanded = (itemId: string): boolean => {
		ports.revision();
		return (
			ports.activeRuntime().thinkingExpansionOverrides.get(itemId) ??
			ports.thinkingExpanded()
		);
	};
	const setAllThinkingExpanded = (expanded: boolean) => {
		ports.setThinkingExpanded(expanded);
		ports.setThinkingExpansionOverrides(new Map());
	};
	const toggleThinkingItem = (itemId: string) => {
		const next = !thinkingIsExpanded(itemId);
		ports.setThinkingExpansionOverrides((current) => {
			const updated = new Map(current);
			updated.set(itemId, next);
			return updated;
		});
	};
	const streaming = createMemo(() => {
		ports.conversationRevision();
		return ports.activeRuntime().conversation.isStreaming;
	});
	const compactionView = createMemo(() => {
		ports.compactionRevision();
		const runtime = ports.activeRuntime();
		return {
			telemetry: runtime.compactionTelemetry,
			smartCompactProgress: runtime.smartCompactProgress,
			oneRoundProgress: runtime.oneRoundProgress,
			laneTexts: runtime.oneRoundLaneTexts,
		};
	});
	const lastCompactionCompletion = createMemo(() => {
		ports.conversationRevision();
		return ports.activeRuntime().lastCompactionCompletion;
	});
	// Show for the whole agent turn — including thinking streams and tool
	// calls. Hiding while the latest item is "active" made Working disappear
	// exactly when users expect it.
	const showWorkingIndicator = streaming;

	return {
		visibleSidebar,
		items,
		structureItems,
		visibleItems,
		hiddenMessageCount,
		visibleMessageIds,
		promptMapEntries,
		todos,
		subagentsAvailable,
		todosAvailable,
		commandSuggestions,
		thinkingIsExpanded,
		setAllThinkingExpanded,
		toggleThinkingItem,
		streaming,
		compactionView,
		lastCompactionCompletion,
		showWorkingIndicator,
	};
}
