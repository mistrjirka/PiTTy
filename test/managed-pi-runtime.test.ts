import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ensureManagedPi } from "../scripts/ensure-managed-pi.mjs";

describe("managed Pi runtime installer", () => {
	const managedTest = process.platform === "linux" || process.platform === "darwin" ? test : test.skip;
	managedTest("a runtime missing a declared queue module is not reused", () => {
		const root = mkdtempSync(path.join(tmpdir(), "pitty-fork-modules-"));
		try {
			const manifestText = readFileSync(
				new URL("../vendor/managed-fork-manifest.json", import.meta.url),
				"utf8",
			);
			const manifest = JSON.parse(manifestText) as {
				pi: { modules: { target: string }[] };
			};
			const runtime = path.join(root, "fork-runtime");
			const requiredFiles = [
				"pi/dist/cli.js",
				"pi-code-tool/dist/pi/state-codec.js",
				...manifest.pi.modules.map((module) => "pi/" + module.target),
			];
			for (const file of requiredFiles) {
				const destination = path.join(runtime, file);
				mkdirSync(path.dirname(destination), { recursive: true });
				writeFileSync(destination, "// installed module\n");
			}
			writeFileSync(
				path.join(runtime, "pitty-fork-runtime.json"),
				JSON.stringify({
					schemaVersion: 1,
					patchSha256: createHash("sha256").update(manifestText).digest("hex"),
				}),
			);
			const env = {
				HOME: root,
				PITTY_UPSTREAM_PI_ROOT: path.join(root, "unavailable-upstream"),
			};
			expect(ensureManagedPi(root, env).status).toBe("ready");
			const agentModule = manifest.pi.modules.find((module) =>
				module.target.includes("pi-agent-core"),
			);
			expect(agentModule).toBeDefined();
			rmSync(path.join(runtime, "pi", agentModule!.target));
			expect(ensureManagedPi(root, env).status).toBe("unsupported");
			expect(existsSync(path.join(runtime, "pi", "dist", "cli.js"))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	managedTest("incompatible upstream version does not replace the installation", () => {
		const root = mkdtempSync(path.join(tmpdir(), "pitty-fork-incompatible-"));
		try {
			const existing = path.join(root, "existing");
			const upstream = path.join(root, "upstream");
			mkdirSync(upstream);
			writeFileSync(
				path.join(upstream, "package.json"),
				JSON.stringify({
					name: "@earendil-works/pi-coding-agent",
					version: "0.0.0",
				}),
			);
			const codeTool = path.join(root, "code-tool");
			mkdirSync(codeTool);
			writeFileSync(
				path.join(codeTool, "package.json"),
				JSON.stringify({ name: "pi-code-tool", version: "0.6.2" }),
			);
			mkdirSync(existing);
			writeFileSync(path.join(existing, "user-note.txt"), "leave me alone");
			const result = ensureManagedPi(existing, {
				HOME: root,
				PITTY_UPSTREAM_PI_ROOT: upstream,
				PITTY_UPSTREAM_CODE_TOOL_ROOT: codeTool,
			});
			expect(result.status).toBe("unsupported");
			expect(result).toMatchObject({ reason: expect.stringContaining("Installed Pi version differs") });
			expect(readFileSync(path.join(existing, "user-note.txt"), "utf8")).toBe(
				"leave me alone",
			);
			expect(existsSync(path.join(existing, "fork-runtime"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("explicit upstream selection skips staging", () => {
		const result = ensureManagedPi("/does-not-exist", {
			PITTY_USE_UPSTREAM_PI: "1",
		});
		expect(result.status).toBe("skipped");
	});

	// The managed fork is intentionally not installed on Windows. Verify this
	// process-local Node hook only on the supported Linux/macOS platforms.
	const hookTest = process.platform === "win32" ? test.skip : test;
	hookTest(
		"process-local code-tool replacement leaves the original module untouched",
		() => {
			const root = mkdtempSync(path.join(tmpdir(), "pitty-code-fork-hook-"));
			try {
				writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
				const original = path.join(
					root,
					"pi-code-tool",
					"dist",
					"pi",
					"extension.js",
				);
				const replacement = path.join(root, "patched", "extension.js");
				const entry = path.join(root, "entry.mjs");
				mkdirSync(path.dirname(original), { recursive: true });
				mkdirSync(path.dirname(replacement), { recursive: true });
				writeFileSync(original, 'export const marker = "original";\n');
				writeFileSync(replacement, 'export const marker = "patched";\n');
				writeFileSync(
					entry,
					'import { marker } from "./pi-code-tool/dist/pi/extension.js"; console.log(marker);\n',
				);
				const loader = fileURLToPath(
					new URL("../src/pi-display/code-tool-loader.mjs", import.meta.url),
				);
				const env = {
					...process.env,
					PITTY_CODE_TOOL_REPLACEMENT: replacement,
				};
				const node = process.env.PITTY_NODE_EXECUTABLE || "node";
				const plain = spawnSync(node, [entry], { encoding: "utf8", env });
				const patched = spawnSync(node, ["--import=" + loader, entry], {
					encoding: "utf8",
					env,
				});
				expect(plain.status).toBe(0);
				expect(plain.stdout.trim()).toBe("original");
				expect(patched.status).toBe(0);
				expect(patched.stdout.trim()).toBe("patched");
				expect(readFileSync(original, "utf8")).toContain('"original"');
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		},
	);
});
