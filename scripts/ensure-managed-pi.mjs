#!/usr/bin/env node
/**
 * Build an isolated Pi + pi-code-tool runtime from the upstream installations
 * already present on the machine, audited fork patches, and a pinned private
 * Monty dependency. Fetch that dependency only when no compatible copy exists.
 * Never write to ~/.pi, global Pi, or sessions.
 *
 * This script is safe to run on every PiTTy startup. It returns immediately
 * when the runtime is current, and falls back to upstream on a version mismatch.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
	accessSync,
	constants,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const releaseRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const manifestName = "pitty-fork-runtime.json";
const manifestPath = path.join(
	releaseRoot,
	"vendor",
	"managed-fork-manifest.json",
);
const safeHash = (file) =>
	createHash("sha256").update(readFileSync(file)).digest("hex");

function packageRootFromEntrypoint(entry) {
	let root;
	try {
		root = path.dirname(realpathSync(entry));
	} catch {
		return undefined;
	}
	for (let i = 0; i < 8; i++) {
		const manifest = path.join(root, "package.json");
		if (existsSync(manifest)) {
			try {
				if (
					JSON.parse(readFileSync(manifest, "utf8")).name ===
					"@earendil-works/pi-coding-agent"
				) {
					return root;
				}
			} catch {
				/* Keep searching parent directories. */
			}
		}
		const parent = path.dirname(root);
		if (root === parent) break;
		root = parent;
	}
	return undefined;
}

function findUpstreamPiPackage(env) {
	// A release can be staged in a separate directory while the installed Pi
	// executable remains the source of truth for matching core dependencies.
	const executable = env.PITTY_UPSTREAM_PI_EXECUTABLE || "pi";
	if (executable.includes("/") || executable.includes("\\")) {
		return packageRootFromEntrypoint(executable);
	}
	for (const base of (env.PATH || "").split(path.delimiter)) {
		if (!base) continue;
		for (const candidate of process.platform === "win32"
			? [executable + ".cmd", executable + ".exe", executable]
			: [executable]) {
			const result = packageRootFromEntrypoint(path.join(base, candidate));
			if (result) return result;
		}
	}
	return undefined;
}

const PREPARATION_TIMEOUT_MS = 90_000;

function stepTimeout(deadline, maximum) {
	const remaining = deadline - Date.now();
	if (remaining <= 0) {
		throw new Error("Managed runtime preparation timed out. Existing runtime was not replaced.");
	}
	return Math.min(maximum, remaining);
}

function nativeMontyPackage() {
	if (!["x64", "arm64"].includes(process.arch)) return undefined;
	if (process.platform === "linux") return "monty-linux-" + process.arch + "-gnu";
	if (process.platform === "darwin") return "monty-darwin-" + process.arch;
	return undefined;
}

function packageFile(root, relative) {
	if (typeof relative !== "string") return undefined;
	const file = path.resolve(root, relative);
	const local = path.relative(root, file);
	return local && !local.startsWith(".." + path.sep) && local !== ".." && !path.isAbsolute(local)
		? file
		: undefined;
}

function lockedMontyDependencies(manifest) {
	const pin = manifest.monty;
	const definition = JSON.parse(readFileSync(path.join(releaseRoot, pin.packageFile), "utf8"));
	const lock = JSON.parse(readFileSync(path.join(releaseRoot, pin.lockFile), "utf8"));
	if (
		definition.dependencies?.["@pydantic/monty"] !== pin.version ||
		lock.packages?.[""]?.dependencies?.["@pydantic/monty"] !== pin.version ||
		lock.packages?.["node_modules/@pydantic/monty"]?.version !== pin.version
	) throw new Error("Bundled Monty dependency pin and lockfile disagree");
	const matches = (values, current) => !values ||
		(!values.includes("!" + current) &&
			(values.every((value) => value.startsWith("!")) || values.includes(current)));
	const dependencies = [];
	for (const [location, entry] of Object.entries(lock.packages)) {
		if (location === "") continue;
		const relative = location.startsWith("node_modules/") ? location.slice("node_modules/".length) : "";
		const root = relative.split("/node_modules/")[0];
		if (
			!relative || relative.split("/").some((part) => !part || part === "." || part === "..") ||
			!entry.version || root === "typebox" || root.startsWith("@earendil-works/")
		) throw new Error("Bundled Monty dependencies conflict with the private runtime");
		if (matches(entry.os, process.platform) && matches(entry.cpu, process.arch)) {
			dependencies.push({ relative, root, name: relative.split("/node_modules/").at(-1), version: entry.version });
		}
	}
	if (!dependencies.some((entry) => entry.name === "@pydantic/" + nativeMontyPackage())) {
		throw new Error("Bundled Monty lockfile has no native package for this platform");
	}
	return dependencies;
}

