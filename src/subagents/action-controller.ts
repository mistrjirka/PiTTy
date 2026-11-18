/** Owns subagent steer/pause/resume/stop policy, not TUI selection or rendering. */
import type { Setter } from "solid-js";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import type { SubagentRun } from "../types.ts";
import type { PendingSteerEntry } from "../state/input-continuity.ts";
import {
	pauseSubagent,
	resumeSubagent,
	steerSubagent,
	stopSubagent,
} from "../subagents/control.ts";
import type { SubagentTarget } from "../subagents/targets.ts";

export type SubagentControlPorts = {
	selectedTarget: () => SubagentTarget | undefined;
	inspectorOpen: () => boolean;
	runtimeAvailable: () => boolean;
	setPendingSteers: Setter<PendingSteerEntry[]>;
	clearDraft: (key: string) => void;
	touch: () => void;
	logger: Pick<DiagnosticLogger, "info" | "error">;
	toast: (
		message: string,
		tone: "info" | "warning" | "success" | "error",
		duration?: number,
	) => void;
};

export function createSubagentControlActions(ports: SubagentControlPorts) {
	const sendSubagentSteer = (message: string) => {
		const target = ports.selectedTarget();
		if (!target?.canSteer) {
			ports.toast("This subagent is not currently steerable", "warning");
			return;
		}
		try {
			const request = steerSubagent(target.run, message, target.stepIndex);
			ports.setPendingSteers((entries) => [
				...entries,
				{
					requestId: request.requestId,
					targetKey: target.key,
					runId: target.run.runId,
					text: message.trim(),
					submittedAt: request.submittedAt,
					baselineSteerCount: request.baselineSteerCount,
				},
			]);
			ports.clearDraft(target.key);
			ports.touch();
			ports.logger.info("subagent.steer_requested", {
				runId: target.run.runId,
				index: target.stepIndex,
				agent: target.label,
				requestId: request.requestId,
			});
			ports.toast(`Steering queued for ${target.label}`, "success");
		} catch (error) {
			ports.logger.error("subagent.steer_failed", {
				runId: target.run.runId,
				index: target.stepIndex,
				error,
			});
			ports.toast(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	};

	const subagentControlGuard = (): {
		target?: SubagentTarget;
		run?: SubagentRun;
	} => {
		if (!ports.inspectorOpen()) return {};
		if (!ports.runtimeAvailable()) {
			ports.toast(
				"Install a supported subagent runtime to control child agents",
				"info",
				5000,
			);
			return {};
		}
		const target = ports.selectedTarget();
		const run = target?.run;
		const profiled = run?.control === "profiled";
		const controllableState = profiled
			? ["running", "queued", "waiting", "idle"].includes(run?.state ?? "")
			: run?.state === "running" ||
				run?.state === "paused" ||
				run?.state === "queued";
		const controllable =
			controllableState &&
			(target?.canSteer || (!profiled && run?.state === "paused"));
		const hasControlPath = profiled
			? Boolean(run?.controlDir)
			: Boolean(run?.asyncDir);
		if (
			!target ||
			!run ||
			!controllable ||
			!hasControlPath ||
			run.control === "foreground"
		) {
			ports.toast("No steerable subagent selected", "warning");
			return {};
		}
		return { target, run };
	};

	const requestPauseSubagent = () => {
		const { run } = subagentControlGuard();
		if (!run) return;
		if (run.control === "profiled") {
			ports.toast(
				"Profiled subagents support steer/stop, not pause/resume",
				"info",
			);
			return;
		}
		if (run.state !== "running") {
			ports.toast("Only running subagents can be paused", "warning");
			return;
		}
		try {
			pauseSubagent(run);
			ports.logger.info("subagent.pause_requested", {
				runId: run.runId,
				agent: run.agent,
				pid: run.pid,
			});
			ports.toast(`Pause requested for ${run.agent ?? run.runId}`, "warning");
		} catch (error) {
			ports.logger.error("subagent.pause_failed", { runId: run.runId, error });
			ports.toast(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	};

	const requestResumeSubagent = () => {
		const { run } = subagentControlGuard();
		if (!run) return;
		if (run.control === "profiled") {
			ports.toast(
				"Profiled subagents support steer/stop, not pause/resume",
				"info",
			);
			return;
		}
		if (run.state !== "paused") {
			ports.toast("Only paused subagents can be resumed", "warning");
			return;
		}
		try {
			resumeSubagent(run);
			ports.logger.info("subagent.resume_requested", {
				runId: run.runId,
				agent: run.agent,
				pid: run.pid,
			});
			ports.toast(`Resume requested for ${run.agent ?? run.runId}`, "info");
		} catch (error) {
			ports.logger.error("subagent.resume_failed", { runId: run.runId, error });
			ports.toast(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	};

	const requestStopSubagent = () => {
		const { run } = subagentControlGuard();
		if (!run) return;
		const stoppable =
			run.control === "profiled"
				? ["running", "queued", "waiting", "idle"].includes(run.state)
				: ["running", "paused", "queued"].includes(run.state);
		if (!stoppable) {
			ports.toast("No active controllable subagent selected", "warning");
			return;
		}
		try {
			stopSubagent(run);
			ports.logger.info("subagent.stop_requested", {
				runId: run.runId,
				agent: run.agent,
				pid: run.pid,
			});
			ports.toast(`Stop requested for ${run.agent ?? run.runId}`, "warning");
		} catch (error) {
			ports.logger.error("subagent.stop_failed", { runId: run.runId, error });
			ports.toast(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	};

	return {
		sendSubagentSteer,
		requestPauseSubagent,
		requestResumeSubagent,
		requestStopSubagent,
	};
}
