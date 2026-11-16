import { constants, createReadStream } from "node:fs";
import { lstat, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGunzip } from "node:zlib";
import stripAnsi from "strip-ansi";

export const BG_STATUS_KEY = "pitty.bg.v1";
export const BG_PAGE_BYTES = 64 * 1024;
const MAX_TASKS = 100;
const SESSION_ID = /^[a-zA-Z0-9-]{8,80}$/;
const TASK_ID = /^bg-[1-9]\d{0,6}$/;
const STATES = new Set(["running", "exited", "exit-unknown", "killed"]);

export type BackgroundTask = {
	id: string;
	command: string;
	commandTruncated: boolean;
	cwd: string;
	state: "running" | "exited" | "exit-unknown" | "killed";
	startedAt: number;
	endedAt?: number;
	exitCode?: number;
	reason?: string;
};
export type BackgroundSnapshot = {
	version: 1;
	sessionId: string;
	tasks: BackgroundTask[];
};
export type BackgroundOutputPage = {
	text: string;
	page: number;
	maxPage: number;
	startByte: number;
	endByte: number;
	totalBytes: number;
	compressed: boolean;
	available: boolean;
};

export function parseBackgroundSnapshot(raw: string): BackgroundSnapshot | undefined {
	let value: unknown;
	try { value = JSON.parse(raw); } catch { return undefined; }
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const data = value as Record<string, unknown>;
	if (data.version !== 1 || typeof data.sessionId !== "string" || !SESSION_ID.test(data.sessionId)) return undefined;
	if (!Array.isArray(data.tasks) || data.tasks.length > MAX_TASKS) return undefined;
	const tasks: BackgroundTask[] = [];
	const ids = new Set<string>();
	for (const item of data.tasks) {
		if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
		const t = item as Record<string, unknown>;
		if (typeof t.id !== "string" || !TASK_ID.test(t.id) || ids.has(t.id)) return undefined;
		if (typeof t.command !== "string" || t.command.length > 32768 || typeof t.cwd !== "string" || t.cwd.length > 4096) return undefined;
		if (!STATES.has(t.state as string)) return undefined;
		if (!Number.isSafeInteger(t.startedAt) || Number(t.startedAt) < 0) return undefined;
		if (t.endedAt !== undefined && (!Number.isSafeInteger(t.endedAt) || Number(t.endedAt) < 0)) return undefined;
		if (t.exitCode !== undefined && !Number.isSafeInteger(t.exitCode)) return undefined;
		if (t.reason !== undefined && (typeof t.reason !== "string" || t.reason.length > 128)) return undefined;
		ids.add(t.id);
		tasks.push({
			id: t.id,
			command: t.command,
			commandTruncated: t.commandTruncated === true,
			cwd: t.cwd,
			state: t.state as BackgroundTask["state"],
			startedAt: Number(t.startedAt),
			...(t.endedAt === undefined ? {} : { endedAt: Number(t.endedAt) }),
			...(t.exitCode === undefined ? {} : { exitCode: Number(t.exitCode) }),
			...(t.reason === undefined ? {} : { reason: t.reason as string }),
		});
	}
	return { version: 1, sessionId: data.sessionId, tasks };
}

export function backgroundStatus(task: BackgroundTask): string {
	switch (task.state) {
		case "running": return "running";
		case "exited": return `exit ${task.exitCode ?? "?"}`;
		case "killed": return task.reason ?? "killed";
		default: return "exit unknown";
	}
}

function location(sessionId: string, taskId: string, stateHome: string): string {
	if (!SESSION_ID.test(sessionId) || !TASK_ID.test(taskId)) throw new Error("Invalid background task identity.");
	return path.join(stateHome, "pi-bg", sessionId, `${taskId}.log`);
}