function installedMonty(scope, version, dependencies) {
	try {
		const nativeName = nativeMontyPackage();
		if (!version || !nativeName) return undefined;
		const wrapperRoot = path.join(scope, "monty");
		const nativeRoot = path.join(scope, nativeName);
		const wrapper = JSON.parse(readFileSync(path.join(wrapperRoot, "package.json"), "utf8"));
		const native = JSON.parse(readFileSync(path.join(nativeRoot, "package.json"), "utf8"));
		const entry = packageFile(wrapperRoot, wrapper.exports?.["."]?.node ?? wrapper.main);
		const binding = packageFile(nativeRoot, native.main);
		const worker = path.join(nativeRoot, "monty");
		if (
			wrapper.name !== "@pydantic/monty" || wrapper.version !== version ||
			native.name !== "@pydantic/" + nativeName || native.version !== version ||
			wrapper.optionalDependencies?.[native.name] !== version ||
			!native.os?.includes(process.platform) || !native.cpu?.includes(process.arch) ||
			!entry || !binding || !existsSync(entry) || !existsSync(binding) || !existsSync(worker)
		) return undefined;
		accessSync(worker, constants.X_OK);
		for (const dependency of dependencies) {
			const metadata = JSON.parse(readFileSync(path.join(path.dirname(scope), dependency.relative, "package.json"), "utf8"));
			if (metadata.name !== dependency.name || metadata.version !== dependency.version) return undefined;
		}
		return { wrapperRoot, nativeRoot, nativeName, entry };
	} catch {
		return undefined;
	}
}

function dependencyEnvironment(env) {
	// Public packages need no registry credentials or user npm configuration.
	// Keep transport settings without forwarding npm overrides or auth tokens.
	const allowed = [
		"PATH", "HOME", "LANG", "LC_ALL", "TMPDIR",
		"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
		"NODE_EXTRA_CA_CERTS",
	];
	return Object.fromEntries(allowed.flatMap((name) =>
		typeof env[name] === "string" ? [[name, env[name]]] : [],
	));
}

function checkMonty(scope, version, dependencies, env, deadline) {
	const installed = installedMonty(scope, version, dependencies);
	if (!installed) return false;
	const result = spawnSync(process.execPath, [
		path.join(releaseRoot, "scripts", "check-managed-monty.mjs"),
		path.dirname(path.dirname(scope)),
	], {
		env: dependencyEnvironment(env),
		encoding: "utf8",
		timeout: stepTimeout(deadline, 20_000),
		maxBuffer: 64 * 1024,
	});
	return result.status === 0;
}

