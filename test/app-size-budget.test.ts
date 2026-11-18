import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = [
	"src/app.tsx",
	"src/tabs/app-controller-graph.ts",
	"src/tabs/app-controller-root.ts",
	"src/tabs/app-controller-root-types.ts",
	"src/tabs/app-keyboard-wiring.ts",
	"src/tabs/app-lifecycle-boot.ts",
	"src/tabs/app-runtime-scope.ts",
	"src/tabs/app-session-projections.ts",
	"src/tabs/app-settings-coordinator.ts",
	"src/tabs/app-transcript-controls.ts",
	"src/tabs/app-transcript-scroll.ts",
	"src/tabs/app-ui-actions.ts",
	"src/ui/app-screen-context.ts",
	"src/ui/app-screen-dialog-props.ts",
	"src/ui/app-screen-main-props.ts",
	"src/ui/app-screen.tsx",
] as const;

describe("App refactor size budget", () => {
	for (const file of modules) {
		test(file, () => {
			const contents = readFileSync(path.join(root, file), "utf8");
			const lineCount = contents.split(/\r?\n/).length;
			expect(lineCount, `${file} grew past 500 lines`).toBeLessThan(500);
		});
	}
});
