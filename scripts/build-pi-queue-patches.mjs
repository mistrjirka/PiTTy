#!/usr/bin/env node
/**
 * Rebuild all managed fork modules from the Pi source checkout.
 * Usage: node scripts/build-pi-queue-patches.mjs --pi-source /path/to/pi
 *   --upstream-pi-root /path/to/installed/pi-coding-agent
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
const sourceRoot = argument("--pi-source");
const upstreamRoot = argument("--upstream-pi-root");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: sourceRoot,
	encoding: "utf8",
}).trim();
const manifestPath = path.join(root, "vendor", "managed-fork-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const upstreamPackage = JSON.parse(
	readFileSync(path.join(upstreamRoot, "package.json"), "utf8"),
);
if (
	upstreamPackage.name !== "@earendil-works/pi-coding-agent" ||
	upstreamPackage.version !== manifest.pi.version
) throw new Error("Upstream package does not match the pinned Pi version.");
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const originalSessionManager = path.join(upstreamRoot, "dist/core/session-manager.js");
if (hash(originalSessionManager) !== manifest.pi.originalSessionManagerSha256)
	throw new Error("Upstream session manager does not match the audited base.");

const modules = [
	["packages/coding-agent/src/core/session-manager.ts", "dist/core/session-manager.js", "session-manager.js"],
	["packages/coding-agent/src/core/session-lazy-state.ts", "dist/core/session-lazy-state.js", "session-lazy-state.js"],
	["packages/coding-agent/src/core/agent-session.ts", "dist/core/agent-session.js", "agent-session.js"],
	["packages/coding-agent/src/core/queued-input.ts", "dist/core/queued-input.js", "queued-input.js"],
	["packages/coding-agent/src/modes/rpc/rpc-mode.ts", "dist/modes/rpc/rpc-mode.js", "rpc-mode.js"],
	["packages/agent/src/agent.ts", "node_modules/@earendil-works/pi-agent-core/dist/agent.js", "agent.js"],
	// Include the runtime and diagnostic modules matching the synchronized Pi base.
	["packages/coding-agent/src/core/agent-session-runtime.ts", "dist/core/agent-session-runtime.js", "agent-session-runtime.js"],
	["packages/coding-agent/src/modes/diagnostics-stderr.ts", "dist/modes/diagnostics-stderr.js", "diagnostics-stderr.js"],
	// Side questions use the effective SDK request and explicit provider capabilities.
	["packages/coding-agent/src/core/side-questions.ts", "dist/core/side-questions.js", "side-questions.js"],
	// Cache maintenance and usage are part of the managed runtime RPC contract.
	["packages/coding-agent/src/core/cache-compaction.ts", "dist/core/cache-compaction.js", "cache-compaction.js"],
	["packages/coding-agent/src/core/cache-warmer.ts", "dist/core/cache-warmer.js", "cache-warmer.js"],
	["packages/coding-agent/src/core/provider-usage.ts", "dist/core/provider-usage.js", "provider-usage.js"],
	["packages/coding-agent/src/core/settings-defaults.ts", "dist/core/settings-defaults.js", "settings-defaults.js"],
	["packages/coding-agent/src/core/settings-manager.ts", "dist/core/settings-manager.js", "settings-manager.js"],
	["packages/coding-agent/src/core/settings-schema.ts", "dist/core/settings-schema.js", "settings-schema.js"],
	["packages/coding-agent/src/modes/interactive/components/status-indicator.ts", "dist/modes/interactive/components/status-indicator.js", "status-indicator.js"],
	["packages/coding-agent/src/core/sdk.ts", "dist/core/sdk.js", "sdk.js"],
	["packages/coding-agent/src/core/extensions/types.ts", "dist/core/extensions/types.js", "extension-types.js"],
	["packages/coding-agent/src/core/extensions/runner.ts", "dist/core/extensions/runner.js", "extension-runner.js"],
	["packages/coding-agent/src/core/model-runtime.ts", "dist/core/model-runtime.js", "model-runtime.js"],
	["packages/coding-agent/src/core/model-registry.ts", "dist/core/model-registry.js", "model-registry.js"],
	["packages/coding-agent/src/core/provider-composer.ts", "dist/core/provider-composer.js", "provider-composer.js"],
	["packages/ai/src/models.ts", "node_modules/@earendil-works/pi-ai/dist/models.js", "ai-models.js"],
	["packages/ai/src/providers/all.ts", "node_modules/@earendil-works/pi-ai/dist/providers/all.js", "ai-providers-all.js"],
];
for (const [source, target, filename] of modules) {
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
	const output = path.join(root, "vendor", "pi-" + manifest.pi.version, filename);
	mkdirSync(path.dirname(output), { recursive: true });
	writeFileSync(output, result.outputText);
	console.log(source + " -> " + path.relative(root, output));
}

const assets = [
	["packages/coding-agent/schemas/settings.schema.json", "schemas/settings.schema.json", "settings.schema.json"],
];
for (const [source, , filename] of assets) {
	const output = path.join(root, "vendor", "pi-" + manifest.pi.version, filename);
	writeFileSync(output, readFileSync(path.join(sourceRoot, source)));
}

manifest.pi.modules = [...modules, ...assets].map(([, target, filename]) => {
	const source = "vendor/pi-" + manifest.pi.version + "/" + filename;
	const original = path.join(upstreamRoot, target);
	manifest.patchFiles[source] = hash(path.join(root, source));
	return { source, target, originalSha256: existsSync(original) ? hash(original) : null };
});
manifest.pi.forkCommit = sourceCommit;
manifest.pi.queueProtocolVersion = 1;
manifest.pi.sideQuestionProtocolVersion = 1;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
