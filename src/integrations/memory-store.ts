import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Read/search/remove support for the `pi-hermes-memory` extension's
 * Markdown-backed persistent memory. PiTTy talks to Pi over RPC, but the
 * extension exposes memory only as LLM-callable tools (`memory`,
 * `memory_search`), not RPC commands, so this reads the same on-disk files
 * the extension itself owns directly — mirroring its own format
 * (see pi-hermes-memory/src/store/memory-store.ts) rather than depending on it.
 */

export type MemorySource = "memory" | "user" | "failure" | "project";

export type MemoryEntry = {
	/** Stable within a single browse session: `${source}:${index}`. */
	id: string;
	source: MemorySource;
	sourceLabel: string;
	filePath: string;
	/** Index into that file's trimmed §-delimited entry list. */
	index: number;
	/** Exact on-disk entry text (metadata comment included) for safe removal. */
	raw: string;
	/** Decoded, human-readable text with the metadata comment stripped. */
	text: string;
	category: string | undefined;
	created: string | undefined;
	lastReferenced: string | undefined;
	project: string | undefined;
};

export type MemoryFileSnapshot = {
	source: MemorySource;
	sourceLabel: string;
	filePath: string;
	/** Raw file content at read time, used to detect concurrent writers before removal. */
	fileContent: string;
	entries: MemoryEntry[];
};

export type MemorySnapshot = {
	files: MemoryFileSnapshot[];
	entries: MemoryEntry[];
	projectName?: string;
};

const ENTRY_DELIMITER = "\n§\n";

function expandHome(input: string): string {
	if (input === "~") return os.homedir();
	if (input.startsWith("~/") || input.startsWith("~\\")) {
		return path.join(os.homedir(), input.slice(2));
	}
	return input;
}

export function resolveMemoryAgentRoot(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const configured = env.PI_CODING_AGENT_DIR?.trim();
	if (configured) return path.resolve(expandHome(configured));
	return path.join(os.homedir(), ".pi", "agent");
}

/** Directory basename project detection, matching pi-hermes-memory's own `detectProject`. */
export function detectMemoryProjectName(
	cwd: string,
	home: string = os.homedir(),
): string | undefined {
	const resolved = path.resolve(cwd);
	const resolvedHome = path.resolve(home);
	if (resolved === resolvedHome || resolved === path.parse(resolved).root)
		return undefined;
	const name = path.basename(resolved);
	return name && name !== "." && name !== ".." ? name : undefined;
}

export type MemoryFileTarget = {
	source: MemorySource;
	sourceLabel: string;
	filePath: string;
};

export function resolveMemoryFileTargets(
	cwd: string,
	agentRoot: string = resolveMemoryAgentRoot(),
): MemoryFileTarget[] {
	const globalDir = path.join(agentRoot, "pi-hermes-memory");
	const targets: MemoryFileTarget[] = [
		{
			source: "memory",
			sourceLabel: "Memory",
			filePath: path.join(globalDir, "MEMORY.md"),
		},
		{
			source: "user",
			sourceLabel: "User",
			filePath: path.join(globalDir, "USER.md"),
		},
		{
			source: "failure",
			sourceLabel: "Failures",
			filePath: path.join(globalDir, "failures.md"),
		},
	];
	const projectName = detectMemoryProjectName(cwd);
	if (projectName) {
		targets.push({
			source: "project",
			sourceLabel: `Project: ${projectName}`,
			filePath: path.join(
				agentRoot,
				"projects-memory",
				projectName,
				"MEMORY.md",
			),
		});
	}
	return targets;
}

const METADATA_PATTERN =
	/^(.*?)\s*<!--\s*created=([^,]+),\s*last=([^,>]+)(?:,\s*project64=([A-Za-z0-9_-]+))?\s*-->\s*$/s;
const CATEGORY_PATTERN = /^\[([\w-]+)\]\s*/;

