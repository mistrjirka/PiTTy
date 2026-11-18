/** Own timed UI refresh and event-loop stall diagnostics, not Pi process lifetime. */
import type { Setter } from "solid-js";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import type { RpcSessionState, SubagentRun } from "../types.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { ConversationTabRuntime } from "./runtime.ts";
import { spinnerFrames } from "../ui/spinner.ts";

export interface UiMonitoringPorts {
	logger: Pick<DiagnosticLogger, "warn" | "debug">;
	subagentsInstalled: boolean;
	refreshState: () => Promise<boolean>;
	refreshSubagentRuns: (state: RpcSessionState) => void;
	sessionState: () => RpcSessionState | undefined;
	setSpinnerIndex: Setter<number>;
	setClockNow: Setter<number>;
	status: () => string;
	streaming: () => boolean;
	activeRuntime: () => ConversationTabRuntime;
	runs: () => SubagentRun[];
	availableSubagentTargets: () => SubagentTarget[];
}

export function startUiMonitoring(ports: UiMonitoringPorts): () => void {
	let statsTimer: ReturnType<typeof setInterval> | undefined;
	let subagentsTimer: ReturnType<typeof setInterval> | undefined;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	let stallProbeTimer: ReturnType<typeof setInterval> | undefined;
	let spinnerTimer: ReturnType<typeof setInterval> | undefined;
	let clockTimer: ReturnType<typeof setInterval> | undefined;
	statsTimer = setInterval(() => void ports.refreshState(), 10_000);
	subagentsTimer = setInterval(() => {
		if (!ports.subagentsInstalled) return;
		const state = ports.sessionState();
		if (state) ports.refreshSubagentRuns(state);
	}, 750);
	spinnerTimer = setInterval(() => {
		ports.setSpinnerIndex((value) => (value + 1) % spinnerFrames.length);
	}, 250);
	clockTimer = setInterval(() => ports.setClockNow(Date.now()), 1000);
	// Event-loop stall probe: a 100ms timer that fires late means the UI thread was
	// busy (render, sync I/O, JSON parsing). Stalls are logged as they happen and the
	// worst one since the previous heartbeat is attached to it.
	let probeExpectedAt = Date.now() + 100;
	let worstStallMs = 0;
	stallProbeTimer = setInterval(() => {
		const now = Date.now();
		const lag = now - probeExpectedAt;
		probeExpectedAt = now + 100;
		if (lag > worstStallMs) worstStallMs = lag;
		if (lag >= 250)
			ports.logger.warn("ui.event_loop_stall", {
				lagMs: lag,
				status: ports.status(),
				streaming: ports.streaming(),
			});
	}, 100);
	heartbeatTimer = setInterval(() => {
		const stallMs = worstStallMs;
		worstStallMs = 0;
		ports.logger.debug("ui.heartbeat", {
			worstEventLoopStallMs: stallMs,
			status: ports.status(),
			streaming: ports.streaming(),
			messages: ports.activeRuntime().conversation.items.length,
			subagents: ports.runs().length, // legacy/mission runs only
			profiledSubagentTargets: ports.availableSubagentTargets().length,
			activeSubagents: ports
				.availableSubagentTargets()
				.filter((target) => target.active).length,
			backgroundTasks: ports.activeRuntime().background?.tasks.length ?? 0,
			activeBackgroundTasks:
				ports
					.activeRuntime()
					.background?.tasks.filter((task) => task.state === "running")
					.length ?? 0,
			memoryUsage: process.memoryUsage(),
		});
	}, 30_000);

	return () => {
		if (statsTimer) clearInterval(statsTimer);
		if (subagentsTimer) clearInterval(subagentsTimer);
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		if (stallProbeTimer) clearInterval(stallProbeTimer);
		if (spinnerTimer) clearInterval(spinnerTimer);
		if (clockTimer) clearInterval(clockTimer);
	};
}
