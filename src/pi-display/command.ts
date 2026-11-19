import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export type DisplayRpcLaunch = {
	executable: string;
	args: string[];
	environment: { PITTY_DISPLAY_RPC_MODE_PATH: string };
	piVersion: string;
};

/** Resolve only a recognized Pi npm installation, not arbitrary commands. */
function piEntry(
	executable: string,
	searchPath: string | undefined,
): string | undefined {
	const candidates =
		executable.includes("/") || executable.includes("\\")
			? [executable]
			: (searchPath ?? "")
					.split(path.delimiter)
					.filter(Boolean)
					.map((dir) => path.join(dir, executable));
	for (const candidate of candidates) {
		try {
			const resolved = realpathSync(candidate);
			if (
				resolved.endsWith(path.join("dist", "bundle", "cli.js")) ||
				resolved.endsWith(path.join("dist", "cli.js"))
			)
				return resolved;
		} catch {
			// Other executables (including native Pi binaries) use normal RPC.
		}
	}
	return undefined;
}

/**
 * Uses Pi's own unbundled CLI in a separate Node process. The optional loader
 * adds a compact read-only RPC command only inside that process. The global
 * installed `pi` executable and source are not modified.
 */
export function resolveDisplayRpcLaunch(
	executable: string,
	args: readonly string[],
	loaderPath: string,
	options: {
		path?: string | undefined;
		nodeExecutable?: string;
		platform?: string;
	} = {},
): DisplayRpcLaunch | undefined {
	if (
		(options.platform ?? process.platform) === "win32" ||
		!existsSync(loaderPath)
	)
		return undefined;
	const file = piEntry(executable, options.path ?? process.env.PATH);
	if (!file) return undefined;
	const distDir = file.endsWith(path.join("bundle", "cli.js"))
		? path.dirname(path.dirname(file))
		: path.dirname(file);
	const root = path.dirname(distDir);
	const cli = path.join(distDir, "cli.js");
	const rpcModePath = path.join(distDir, "modes", "rpc", "rpc-mode.js");
	try {
		const pkg = JSON.parse(
			readFileSync(path.join(root, "package.json"), "utf8"),
		) as { name?: string; version?: string };
		if (
			pkg.name !== "@earendil-works/pi-coding-agent" ||
			!pkg.version ||
			!existsSync(cli) ||
			!existsSync(rpcModePath)
		)
			return undefined;
		return {
			executable:
				options.nodeExecutable ?? process.env.PITTY_NODE_EXECUTABLE ?? "node",
			args: [`--import=${path.resolve(loaderPath)}`, cli, ...args],
			environment: { PITTY_DISPLAY_RPC_MODE_PATH: realpathSync(rpcModePath) },
			piVersion: pkg.version,
		};
	} catch {
		return undefined;
	}
}

/** Runtime sources are installed under src; Bun's bundle lives under dist. */
function locateProcessLoader(
	filename: string,
	importMetaDir: string,
	appRoot = process.env.PITTY_APP_ROOT,
): string | undefined {
	const roots = [
		...(appRoot ? [path.resolve(appRoot)] : []),
		path.resolve(importMetaDir, "..", ".."),
		path.resolve(importMetaDir, ".."),
	];
	for (const root of roots) {
		const candidate = path.join(root, "src", "pi-display", filename);
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

/** Load an ESM hook only inside PiTTy child processes. */
export function locateDisplayRpcLoader(
	importMetaDir: string,
	appRoot = process.env.PITTY_APP_ROOT,
): string | undefined {
	return locateProcessLoader("loader.mjs", importMetaDir, appRoot);
}

export function locateCodeToolForkLoader(
	importMetaDir: string,
	appRoot = process.env.PITTY_APP_ROOT,
): string | undefined {
	return locateProcessLoader("code-tool-loader.mjs", importMetaDir, appRoot);
}