export function decodeMemoryEntry(raw: string): {
	text: string;
	category: string | undefined;
	created: string | undefined;
	lastReferenced: string | undefined;
	project: string | undefined;
} {
	const match = raw.match(METADATA_PATTERN);
	let text = raw.trim();
	let created: string | undefined;
	let lastReferenced: string | undefined;
	let project: string | undefined;
	if (match?.[1] !== undefined) {
		text = match[1].trim();
		created = match[2]?.trim();
		lastReferenced = match[3]?.trim();
		if (match[4]) {
			try {
				project =
					Buffer.from(match[4], "base64url").toString("utf-8").trim() ||
					undefined;
			} catch {
				project = undefined;
			}
		}
	}
	const category = text.match(CATEGORY_PATTERN)?.[1];
	return { text, category, created, lastReferenced, project };
}

function splitEntries(fileContent: string): string[] {
	return fileContent.trim()
		? fileContent
				.split(ENTRY_DELIMITER)
				.map((entry) => entry.trim())
				.filter(Boolean)
		: [];
}

function readFileSafe(filePath: string): string | undefined {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function parseMemoryFile(target: MemoryFileTarget): MemoryFileSnapshot {
	const fileContent = readFileSafe(target.filePath) ?? "";
	const rawEntries = splitEntries(fileContent);
	const entries: MemoryEntry[] = rawEntries.map((raw, index) => {
		const decoded = decodeMemoryEntry(raw);
		return {
			id: `${target.source}:${index}`,
			source: target.source,
			sourceLabel: target.sourceLabel,
			filePath: target.filePath,
			index,
			raw,
			...decoded,
		};
	});
	return {
		source: target.source,
		sourceLabel: target.sourceLabel,
		filePath: target.filePath,
		fileContent,
		entries,
	};
}

/** Reads every memory file (global + current project) into one browsable snapshot. */
export function loadMemorySnapshot(
	cwd: string,
	agentRoot: string = resolveMemoryAgentRoot(),
): MemorySnapshot {
	const targets = resolveMemoryFileTargets(cwd, agentRoot);
	const files = targets.map(parseMemoryFile);
	const projectName = detectMemoryProjectName(cwd);
	return {
		files,
		entries: files.flatMap((file) => file.entries),
		...(projectName ? { projectName } : {}),
	};
}

export function filterMemoryEntries(
	entries: MemoryEntry[],
	query: string,
): MemoryEntry[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return entries;
	return entries.filter((entry) =>
		[
			entry.text,
			entry.sourceLabel,
			entry.category ?? "",
			entry.project ?? "",
		].some((value) => value.toLowerCase().includes(normalized)),
	);
}

export type RemoveMemoryEntryResult =
	| { success: true }
	| { success: false; error: string };

/**
 * Removes one entry by rewriting its file. Re-reads the file immediately
 * before writing and refuses if its content no longer matches the snapshot
 * this entry came from (e.g. another Pi session mutated it meanwhile) rather
 * than risk clobbering a concurrent write. This is a lighter-weight,
 * best-effort analogue of the extension's own SQLite mutation lock, which
 * PiTTy does not take.
 */
export function removeMemoryEntry(
	entry: MemoryEntry,
	expectedFileContent: string,
): RemoveMemoryEntryResult {
	const current = readFileSafe(entry.filePath) ?? "";
	if (current !== expectedFileContent) {
		return {
			success: false,
			error:
				"Memory file changed since this was loaded. Reopen the memory browser and try again.",
		};
	}
	const entries = splitEntries(current);
	if (entries[entry.index] !== entry.raw) {
		return {
			success: false,
			error:
				"Memory file changed since this was loaded. Reopen the memory browser and try again.",
		};
	}
	const next = [
		...entries.slice(0, entry.index),
		...entries.slice(entry.index + 1),
	];
	const nextContent = next.length ? next.join(ENTRY_DELIMITER) : "";
	try {
		const dir = path.dirname(entry.filePath);
		const tmpPath = path.join(
			dir,
			`.pitty-memory-${process.pid}-${Date.now()}.tmp`,
		);
		fs.writeFileSync(tmpPath, nextContent, { encoding: "utf8", mode: 0o600 });
		fs.renameSync(tmpPath, entry.filePath);
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	return { success: true };
}
