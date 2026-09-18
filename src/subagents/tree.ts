import type { SubagentTarget } from "./targets.ts";

export type SubagentTreeRow = {
	target: SubagentTarget;
	depth: number;
	prefix: string;
	parent?: SubagentTarget | undefined;
	childCount: number;
	descendantCount: number;
};

function agentId(target: SubagentTarget): string | undefined {
	return target.run.agentId?.trim() || undefined;
}

function parentAgentId(target: SubagentTarget): string | undefined {
	return target.run.parentAgentId?.trim() || undefined;
}

function treeId(target: SubagentTarget): string | undefined {
	return target.run.treeId?.trim() || undefined;
}

function startedAt(target: SubagentTarget): number {
	return target.startedAt ?? target.run.startedAt ?? 0;
}

function sameProfiledTree(a: SubagentTarget, b: SubagentTarget): boolean {
	const aTree = treeId(a);
	const bTree = treeId(b);
	return Boolean(aTree && bTree && aTree === bTree);
}

export function parentSubagentTarget(
	target: SubagentTarget,
	targets: readonly SubagentTarget[],
): SubagentTarget | undefined {
	const parentId = parentAgentId(target);
	if (!parentId || parentId === "root") return undefined;
	const matches = targets.filter(
		(candidate) =>
			candidate !== target &&
			sameProfiledTree(candidate, target) &&
			agentId(candidate) === parentId,
	);
	// Whole-tree ids are unique on current pi-subagent. Older runtimes could
	// collide; a flat fallback is safer than drawing the child under an
	// arbitrary same-id run.
	return matches.length === 1 ? matches[0] : undefined;
}

export function directSubagentChildren(
	target: SubagentTarget,
	targets: readonly SubagentTarget[],
): SubagentTarget[] {
	const id = agentId(target);
	if (!id) return [];
	return targets
		.filter(
			(candidate) =>
				candidate !== target &&
				sameProfiledTree(candidate, target) &&
				parentAgentId(candidate) === id &&
				parentSubagentTarget(candidate, targets) === target,
		)
		.sort((a, b) => startedAt(a) - startedAt(b) || a.key.localeCompare(b.key));
}

export function subagentAncestors(
	target: SubagentTarget,
	targets: readonly SubagentTarget[],
): SubagentTarget[] {
	const result: SubagentTarget[] = [];
	const seen = new Set<string>([target.key]);
	let current = parentSubagentTarget(target, targets);
	while (current && !seen.has(current.key)) {
		result.unshift(current);
		seen.add(current.key);
		current = parentSubagentTarget(current, targets);
	}
	return result;
}

export function subagentDescendants(
	target: SubagentTarget,
	targets: readonly SubagentTarget[],
): SubagentTarget[] {
	const result: SubagentTarget[] = [];
	const seen = new Set<string>();
	const visit = (parent: SubagentTarget) => {
		for (const child of directSubagentChildren(parent, targets)) {
			if (seen.has(child.key)) continue;
			seen.add(child.key);
			result.push(child);
			visit(child);
		}
	};
	visit(target);
	return result;
}

/**
 * Present profiled recursive agents as a tree while leaving legacy runs as
 * ordinary root rows. Root targets retain the existing newest-first order;
 * children keep launch order so late grandchildren do not jump above parents.
 */
export function subagentTreeRows(
	targets: readonly SubagentTarget[],
): SubagentTreeRow[] {
	const rows: SubagentTreeRow[] = [];
	const roots = targets.filter((target) => !parentSubagentTarget(target, targets));
	const emitted = new Set<string>();

	const visit = (
		target: SubagentTarget,
		depth: number,
		continuations: readonly boolean[],
		isLast: boolean,
		parent?: SubagentTarget,
	) => {
		if (emitted.has(target.key)) return;
		emitted.add(target.key);
		const children = directSubagentChildren(target, targets);
		const prefix =
			depth === 0
				? ""
				: `${continuations
						.map((continues) => (continues ? "│  " : "   "))
						.join("")}${isLast ? "└─ " : "├─ "}`;
		rows.push({
			target,
			depth,
			prefix,
			parent,
			childCount: children.length,
			descendantCount: subagentDescendants(target, targets).length,
		});
		const childContinuations =
			depth === 0 ? [] : [...continuations, !isLast];
		children.forEach((child, index) =>
			visit(
				child,
				depth + 1,
				childContinuations,
				index === children.length - 1,
				target,
			),
		);
	};

	roots.forEach((root, index) =>
		visit(root, 0, [], index === roots.length - 1),
	);
	// Malformed/cyclic parent metadata must never hide a run.
	for (const target of targets) {
		if (!emitted.has(target.key)) visit(target, 0, [], true);
	}
	return rows;
}