function prepareMonty(stage, appRoot, codeToolRoot, manifest, env, deadline) {
	const pin = manifest.monty;
	const dependencies = lockedMontyDependencies(manifest);
	const packageRoots = [...new Set(dependencies.map((entry) => entry.root))];
	const targetModules = path.join(stage, "pi-code-tool", "node_modules");
	const targetScope = path.join(targetModules, "@pydantic");
	const clearPackages = () => {
		for (const relative of packageRoots) rmSync(path.join(targetModules, relative), { recursive: true, force: true });
	};
	const copyPackages = (scope) => {
		stepTimeout(deadline, 1);
		if (!installedMonty(scope, pin.version, dependencies)) return false;
		clearPackages();
		for (const relative of packageRoots) {
			stepTimeout(deadline, 1);
			const destination = path.join(targetModules, relative);
			mkdirSync(path.dirname(destination), { recursive: true });
			cpSync(path.join(path.dirname(scope), relative), destination, { recursive: true, dereference: true });
		}
		return checkMonty(targetScope, pin.version, dependencies, env, deadline);
	};

	// Reuse the complete locked dependency closure without changing its source.
	const candidates = [
		path.join(appRoot, "fork-runtime", "pi-code-tool", "node_modules", "@pydantic"),
		path.join(codeToolRoot, "node_modules", "@pydantic"),
		path.join(path.dirname(codeToolRoot), "@pydantic"),
	];
	for (const candidate of candidates) {
		if (copyPackages(candidate)) return;
	}
	clearPackages();

	// npm ci must never run in the copied code-tool package: its peers point
	// to the private Pi/typebox copies and must not be resolved from a registry.
	const installRoot = mkdtempSync(path.join(stage, ".monty-deps-"));
	try {
		cpSync(path.join(releaseRoot, pin.packageFile), path.join(installRoot, "package.json"));
		cpSync(path.join(releaseRoot, pin.lockFile), path.join(installRoot, "package-lock.json"));
		const userConfig = path.join(installRoot, "npm-user-config");
		const globalConfig = path.join(installRoot, "npm-global-config");
		writeFileSync(userConfig, "");
		writeFileSync(globalConfig, "");
		const result = spawnSync("npm", [
			"ci", "--ignore-scripts", "--omit=dev", "--include=optional", "--no-audit", "--no-fund",
			"--global=false", "--workspaces=false", "--registry=https://registry.npmjs.org/",
			"--userconfig=" + userConfig, "--globalconfig=" + globalConfig,
			"--cache=" + path.join(installRoot, "npm-cache"), "--logs-max=0",
			"--loglevel=error", "--update-notifier=false", "--fetch-retries=1", "--fetch-timeout=30000",
		], {
			cwd: installRoot,
			env: dependencyEnvironment(env),
			encoding: "utf8",
			timeout: stepTimeout(deadline, 60_000),
			maxBuffer: 256 * 1024,
		});
		if (result.status !== 0) {
			const reason = result.error?.code === "ENOENT" ? "npm is unavailable"
				: result.error?.code === "ETIMEDOUT" ? "download timed out"
				: "npm exited " + (result.status ?? "without a status");
			// Do not echo npm stderr: proxy/config diagnostics can contain credentials.
			throw new Error("Cannot prepare private Monty " + pin.version + ": " + reason +
				". Existing runtime was not replaced.");
		}
		if (!copyPackages(path.join(installRoot, "node_modules", "@pydantic"))) {
			throw new Error("Private Monty " + pin.version +
				" failed its native worker/state check. Existing runtime was not replaced.");
		}
	} finally {
		rmSync(installRoot, { recursive: true, force: true });
	}
}

function hasValidRuntime(appRoot, patchSha, manifest) {
	const target = path.join(appRoot, "fork-runtime");
	try {
		const state = JSON.parse(
			readFileSync(path.join(target, manifestName), "utf8"),
		);
		const dependencies = lockedMontyDependencies(manifest);
		return (
			state.schemaVersion === 1 &&
			state.patchSha256 === patchSha &&
			state.montyVersion === manifest.monty.version &&
			state.montyNativePackage === "@pydantic/" + nativeMontyPackage() &&
			Boolean(installedMonty(path.join(target, "pi-code-tool", "node_modules", "@pydantic"), manifest.monty.version, dependencies)) &&
			JSON.parse(readFileSync(path.join(target, "pi-code-tool", "package.json"), "utf8")).dependencies?.["@pydantic/monty"] === manifest.monty.version &&
			existsSync(path.join(target, "pi", "dist", "cli.js")) &&
			manifest.pi.modules.every(({ target: modulePath }) =>
				existsSync(path.join(target, "pi", modulePath)),
			) &&
			manifest.codeTool.modules.every(({ target: modulePath }) =>
				existsSync(path.join(target, "pi-code-tool", modulePath)),
			)
		);
	} catch {
		return false;
	}
}

function addPackageSymlink(link, target) {
	mkdirSync(path.dirname(link), { recursive: true });
	// Both paths are inside the same stage, so the link survives the rename.
	symlinkSync(path.relative(path.dirname(link), target), link, "dir");
}

function failIfPatchChanged(manifest) {
	for (const [rel, expected] of Object.entries(manifest.patchFiles)) {
		const file = path.join(releaseRoot, rel);
		if (!existsSync(file) || safeHash(file) !== expected) {
			throw new Error("Bundled Pi fork patch checksum mismatch: " + rel);
		}
	}
}

