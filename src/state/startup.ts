import { PiRpcTimeoutError } from "../rpc/pi-rpc-client.ts";

export type StartupFailureReason = "timeout" | "exit" | "protocol" | "error";
export type StartupPhase =
	| { kind: "starting" }
	| { kind: "history" }
	| { kind: "ready" }
	| { kind: "failed"; reason: StartupFailureReason };

export class StartupDeadlineError extends Error {
	constructor() {
		super("Pi startup deadline exceeded.");
		this.name = "StartupDeadlineError";
	}
}

export function withStartupDeadline<T>(
	operation: Promise<T>,
	deadlineMs: number,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new StartupDeadlineError()), deadlineMs);
		operation.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

export function startupFailureReason(
	error: unknown,
	current: StartupPhase,
): StartupFailureReason {
	if (current.kind === "failed") return current.reason;
	if (error instanceof StartupDeadlineError) return "timeout";
	if (error instanceof PiRpcTimeoutError) return "timeout";
	return "error";
}

export function startupHeading(phase: StartupPhase): string {
	if (phase.kind === "starting") return "Starting Pi runtime";
	if (phase.kind === "history") return "Loading conversation";
	if (phase.kind === "failed" && phase.reason === "timeout")
		return "Pi startup timed out";
	if (phase.kind === "failed") return "Pi startup failed";
	return "Ready";
}

export function startupExplanation(phase: StartupPhase): string {
	if (phase.kind === "starting")
		return "Loading Pi extensions and session state. Large histories can take a while.";
	if (phase.kind === "history")
		return "Pi is ready. Restoring the conversation before enabling controls.";
	if (phase.kind === "failed" && phase.reason === "timeout")
		return "Startup did not finish before the deadline. Pi may still be loading extensions or conversation history; check slow extensions or clean up old sessions, then retry.";
	if (phase.kind === "failed")
		return "Check the Pi process and diagnostics, then retry.";
	return "";
}

export type SingleFlight<T> = { run: () => Promise<T> };

export function createSingleFlight<T>(
	operation: () => Promise<T>,
): SingleFlight<T> {
	let inFlight: Promise<T> | undefined;
	return {
		run: () => {
			if (inFlight) return inFlight;
			const pending = Promise.resolve().then(operation);
			inFlight = pending;
			void pending.then(
				() => {
					if (inFlight === pending) inFlight = undefined;
				},
				() => {
					if (inFlight === pending) inFlight = undefined;
				},
			);
			return pending;
		},
	};
}
