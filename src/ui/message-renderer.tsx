/** Message cards and compaction summary cards for the transcript window. */
import { type Accessor, createMemo, type JSX, type Setter } from "solid-js";
import {
	type CompactionCompletion,
	compactionCompletionForItem,
} from "../state/compaction-telemetry.ts";
import type { OwnedSubagentTargets } from "../subagents/targets.ts";
import type { ConversationTabRuntime } from "../tabs/runtime.ts";
import type { ConversationItem } from "../types.ts";
import { CompactedSummary } from "./compaction-panel.tsx";
import { MessageView } from "./message.tsx";

export interface MessageRendererPorts {
	visibleItems: Accessor<ConversationItem[]>;
	activeRuntime: () => ConversationTabRuntime;
	lastCompactionCompletion: Accessor<CompactionCompletion | undefined>;
	compactionSummaryExpanded: Accessor<boolean>;
	setCompactionSummaryExpanded: Setter<boolean>;
	viewportHeight: () => number;
	ownedVisibleSubagentTargets: Accessor<OwnedSubagentTargets>;
	thinkingIsExpanded: (id: string) => boolean;
	toggleThinkingItem: (id: string) => void;
	toolExpanded: (id: string) => boolean;
	toggleTool: (id: string) => void;
	diffExpanded: (id: string) => boolean;
	toggleDiff: (id: string) => void;
	streaming: Accessor<boolean>;
	forkAt: (entryId: string, userItem?: ConversationItem) => Promise<void>;
	inspectSubagentTarget: (targetKey: string) => void;
	clockNow: Accessor<number>;
}

export function createMessageRenderer(
	ports: MessageRendererPorts,
): (itemId: string) => JSX.Element | null {
	const renderItemEntry = (itemId: string) => {
		const item = createMemo(() =>
			ports.visibleItems().find((candidate) => candidate.id === itemId),
		);
		const compactionCompletion = createMemo(() =>
			compactionCompletionForItem(
				ports.activeRuntime().conversation.items,
				itemId,
				ports.lastCompactionCompletion(),
			),
		);
		const tool = createMemo(() => {
			const candidate = item();
			return candidate?.kind === "tool" ? candidate : undefined;
		});
		const subagentTargetsForItem = createMemo(
			() => ports.ownedVisibleSubagentTargets().get(itemId) ?? [],
		);
		const initialItem = item();
		if (!initialItem) return null;
		const completion = compactionCompletion();
		if (completion) {
			return (
				<CompactedSummary
					completion={completion}
					expanded={ports.compactionSummaryExpanded}
					onToggle={() => ports.setCompactionSummaryExpanded((value) => !value)}
					viewportHeight={ports.viewportHeight()}
				/>
			);
		}
		const itemSource = () => item() ?? initialItem;
		return (
			<MessageView
				item={() => itemSource()}
				showThinking
				thinkingExpanded={() => ports.thinkingIsExpanded(itemId)}
				onToggleThinking={() => ports.toggleThinkingItem(itemId)}
				toolExpanded={() => tool() !== undefined && ports.toolExpanded(itemId)}
				onToggleTool={ports.toggleTool}
				diffExpanded={() => tool() !== undefined && ports.diffExpanded(itemId)}
				onToggleDiff={ports.toggleDiff}
				canFork={!ports.streaming()}
				onFork={(entryId) => void ports.forkAt(entryId, item())}
				subagentTargets={subagentTargetsForItem()}
				onInspectSubagentTarget={ports.inspectSubagentTarget}
				now={
					tool()?.status === "streaming" ||
					tool()?.status === "pending" ||
					subagentTargetsForItem().some((target) => target.active)
						? ports.clockNow()
						: (tool()?.endedAt ?? tool()?.startedAt ?? tool()?.timestamp ?? 0)
				}
			/>
		);
	};

	return renderItemEntry;
}
