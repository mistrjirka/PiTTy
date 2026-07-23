import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	decodeMemoryEntry,
	detectMemoryProjectName,
	loadMemorySnapshot,
	removeMemoryEntry,
	resolveMemoryFileTargets,
} from "../src/integrations/memory-store.ts";

function tmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pitty-memory-"));
}

describe("decodeMemoryEntry", () => {
	test("strips the metadata comment and reads created/last dates", () => {
		const decoded = decodeMemoryEntry(
			"User prefers pnpm over npm. <!-- created=2026-07-01, last=2026-07-20 -->",
		);
		expect(decoded.text).toBe("User prefers pnpm over npm.");
		expect(decoded.created).toBe("2026-07-01");
		expect(decoded.lastReferenced).toBe("2026-07-20");
		expect(decoded.project).toBeUndefined();
	});

	test("extracts a leading [category] tag", () => {
		const decoded = decodeMemoryEntry(
			"[correction] Do not do that. <!-- created=2026-07-01, last=2026-07-01 -->",
		);
		expect(decoded.category).toBe("correction");
		expect(decoded.text).toBe("[correction] Do not do that.");
	});

	test("decodes a base64url project64 suffix", () => {
		const project64 = Buffer.from("Ghostwriter", "utf-8").toString("base64url");
		const decoded = decodeMemoryEntry(
			`Some scoped failure. <!-- created=2026-07-01, last=2026-07-01, project64=${project64} -->`,
		);
		expect(decoded.project).toBe("Ghostwriter");
	});

	test("falls back gracefully for legacy entries without metadata", () => {
		const decoded = decodeMemoryEntry("Just plain text, no comment.");
		expect(decoded.text).toBe("Just plain text, no comment.");
		expect(decoded.created).toBeUndefined();
	});
});

describe("resolveMemoryFileTargets", () => {
	test("includes global files plus a project file named after the cwd basename", () => {
		const agentRoot = "/home/user/.pi/agent";
		const targets = resolveMemoryFileTargets(
			"/home/user/code/MyProject",
			agentRoot,
		);
		expect(targets.map((t) => t.source)).toEqual([
			"memory",
			"user",
			"failure",
			"project",
		]);
		const project = targets.find((t) => t.source === "project");
		expect(project?.filePath).toBe(
			path.join(agentRoot, "projects-memory", "MyProject", "MEMORY.md"),
		);
	});

	test("omits the project file when cwd is the home directory", () => {
		const home = os.homedir();
		const targets = resolveMemoryFileTargets(home, "/home/user/.pi/agent");
		expect(targets.map((t) => t.source)).toEqual(["memory", "user", "failure"]);
	});
});

describe("detectMemoryProjectName", () => {
	test("returns the basename for a normal project directory", () => {
		expect(detectMemoryProjectName("/home/user/code/PiTTy", "/home/user")).toBe(
			"PiTTy",
		);
	});

	test("returns undefined for the home directory itself", () => {
		expect(detectMemoryProjectName("/home/user", "/home/user")).toBeUndefined();
	});
});

describe("loadMemorySnapshot + removeMemoryEntry", () => {
	test("parses §-delimited entries from disk and removes one safely", () => {
		const agentRoot = tmpDir();
		const globalDir = path.join(agentRoot, "pi-hermes-memory");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(
			path.join(globalDir, "MEMORY.md"),
			[
				"First fact. <!-- created=2026-07-01, last=2026-07-01 -->",
				"§",
				"Second fact. <!-- created=2026-07-02, last=2026-07-02 -->",
			].join("\n"),
		);
		fs.writeFileSync(path.join(globalDir, "USER.md"), "");
		fs.writeFileSync(path.join(globalDir, "failures.md"), "");

		const cwd = path.join(agentRoot, "some-project");
		const snapshot = loadMemorySnapshot(cwd, agentRoot);

		const memoryFile = snapshot.files.find((f) => f.source === "memory");
		expect(memoryFile?.entries.map((e) => e.text)).toEqual([
			"First fact.",
			"Second fact.",
		]);
		expect(snapshot.projectName).toBe("some-project");

		const [first] = memoryFile!.entries;
		const result = removeMemoryEntry(first!, memoryFile!.fileContent);
		expect(result.success).toBe(true);

		const reloaded = loadMemorySnapshot(cwd, agentRoot);
		const reloadedMemory = reloaded.files.find((f) => f.source === "memory");
		expect(reloadedMemory?.entries.map((e) => e.text)).toEqual([
			"Second fact.",
		]);

		fs.rmSync(agentRoot, { recursive: true, force: true });
	});

	test("refuses to remove when the file changed since the snapshot was taken", () => {
		const agentRoot = tmpDir();
		const globalDir = path.join(agentRoot, "pi-hermes-memory");
		fs.mkdirSync(globalDir, { recursive: true });
		const filePath = path.join(globalDir, "MEMORY.md");
		fs.writeFileSync(
			filePath,
			"Only fact. <!-- created=2026-07-01, last=2026-07-01 -->",
		);
		fs.writeFileSync(path.join(globalDir, "USER.md"), "");
		fs.writeFileSync(path.join(globalDir, "failures.md"), "");

		const cwd = path.join(agentRoot, "some-project");
		const snapshot = loadMemorySnapshot(cwd, agentRoot);
		const memoryFile = snapshot.files.find((f) => f.source === "memory")!;
		const [entry] = memoryFile.entries;

		// Simulate a concurrent writer mutating the file after the snapshot was read.
		fs.appendFileSync(
			filePath,
			"\n§\nAnother fact. <!-- created=2026-07-03, last=2026-07-03 -->",
		);

		const result = removeMemoryEntry(entry!, memoryFile.fileContent);
		expect(result.success).toBe(false);

		const stillThere = loadMemorySnapshot(cwd, agentRoot)
			.files.find((f) => f.source === "memory")!
			.entries.map((e) => e.text);
		expect(stillThere).toEqual(["Only fact.", "Another fact."]);

		fs.rmSync(agentRoot, { recursive: true, force: true });
	});

	test("writes an empty file rather than deleting it when the last entry is removed", () => {
		const agentRoot = tmpDir();
		const globalDir = path.join(agentRoot, "pi-hermes-memory");
		fs.mkdirSync(globalDir, { recursive: true });
		const filePath = path.join(globalDir, "USER.md");
		fs.writeFileSync(
			filePath,
			"Only entry. <!-- created=2026-07-01, last=2026-07-01 -->",
		);
		fs.writeFileSync(path.join(globalDir, "MEMORY.md"), "");
		fs.writeFileSync(path.join(globalDir, "failures.md"), "");

		const cwd = path.join(agentRoot, "some-project");
		const snapshot = loadMemorySnapshot(cwd, agentRoot);
		const userFile = snapshot.files.find((f) => f.source === "user")!;
		const result = removeMemoryEntry(
			userFile.entries[0]!,
			userFile.fileContent,
		);
		expect(result.success).toBe(true);
		expect(fs.existsSync(filePath)).toBe(true);
		expect(fs.readFileSync(filePath, "utf8")).toBe("");

		fs.rmSync(agentRoot, { recursive: true, force: true });
	});
});