function prepareStagedRuntime(stage, piRoot, codeToolRoot, manifest, patchSha, appRoot, env, deadline) {
	stepTimeout(deadline, 1);
	const pi = path.join(stage, "pi");
	const codeTool = path.join(stage, "pi-code-tool");
	mkdirSync(pi);
	cpSync(path.join(piRoot, "dist"), path.join(pi, "dist"), { recursive: true });
	cpSync(path.join(piRoot, "node_modules"), path.join(pi, "node_modules"), {
		recursive: true,
	});
	cpSync(path.join(piRoot, "package.json"), path.join(pi, "package.json"));
	for (const module of manifest.pi.modules) {
		const destination = path.join(pi, module.target);
		mkdirSync(path.dirname(destination), { recursive: true });
		cpSync(path.join(releaseRoot, module.source), destination);
	}

	mkdirSync(codeTool);
	cpSync(path.join(codeToolRoot, "dist"), path.join(codeTool, "dist"), {
		recursive: true,
	});
	cpSync(
		path.join(codeToolRoot, "package.json"),
		path.join(codeTool, "package.json"),
	);
	for (const module of manifest.codeTool.modules) {
		const destination = path.join(codeTool, module.target);
		mkdirSync(path.dirname(destination), { recursive: true });
		cpSync(path.join(releaseRoot, module.source), destination);
	}

	// Keep the forked code tool bound to the same copy of Pi used by the RPC
	// process. Do not resolve its peer dependency to the user's global Pi.
	const codeNodeModules = path.join(codeTool, "node_modules");
	mkdirSync(codeNodeModules, { recursive: true });
	addPackageSymlink(
		path.join(codeNodeModules, "@earendil-works", "pi-coding-agent"),
		pi,
	);
	addPackageSymlink(
		path.join(codeNodeModules, "typebox"),
		path.join(pi, "node_modules", "typebox"),
	);

	prepareMonty(stage, appRoot, codeToolRoot, manifest, env, deadline);
	const codePackage = path.join(codeTool, "package.json");
	const codeMetadata = JSON.parse(readFileSync(codePackage, "utf8"));
	codeMetadata.dependencies = { ...codeMetadata.dependencies, "@pydantic/monty": manifest.monty.version };
	writeFileSync(codePackage, JSON.stringify(codeMetadata, null, 2) + "\n");

	const result = spawnSync(
		process.execPath,
		[path.join(pi, "dist", "cli.js"), "--version"],
		{
			encoding: "utf8",
			timeout: stepTimeout(deadline, 20_000),
		},
	);
	if (result.status !== 0 || result.stdout.trim() !== manifest.pi.version) {
		throw new Error(
			"Managed Pi runtime failed its startup/version check: " +
				(result.stderr || "").slice(-300),
		);
	}
	const loaded = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			"await import(" +
				JSON.stringify(
					pathToFileURL(path.join(codeTool, "dist", "pi", "extension.js")).href,
				) +
				")",
		],
		{ encoding: "utf8", timeout: stepTimeout(deadline, 30_000) },
	);
	if (loaded.status !== 0) {
		throw new Error(
			"Managed code-tool failed its import check: " +
				(loaded.stderr || "").slice(-500),
		);
	}
	writeFileSync(
		path.join(stage, manifestName),
		JSON.stringify(
			{
				schemaVersion: 1,
				patchSha256: patchSha,
				piVersion: manifest.pi.version,
				codeToolVersion: manifest.codeTool.version,
				piCommit: manifest.pi.forkCommit,
				codeToolCommit: manifest.codeTool.forkCommit,
				montyVersion: manifest.monty.version,
				montyNativePackage: "@pydantic/" + nativeMontyPackage(),
			},
			null,
			2,
		) + "\n",
	);
}

