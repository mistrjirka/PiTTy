/** Subagent roster projection, foreground workflow and ownership | target-identity. */

import type { ToolItem } from "../types.ts";

import {
	isProfiledSubagentTool,
	isSubagentFamilyToolName,
} from "./profiled.ts";

import type { SubagentTarget } from "./target-metadata.ts";

export function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function compareTargetRichness(
	a: SubagentTarget,
	b: SubagentTarget,
): number {
	const fileBacked = Number(Boolean(a.transcriptPath || a.sessionFile));
	const otherFileBacked = Number(Boolean(b.transcriptPath || b.sessionFile));
	if (fileBacked !== otherFileBacked) return fileBacked - otherFileBacked;
	const model = Number(Boolean(a.model));
	const otherModel = Number(Boolean(b.model));
	if (model !== otherModel) return model - otherModel;
	const step = Number(Boolean(a.step));
	const otherStep = Number(Boolean(b.step));
	if (step !== otherStep) return step - otherStep;
	if (a.active !== b.active) return Number(a.active) - Number(b.active);
	return (a.lastUpdate ?? 0) - (b.lastUpdate ?? 0);
}

export function subagentRunIdFromTool(item: ToolItem): string | undefined {
	if (!isSubagentFamilyToolName(item.name)) return undefined;
	const details = record(item.details);
	for (const key of ["runId", "asyncId", "id"] as const) {
		const value = details?.[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

export function reconcileSubagentSelection(
	previousKey: string | undefined,
	previousTargets: readonly SubagentTarget[],
	nextTargets: readonly SubagentTarget[],
): string | undefined {
	if (previousKey && nextTargets.some((target) => target.key === previousKey))
		return previousKey;
	const previous = previousTargets.find((target) => target.key === previousKey);
	if (
		previous?.run.control === "foreground" &&
		previous.sessionFile &&
		previous.stepIndex !== undefined
	) {
		const matches = nextTargets.filter(
			(target) =>
				target.active &&
				target.canSteer &&
				target.sessionFile === previous.sessionFile &&
				target.stepIndex === previous.stepIndex,
		);
		if (matches.length === 1) return matches[0]?.key;
	}
	// Previous target is gone: prefer a live/current run, else the most recent
	// finished run (nextTargets is already most-recent-first). Never yanks a
	// surviving selection — that case returned above.
	if (nextTargets.length === 0) return undefined;
	return (
		nextTargets.find((target) => target.active)?.key ?? nextTargets[0]?.key
	);
}

export function subagentTargetIdentity(target: SubagentTarget): string {
	const run = target.run;
	// Profiled runs are distinct per run even when they share a session file:
	// identity leads with the control dir (or runId when status-less), then
	// treeId/agentId, with the session file last — never bare agentId, never
	// the session file alone. Legacy/file-backed runs without a control dir
	// keep exactly today's session-then-key behavior.
	const controlDir = run.controlDir?.trim();
	if (
		controlDir ||
		run.control === "profiled" ||
		run.runtime === "profiled-subagents"
	) {
		const scope = controlDir ? `dir:${controlDir}` : `run:${run.runId}`;
		const tree = run.treeId?.trim() ?? "";
		const agent = run.agentId?.trim() ?? "";
		const session = target.sessionFile?.trim() ?? "";
		return `profiled:${scope}:${tree}:${agent}:${target.stepIndex ?? "run"}:${session}`;
	}
	const sessionFile = target.sessionFile?.trim();
	return sessionFile
		? `session:${target.stepIndex ?? "run"}:${sessionFile}`
		: `key:${target.key}`;
}

export type OwnedSubagentTargets = ReadonlyMap<string, SubagentTarget[]>;

export const NEAREST_RUN_WINDOW_MS = 30_000;

export function matchByRunIdOrToolCallId(
	item: ToolItem,
	targets: readonly SubagentTarget[],
): SubagentTarget[] {
	// Profile-driven agent_spawn results carry the exact child identity in
	// details rather than the legacy runId fields. Match that identity first;
	// otherwise nested descendants can fall through to the timestamp heuristic
	// and appear owned by the wrong spawn card.
	if (isProfiledSubagentTool(item)) {
		const details = record(item.details);
		const controlDir =
			typeof details?.controlDir === "string" && details.controlDir.trim()
				? details.controlDir.trim()
				: undefined;
		const treeId =
			typeof details?.treeId === "string" && details.treeId.trim()
				? details.treeId.trim()
				: undefined;
		const agentId =
			typeof details?.agentId === "string" && details.agentId.trim()
				? details.agentId.trim()
				: undefined;
		const parentAgentId =
			typeof details?.parentAgentId === "string" && details.parentAgentId.trim()
				? details.parentAgentId.trim()
				: undefined;
		if (controlDir) {
			const byControlDir = targets.filter(
				(target) => target.run.controlDir === controlDir,
			);
			if (byControlDir.length > 0) return byControlDir;
		}
		if (treeId && agentId) {
			const byTreeIdentity = targets.filter(
				(target) =>
					target.run.treeId === treeId &&
					target.run.agentId === agentId &&
					(parentAgentId === undefined ||
						target.run.parentAgentId === parentAgentId),
			);
			if (byTreeIdentity.length > 0) return byTreeIdentity;
		}
	}

	const runId = subagentRunIdFromTool(item);
	if (runId) {
		const byRunId = targets.filter((target) => target.run.runId === runId);
		if (byRunId.length > 0) return byRunId;
	}
	if (item.toolCallId) {
		const direct = targets.filter(
			(target) => target.toolCallId === item.toolCallId,
		);
		if (direct.length > 0) return direct;
	}
	return [];
}

export function ownedSubagentTargetsForItems(
	items: readonly ToolItem[],
	targets: readonly SubagentTarget[],
): OwnedSubagentTargets {
	const owners = new Map<string, string>();
	const assigned = new Map<string, SubagentTarget[]>();
	const claimed = new Set<string>();
	const assign = (target: SubagentTarget, ownerId: string) => {
		const identity = subagentTargetIdentity(target);
		const existingOwner = owners.get(identity);
		if (existingOwner && existingOwner !== ownerId) {
			// The same logical target reappeared under a different tool call; the
			// newer target replaces the older one under its original owner instead
			// of duplicating rows.
			const ownedTargets = assigned.get(existingOwner);
			const targetIndex =
				ownedTargets?.findIndex(
					(candidate) => subagentTargetIdentity(candidate) === identity,
				) ?? -1;
			if (ownedTargets && targetIndex >= 0) ownedTargets[targetIndex] = target;
			return;
		}
		owners.set(identity, ownerId);
		const ownedTargets = assigned.get(ownerId) ?? [];
		if (
			!ownedTargets.some(
				(candidate) => subagentTargetIdentity(candidate) === identity,
			)
		) {
			ownedTargets.push(target);
		}
		assigned.set(ownerId, ownedTargets);
		claimed.add(identity);
	};

	// Pass 1 — explicit ownership by runId / toolCallId. These keys reliably
	// tie a run to the tool call that spawned it.
	for (const item of items) {
		for (const target of matchByRunIdOrToolCallId(item, targets)) {
			assign(target, item.id);
		}
	}

	// Pass 2 — nearest-match fallback for runs that older pi-subagents results
	// emitted without a runId. Assign each still-unclaimed run to the single
	// closest subagent tool call within a tight window, 1:1, so a later
	// parallel spawn no longer attaches its children to an earlier unrelated
	// subagent tool call. Runs that cannot be unambiguously owned stay hidden.
	const unclaimedByRun = new Map<string, SubagentTarget[]>();
	for (const target of targets) {
		if (claimed.has(subagentTargetIdentity(target))) continue;
		// A profiled descendant belongs to the agent_spawn call inside its
		// immediate parent's transcript. Never let the legacy nearest-time
		// fallback attach it to a root/main spawn card.
		if (
			target.run.runtime === "profiled-subagents" &&
			target.run.parentAgentId &&
			target.run.parentAgentId !== "root"
		)
			continue;
		const group = unclaimedByRun.get(target.run.runId) ?? [];
		group.push(target);
		unclaimedByRun.set(target.run.runId, group);
	}
	const usedFallbackItems = new Set<string>();
	for (const group of unclaimedByRun.values()) {
		const runStartedAt = group[0]?.run.startedAt ?? group[0]?.startedAt;
		if (runStartedAt === undefined) continue;
		let bestItem: ToolItem | undefined;
		let bestGap = NEAREST_RUN_WINDOW_MS;
		for (const item of items) {
			if (!isSubagentFamilyToolName(item.name)) continue;
			if ((assigned.get(item.id) ?? []).length > 0) continue;
			if (usedFallbackItems.has(item.id)) continue;
			const gap = Math.abs(runStartedAt - item.timestamp);
			if (gap < bestGap) {
				bestGap = gap;
				bestItem = item;
			}
		}
		if (!bestItem) continue;
		usedFallbackItems.add(bestItem.id);
		for (const target of group) assign(target, bestItem.id);
	}

	return assigned;
}
