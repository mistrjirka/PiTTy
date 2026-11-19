/** Runtime edges exclude type-only imports and exports.
 * A cycle here can make a module observe another module before it initializes.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(fileURLToPath(new URL("../src/", import.meta.url)));

function filesUnder(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const file = join(directory, entry.name);
		return entry.isDirectory()
			? filesUnder(file)
			: /\.(ts|tsx)$/.test(entry.name)
				? [file]
				: [];
	});
}

function runtimeTargets(file: string, known: Set<string>): string[] {
	const syntax = ts.createSourceFile(
		file,
		readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const result: string[] = [];
	for (const stmt of syntax.statements) {
		if (!ts.isImportDeclaration(stmt) && !ts.isExportDeclaration(stmt))
			continue;
		const specifier = stmt.moduleSpecifier;
		if (
			!specifier ||
			!ts.isStringLiteral(specifier) ||
			!specifier.text.startsWith(".")
		)
			continue;
		if (ts.isImportDeclaration(stmt)) {
			const clause = stmt.importClause;
			if (clause?.isTypeOnly) continue;
			if (
				clause?.namedBindings &&
				!clause.name &&
				ts.isNamedImports(clause.namedBindings) &&
				clause.namedBindings.elements.every((entry) => entry.isTypeOnly)
			)
				continue;
		} else {
			if (stmt.isTypeOnly) continue;
			if (
				stmt.exportClause &&
				ts.isNamedExports(stmt.exportClause) &&
				stmt.exportClause.elements.every((entry) => entry.isTypeOnly)
			)
				continue;
		}
		const candidate = resolve(dirname(file), specifier.text);
		const target = [
			candidate,
			candidate + ".ts",
			candidate + ".tsx",
			join(candidate, "index.ts"),
		].find((item) => known.has(item));
		if (target) result.push(target);
	}
	return result;
}

describe("Runtime dependency architecture", () => {
	test("production modules contain no runtime import cycles", () => {
		const files = filesUnder(root);
		const known = new Set(files);
		const edges = new Map(
			files.map((file) => [file, runtimeTargets(file, known)]),
		);
		const visiting = new Set<string>();
		const visited = new Set<string>();
		const chain: string[] = [];
		const cycles: string[] = [];
		function visit(file: string): void {
			if (visited.has(file)) return;
			if (visiting.has(file)) {
				const start = chain.indexOf(file);
				cycles.push(
					[...chain.slice(start), file]
						.map((item) => item.slice(root.length + 1))
						.join(" -> "),
				);
				return;
			}
			visiting.add(file);
			chain.push(file);
			for (const dependency of edges.get(file) ?? []) visit(dependency);
			chain.pop();
			visiting.delete(file);
			visited.add(file);
		}
		for (const file of files) visit(file);
		expect(cycles).toEqual([]);
	});
});
