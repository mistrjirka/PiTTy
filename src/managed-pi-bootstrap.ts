import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { piForkRuntimePaths } from "./pi-fork-runtime.ts";

/**
 * The old PiTTy launcher can activate an upgrade without knowing about its
 * managed Pi fork. Run this before choosing the Pi executable, including on
 * the first launch after an old-version upgrade. Never write to ~/.pi.
 */
export function bootstrapManagedPi(
	explicitPi = false,
	env: NodeJS.ProcessEnv = process.env,
): void {
	if (
		explicitPi ||
		!env.PITTY_APP_ROOT ||
		env.PI_BIN ||
		env.PITTY_USE_UPSTREAM_PI === "1" ||
		env.PITTY_NO_MANAGED_PI === "1"
	)
		return;

	const appRoot = path.resolve(env.PITTY_APP_ROOT);
	const marker = piForkRuntimePaths(env).markerFile;
	const script = path.join(appRoot, "scripts", "ensure-managed-pi.mjs");
	if (existsSync(marker) || !existsSync(script)) return;

	const installed = spawnSync(
		env.PITTY_NODE_EXECUTABLE || "node",
		[script, "--install-root", appRoot],
		{ cwd: appRoot, env, encoding: "utf8", timeout: 120_000 },
	);
	if (installed.status !== 0 && installed.status !== 2) {
		const message = (
			installed.stderr ||
			installed.stdout ||
			installed.error?.message ||
			"unknown error"
		).trim();
		console.warn(
			"PiTTy: managed Pi could not be initialized; using upstream Pi. " +
				message.slice(-450),
		);
	}
}
