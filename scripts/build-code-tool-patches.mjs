#!/usr/bin/env node
/**
 * Rebuild the managed code-tool modules from the committed source checkout.
 * Usage: node scripts/build-code-tool-patches.mjs --code-tool-source /path/to/pi-code-tool
 *   --upstream-code-tool-root /path/to/installed/pi-code-tool
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function argument(name) {
	const index = process.argv.indexOf(name);
	if (index < 0 || !process.argv[index + 1])
		throw new Error("Missing required argument: " + name);
	return path.resolve(process.argv[index + 1]);
}
const sourceRoot = argument("--code-tool-source");
const upstreamRoot = argument("--upstream-code-tool-root");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: sourceRoot,
	encoding: "utf8",
}).trim();
const manifestPath = path.join(root, "vendor", "managed-fork-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const upstreamPackage = JSON.parse(readFileSync(path.join(upstreamRoot, "package.json"), "utf8"));
if (upstreamPackage.name !== "pi-code-tool" || upstreamPackage.version !== manifest.codeTool.version)
	throw new Error("Upstream package does not match the pinned code-tool version.");
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
if (hash(path.join(upstreamRoot, "dist/pi/extension.js")) !== manifest.codeTool.originalExtensionSha256)
	throw new Error("Upstream code-tool extension does not match the audited base.");
for (const module of manifest.codeTool.modules ?? []) {
	const original = path.join(upstreamRoot, module.target);
	const matches = module.originalSha256 === null
		? !existsSync(original)
		: existsSync(original) && hash(original) === module.originalSha256;
	if (!matches) throw new Error("Upstream code-tool module does not match the audited base: " + module.target);
}

const modules = [
	["src/pi/extension.ts", "dist/pi/extension.js", "extension.js"],
	["src/pi/bridge.ts", "dist/pi/bridge.js", "bridge.js"],
	["src/pi/state-codec.ts", "dist/pi/state-codec.js", "state-codec.js"],
];
execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...modules.map(([source]) => source)], {
	cwd: sourceRoot,
	stdio: "pipe",
});
for (const [source, , filename] of modules) {
	const file = path.join(sourceRoot, source);
	const result = ts.transpileModule(readFileSync(file, "utf8"), {
		fileName: file,
		reportDiagnostics: true,
		compilerOptions: {
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
			rewriteRelativeImportExtensions: true,
		},
	});
	const errors = (result.diagnostics ?? []).filter(
		(diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
	);
	if (errors.length)
		throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
			getCanonicalFileName: (name) => name,
			getCurrentDirectory: () => sourceRoot,
			getNewLine: () => "\n",
		}));
	const output = path.join(root, "vendor", "pi-code-tool-" + manifest.codeTool.version, filename);
	mkdirSync(path.dirname(output), { recursive: true });
	writeFileSync(output, result.outputText);
	console.log(source + " -> " + path.relative(root, output));
}
manifest.codeTool.modules = modules.map(([, target, filename]) => {
	const source = "vendor/pi-code-tool-" + manifest.codeTool.version + "/" + filename;
	const original = path.join(upstreamRoot, target);
	manifest.patchFiles[source] = hash(path.join(root, source));
	return { source, target, originalSha256: existsSync(original) ? hash(original) : null };
});
manifest.codeTool.forkCommit = sourceCommit;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