async function regularFile(file: string): Promise<boolean> {
	try {
		const stat = await lstat(file);
		if (stat.isSymbolicLink()) throw new Error("Refusing a symlinked background log.");
		return stat.isFile();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

function pageRange(totalBytes: number, requestedPage: number) {
	const maxPage = Math.max(0, Math.ceil(totalBytes / BG_PAGE_BYTES) - 1);
	const page = Math.min(Math.max(0, Math.floor(requestedPage)), maxPage);
	const endByte = Math.max(0, totalBytes - page * BG_PAGE_BYTES);
	const startByte = Math.max(0, endByte - BG_PAGE_BYTES);
	return { page, maxPage, startByte, endByte };
}

async function plainPage(file: string, requestedPage: number): Promise<BackgroundOutputPage> {
	const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const totalBytes = (await handle.stat()).size;
		const range = pageRange(totalBytes, requestedPage);
		const length = range.endByte - range.startByte;
		const buffer = Buffer.alloc(length);
		let readBytes = 0;
		while (readBytes < length) {
			const { bytesRead } = await handle.read(buffer, readBytes, length - readBytes, range.startByte + readBytes);
			if (!bytesRead) break;
			readBytes += bytesRead;
		}
		return { ...range, text: sanitize(buffer.subarray(0, readBytes).toString("utf8")), totalBytes, compressed: false, available: true };
	} finally {
		await handle.close();
	}
}

async function gzipPage(file: string, requestedPage: number): Promise<BackgroundOutputPage> {
	// pi-bg-bash produces one gzip member, and caps the original log at ~100 MiB.
	// Its ISIZE footer gives the exact uncompressed size in this range.
	const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	let totalBytes: number;
	try {
		const stat = await handle.stat();
		if (stat.size < 18) throw new Error("Truncated background gzip log.");
		const size = Buffer.alloc(4);
		await handle.read(size, 0, 4, stat.size - 4);
		totalBytes = size.readUInt32LE(0);
	} finally { await handle.close(); }
	const range = pageRange(totalBytes, requestedPage);
	const chunks: Buffer[] = [];
	let offset = 0;
	for await (const raw of createReadStream(file).pipe(createGunzip())) {
		const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
		const until = offset + chunk.length;
		if (until > 120 * 1024 * 1024) throw new Error("Background log exceeds the safe decompression limit.");
		const start = Math.max(0, range.startByte - offset);
		const end = Math.min(chunk.length, range.endByte - offset);
		if (end > start) chunks.push(chunk.subarray(start, end));
		offset = until;
	}
	if (offset !== totalBytes) throw new Error("Background gzip log size changed or is corrupt.");
	return { ...range, text: sanitize(Buffer.concat(chunks).toString("utf8")), totalBytes, compressed: true, available: true };
}

function sanitize(raw: string): string {
	// Process-control markers are implementation details, not shell output.
	return stripAnsi(raw)
		.replace(/(^|\n)__PI_BG_(?:EXIT|GONE|LIMIT)__:[a-f0-9]{16}(?::\d+)?(?=\n|$)/g, "")
		.replace(/\r/g, "")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/** Read one bounded page only when the viewer is open; never alter bash_output's cursor. */
export async function readBackgroundOutput(
	sessionId: string,
	taskId: string,
	requestedPage = 0,
	stateHome: string = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
): Promise<BackgroundOutputPage> {
	if (!Number.isSafeInteger(requestedPage) || requestedPage < 0) throw new Error("Invalid output page.");
	const file = location(sessionId, taskId, stateHome);
	const directory = path.dirname(file);
	try {
		const dir = await lstat(directory);
		if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error("Unsafe background log directory.");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { text: "", page: 0, maxPage: 0, startByte: 0, endByte: 0, totalBytes: 0, compressed: false, available: false };
		}
		throw error;
	}
	if (await regularFile(file)) return plainPage(file, requestedPage);
	if (await regularFile(file + ".gz")) return gzipPage(file + ".gz", requestedPage);
	return { text: "", page: 0, maxPage: 0, startByte: 0, endByte: 0, totalBytes: 0, compressed: false, available: false };
}
