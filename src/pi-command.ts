import { existsSync } from "node:fs";
import { piForkRuntimePaths } from "./pi-fork-runtime.ts";

export type PiCommand = {
	executable: string;
	args: string[];
};

export function isJavaScriptEntry(executable: string): boolean {
	return /\.(?:cjs|mjs|js)$/i.test(executable);
}

export function resolvePiCommand(
	executable: string,
	args: string[] = [],
	nodeExecutable = process.env.PITTY_NODE_EXECUTABLE ?? "node",
): PiCommand {
	if (!isJavaScriptEntry(executable)) return { executable, args };
	return { executable: nodeExecutable, args: [executable, ...args] };
}

export function resolveDefaultPiExecutable(
	env: NodeJS.ProcessEnv = process.env,
	fileExists: (file: string) => boolean = existsSync,
): string {
	if (env.PI_BIN) return env.PI_BIN;
	if (env.PITTY_USE_UPSTREAM_PI === "1") return "pi";
	const fork = piForkRuntimePaths(env);
	return fileExists(fork.markerFile) && fileExists(fork.piExecutable)
		? fork.piExecutable
		: "pi";
}
