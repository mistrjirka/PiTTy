/** One-flight RPC state refresh and PID-scoped subagent roster updates. */
import type { Accessor, Setter } from "solid-js";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import { PiRpcTimeoutError } from "../rpc/pi-rpc-client.ts";
import {
	createSingleFlight,
	type SingleFlight,
	type StartupPhase,
} from "../state/startup.ts";
import { listSubagentRuns } from "../subagents/artifacts.ts";
import { subagentLogSummary } from "../subagents/log-summary.ts";
import { mergeMissionRuns } from "../subagents/missions.ts";
import {
	reconcileSubagentSelection,
	type SubagentTarget,
	subagentTargets,
} from "../subagents/targets.ts";
import { subagentTreeRows } from "../subagents/tree.ts";
import type {
	RpcSessionState,
	SubagentRun,
	Toast,
	ToolItem,
} from "../types.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

export interface RuntimeRefreshPorts {
	logger: DiagnosticLogger;
	cwd: string;
	subagentsInstalled: boolean;
	reconcileSteers: (targets: readonly SubagentTarget[]) => void;
	pendingSteerCount: () => number;
	setRuns: (nextRuns: SubagentRun[]) => void;
	subagentTools: () => ToolItem[];
	contextWindowForModel: (model: string | undefined) => number | undefined;
	activeRuntime: () => ConversationTabRuntime;
	selectedTargetKey: () => string | undefined;
	availableSubagentTargets: () => SubagentTarget[];
	setSelectedTargetKey: (key: string | undefined) => void;
	rememberThinkingLevel: (runtime: ConversationTabRuntime) => void;
	tabRuntimeIsActive: (id: string) => boolean;
	setStatus: (value: string) => void;
	setRpcAvailable: Setter<boolean>;
	touch: () => void;
	toast: (text: string, tone: Toast["tone"], durationMs?: number) => void;
	startupPhase: Accessor<StartupPhase>;
}

export interface RuntimeRefreshActions {
	refreshSubagentRuns: (state: RpcSessionState) => void;
	refreshState: (runtime?: ConversationTabRuntime) => Promise<boolean>;
	dropRefreshCoordinator: (runtimeId: string) => void;
}

export function createRuntimeRefresh(
	ports: RuntimeRefreshPorts,
): RuntimeRefreshActions {
	let lastRunsDigest = "";
	let lastRefreshTimeoutNotice = 0;
	const refreshSubagentRuns = (state: RpcSessionState): void => {
		const identity = {
			sessionId: state.sessionId,
			...(state.sessionFile ? { sessionFile: state.sessionFile } : {}),
		};
		const nextRuns = ports.subagentsInstalled
			? mergeMissionRuns(listSubagentRuns(identity), identity, ports.cwd)
			: [];
		const summaries = nextRuns.map(subagentLogSummary);
		const digest = JSON.stringify(summaries);
		const changed = digest !== lastRunsDigest;
		// The background roster poll runs every 750 ms. Do not repeatedly
		// scan the filesystem to build targets when neither the roster nor
		// pending local steers need reconciliation.
		if (!changed && ports.pendingSteerCount() === 0) return;
		const nextTargets = subagentTargets(nextRuns, ports.subagentTools(), {
			contextWindowForModel: ports.contextWindowForModel,
			ownerPid: ports.activeRuntime().client.getProcessPid(),
		});
		if (ports.pendingSteerCount() > 0) ports.reconcileSteers(nextTargets);
		if (!changed) return;
		lastRunsDigest = digest;
		ports.setRuns(nextRuns);
		const nextDisplayTargets = subagentTreeRows(nextTargets).map(
			(row) => row.target,
		);
		ports.setSelectedTargetKey(
			reconcileSubagentSelection(
				ports.selectedTargetKey(),
				ports.availableSubagentTargets(),
				nextDisplayTargets,
			),
		);
		ports.logger.info("subagents.changed", { runs: summaries });
	};
	const refreshOperation = async (
		target: ConversationTabRuntime,
	): Promise<boolean> => {
		const version = target.eventVersion;
		try {
			const [state, stats] = await Promise.all([
				target.client.getState(),
				target.client.getSessionStats(),
			]);
			if (target.eventVersion !== version) return true;
			const streamingChanged =
				target.conversation.isStreaming !== state.isStreaming;
			target.sessionState = state;
			ports.rememberThinkingLevel(target);
			target.sessionStats = stats;
			target.conversation.isStreaming = state.isStreaming;
			if (streamingChanged) target.onConversationChange();
			delete target.lastError;
			if (ports.tabRuntimeIsActive(target.id)) {
				ports.setStatus(state.isStreaming ? "working" : "ready");
				refreshSubagentRuns(state);
				ports.setRpcAvailable(true);
				ports.touch();
			}
			return true;
		} catch (error) {
			if (target.eventVersion !== version) return true;
			const message = error instanceof Error ? error.message : String(error);
			target.lastError = error instanceof Error ? error : new Error(message);
			ports.logger.error("ui.refresh_state_failed", {
				runtimeId: target.id,
				error,
			});
			if (!ports.tabRuntimeIsActive(target.id)) return false;
			if (error instanceof PiRpcTimeoutError) {
				ports.setStatus("Pi busy; state refresh delayed");
				const now = Date.now();
				if (now - lastRefreshTimeoutNotice >= 60_000) {
					lastRefreshTimeoutNotice = now;
					ports.toast(
						"Pi is still running, but its state response is delayed.",
						"warning",
						5000,
					);
				}
				return false;
			}
			ports.setStatus("Pi disconnected");
			ports.setRpcAvailable(false);
			ports.toast(message, "error", 5000);
			return false;
		}
	};
	const refreshCoordinators = new Map<string, SingleFlight<boolean>>();
	const refreshState = (
		target: ConversationTabRuntime = ports.activeRuntime(),
	): Promise<boolean> => {
		if (ports.startupPhase().kind !== "ready" || !target.startupResolved)
			return Promise.resolve(false);
		let coordinator = refreshCoordinators.get(target.id);
		if (!coordinator) {
			coordinator = createSingleFlight(() => refreshOperation(target));
			refreshCoordinators.set(target.id, coordinator);
		}
		return coordinator.run();
	};

	const dropRefreshCoordinator = (runtimeId: string): void => {
		refreshCoordinators.delete(runtimeId);
	};
	return { refreshSubagentRuns, refreshState, dropRefreshCoordinator };
}
