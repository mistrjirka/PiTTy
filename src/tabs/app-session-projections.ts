/** Per-session RPC projections, model thinking memory, and UI revisions. */

import type { ThinkingLevel } from "../rpc/pi-rpc-client.ts";
import type { AppSignals } from "../state/app-signals.ts";
import { reconcilePendingSteers } from "../state/input-continuity.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { RpcSessionState, SubagentRun } from "../types.ts";
import type { ConversationTabRuntime } from "./runtime.ts";
import { isThinkingLevel } from "./slash-commands.ts";

export interface SessionProjectionPorts {
	cwd: string;
	signals: AppSignals;
	activeRuntime: () => ConversationTabRuntime;
}
function modelThinkingKey(provider: string, modelId: string): string {
	return provider + String.fromCharCode(0) + modelId;
}
export interface AppSessionProjections {
	touch: () => void;
	conversationTouch: (reason?: "stream" | "structure") => void;
	reconcileSteers: (targets: readonly SubagentTarget[]) => void;
	sessionState: () => RpcSessionState | undefined;
	sessionStats: () => ConversationTabRuntime["sessionStats"];
	runs: () => SubagentRun[];
	mcpStatus: () => ConversationTabRuntime["mcpStatus"];
	mcpCounts: () => ConversationTabRuntime["mcpCounts"];
	lastRequestPerformance: () => ConversationTabRuntime["lastRequestPerformance"];
	requestTimingHistory: () => ConversationTabRuntime["timingHistory"];
	setRuns: (runs: SubagentRun[]) => void;
	currentSessionKey: () => string;
	rememberThinkingLevel: (
		runtime: ConversationTabRuntime,
		level?: ThinkingLevel,
	) => void;
	applyRememberedThinkingLevel: (
		runtime: ConversationTabRuntime,
		provider: string,
		modelId: string,
	) => Promise<void>;
}
export function createSessionProjections(
	ports: SessionProjectionPorts,
): AppSessionProjections {
	const { activeRuntime } = ports;
	const {
		revision: [revision, setRevision],
		conversationRevision: [, setConversationRevision],
		conversationStructureRevision: [, setConversationStructureRevision],
		pendingSteers: [, setPendingSteers],
	} = ports.signals;
	const touch = () => setRevision((value) => value + 1);
	const conversationTouch = (reason: "stream" | "structure" = "structure") => {
		setConversationRevision((value) => value + 1);
		if (reason === "structure")
			setConversationStructureRevision((value) => value + 1);
	};
	const reconcileSteers = (nextTargets: readonly SubagentTarget[]) => {
		setPendingSteers((entries) =>
			reconcilePendingSteers(
				entries,
				nextTargets.map((target) => ({
					runId: target.run.runId,
					targetKey: target.key,
					steerCount: target.run.steerCount,
					active: target.active,
				})),
			),
		);
	};

	const sessionState = () => {
		revision();
		return activeRuntime().sessionState;
	};
	const sessionStats = () => {
		revision();
		return activeRuntime().sessionStats;
	};
	const runs = () => {
		revision();
		return activeRuntime().runs;
	};
	const mcpStatus = () => {
		revision();
		return activeRuntime().mcpStatus;
	};
	const mcpCounts = () => {
		revision();
		return activeRuntime().mcpCounts;
	};
	const lastRequestPerformance = () => {
		revision();
		return activeRuntime().lastRequestPerformance;
	};
	const requestTimingHistory = () => {
		revision();
		return activeRuntime().timingHistory;
	};
	const setRuns = (nextRuns: SubagentRun[]) => {
		activeRuntime().runs = nextRuns;
		touch();
	};
	const currentSessionKey = () => sessionState()?.sessionId ?? ports.cwd;
	const rememberThinkingLevel = (
		runtime: ConversationTabRuntime,
		level = runtime.sessionState?.thinkingLevel,
	): void => {
		const model = runtime.sessionState?.model;
		if (model && level && isThinkingLevel(level))
			runtime.effectiveThinkingLevels.set(
				modelThinkingKey(model.provider, model.id),
				level,
			);
	};
	const applyRememberedThinkingLevel = async (
		runtime: ConversationTabRuntime,
		provider: string,
		modelId: string,
	): Promise<void> => {
		const level = runtime.effectiveThinkingLevels.get(
			modelThinkingKey(provider, modelId),
		);
		if (level) await runtime.client.setThinkingLevel(level);
	};

	return {
		touch,
		conversationTouch,
		reconcileSteers,
		sessionState,
		sessionStats,
		runs,
		mcpStatus,
		mcpCounts,
		lastRequestPerformance,
		requestTimingHistory,
		setRuns,
		currentSessionKey,
		rememberThinkingLevel,
		applyRememberedThinkingLevel,
	};
}