export function ensureManagedPi(appRoot, env = process.env) {
	if (env.PITTY_USE_UPSTREAM_PI === "1" || env.PITTY_NO_MANAGED_PI === "1") {
		return { status: "skipped", reason: "Explicit upstream Pi selection" };
	}
	if (process.platform !== "linux" && process.platform !== "darwin") {
		return {
			status: "unsupported",
			reason: "Managed Pi fork is not yet available on this platform",
		};
	}
	if (!existsSync(manifestPath)) {
		return {
			status: "unsupported",
			reason: "This release does not contain fork patches",
		};
	}
	const patchSha = safeHash(manifestPath);
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (!manifest.monty?.version || !nativeMontyPackage()) {
		return { status: "unsupported", reason: "This release has no compatible managed Monty dependency" };
	}
	for (const file of [manifest.monty.packageFile, manifest.monty.lockFile]) {
		if (typeof file !== "string" || !Object.hasOwn(manifest.patchFiles, file)) {
			throw new Error("Bundled Monty dependency definition is missing its checksum");
		}
	}
	if (hasValidRuntime(appRoot, patchSha, manifest)) return { status: "ready" };
	failIfPatchChanged(manifest);

	const piRoot = env.PITTY_UPSTREAM_PI_ROOT || findUpstreamPiPackage(env);
	const agentDir =
		env.PI_CODING_AGENT_DIR || path.join(env.HOME || homedir(), ".pi", "agent");
	const codeToolRoot =
		env.PITTY_UPSTREAM_CODE_TOOL_ROOT ||
		path.join(agentDir, "npm", "node_modules", "pi-code-tool");
	if (!piRoot || !existsSync(path.join(piRoot, "package.json"))) {
		return {
			status: "unsupported",
			reason: "Cannot locate a matching installed Pi package",
		};
	}
	if (!existsSync(path.join(codeToolRoot, "package.json"))) {
		return { status: "unsupported", reason: "pi-code-tool is not installed" };
	}
	const piMetadata = JSON.parse(
		readFileSync(path.join(piRoot, "package.json"), "utf8"),
	);
	const codeMetadata = JSON.parse(
		readFileSync(path.join(codeToolRoot, "package.json"), "utf8"),
	);
	if (
		piMetadata.name !== "@earendil-works/pi-coding-agent" ||
		piMetadata.version !== manifest.pi.version
	) {
		return {
			status: "unsupported",
			reason:
				"Installed Pi version differs from the verified fork version " +
				manifest.pi.version,
		};
	}
	if (
		codeMetadata.name !== "pi-code-tool" ||
		codeMetadata.version !== manifest.codeTool.version
	) {
		return {
			status: "unsupported",
			reason:
				"Installed code-tool version differs from " + manifest.codeTool.version,
		};
	}
	const matchesOriginalModules = (packageRoot, modules) => modules.every((module) => {
		const original = path.join(packageRoot, module.target);
		return module.originalSha256 === null
			? !existsSync(original)
			: existsSync(original) && safeHash(original) === module.originalSha256;
	});
	if (
		!matchesOriginalModules(piRoot, manifest.pi.modules) ||
		!matchesOriginalModules(codeToolRoot, manifest.codeTool.modules)
	) {
		return {
			status: "unsupported",
			reason: "Upstream modules do not match the audited fork patch bases",
		};
	}

	const deadline = Date.now() + PREPARATION_TIMEOUT_MS;
	mkdirSync(appRoot, { recursive: true });
	const stage = mkdtempSync(path.join(appRoot, ".fork-stage-"));
	const target = path.join(appRoot, "fork-runtime");
	const backup = path.join(appRoot, ".fork-runtime-backup");
	try {
		prepareStagedRuntime(stage, piRoot, codeToolRoot, manifest, patchSha, appRoot, env, deadline);
		stepTimeout(deadline, 1);
		if (existsSync(backup))
			throw new Error("Fork backup already exists. Refusing replacement.");
		if (existsSync(target)) renameSync(target, backup);
		try {
			renameSync(stage, target);
		} catch (error) {
			if (existsSync(backup)) renameSync(backup, target);
			throw error;
		}
		if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
		return { status: "installed", piVersion: manifest.pi.version };
	} finally {
		if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
	}
}

function isRunningDirectly() {
	if (!process.argv[1]) return false;
	try {
		// Node resolves ESM symlinks, but argv can retain a symlinked parent path.
		return (
			realpathSync(fileURLToPath(import.meta.url)) ===
			realpathSync(process.argv[1])
		);
	} catch {
		// Importers such as node -e need not provide a real entrypoint file.
		return false;
	}
}

if (isRunningDirectly()) {
	const index = process.argv.indexOf("--install-root");
	const root = index >= 0 ? process.argv[index + 1] : releaseRoot;
	try {
		const outcome = ensureManagedPi(path.resolve(root));
		console.log(
			"PiTTy managed Pi: " +
				outcome.status +
				(outcome.reason ? " (" + outcome.reason + ")" : ""),
		);
		if (outcome.status === "unsupported") process.exitCode = 2;
	} catch (error) {
		console.error(
			"PiTTy managed Pi install failed: " +
				(error instanceof Error ? error.message : String(error)),
		);
		process.exitCode = 1;
	}
}
