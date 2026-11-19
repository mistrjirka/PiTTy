#!/usr/bin/env node
/**
 * Install two independently built, local fork checkouts for PiTTy only.
 * The global pi binary and original Pi sessions remain unchanged. If present,
 * an existing code-tool autoapprove wrapper is redirected with a backup.
 *
 * Example:
 * node scripts/install-fork-runtime.mjs \
 *   --pi-source ~/programovani/pi-fork \
 *   --code-tool-source ~/programovani/pi-code-tool-fork
 */
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const args = process.argv.slice(2);
function option(name, fallback) {
	const index = args.indexOf("--" + name);
	if (index >= 0) {
		const value = args[index + 1];
		if (!value || value.startsWith("--"))
			throw new Error("--" + name + " requires a value");
		return path.resolve(value);
	}
	return fallback;
}
function run(executable, argv, cwd) {
	const child = spawnSync(executable, argv, {
		cwd,
		encoding: "utf8",
		timeout: 180_000,
		env: process.env,
	});
	if (child.error || child.status !== 0) {
		throw new Error(
			executable +
				" failed: " +
				(child.error?.message ?? child.stderr.slice(-1500)),
		);
	}
	return child.stdout.trim();
}
function findPackageRoot(entry) {
	let dir = path.dirname(realpathSync(entry));
	for (let i = 0; i < 8; i++) {
		const manifest = path.join(dir, "package.json");
		if (
			existsSync(manifest) &&
			JSON.parse(readFileSync(manifest, "utf8")).name ===
				"@earendil-works/pi-coding-agent"
		) {
			return dir;
		}
		const next = path.dirname(dir);
		if (next === dir) break;
		dir = next;
	}
	throw new Error(
		"Could not locate an installed @earendil-works/pi-coding-agent package",
	);
}
const sourcePi = option("pi-source");
const sourceCodeTool = option("code-tool-source");
if (!sourcePi || !sourceCodeTool) {
	throw new Error(
		"Specify both --pi-source and --code-tool-source (local fork checkouts)",
	);
}
const target = option(
	"destination",
	path.join(process.env.HOME || homedir(), ".local", "share", "pitty-forks"),
);
const base =
	option("upstream-pi-root") ??
	findPackageRoot(
		run(
			process.platform === "win32" ? "where" : "which",
			["pi"],
			process.cwd(),
		).split("\n")[0],
	);

function getManifest(file) {
	return JSON.parse(readFileSync(file, "utf8"));
}
const sourcePiPackage = getManifest(
	path.join(sourcePi, "packages", "coding-agent", "package.json"),
);
const sourceCodeToolPackage = getManifest(
	path.join(sourceCodeTool, "package.json"),
);
const installedPiPackage = getManifest(path.join(base, "package.json"));
if (
	sourcePiPackage.name !== installedPiPackage.name ||
	sourcePiPackage.version !== installedPiPackage.version
) {
	throw new Error(
		"Fork Pi version does not match the installed Pi package. Refusing to mix releases.",
	);
}
if (sourceCodeToolPackage.name !== "pi-code-tool") {
	throw new Error("Invalid pi-code-tool checkout.");
}
for (const file of [
	path.join(
		sourcePi,
		"packages",
		"coding-agent",
		"src",
		"core",
		"session-manager.ts",
	),
	path.join(
		sourcePi,
		"packages",
		"coding-agent",
		"src",
		"core",
		"session-lazy-state.ts",
	),
	path.join(sourceCodeTool, "dist", "pi", "extension.js"),
	path.join(sourceCodeTool, "dist", "pi", "state-codec.js"),
]) {
	if (!existsSync(file))
		throw new Error("Required built source missing: " + file);
}
function redirectExistingCodeToolRegistration() {
	const home = process.env.HOME || homedir();
	const agentDir =
		process.env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent");
	const wrapper = path.join(
		agentDir,
		"extensions",
		"pi-code-tool-autoapprove.ts",
	);
	if (!existsSync(wrapper)) return false;
	// Keep autoApprove and the user's other extension configuration intact.
	// Never add a second "code" tool: Pi rejects duplicate registrations.
	const oldImport = "../npm/node_modules/pi-code-tool/dist/pi/extension.js";
	const newImport = path
		.join(target, "pi-code-tool", "dist", "pi", "extension.js")
		.replaceAll("\\", "/");
	const original = readFileSync(wrapper, "utf8");
	if (original.includes(newImport)) return true;
	if (!original.includes(oldImport)) {
		throw new Error(
			"Existing code-tool wrapper is not recognized. Refusing to modify " +
				wrapper,
		);
	}
	const backup = wrapper + ".pitty-upstream-backup";
	if (!existsSync(backup))
		cpSync(wrapper, backup, { errorOnExist: true, force: false });
	const candidate = wrapper + ".tmp-" + process.pid;
	try {
		writeFileSync(candidate, original.replace(oldImport, newImport), {
			mode: statSync(wrapper).mode & 0o777,
			flag: "wx",
		});
		renameSync(candidate, wrapper);
	} finally {
		if (existsSync(candidate)) rmSync(candidate, { force: true });
	}
	return true;
}

