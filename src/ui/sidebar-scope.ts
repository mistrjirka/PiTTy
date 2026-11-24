import type { RequestPerformance } from "../tabs/request-metrics.ts";
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
	lastRequestPerformance?: RequestPerformance | undefined;
	modelIdentity?: { provider: string; id: string } | undefined;
};

export function sidebarScopeForTarget(target: SubagentTarget): SidebarScope {
	// A resident or parent-waiting child's window is stale; show no numbers.
	const numbers = isResidentTargetState(target.state)
		? undefined
		: targetContextNumbers(target);
	const lastRequestPerformance = target.step ? undefined : target.run.lastRequestPerformance;
	const reportedProvider = lastRequestPerformance?.provider;
	const reportedModel = lastRequestPerformance?.modelId;
	const separator = target.model?.indexOf("/") ?? -1;
	const modelIdentity = target.model && separator > 0
		? { provider: target.model.slice(0, separator), id: target.model.slice(separator + 1) }
		: reportedProvider && reportedModel && (!target.model || target.model === reportedModel)
			? { provider: reportedProvider, id: reportedModel }
			: undefined;
	return {
		lastRequestPerformance,
		modelIdentity,
		label: target.run.agentId ? `@${target.run.agentId}` : target.label,
		used: numbers?.used,
		limit: numbers?.limit ?? target.contextWindow,
		model: target.model ?? (modelIdentity ? `${modelIdentity.provider}/${modelIdentity.id}` : undefined),
		thinking: target.thinking,
	};
}
