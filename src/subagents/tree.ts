import type { SubagentTarget } from "./targets.ts";

export type SubagentTreeRow = {
	target: SubagentTarget;
	depth: number;
	parentKey?: string | undefined;
	directChildCount: number;
	descendantCount: number;
	activeDescendantCount: number;
};

function profiledParentId(target: SubagentTarget): string | undefined {
	if (target.run.runtime !== "profiled-subagents") return undefined;
	const parent = target.run.parentAgentId?.trim();
	return parent && parent !== "root" ? parent : undefined;
}

function sameTree(left: SubagentTarget, right: SubagentTarget): boolean {
	const leftTree = left.run.treeId?.trim();
	const rightTree = right.run.treeId?.trim();
	return Boolean(leftTree && rightTree && leftTree === rightTree);
}

/**
 * Resolve the immediate profiled parent. Current pi-subagent guarantees
 * whole-tree agent-id uniqueness, but choose the newest plausible earlier
 * run if an old runtime produced duplicate bare ids.
 */
export function subagentParentTarget(
	target: SubagentTarget,
	targets: readonly SubagentTarget[],
): SubagentTarget | undefined {
	const parentId = profiledParentId(target);
	if (!parentId) return undefined;
	const childStartedAt = target.startedAt ?? target.run.startedAt ?? Number.POSITIVE_INFINITY;
	return targets
		.filter(
			(candidate) =>
				candidate !== target &&
				sameTree(candidate, target) &&
				candidate.run.agentId?.trim() === parentId &&
				(candidate.startedAt ?? candidate.run.startedAt ?? 0) <= childStartedAt,
		)
		.sort(
			(a, b) =>
				(b.startedAt ?? b.run.startedAt ?? 0) -
				(a.startedAt ?? a.run.startedAt ?? 0),
		)[0];
}

export function subagentDirectChildren(
	parent: SubagentTarget,
	targets: readonly SubagentTarget[],
): SubagentTarget[] {
	const parentId = parent.run.agentId?.trim();
	const treeId = parent.run.treeId?.trim();
	if (!parentId || !treeId) return [];
	return targets
		.filter(
			(candidate) =>
				candidate !== parent &&
				candidate.run.runtime === "profiled-subagents" &&
				candidate.run.treeId?.trim() === treeId &&
				candidate.run.parentAgentId?.trim() === parentId,
		)
		.sort(
			(a, b) =>
				(a.startedAt ?? a.run.startedAt ?? 0) -
					(b.startedAt ?? b.run.startedAt ?? 0) ||
				a.key.localeCompare(b.key),
		);
}

export function subagentTargetPath(
	target: SubagentTarget,
	targets: readonly SubagentTarget[],
): SubagentTarget[] {
	const path: SubagentTarget[] = [];
	const seen = new Set<string>();
	let current: SubagentTarget | undefined = target;
	while (current && !seen.has(current.key)) {
		path.unshift(current);
		seen.add(current.key);
		current = subagentParentTarget(current, targets);
	}
	return path;
}

export function subagentShortLabel(target: SubagentTarget): string {
	const id = target.run.agentId?.trim();
	const profile = target.run.profile?.trim();
	if (id && profile) return `@${id} · ${profile}`;
	if (id) return `@${id}`;
	return target.label;
}

/**
 * Sidebar projection of all subagents. Profiled descendants stay contiguous
 * under their parent instead of participating in the old global startedAt
 * sort. Non-profiled/legacy runs remain top-level in their existing order.
 */
export function subagentTreeRows(
	targets: readonly SubagentTarget[],
): SubagentTreeRow[] {
	const parentByKey = new Map<string, SubagentTarget>();
	const childrenByKey = new Map<string, SubagentTarget[]>();
	const roots: SubagentTarget[] = [];

	for (const target of targets) {
		const parent = subagentParentTarget(target, targets);
		if (!parent) {
			roots.push(target);
			continue;
		}
		parentByKey.set(target.key, parent);
		const children = childrenByKey.get(parent.key) ?? [];
		children.push(target);
		childrenByKey.set(parent.key, children);
	}
	for (const children of childrenByKey.values()) {
		children.sort(
			(a, b) =>
				(a.startedAt ?? a.run.startedAt ?? 0) -
					(b.startedAt ?? b.run.startedAt ?? 0) ||
				a.key.localeCompare(b.key),
		);
	}

	const descendants = (
		target: SubagentTarget,
		seen = new Set<string>(),
	): { total: number; active: number } => {
		if (seen.has(target.key)) return { total: 0, active: 0 };
		const nextSeen = new Set(seen);
		nextSeen.add(target.key);
		let total = 0;
		let active = 0;
		for (const child of childrenByKey.get(target.key) ?? []) {
			total += 1;
			if (child.active) active += 1;
			const nested = descendants(child, nextSeen);
			total += nested.total;
			active += nested.active;
		}
		return { total, active };
	};

	const rows: SubagentTreeRow[] = [];
	const visited = new Set<string>();
	const append = (target: SubagentTarget, depth: number): void => {
		if (visited.has(target.key)) return;
		visited.add(target.key);
		const counts = descendants(target);
		const parent = parentByKey.get(target.key);
		rows.push({
			target,
			depth,
			...(parent ? { parentKey: parent.key } : {}),
			directChildCount: childrenByKey.get(target.key)?.length ?? 0,
			descendantCount: counts.total,
			activeDescendantCount: counts.active,
		});
		for (const child of childrenByKey.get(target.key) ?? []) append(child, depth + 1);
	};

	for (const root of roots) append(root, 0);
	// Fail closed on malformed/cyclic historical data: every target remains
	// reachable even if its parent relationship cannot form a valid tree.
	for (const target of targets) if (!visited.has(target.key)) append(target, 0);
	return rows;
}
