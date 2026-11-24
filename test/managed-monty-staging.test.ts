import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const supportedTest = process.platform === "linux" || process.platform === "darwin" ? test : test.skip;
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function write(file: string, text: string, mode?: number) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text, mode === undefined ? undefined : { mode });
}

describe("managed Pi installer entrypoint", () => {
	supportedTest("runs through a symlinked parent directory", () => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), "pitty-installer-entry-")));
		try {
			const alias = path.join(root, "release-link");
			const app = path.join(root, "app");
			symlinkSync(repo, alias, "dir");
			for (const release of [repo, alias]) {
				const result = spawnSync(process.env.PITTY_NODE_EXECUTABLE || "node", [
					path.join(release, "scripts/ensure-managed-pi.mjs"), "--install-root", app,
				], {
					env: { ...process.env, PITTY_NO_MANAGED_PI: "1" },
					encoding: "utf8",
					timeout: 10_000,
				});
				expect(result.status).toBe(0);
				expect(result.stdout).toContain("PiTTy managed Pi: skipped");
				expect(result.stderr).toBe("");
			}
			expect(existsSync(app)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("can be imported without a file entrypoint", () => {
		const installer = new URL("../scripts/ensure-managed-pi.mjs", import.meta.url).href;
		for (const argv of ["delete process.argv[1];", "process.argv[1] = 'missing-installer-entrypoint';"]) {
			const result = spawnSync(process.env.PITTY_NODE_EXECUTABLE || "node", [
				"--input-type=module", "-e", argv + "await import(" + JSON.stringify(installer) + "); console.log('imported');",
			], {
				env: { ...process.env, PITTY_NO_MANAGED_PI: "1" },
				encoding: "utf8",
				timeout: 10_000,
			});
			expect(result.status).toBe(0);
			expect(result.stdout).toBe("imported\n");
			expect(result.stderr).toBe("");
		}
	});
});

