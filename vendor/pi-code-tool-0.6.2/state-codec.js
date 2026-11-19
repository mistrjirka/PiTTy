/** Compact snapshots without changing their semantics.
 * Old sessions stored plain JSON. Both formats remain readable.
 */
import { gzipSync, gunzipSync, constants as zlibConstants } from "node:zlib";
const GZIP_MARKER = "pi-code-tool:gzip-v1:";
const MIN_COMPRESS_BYTES = 4 * 1024;
const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
/** Compress large snapshots before they are persisted as tool-result details. */
export function encodeSessionState(json) {
    if (Buffer.byteLength(json, "utf8") < MIN_COMPRESS_BYTES)
        return json;
    return GZIP_MARKER + gzipSync(Buffer.from(json, "utf8"), {
        level: zlibConstants.Z_BEST_SPEED,
    }).toString("base64");
}
/** Accept both historical plain JSON and new compressed snapshots. */
export function decodeSessionState(value) {
    if (!value.startsWith(GZIP_MARKER))
        return value;
    const bytes = Buffer.from(value.slice(GZIP_MARKER.length), "base64");
    return gunzipSync(bytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES }).toString("utf8");
}
