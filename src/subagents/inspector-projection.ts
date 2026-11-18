/** Memoized PID-scoped subagent roster and inspector transcript projection. */
import { createMemo, type Accessor } from "solid-js";
import type { ConversationItem, SubagentRun, ToolItem } from "../types.ts";
import type { ConversationTabRuntime } from "../tabs/runtime.ts";
import {
	subagentTargets,
	ownedSubagentTargetsForItems,
	type SubagentTarget,
	type OwnedSubagentTargets,
} from "./targets.ts";
import { subagentTreeRows } from "./tree.ts";
import { resolveLiveChildTranscriptPath } from "./artifacts.ts";
import { createSubagentTranscriptCache } from "./transcript-cache.ts";
import { preserveReferencedList } from "../ui/list-stability.ts";

export interface InspectorProjectionPorts {
	cwd: string;
	clockNow: Accessor<number>;
	runs: () => SubagentRun[];
	structureItems: () => ConversationItem[];
	visibleItems: Accessor<ConversationItem[]>;
	contextWindowForModel: (modelName: string | undefined) => number | undefined;
	activeRuntime: () => ConversationTabRuntime;
	selectedTargetKey: () => string | undefined;
	inspectSubagent: () => boolean;
}

export interface InspectorProjection {
	subagentTools: Accessor<ToolItem[]>;
	availableSubagentTargets: Accessor<SubagentTarget[]>;
	displaySubagentTargets: Accessor<SubagentTarget[]>;
	ownedVisibleSubagentTargets: Accessor<OwnedSubagentTargets>;
	selectedSubagentTarget: Accessor<SubagentTarget | undefined>;
	inspectedTarget: Accessor<SubagentTarget | undefined>;
	inspectedTranscript: Accessor<ConversationItem[]>;
}

export function createInspectorProjection(
	ports: InspectorProjectionPorts,
): InspectorProjection {
	const subagentTools = createMemo<ToolItem[]>((previous) =>
		preserveReferencedList(
			previous,
			ports
				.structureItems()
				.filter((item): item is ToolItem => item.kind === "tool"),
		),
	);
	// A separate memo prevents expensive filesystem discovery every second.
	// The live status can change without any Pi RPC event.
	const profiledSubagentScanTick = createMemo(() =>
		Math.floor(ports.clockNow() / 3_000),
	);
	const availableSubagentTargets = createMemo(() => {
		profiledSubagentScanTick();
		return subagentTargets(ports.runs(), subagentTools(), {
			contextWindowForModel: ports.contextWindowForModel,
			ownerPid: ports.activeRuntime().client.getProcessPid(),
		});
	});
	const displaySubagentTargets = createMemo(() =>
		subagentTreeRows(availableSubagentTargets()).map((row) => row.target),
	);
	const ownedVisibleSubagentTargets = createMemo(() =>
		ownedSubagentTargetsForItems(
			ports
				.visibleItems()
				.filter((item): item is ToolItem => item.kind === "tool"),
			availableSubagentTargets(),
		),
	);
	const selectedSubagentTarget = createMemo(
		() =>
			availableSubagentTargets().find(
				(target) => target.key === ports.selectedTargetKey(),
			) ?? displaySubagentTargets()[0],
	);
	const inspectedTranscriptCache = createSubagentTranscriptCache();
	const inspectedTarget = createMemo(() => {
		const target = selectedSubagentTarget();
		if (target?.active && !target.transcriptPath && !target.sessionFile) {
			const parentSessionFile = ports.activeRuntime().sessionState?.sessionFile;
			const transcriptPath = resolveLiveChildTranscriptPath({
				agent: target.step?.agent ?? target.run.agent ?? target.label,
				...(target.workflowKey !== undefined
					? { index: 0 }
					: target.stepIndex !== undefined
						? { index: target.stepIndex }
						: {}),
				...(target.childRunId !== undefined
					? { childRunId: target.childRunId }
					: {}),
				...(target.startedAt !== undefined
					? { startedAt: target.startedAt }
					: {}),
				cwd: ports.cwd,
				...(parentSessionFile ? { parentSessionFile } : {}),
			});
			if (transcriptPath) {
				return {
					...target,
					transcriptPath,
					run: { ...target.run, transcriptPath },
				};
			}
		}
		return target;
	});
	const inspectedTranscript = createMemo(() =>
		inspectedTranscriptCache(inspectedTarget(), ports.inspectSubagent()),
	);

	return {
		subagentTools,
		availableSubagentTargets,
		displaySubagentTargets,
		ownedVisibleSubagentTargets,
		selectedSubagentTarget,
		inspectedTarget,
		inspectedTranscript,
	};
}