describe("private Monty dependency staging", () => {
	const scenarios: { name: string; exit: number | null; error: string; budget?: number }[] = [
		{ name: "npm failure", exit: 23, error: "npm exited 23" },
		{ name: "missing native package after npm success", exit: 0, error: "failed its native worker/state check" },
		{ name: "npm timeout", exit: null, error: "download timed out", budget: 2500 },
	];
	for (const scenario of scenarios) {
		supportedTest(scenario.name + " preserves the old runtime and isolates npm", () => {
			const root = realpathSync(mkdtempSync(path.join(tmpdir(), "pitty-private-monty-")));
			try {
				const release = path.join(root, "release");
				const app = path.join(root, "app");
				const upstreamPi = path.join(root, "upstream-pi");
				const upstreamCode = path.join(root, "upstream-code");
				const fakeBin = path.join(root, "bin");
				const record = path.join(root, "npm-call.json");
				const userConfig = path.join(root, "user-npmrc");
				const originalConfig = "//registry.npmjs.org/:_authToken=synthetic-unused-token\n";
				const manifest = JSON.parse(readFileSync(path.join(repo, "vendor/managed-fork-manifest.json"), "utf8"));
				const dependency = JSON.parse(readFileSync(path.join(repo, "vendor/monty-runtime/package.json"), "utf8"));
				manifest.monty = {
					version: dependency.dependencies["@pydantic/monty"],
					packageFile: "vendor/monty-runtime/package.json",
					lockFile: "vendor/monty-runtime/package-lock.json",
				};
				manifest.pi.modules = [];
				manifest.codeTool.modules = [];
				manifest.patchFiles = {};
				mkdirSync(path.join(release, "scripts"), { recursive: true });
				let installer = readFileSync(path.join(repo, "scripts/ensure-managed-pi.mjs"), "utf8");
				if (scenario.budget !== undefined) {
					// Exercise the same shared deadline without making the unit test wait 90 seconds.
					const original = "const PREPARATION_TIMEOUT_MS = 90_000;";
					expect(installer).toContain(original);
					installer = installer.replace(original, "const PREPARATION_TIMEOUT_MS = " + scenario.budget + ";");
				}
				write(path.join(release, "scripts/ensure-managed-pi.mjs"), installer);
				cpSync(path.join(repo, "scripts/private-pi-base.mjs"), path.join(release, "scripts/private-pi-base.mjs"));
				cpSync(path.join(repo, "scripts/check-managed-monty.mjs"), path.join(release, "scripts/check-managed-monty.mjs"));
				for (const file of [manifest.monty.packageFile, manifest.monty.lockFile]) {
					mkdirSync(path.dirname(path.join(release, file)), { recursive: true });
					cpSync(path.join(repo, file), path.join(release, file));
					manifest.patchFiles[file] = sha(path.join(release, file));
				}
				write(path.join(release, "vendor/managed-fork-manifest.json"), JSON.stringify(manifest));
				write(path.join(upstreamPi, "package.json"), JSON.stringify({
					name: "@earendil-works/pi-coding-agent", version: manifest.pi.version,
				}));
				write(path.join(upstreamPi, "dist/cli.js"), "console.log(" + JSON.stringify(manifest.pi.version) + ");\n");
				write(path.join(upstreamPi, "node_modules/typebox/package.json"), '{"name":"typebox","version":"0.0.0"}');
				write(path.join(upstreamCode, "package.json"), JSON.stringify({
					name: "pi-code-tool", version: manifest.codeTool.version, type: "module",
					dependencies: { "@pydantic/monty": "^0.0.18" },
				}));
				write(path.join(upstreamCode, "dist/pi/extension.js"), "export {};\n");
				write(path.join(app, "fork-runtime/pitty-fork-runtime.json"), '{"oldRuntime":true}\n');
				write(path.join(app, "fork-runtime/keep.txt"), "previous working runtime");
				write(userConfig, originalConfig);
				write(path.join(fakeBin, "npm"), [
					"#!/usr/bin/env node",
					"const fs = require('node:fs');",
					"fs.writeFileSync(" + JSON.stringify(record) + ", JSON.stringify({",
					"  cwd: process.cwd(), args: process.argv.slice(2),",
					"  authPresent: ['NPM_TOKEN','NODE_AUTH_TOKEN'].some(key => process.env[key] !== undefined),",
					"  npmOverridesPresent: Object.keys(process.env).some(key => /^npm_config_/i.test(key)),",
					"}));",
					"console.error('SYNTHETIC_NPM_DIAGNOSTIC_SECRET');",
					scenario.exit === null ? "setInterval(() => {}, 1000);" : "process.exit(" + scenario.exit + ");",
					"",
				].join("\n"), 0o755);
				const originalPi = sha(path.join(upstreamPi, "package.json"));
				const originalCode = sha(path.join(upstreamCode, "package.json"));
				const node = process.env.PITTY_NODE_EXECUTABLE || "node";
				const result = spawnSync(node, [path.join(release, "scripts/ensure-managed-pi.mjs"), "--install-root", app], {
					cwd: release,
					env: {
						...process.env,
						PATH: fakeBin + path.delimiter + (process.env.PATH ?? ""),
						PITTY_USE_UPSTREAM_PI: "0",
						PITTY_NO_MANAGED_PI: "0",
						PITTY_UPSTREAM_PI_ROOT: upstreamPi,
						PITTY_UPSTREAM_CODE_TOOL_ROOT: upstreamCode,
						NPM_CONFIG_GLOBAL: "true",
						NPM_CONFIG_USERCONFIG: userConfig,
						NPM_CONFIG_OMIT: "optional",
						NPM_TOKEN: "synthetic-unused-token",
						NODE_AUTH_TOKEN: "synthetic-unused-token",
					},
					encoding: "utf8",
					timeout: 20_000,
				});
				expect(result.status).toBe(1);
				expect(result.stderr).toContain(scenario.error);
				expect(result.stderr + result.stdout).not.toContain("SYNTHETIC_NPM_DIAGNOSTIC_SECRET");
				expect(result.stderr + result.stdout).not.toContain("synthetic-unused-token");
				const invocation = JSON.parse(readFileSync(record, "utf8")) as {
					cwd: string; args: string[]; authPresent: boolean; npmOverridesPresent: boolean;
				};
				expect(invocation.cwd.startsWith(path.join(app, ".fork-stage-"))).toBe(true);
				expect(invocation.args).toContain("--ignore-scripts");
				expect(invocation.args).toContain("--include=optional");
				expect(invocation.args).toContain("--omit=dev");
				expect(invocation.args).toContain("--global=false");
				expect(invocation.args).toContain("--no-audit");
				expect(invocation.args).toContain("--no-fund");
				expect(invocation.args).toContain("--cache=" + path.join(invocation.cwd, "npm-cache"));
				expect(invocation.args).toContain("--userconfig=" + path.join(invocation.cwd, "npm-user-config"));
				expect(invocation.args).toContain("--globalconfig=" + path.join(invocation.cwd, "npm-global-config"));
				expect(invocation.authPresent).toBe(false);
				expect(invocation.npmOverridesPresent).toBe(false);
				expect(readFileSync(userConfig, "utf8")).toBe(originalConfig);
				expect(sha(path.join(upstreamPi, "package.json"))).toBe(originalPi);
				expect(sha(path.join(upstreamCode, "package.json"))).toBe(originalCode);
				expect(readFileSync(path.join(app, "fork-runtime/keep.txt"), "utf8")).toBe("previous working runtime");
				expect(readFileSync(path.join(app, "fork-runtime/pitty-fork-runtime.json"), "utf8")).toBe('{"oldRuntime":true}\n');
				expect(readdirSync(app).filter(name => name.startsWith(".fork-stage-"))).toEqual([]);
				expect(existsSync(path.join(app, ".fork-runtime-backup"))).toBe(false);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	}
});
