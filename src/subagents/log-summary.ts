/** Compact diagnostics for one direct or nested subagent. */
import type { SubagentRun } from "../types.ts";
import { subagentActivityAt } from "./transcript.ts";

export function subagentLogSummary(run: SubagentRun): Record<string, unknown> {
	return {
		runId: run.runId,
		agent: run.agent,
		mode: run.mode,
		state: run.state,
		activityState: run.activityState,
		lastActivityAt: subagentActivityAt(run),
		model: run.model,
		thinking: run.thinking,
		contextWindow: run.contextWindow,
		currentTool: run.currentTool,
		activeTools: run.activeTools,
		currentPath: run.currentPath,
		currentStep: run.currentStep,
		chainStepCount: run.chainStepCount,
		turnCount: run.turnCount,
		toolCount: run.toolCount,
		totalTokens: run.totalTokens,
		error: run.error,
		steps: run.steps.map((step) => ({
			index: step.index,
			agent: step.agent,
			status: step.status,
			activityState: step.activityState,
			lastActivityAt: subagentActivityAt(run, step.index),
			model: step.model,
			thinking: step.thinking,
			contextWindow: step.contextWindow,
			currentTool: step.currentTool,
			currentPath: step.currentPath,
			turnCount: step.turnCount,
			toolCount: step.toolCount,
			tokens: step.tokens?.total,
			error: step.error,
		})),
	};
}
