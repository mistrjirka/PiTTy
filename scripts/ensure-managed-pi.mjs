#!/usr/bin/env node
/**
 * Build an isolated Pi + pi-code-tool runtime from the upstream installations
 * already present on the machine and the audited, version-pinned fork patches
 * shipped in the PiTTy release. Never write to ~/.pi, global Pi, or sessions.
 *
 * This script is safe to run on every PiTTy startup. It returns immediately
 * when the runtime is current, and falls back to upstream on a version mismatch.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	readdirSync,
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

function hasValidRuntime(appRoot, patchSha, manifest) {
	const target = path.join(appRoot, "fork-runtime");
	try {
		const state = JSON.parse(
			readFileSync(path.join(target, manifestName), "utf8"),
		);
		return (
			state.schemaVersion === 1 &&
			state.patchSha256 === patchSha &&
			existsSync(path.join(target, "pi", "dist", "cli.js")) &&
			manifest.pi.modules.every(({ target: modulePath }) =>
				existsSync(path.join(target, "pi", modulePath)),
			) &&
			existsSync(
				path.join(target, "pi-code-tool", "dist", "pi", "state-codec.js"),
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

function prepareStagedRuntime(stage, piRoot, codeToolRoot, manifest, patchSha) {
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
	const codePatch = path.join(
		releaseRoot,
		"vendor",
		"pi-code-tool-" + manifest.codeTool.version,
	);
	for (const name of ["extension.js", "state-codec.js"]) {
		cpSync(path.join(codePatch, name), path.join(codeTool, "dist", "pi", name));
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

	// Pi's code tool relies on Monty's optional native package. Reuse the exact
	// installed packages instead of contacting a registry during an upgrade.
	const montyRoot = path.join(path.dirname(codeToolRoot), "@pydantic");
	const targetMontyRoot = path.join(codeNodeModules, "@pydantic");
	const montyPackages = readdirSync(montyRoot).filter(
		(name) => name === "monty" || name.startsWith("monty-"),
	);
	if (!montyPackages.includes("monty"))
		throw new Error("Monty runtime is not installed");
	mkdirSync(targetMontyRoot);
	for (const name of montyPackages) {
		cpSync(path.join(montyRoot, name), path.join(targetMontyRoot, name), {
			recursive: true,
		});
	}

	const result = spawnSync(
		process.execPath,
		[path.join(pi, "dist", "cli.js"), "--version"],
		{
			encoding: "utf8",
			timeout: 20_000,
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
		{ encoding: "utf8", timeout: 30_000 },
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
	const matchingPi = manifest.pi.modules.every((module) => {
		const original = path.join(piRoot, module.target);
		return module.originalSha256 === null
			? !existsSync(original)
			: existsSync(original) && safeHash(original) === module.originalSha256;
	});
	if (
		!matchingPi ||
		safeHash(path.join(codeToolRoot, "dist", "pi", "extension.js")) !==
			manifest.codeTool.originalExtensionSha256
	) {
		return {
			status: "unsupported",
			reason: "Upstream modules do not match the audited fork patch bases",
		};
	}

	mkdirSync(appRoot, { recursive: true });
	const stage = mkdtempSync(path.join(appRoot, ".fork-stage-"));
	const target = path.join(appRoot, "fork-runtime");
	const backup = path.join(appRoot, ".fork-runtime-backup");
	try {
		prepareStagedRuntime(stage, piRoot, codeToolRoot, manifest, patchSha);
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

const runningDirectly =
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (runningDirectly) {
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
