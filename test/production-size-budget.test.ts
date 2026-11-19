/** Enforce a strict line budget for every production module, not only the App. */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../src/", import.meta.url)));
const scriptExtensions = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return entry.isFile() &&
			scriptExtensions.test(entry.name) &&
			!entry.name.endsWith(".d.ts")
			? [path]
			: [];
	});
}

describe("Every production source file stays under 500 lines", () => {
	for (const file of sourceFiles(root)) {
		test(file.slice(root.length + 1), () => {
			const count = readFileSync(file, "utf8").split(/\r?\n/).length;
			expect(count, `${file} is ${count} lines`).toBeLessThan(500);
		});
	}
});
