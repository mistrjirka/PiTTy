/** Subagent roster projection, foreground workflow and ownership | target-context. */

import { compactTokenCount } from "../state/compaction-telemetry.ts";
import type { ToolItem } from "../types.ts";

import { isSubagentFamilyToolName } from "./profiled.ts";
import {
	matchByRunIdOrToolCallId,
	NEAREST_RUN_WINDOW_MS,
} from "./target-identity.ts";
import type { SubagentTarget } from "./target-metadata.ts";

export function targetsForTool(
	item: ToolItem,
	targets: readonly SubagentTarget[],
): SubagentTarget[] {
	const matched = matchByRunIdOrToolCallId(item, targets);
	if (matched.length > 0) return matched;

	// Legacy timestamp fallback for older pi-subagents results that omitted
	// runId. Kept for direct callers/tests; the owner pass in
	// `ownedSubagentTargetsForItems` uses a global nearest-match instead, which
	// prevents a later run from attaching to an earlier unrelated tool call.
	if (!isSubagentFamilyToolName(item.name)) return [];
	const candidates = new Map<string, SubagentTarget[]>();
	for (const target of targets) {
		const startedAt = target.run.startedAt ?? target.startedAt;
		if (
			startedAt === undefined ||
			Math.abs(startedAt - item.timestamp) > NEAREST_RUN_WINDOW_MS
		)
			continue;
		const group = candidates.get(target.run.runId) ?? [];
		group.push(target);
		candidates.set(target.run.runId, group);
	}
	return candidates.size === 1 ? ([...candidates.values()][0] ?? []) : [];
}

export function formatContextUsage(
	used: number | undefined,
	limit: number | undefined,
): string | undefined {
	if (used === undefined || limit === undefined) return undefined;
	const usedRounded = Math.round(used);
	const limitRounded = Math.round(limit);
	if (
		!Number.isFinite(usedRounded) ||
		!Number.isFinite(limitRounded) ||
		limitRounded <= 0
	)
		return undefined;
	return `${compactTokenCount(Math.max(0, usedRounded))} / ${compactTokenCount(limitRounded)}`;
}

export type TargetContextNumbers = {
	used: number;
	limit: number;
};

export function targetContextNumbers(
	target: SubagentTarget,
): TargetContextNumbers | undefined {
	const used = target.step?.tokens?.window ?? target.run.tokens?.window;
	const limit = target.step?.contextWindow ?? target.run.contextWindow;
	if (used === undefined || limit === undefined) return undefined;
	return { used, limit };
}

export function targetContextUsage(target: SubagentTarget): string | undefined {
	const numbers = targetContextNumbers(target);
	if (!numbers) return undefined;
	return formatContextUsage(numbers.used, numbers.limit);
}

export function targetContextPercent(
	target: SubagentTarget,
): number | undefined {
	const numbers = targetContextNumbers(target);
	if (!numbers || numbers.limit <= 0) return undefined;
	return Math.round((numbers.used / numbers.limit) * 100);
}