const parent = path.dirname(target);
mkdirSync(parent, { recursive: true });
const stage = mkdtempSync(path.join(parent, ".pitty-forks-stage-"));
const pi = path.join(stage, "pi");
const codeTool = path.join(stage, "pi-code-tool");
let installed = false;
try {
	mkdirSync(pi);
	// Copy the official version-matched Pi distribution, then replace just
	// the two compiled modules maintained in our Pi fork.
	cpSync(path.join(base, "dist"), path.join(pi, "dist"), { recursive: true });
	cpSync(path.join(base, "node_modules"), path.join(pi, "node_modules"), {
		recursive: true,
	});
	cpSync(path.join(base, "package.json"), path.join(pi, "package.json"));
	for (const name of ["session-manager", "session-lazy-state"]) {
		const source = path.join(
			sourcePi,
			"packages",
			"coding-agent",
			"src",
			"core",
			name + ".ts",
		);
		const destination = path.join(pi, "dist", "core", name + ".js");
		const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
			fileName: source,
			compilerOptions: {
				target: ts.ScriptTarget.ES2022,
				module: ts.ModuleKind.ESNext,
			},
			reportDiagnostics: true,
		});
		if (compiled.diagnostics?.length) {
			throw new Error("Cannot compile Pi module " + name);
		}
		const javascript = compiled.outputText.replace(
			/(from\s*["'][^"']+)\.ts(["'])/g,
			"$1.js$2",
		);
		writeFileSync(destination, javascript);
	}

	mkdirSync(codeTool);
	for (const name of ["package.json", "package-lock.json"]) {
		cpSync(path.join(sourceCodeTool, name), path.join(codeTool, name));
	}
	cpSync(path.join(sourceCodeTool, "dist"), path.join(codeTool, "dist"), {
		recursive: true,
	});
	cpSync(
		path.join(sourceCodeTool, "extensions"),
		path.join(codeTool, "extensions"),
		{ recursive: true },
	);
	// Install only runtime dependencies. Supply the peer dependencies from the
	// exact Pi fork build so npm cannot quietly bring in a second Pi version.
	run(
		"npm",
		[
			"ci",
			"--omit=dev",
			"--omit=peer",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
		],
		codeTool,
	);
	for (const [name, destination] of [
		["@earendil-works/pi-coding-agent", pi],
		["typebox", path.join(pi, "node_modules", "typebox")],
	]) {
		const link = path.join(codeTool, "node_modules", ...name.split("/"));
		mkdirSync(path.dirname(link), { recursive: true });
		if (existsSync(link) || lstatSyncSafe(link))
			rmSync(link, { recursive: true, force: true });
		symlinkSync(
			path.relative(path.dirname(link), destination),
			link,
			"junction",
		);
	}
	const piCli = path.join(pi, "dist", "cli.js");
	const plugin = path.join(codeTool, "dist", "pi", "extension.js");
	const version = run(process.execPath, [piCli, "--version"], stage);
	if (version !== installedPiPackage.version)
		throw new Error("Fork Pi failed version smoke test: " + version);
	const pluginCheck = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			"import(" +
				JSON.stringify(pathToFileURL(plugin).href) +
				").then(() => console.log('ok'))",
		],
		{ cwd: stage, encoding: "utf8", timeout: 30_000 },
	);
	if (pluginCheck.status !== 0) {
		throw new Error(
			"Code-tool fork failed import smoke test: " +
				pluginCheck.stderr.slice(-1200),
		);
	}
	writeFileSync(
		path.join(stage, "pitty-fork-runtime.json"),
		JSON.stringify(
			{
				pi: {
					version,
					sourceCommit: run("git", ["rev-parse", "HEAD"], sourcePi),
				},
				codeTool: {
					version: sourceCodeToolPackage.version,
					sourceCommit: run("git", ["rev-parse", "HEAD"], sourceCodeTool),
				},
				installedAt: new Date().toISOString(),
			},
			null,
			2,
		) + "\n",
	);
	if (
		existsSync(target) &&
		!existsSync(path.join(target, "pitty-fork-runtime.json"))
	) {
		throw new Error(
			"Destination exists and is not a managed PiTTy fork runtime: " + target,
		);
	}
	const backup = target + ".backup";
	if (existsSync(backup))
		throw new Error("Backup destination already exists: " + backup);
	if (existsSync(target)) renameSync(target, backup);
	let redirectedRegistration = false;
	try {
		renameSync(stage, target);
		redirectedRegistration = redirectExistingCodeToolRegistration();
		installed = true;
	} catch (error) {
		if (existsSync(target)) rmSync(target, { recursive: true, force: true });
		if (existsSync(backup)) renameSync(backup, target);
		throw error;
	}
	if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
	console.log("PiTTy fork Pi: " + path.join(target, "pi", "dist", "cli.js"));
	console.log(
		"PiTTy fork code-tool: " +
			path.join(target, "pi-code-tool", "dist", "pi", "extension.js"),
	);
	console.log(
		"Existing code-tool autoapprove registration redirected: " +
			redirectedRegistration,
	);
	console.log("Global pi executable and session files: unchanged");
} finally {
	if (!installed && existsSync(stage))
		rmSync(stage, { recursive: true, force: true });
}
function lstatSyncSafe(file) {
	try {
		return lstatSync(file);
	} catch {
		return undefined;
	}
}
