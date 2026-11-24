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

/** Only a selected managed Pi gets a private child launcher. No global PATH changes. */
export function managedChildEnvironment(
	selectedPi: string,
	env: NodeJS.ProcessEnv,
	launch: { node: string; launcher?: string | undefined; displayLoader?: string | undefined; codeLoader?: string | undefined },
	fileExists: (file: string) => boolean = existsSync,
	platform = process.platform,
): Record<string, string> | undefined {
	if (platform === "win32") return undefined;
	const managed = piForkRuntimePaths(env);
	if (path.resolve(selectedPi) !== managed.piExecutable || !fileExists(managed.markerFile)) return undefined;
	if (!launch.launcher || !fileExists(launch.launcher)) {
		throw new Error("Managed Pi child launcher is missing; reinstall PiTTy.");
	}
	const directory = path.dirname(launch.launcher);
	return {
		PATH: [directory, ...(env.PATH ?? "").split(path.delimiter).filter((entry) => entry && entry !== directory)].join(path.delimiter),
		PITTY_CHILD_PI_ENTRY: managed.piExecutable,
		PITTY_CHILD_PI_NODE: launch.node,
		PITTY_CHILD_PI_DISPLAY_LOADER: launch.displayLoader ?? "",
		PITTY_CHILD_PI_CODE_LOADER: launch.codeLoader ?? "",
	};
}
