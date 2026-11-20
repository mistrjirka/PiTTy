import { afterEach, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TestRendererSetup } from "@opentui/core/testing";
import { registerBundledParsers } from "../../src/ui/parsers.ts";

registerBundledParsers();

export const active: TestRendererSetup[] = [];
export const tempDirs: string[] = [];
// Isolate profiled fallback discovery: some suites render subagent targets,
// which scans runtime roots. Point it at an empty isolated base so host /tmp
// leftovers never leak into rendered rows.
const ORIGINAL_PROFILED_ROOT = process.env.PI_PITTY_PROFILED_ROOT;
/**
 * Registers per-test isolation and renderer cleanup for the calling file.
 * Bun binds module-level hooks to the first test file that loads a module,
 * and loads each module once per run. Hooks declared at this module's top
 * level would therefore clean up after one file only, and every later file
 * would leak live renderers into the next (a global theme change then hits
 * destroyed editors). Each render test file calls this itself.
 */
export function useRenderTestEnv(): void {
	beforeEach(() => {
		const isolated = fs.mkdtempSync(
			path.join(os.tmpdir(), "pitty-profiled-isolated-"),
		);
		tempDirs.push(isolated);
		process.env.PI_PITTY_PROFILED_ROOT = isolated;
	});
	afterEach(() => {
		for (const setup of active.splice(0)) setup.renderer.destroy();
		for (const dir of tempDirs.splice(0))
			fs.rmSync(dir, { recursive: true, force: true });
		if (ORIGINAL_PROFILED_ROOT === undefined)
			delete process.env.PI_PITTY_PROFILED_ROOT;
		else process.env.PI_PITTY_PROFILED_ROOT = ORIGINAL_PROFILED_ROOT;
	});
}
