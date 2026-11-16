import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import {
	BG_PAGE_BYTES,
	parseBackgroundSnapshot,
	readBackgroundOutput,
	type BackgroundTask,
} from "../src/state/background-tasks.ts";

const fixtures: string[] = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const SESSION = "01a1e377-d9ba-71bc-bddf-ed676a18dbd6";
const TASK = "bg-1";
const sample: BackgroundTask = {
	id: TASK, command: "npm test -- --watch", commandTruncated: false,
	cwd: "/tmp/project", state: "running", startedAt: 123456,
};
async function fixture() {
	const stateHome = await mkdtemp(path.join(os.tmpdir(), "pitty-bg-view-"));
	fixtures.push(stateHome);
	const dir = path.join(stateHome, "pi-bg", SESSION);
	await mkdir(dir, { recursive: true });
	return { stateHome, dir, log: path.join(dir, TASK + ".log") };
}

describe("background task snapshot and log viewer", () => {
	test("accepts validated snapshots without evaluating shell content", () => {
		const value = JSON.stringify({ version: 1, sessionId: SESSION, tasks: [sample] });
		expect(parseBackgroundSnapshot(value)).toEqual({
			version: 1, sessionId: SESSION, tasks: [sample],
		});
		expect(parseBackgroundSnapshot('{"version":1,"sessionId":"../etc","tasks":[]}')).toBeUndefined();
		expect(parseBackgroundSnapshot(JSON.stringify({
			version: 1, sessionId: SESSION, tasks: [{ ...sample, id: "../passwd" }],
		}))).toBeUndefined();
		expect(parseBackgroundSnapshot(JSON.stringify({
			version: 1, sessionId: SESSION, tasks: [{ ...sample, state: "unknown" }],
		}))).toBeUndefined();
		expect(parseBackgroundSnapshot(JSON.stringify({
			version: 1, sessionId: SESSION, tasks: [sample, sample],
		}))).toBeUndefined();
	});

	test("plain logs read in bounded pages, never consume the model's bash_output cursor", async () => {
		const f = await fixture();
		const prefix = "line: " + "x".repeat(90) + "\n";
		const text = prefix.repeat(Math.ceil((BG_PAGE_BYTES * 3) / Buffer.byteLength(prefix)));
		await writeFile(f.log, text + "\n__PI_BG_EXIT__:0123456789abcdef:0\n");
		const newest = await readBackgroundOutput(SESSION, TASK, 0, f.stateHome);
		expect(newest.available).toBe(true);
		expect(newest.compressed).toBe(false);
		expect(newest.startByte).toBeGreaterThan(0);
		expect(newest.text).not.toContain("__PI_BG_EXIT__");
		expect(newest.maxPage).toBeGreaterThanOrEqual(2);
		const older = await readBackgroundOutput(SESSION, TASK, 1, f.stateHome);
		expect(older.endByte).toBe(newest.startByte);
		expect(older.startByte).toBeLessThan(older.endByte);
		expect(older.text).toContain("line:");
		const first = await readBackgroundOutput(SESSION, TASK, 900, f.stateHome);
		expect(first.startByte).toBe(0);
		expect(first.page).toBe(first.maxPage);
	});

	test("finished gzip logs support the same pages without inflating unbounded output", async () => {
		const f = await fixture();
		const text = "completed output\n".repeat(Math.ceil((BG_PAGE_BYTES * 2) / 17));
		await writeFile(f.log + ".gz", gzipSync(text + "__PI_BG_EXIT__:0123456789abcdef:0\n"));
		const newest = await readBackgroundOutput(SESSION, TASK, 0, f.stateHome);
		expect(newest.compressed).toBe(true);
		expect(newest.available).toBe(true);
		expect(newest.text).toContain("completed output");
		expect(newest.text).not.toContain("__PI_BG_EXIT__");
		expect(newest.maxPage).toBeGreaterThanOrEqual(1);
		const older = await readBackgroundOutput(SESSION, TASK, 1, f.stateHome);
		expect(older.endByte).toBe(newest.startByte);
		expect(older.text).toContain("completed output");
	});

	test("empty/unavailable and invalid session paths are handled safely", async () => {
		const f = await fixture();
		expect((await readBackgroundOutput(SESSION, TASK, 0, f.stateHome)).available).toBe(false);
		await expect(readBackgroundOutput("../../secrets", TASK, 0, f.stateHome)).rejects.toThrow("Invalid");
		await expect(readBackgroundOutput(SESSION, "../secrets", 0, f.stateHome)).rejects.toThrow("Invalid");
		await expect(readBackgroundOutput(SESSION, TASK, -1, f.stateHome)).rejects.toThrow("Invalid");
		await symlink(path.join(f.stateHome, "secrets"), f.log);
		await expect(readBackgroundOutput(SESSION, TASK, 0, f.stateHome)).rejects.toThrow("symlink");
	});
});
