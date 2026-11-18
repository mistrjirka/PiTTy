/** Read-only, capped previews for file mutation tool operations. */
import { readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { createTwoFilesPatch } from "diff";
import { objectRecord } from "./conversation-shared.ts";

export function mutationPath(args: unknown): string | undefined {
	const record = objectRecord(args);
	const value = record?.path ?? record?.file_path;
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function mutationContent(
	toolName: string,
	args: unknown,
	oldContent: string,
): string | undefined {
	const record = objectRecord(args);
	if (!record) return undefined;
	const normalizedName = toolName.toLowerCase();
	if (
		normalizedName === "write" ||
		normalizedName.endsWith(".write") ||
		normalizedName.includes("write_file")
	) {
		return typeof record.content === "string" ? record.content : undefined;
	}
	if (
		!(
			normalizedName === "edit" ||
			normalizedName.endsWith(".edit") ||
			normalizedName.includes("edit_file")
		)
	)
		return undefined;
	const rawEdits = Array.isArray(record.edits)
		? record.edits
		: typeof record.oldText === "string" && typeof record.newText === "string"
			? [{ oldText: record.oldText, newText: record.newText }]
			: [];
	let updated = oldContent;
	for (const raw of rawEdits) {
		const edit = objectRecord(raw);
		if (typeof edit?.oldText !== "string" || typeof edit?.newText !== "string")
			continue;
		const position = updated.indexOf(edit.oldText);
		if (position < 0) continue;
		updated =
			updated.slice(0, position) +
			edit.newText +
			updated.slice(position + edit.oldText.length);
	}
	return updated === oldContent && rawEdits.length ? undefined : updated;
}

export const MAX_PREVIEW_BYTES = 1_048_576;

export function isFileMutationTool(toolName: string): boolean {
	const name = toolName.toLowerCase();
	return (
		name === "write" ||
		name.endsWith(".write") ||
		name.includes("write_file") ||
		name === "edit" ||
		name.endsWith(".edit") ||
		name.includes("edit_file")
	);
}

export function createMutationDiff(
	toolName: string,
	args: unknown,
	cwd: string | undefined,
): { diff?: string; path?: string } {
	// Read-only tools must not read their target again on the UI event loop.
	if (!isFileMutationTool(toolName)) return {};
	const requestedPath = mutationPath(args);
	if (!requestedPath) return {};
	const absolutePath = path.isAbsolute(requestedPath)
		? requestedPath
		: path.resolve(cwd ?? process.cwd(), requestedPath);
	let before = "";
	let existed = false;
	try {
		const source = statSync(absolutePath);
		if (!source.isFile() || source.size > MAX_PREVIEW_BYTES)
			return { path: requestedPath };
		before = readFileSync(absolutePath, "utf8");
		existed = true;
	} catch {}
	const after = mutationContent(toolName, args, before);
	if (
		after === undefined ||
		after === before ||
		Buffer.byteLength(after, "utf8") > MAX_PREVIEW_BYTES
	)
		return { path: requestedPath };
	const oldName = existed ? `a/${requestedPath}` : "/dev/null";
	const newName = `b/${requestedPath}`;
	return {
		path: requestedPath,
		diff: createTwoFilesPatch(oldName, newName, before, after, "", "", {
			context: 3,
		}),
	};
}
