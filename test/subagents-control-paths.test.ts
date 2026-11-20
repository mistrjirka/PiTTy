import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { safeProfiledControlDir } from "../src/subagents/profiled-paths.ts";
import { useIsolatedSubagentRoots, roots } from "./subagent-split-helpers/fixtures.ts";

useIsolatedSubagentRoots();

describe("profiled subagent control paths", () => {
	test("accepts a control directory when only the temp root is reached through an OS-style symlink alias", () => {
		const realTmp = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-profiled-real-tmp-"));
		const aliasTmp = path.join(os.tmpdir(), `pitty-profiled-alias-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		fs.symlinkSync(realTmp, aliasTmp, "dir");
		roots.push(aliasTmp, realTmp);

		const runtimeRoot = path.join(realTmp, "pi-profiled-subagents-test");
		const controlDir = path.join(runtimeRoot, "agent-1");
		fs.mkdirSync(controlDir, { recursive: true });
		const aliasedControlDir = path.join(aliasTmp, "pi-profiled-subagents-test", "agent-1");

		expect(safeProfiledControlDir(aliasedControlDir, aliasTmp)).toBe(path.resolve(aliasedControlDir));
	});

	test("rejects a symlinked profiled runtime root even when its target stays inside the temp tree", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-profiled-root-link-"));
		roots.push(tmp);
		const realRuntime = path.join(tmp, "real-runtime");
		const controlDir = path.join(realRuntime, "agent-1");
		fs.mkdirSync(controlDir, { recursive: true });
		const linkedRuntime = path.join(tmp, "pi-profiled-subagents-linked");
		fs.symlinkSync(realRuntime, linkedRuntime, "dir");

		expect(safeProfiledControlDir(path.join(linkedRuntime, "agent-1"), tmp)).toBeUndefined();
	});

	test("rejects a symlinked profiled control directory", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-profiled-control-link-"));
		roots.push(tmp);
		const runtimeRoot = path.join(tmp, "pi-profiled-subagents-test");
		const realControl = path.join(tmp, "real-control");
		fs.mkdirSync(runtimeRoot, { recursive: true });
		fs.mkdirSync(realControl, { recursive: true });
		const linkedControl = path.join(runtimeRoot, "agent-1");
		fs.symlinkSync(realControl, linkedControl, "dir");

		expect(safeProfiledControlDir(linkedControl, tmp)).toBeUndefined();
	});
});
