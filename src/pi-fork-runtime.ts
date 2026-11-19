import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type PiForkRuntimePaths = {
	piExecutable: string;
	codeToolExtension: string;
};

/** PiTTy-managed fork builds do not replace the user's global Pi executable. */
export function piForkRuntimePaths(
	env: NodeJS.ProcessEnv = process.env,
): PiForkRuntimePaths {
	const home = env.HOME || env.USERPROFILE || homedir();
	const root = path.resolve(
		env.PITTY_FORK_RUNTIME_DIR ||
			path.join(home, ".local", "share", "pitty-forks"),
	);
	return {
		piExecutable: path.join(root, "pi", "dist", "cli.js"),
		codeToolExtension: path.join(
			root,
			"pi-code-tool",
			"dist",
			"pi",
			"extension.js",
		),
	};
}

/** Load our forked code tool only when our Pi fork is the selected runtime. */
export function resolveForkCodeToolExtension(
	selectedPi: string,
	env: NodeJS.ProcessEnv = process.env,
	fileExists: (file: string) => boolean = existsSync,
): string | undefined {
	if (env.PITTY_DISABLE_FORK_CODE_TOOL === "1") return undefined;
	const installed = piForkRuntimePaths(env);
	if (
		path.resolve(selectedPi) !== installed.piExecutable ||
		!fileExists(installed.codeToolExtension)
	)
		return undefined;
	// The user may already have a wrapper registering the code tool with autoApprove.
	// The managed installer redirects that wrapper to our fork. Loading a second
	// explicit copy would crash Pi with a duplicate tool registration error.
	const home = env.HOME || env.USERPROFILE || homedir();
	const agentDir = env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent");
	if (
		fileExists(path.join(agentDir, "extensions", "pi-code-tool-autoapprove.ts"))
	)
		return undefined;
	return installed.codeToolExtension;
}
