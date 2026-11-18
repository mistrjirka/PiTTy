/** Read model and reasoning settings from extension agent markdown profiles. */
import fsp from "node:fs/promises";
import path from "node:path";

export function isMissing(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

export async function readMarkdownNames(directory: string): Promise<string[]> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fsp.readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (isMissing(error)) return [];
		throw error;
	}
	const names: string[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		// Mirror pi-subagent's markdownFiles(): agent profiles are often
		// symlinks (e.g. generated profiles), and Dirent.isFile() is false
		// for them. Fall back to stat like the extension does.
		if (entry.isFile()) {
			names.push(path.basename(entry.name, ".md"));
			continue;
		}
		if (!entry.isSymbolicLink()) continue;
		try {
			const stat = await fsp.stat(path.join(directory, entry.name));
			if (stat.isFile()) names.push(path.basename(entry.name, ".md"));
		} catch {
			// Dangling link: ignore, like the extension does.
		}
	}
	return names;
}

function parseProfileRuntime(
	raw: string,
	thinkingLevels: ReadonlySet<string>,
): {
	model?: string;
	thinking?: string;
} {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
	if (!frontmatter?.[1]) return {};
	let model: string | undefined;
	let thinking: string | undefined;
	for (const line of frontmatter[1].split(/\r?\n/)) {
		const match = /^(model|thinking)\s*:\s*(.+?)\s*$/.exec(line);
		if (!match?.[1] || !match[2]) continue;
		const value = match[2]
			.replace(/\s+#.*$/, "")
			.replace(/^(['"])(.*)\1$/, "$2");
		if (!value.trim()) continue;
		if (match[1] === "model") model = value.trim();
		else thinking = thinkingLevels.has(value.trim()) ? value.trim() : undefined;
	}
	return {
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
	};
}

export async function readProfileRuntime(
	agentDir: string,
	cwd: string,
	thinkingLevels: ReadonlySet<string>,
): Promise<Map<string, { model?: string; thinking?: string }>> {
	const runtimes = new Map<string, { model?: string; thinking?: string }>();
	// Later scopes override earlier ones, matching pi-subagent discovery.
	for (const directory of [
		path.join(agentDir, "agents"),
		path.join(cwd, ".pi", "agents"),
	]) {
		for (const name of await readMarkdownNames(directory)) {
			try {
				const raw = await fsp.readFile(
					path.join(directory, `${name}.md`),
					"utf8",
				);
				runtimes.set(name, parseProfileRuntime(raw, thinkingLevels));
			} catch (error) {
				if (isMissing(error)) continue;
				throw error;
			}
		}
	}
	return runtimes;
}
