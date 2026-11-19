import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type PiForkRuntimePaths = {
	piExecutable: string;
	codeToolExtension: string;
	markerFile: string;
};

/**
 * The release-managed runtime lives inside PiTTy's installation, so upgrades
 * stage it and roll it back with the app. Keep the former standalone location
 * for source checkouts and manual installs.
 */
export function piForkRuntimePaths(
	env: NodeJS.ProcessEnv = process.env,
): PiForkRuntimePaths {
	const home = env.HOME || env.USERPROFILE || homedir();
	const root = path.resolve(
		env.PITTY_FORK_RUNTIME_DIR ||
			(env.PITTY_APP_ROOT
				? path.join(env.PITTY_APP_ROOT, "fork-runtime")
				: path.join(home, ".local", "share", "pitty-forks")),
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
		markerFile: path.join(root, "pitty-fork-runtime.json"),
	};
}

/**
 * Return the replacement module for PiTTy's process-local loader.
 * The global extension continues to register its own code tool.
 * We do not register a second copy or modify ~/.pi/agent/extensions.
 */
export function resolveForkCodeToolExtension(
	selectedPi: string,
	env: NodeJS.ProcessEnv = process.env,
	fileExists: (file: string) => boolean = existsSync,
): string | undefined {
	if (env.PITTY_DISABLE_FORK_CODE_TOOL === "1") return undefined;
	const installed = piForkRuntimePaths(env);
	return path.resolve(selectedPi) === installed.piExecutable &&
		fileExists(installed.markerFile) &&
		fileExists(installed.codeToolExtension)
		? installed.codeToolExtension
		: undefined;
}
