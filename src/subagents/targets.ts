/** Backward-compatible exports. Implementations are grouped by responsibility. */
export {
	targetContextPercent,
	targetContextUsage,
	targetsForTool,
} from "./target-context.ts";
export { subagentTargets } from "./target-discovery.ts";
export type { OwnedSubagentTargets } from "./target-identity.ts";
export {
	ownedSubagentTargetsForItems,
	reconcileSubagentSelection,
	subagentRunIdFromTool,
	subagentTargetIdentity,
} from "./target-identity.ts";
export type { SubagentTarget } from "./target-metadata.ts";
