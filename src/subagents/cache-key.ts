import type * as fs from "node:fs";

/**
 * Content-stable hashing and file cache keys shared by the transcript,
 * stream and session caches.
 *
 * Several caches were keyed on `(mtimeMs, size)`, which silently serves a
 * stale parse when two writes land inside one mtime tick with the same byte
 * length (heartbeat rewrites, status refreshes). The keys below mix in the
 * inode + nanosecond mtime where the platform provides them AND a hash of
 * the tail bytes the caller already read, so a same-size rewrite with an
 * unchanged `mtimeMs` is still observed. Reads stay bounded: callers only
 * ever hash bytes they already hold.
 */

/** FNV-1a 32-bit hash rendered as base-36. Deterministic across processes. */
export function stableHash(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

/** Hash the last `tailChars` characters of already-read content. */
export function tailHash(content: string, tailChars = 65_536): string {
	return stableHash(content.length <= tailChars ? content : content.slice(-tailChars));
}

/**
 * Cache key for a file whose content (or its tail) the caller already holds.
 * `size` is mixed in so a pure append without a readable tail still misses.
 */
export function fileContentKey(stat: fs.Stats, content: string): string {
	const anyStat = stat as { ino?: unknown; mtimeNs?: unknown };
	const ino = typeof anyStat.ino === "number" ? anyStat.ino : 0;
	const mtimeNs = typeof anyStat.mtimeNs === "bigint" ? anyStat.mtimeNs.toString() : "";
	return `${stat.mtimeMs}:${stat.size}:${ino}:${mtimeNs}:${tailHash(content)}`;
}

/**
 * Cache key for a file the caller does NOT fully hold: stat fields plus a
 * hash of the last `tailBytes` bytes read just for the key. Cheap (one
 * bounded pread) and observes same-size rewrites even when the clock does
 * not advance.
 */
export function fileTailKey(
	stat: fs.Stats,
	readTail: (length: number, position: number) => string,
	tailBytes = 16_384,
): string {
	const anyStat = stat as { ino?: unknown; mtimeNs?: unknown };
	const ino = typeof anyStat.ino === "number" ? anyStat.ino : 0;
	const mtimeNs = typeof anyStat.mtimeNs === "bigint" ? anyStat.mtimeNs.toString() : "";
	let tail = "";
	try {
		const length = Math.min(stat.size, tailBytes);
		tail = readTail(length, Math.max(0, stat.size - length));
	} catch {
		tail = "unreadable";
	}
	return `${stat.mtimeMs}:${stat.size}:${ino}:${mtimeNs}:${stableHash(tail)}`;
}
