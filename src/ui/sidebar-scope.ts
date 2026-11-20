import { targetContextNumbers } from "../subagents/target-context.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import { isResidentTargetState } from "./model-context.tsx";

/**
 * What the Context and Model blocks describe while an agent is open. The
 * sidebar shows one model at a time, so the subagent view never prints the
 * main model beside the agent's.
 */
export type SidebarScope = {
	label: string;
	used?: number | undefined;
	limit?: number | undefined;
	model?: string | undefined;
	thinking?: string | undefined;
};

export function sidebarScopeForTarget(target: SubagentTarget): SidebarScope {
	// A resident or parent-waiting child's window is stale; show no numbers.
	const numbers = isResidentTargetState(target.state)
		? undefined
		: targetContextNumbers(target);
	return {
		label: target.run.agentId ? `@${target.run.agentId}` : target.label,
		used: numbers?.used,
		limit: numbers?.limit ?? target.contextWindow,
		model: target.model,
		thinking: target.thinking,
	};
}
