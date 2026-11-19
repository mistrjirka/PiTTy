/** One source of truth for interactive subagent controls.
 * This is a pure visibility/eligibility check. The actual file-control writer
 * performs separate path validation before executing any action.
 */
import type { SubagentTarget } from "./targets.ts";

export interface SubagentControlAvailability {
	readonly profiled: boolean;
	readonly canControl: boolean;
	readonly canPause: boolean;
	readonly canResume: boolean;
	readonly canStop: boolean;
}

export function subagentControlAvailability(
	target: SubagentTarget | undefined,
): SubagentControlAvailability {
	if (!target)
		return {
			profiled: false,
			canControl: false,
			canPause: false,
			canResume: false,
			canStop: false,
		};
	const run = target.run;
	const profiled = run.control === "profiled";
	const activeState = profiled
		? ["running", "queued", "waiting", "idle"].includes(run.state)
		: ["running", "paused", "queued"].includes(run.state);
	const writable =
		run.control !== "foreground" &&
		(profiled ? Boolean(run.controlDir) : Boolean(run.asyncDir));
	const canControl =
		activeState &&
		writable &&
		(target.canSteer || (!profiled && run.state === "paused"));
	return {
		profiled,
		canControl,
		canPause: canControl && !profiled && run.state === "running",
		canResume: canControl && !profiled && run.state === "paused",
		canStop: canControl,
	};
}
