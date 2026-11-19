/** Inspector callback and data contracts, shared by its control panes. */
import type { ScrollBoxRenderable } from "@opentui/core";
import type { PendingSteerEntry } from "../state/input-continuity.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { ConversationItem, SubagentRun } from "../types.ts";
export interface SubagentInspectorProps {
	target?: SubagentTarget | undefined;
	run?: SubagentRun | undefined;
	items: ConversationItem[];
	now: number;
	scrollRef?: (value: ScrollBoxRenderable) => void;
	onClose?: () => void;
	onPause?: () => void;
	onResume?: () => void;
	onStop?: () => void;
	onChooseTarget?: () => void;
	targetCount?: number;
	allTargets?: readonly SubagentTarget[];
	onInspectSubagentTarget?: (targetKey: string) => void;
	/** Current shared spinner glyph from the main conversation's 250 ms tick. */
	spinner?: string | undefined;
	draft?: (() => string) | undefined;
	onDraftChange?: (message: string) => void;
	onSteer?: (message: string) => void;
	pendingSteers?: readonly PendingSteerEntry[];
	thinkingExpanded?: (itemId: string) => boolean;
	onToggleThinking?: (itemId: string) => void;
	toolExpanded?: (toolId: string) => boolean;
	onToggleTool?: (toolId: string) => void;
	diffExpanded?: (toolId: string) => boolean;
	onToggleDiff?: (toolId: string) => void;
}
