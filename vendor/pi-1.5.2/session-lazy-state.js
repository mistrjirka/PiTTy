/** Defer huge, persisted tool-result snapshots until code that needs them accesses state.
 * Store only the byte offset of the JSON string. The on-disk JSONL file is
 * authoritative and is not rewritten to remove content.
 */
import { closeSync, openSync, readSync } from "node:fs";
const MIN_DEFERRED_STATE_BYTES = 256 * 1024;
const deferredStateByDetails = new WeakMap();
export function deferredStateForDetails(details) {
    return deferredStateByDetails.get(details);
}
/** Locate the value of details.state without examining parsed tool contents. */
export function largeDetailsStateRange(line, minBytes = MIN_DEFERRED_STATE_BYTES) {
    if (line.length < minBytes || !line.includes('"details"'))
        return undefined;
    const detailsIndex = line.indexOf('"details"');
    const stateKeyIndex = line.indexOf('"state"', detailsIndex + 9);
    if (stateKeyIndex < 0)
        return undefined;
    let opening = stateKeyIndex + '"state"'.length;
    while (line[opening] === " " || line[opening] === "\t")
        opening++;
    if (line[opening] !== ":")
        return undefined;
    opening++;
    while (line[opening] === " " || line[opening] === "\t")
        opening++;
    if (line[opening] !== '"')
        return undefined;
    let closing = opening + 1;
    while (true) {
        closing = line.indexOf('"', closing);
        if (closing < 0)
            return undefined;
        let backslashes = 0;
        for (let i = closing - 1; i > opening && line[i] === "\\"; i--)
            backslashes++;
        if ((backslashes & 1) === 0)
            break;
        closing++;
    }
    if (closing - opening < minBytes)
        return undefined;
    return { start: opening, end: closing + 1 };
}
function readDeferredState(ref) {
    if (ref.override !== undefined)
        return ref.override;
    const fd = openSync(ref.path, "r");
    try {
        const buffer = Buffer.allocUnsafe(ref.length);
        let total = 0;
        while (total < buffer.length) {
            const count = readSync(fd, buffer, total, buffer.length - total, ref.offset + total);
            if (count === 0)
                throw new Error("Session state snapshot was truncated or replaced.");
            total += count;
        }
        const value = JSON.parse(buffer.toString("utf8"));
        if (typeof value !== "string")
            throw new Error("Session state snapshot is not a string.");
        return value;
    }
    finally {
        closeSync(fd);
    }
}
/**
 * Offload new large tool-result snapshots after the entry has been durably
 * appended. The entry is shared with the live agent history, so replacing the
 * property on the original details object releases the snapshot in both places.
 * Failed optimization must not undo a successful append.
 */
export function deferAppendedSessionState(entry, path, lineOffset) {
    const record = entry;
    if (record.type !== "message" || !record.message || typeof record.message !== "object")
        return;
    const message = record.message;
    if (message.role !== "toolResult" || message.toolName !== "code")
        return;
    const details = message.details;
    if (!details || typeof details !== "object" || Array.isArray(details))
        return;
    const typed = details;
    if (typeof typed.state !== "string" || typed.state.length < MIN_DEFERRED_STATE_BYTES)
        return;
    try {
        const text = JSON.stringify(entry);
        const range = largeDetailsStateRange(text);
        if (!range)
            return;
        const reference = {
            path,
            offset: lineOffset + Buffer.byteLength(text.slice(0, range.start)),
            length: Buffer.byteLength(text.slice(range.start, range.end)),
        };
        installDeferredStateGetter(details, reference);
    }
    catch {
        // The entry is already persisted. Keep the in-memory state if optimization
        // fails rather than throwing after a successful disk write.
    }
}
function installDeferredStateGetter(details, reference) {
    Object.defineProperty(details, "state", {
        configurable: true,
        enumerable: true,
        get: () => readDeferredState(reference),
        set: (next) => {
            reference.override = next;
        },
    });
    deferredStateByDetails.set(details, reference);
}
/** Preserve the full entry contract while keeping a large state off-heap. */
export function parseDeferredSessionEntry(line, filePath, byteOffset) {
    const range = largeDetailsStateRange(line);
    if (!range) {
        try {
            return JSON.parse(line);
        }
        catch {
            return null;
        }
    }
    let parsed;
    try {
        parsed = JSON.parse(`${line.slice(0, range.start)}""${line.slice(range.end)}`);
    }
    catch {
        try {
            return JSON.parse(line);
        }
        catch {
            return null;
        }
    }
    if (!parsed || typeof parsed !== "object")
        return parsed;
    const record = parsed;
    const message = record.message;
    if (record.type !== "message" || !message || typeof message !== "object") {
        try {
            return JSON.parse(line);
        }
        catch {
            return null;
        }
    }
    const result = message;
    const details = result.details;
    if (result.role !== "toolResult" || !details || typeof details !== "object" || Array.isArray(details)) {
        try {
            return JSON.parse(line);
        }
        catch {
            return null;
        }
    }
    const typedDetails = details;
    if (typedDetails.state !== "") {
        try {
            return JSON.parse(line);
        }
        catch {
            return null;
        }
    }
    const reference = {
        path: filePath,
        offset: byteOffset + Buffer.byteLength(line.slice(0, range.start)),
        length: Buffer.byteLength(line.slice(range.start, range.end)),
    };
    installDeferredStateGetter(typedDetails, reference);
    return parsed;
}
