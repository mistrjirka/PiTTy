import { describe, expect, test } from "bun:test";
import path from "node:path";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
	resolveDefaultPiExecutable,
	resolvePiCommand,
} from "../src/pi-command.ts";
import {
	managedChildEnvironment,
	piForkRuntimePaths,
	resolveForkCodeToolExtension,
} from "../src/pi-fork-runtime.ts";
import {
	resolveDisplayRpcLaunch,
	locateDisplayRpcLoader,
	locateManagedChildLauncher,
} from "../src/pi-display/command.ts";
import { resolveBundledPiExtensionPath } from "../src/runtime-paths.ts";

describe("Pi command resolution", () => {
	test("runs JavaScript entries with the selected Node executable", () => {
		expect(
			resolvePiCommand("/tmp/pi-entry.mjs", ["list"], "/node.exe"),
		).toEqual({
			executable: "/node.exe",
			args: ["/tmp/pi-entry.mjs", "list"],
		});
	});

	test("defaults JavaScript entries to Node rather than Bun", () => {
		const command = resolvePiCommand("/tmp/pi-entry.mjs");
		expect(command.executable).toBe(
			process.env.PITTY_NODE_EXECUTABLE ?? "node",
		);
	});

	test("preserves an explicit Pi executable override", () => {
		expect(resolveDefaultPiExecutable({ PI_BIN: "/custom/pi" })).toBe(
			"/custom/pi",
		);
		expect(resolveDefaultPiExecutable({}, () => false)).toBe("pi");
		const env = { HOME: "/test-home" };
		const managed = piForkRuntimePaths(env);
		expect(resolveDefaultPiExecutable(env, () => true)).toBe(
			managed.piExecutable,
		);
		expect(
			resolveDefaultPiExecutable({ ...env, PI_BIN: "/custom/pi" }, () => true),
		).toBe("/custom/pi");
		expect(
			resolveDefaultPiExecutable(
				{ ...env, PITTY_USE_UPSTREAM_PI: "1" },
				() => true,
			),
		).toBe("pi");
		expect(
			resolveForkCodeToolExtension(
				managed.piExecutable,
				env,
				(file) =>
					file === managed.codeToolExtension || file === managed.markerFile,
			),
		).toBe(managed.codeToolExtension);
		expect(
			resolveForkCodeToolExtension(managed.piExecutable, env, () => true),
		).toBe(managed.codeToolExtension);
		const staged = { ...env, PITTY_APP_ROOT: "/opt/pitty" };
		const stagedPaths = piForkRuntimePaths(staged);
		expect(stagedPaths.piExecutable).toBe(
			path.join(
				path.resolve("/opt/pitty"),
				"fork-runtime",
				"pi",
				"dist",
				"cli.js",
			),
		);
		expect(
			resolveDefaultPiExecutable(
				staged,
				(file) => file === stagedPaths.piExecutable,
			),
		).toBe("pi");
		expect(resolveDefaultPiExecutable(staged, () => true)).toBe(
			stagedPaths.piExecutable,
		);
		expect(resolveForkCodeToolExtension("pi", env, () => true)).toBeUndefined();
		expect(
			resolveForkCodeToolExtension(managed.piExecutable, env, () => false),
		).toBeUndefined();
		expect(
			resolveForkCodeToolExtension(
				managed.piExecutable,
				{ ...env, PITTY_DISABLE_FORK_CODE_TOOL: "1" },
				() => true,
			),
		).toBeUndefined();
	});

	test("only managed Pi prepends the private child launcher and preserves both loaders", () => {
		const env = { HOME: "/test-home", PATH: ["/usr/bin", "/bin"].join(path.delimiter) };
		const managed = piForkRuntimePaths(env);
		const launcher = path.resolve("src/pi-display/managed-bin/pi");
		const launch = { node: "/node", launcher, displayLoader: "/display loader.mjs", codeLoader: "/code loader.mjs" };
		const child = managedChildEnvironment(managed.piExecutable, env, launch, () => true, "linux");
		expect(child).toEqual({
			PATH: [path.dirname(launcher), env.PATH].join(path.delimiter),
			PITTY_CHILD_PI_ENTRY: managed.piExecutable,
			PITTY_CHILD_PI_NODE: launch.node,
			PITTY_CHILD_PI_DISPLAY_LOADER: launch.displayLoader,
			PITTY_CHILD_PI_CODE_LOADER: launch.codeLoader,
		});
		expect(managedChildEnvironment("pi", env, launch, () => true, "linux")).toBeUndefined();
		expect(managedChildEnvironment(managed.piExecutable, env, launch, () => false, "linux")).toBeUndefined();
		expect(managedChildEnvironment(managed.piExecutable, env, launch, () => true, "win32")).toBeUndefined();
		expect(() => managedChildEnvironment(managed.piExecutable, env, { node: "/node" }, () => true, "linux")).toThrow("Managed Pi child launcher is missing");
		expect(locateManagedChildLauncher(import.meta.dir, process.cwd())).toBe(launcher);
	});

	(process.platform === "win32" ? test.skip : test)("a descendant invoking bare pi receives the managed entrypoint, loaders, and unmodified arguments", () => {
		const launcher = path.resolve("src/pi-display/managed-bin/pi");
		const env = { HOME: "/test-home", PATH: process.env.PATH };
		const managed = piForkRuntimePaths(env);
		const directory = mkdtempSync(path.join(tmpdir(), "pitty-child-launch-"));
		try {
			const node = path.join(directory, "fake node");
			writeFileSync(node, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
			const child = managedChildEnvironment(managed.piExecutable, env, {
				node, launcher, displayLoader: "/display loader.mjs", codeLoader: "/code loader.mjs",
			}, () => true);
			const result = spawnSync("pi", ["--mode", "rpc", "a b", "$literal"], { env: { ...process.env, ...child }, encoding: "utf8" });
			expect(result.status).toBe(0);
			expect(result.stdout.trimEnd().split("\n")).toEqual([
				"--import=/code loader.mjs", "--import=/display loader.mjs", managed.piExecutable,
				"--mode", "rpc", "a b", "$literal",
			]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("resolves bundled Pi extensions from the install root", () => {
		expect(resolveBundledPiExtensionPath("/opt/pitty", "/opt/pitty/dist")).toBe(
			path.join(
				"/opt/pitty",
				"src",
				"pi-extensions",
				"compaction-observer.mjs",
			),
		);
		expect(resolveBundledPiExtensionPath(undefined, "/opt/pitty/src")).toBe(
			path.join(
				"/opt/pitty",
				"src",
				"pi-extensions",
				"compaction-observer.mjs",
			),
		);
	});

	test("uses a process-local compact history adapter only for recognized Pi npm CLIs", () => {
		const loader = path.resolve("src/pi-display/loader.mjs");
		const root = realpathSync(
			path.resolve("node_modules/@earendil-works/pi-coding-agent"),
		);
		const cli = path.join(root, "dist", "bundle", "cli.js");
		const command = resolveDisplayRpcLaunch(
			cli,
			["--mode", "rpc", "--no-extensions"],
			loader,
			{
				platform: "linux",
				nodeExecutable: "/bin/node",
			},
		);
		expect(command).toBeDefined();
		expect(command?.executable).toBe("/bin/node");
		expect(command?.args).toEqual([
			`--import=${loader}`,
			path.join(root, "dist", "cli.js"),
			"--mode",
			"rpc",
			"--no-extensions",
		]);
		expect(command?.environment.PITTY_DISPLAY_RPC_MODE_PATH).toBe(
			path.join(root, "dist", "modes", "rpc", "rpc-mode.js"),
		);
		expect(command?.piVersion).toBeTruthy();
		expect(
			resolveDisplayRpcLaunch(cli, [], loader, { platform: "win32" }),
		).toBeUndefined();
		expect(
			resolveDisplayRpcLaunch("/does-not-exist/pi", [], loader, {
				platform: "linux",
			}),
		).toBeUndefined();
		expect(locateDisplayRpcLoader(path.join(root, "dist"), process.cwd())).toBe(
			loader,
		);
	});

	test("preserves native Pi commands", () => {
		expect(resolvePiCommand("pi", ["list"], "/node.exe")).toEqual({
			executable: "pi",
			args: ["list"],
		});
	});
});
