import { randomUUID } from 'node:crypto';
import { closeSync, fstatSync, mkdirSync, openSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { appendCappedUtf8 } from '../core/stdout.js';
// Leave space for the omission marker and retrieval instructions.
export const OUTPUT_PREVIEW_BYTES = 7 * 1024;
export const OUTPUT_STORAGE_BYTES = 64 * 1024 * 1024;
const HALF_PREVIEW_BYTES = OUTPUT_PREVIEW_BYTES / 2;
/** Captures a bounded head/tail preview and spills larger output to a private file. */
export class CodeOutput {
    id = randomUUID();
    text = '';
    head = '';
    tail = '';
    totalBytes = 0;
    storedBytes = 0;
    file;
    overflow = false;
    storageError;
    directory;
    maxStorageBytes;
    storageTruncated = false;
    constructor(directory, maxStorageBytes = OUTPUT_STORAGE_BYTES) {
        this.directory = directory;
        this.maxStorageBytes = maxStorageBytes;
    }
    append(chunk) {
        if (!chunk)
            return;
        this.totalBytes += Buffer.byteLength(chunk);
        if (!this.overflow && this.totalBytes <= OUTPUT_PREVIEW_BYTES) {
            this.text += chunk;
            return;
        }
        if (!this.overflow) {
            this.overflow = true;
            this.head = utf8Prefix(this.text + chunk, HALF_PREVIEW_BYTES);
            this.tail = utf8Suffix(this.text + chunk, HALF_PREVIEW_BYTES);
            try {
                mkdirSync(this.directory, { recursive: true, mode: 0o700 });
                this.file = openSync(join(this.directory, this.id + '.txt'), 'wx', 0o600);
                this.write(this.text);
            }
            catch (error) {
                this.storageFailed(error);
            }
            this.text = '';
        }
        else {
            this.tail = utf8Suffix(this.tail + chunk, HALF_PREVIEW_BYTES);
        }
        this.write(chunk);
    }
    snapshot() {
        if (!this.overflow)
            return this.text;
        const omitted = this.totalBytes - Buffer.byteLength(this.head) - Buffer.byteLength(this.tail);
        return this.head + '\n[... ' + omitted + ' bytes omitted ...]\n' + this.tail;
    }
    finish(toolName) {
        if (this.file !== undefined) {
            try {
                closeSync(this.file);
            }
            catch (error) {
                this.storageFailed(error);
            }
            this.file = undefined;
        }
        let text = this.snapshot();
        if (!this.overflow)
            return { text };
        if (this.storageError) {
            return { text: text + '\n[Could not save omitted output: ' + this.storageError + ']' };
        }
        const output = { id: this.id, bytes: this.totalBytes, storedBytes: this.storedBytes };
        const coverage = this.storedBytes === this.totalBytes
            ? 'Full output saved'
            : 'Saved first ' + this.storedBytes + ' of ' + this.totalBytes + ' bytes; storage limit reached';
        text += '\n[' + coverage + '. Read with ' + toolName + '({"output":"' + this.id + '","offset":0}).]';
        return { text, output };
    }
    write(chunk) {
        if (this.file === undefined || this.storageError || this.storageTruncated)
            return;
        try {
            const remaining = this.maxStorageBytes - this.storedBytes;
            const value = Buffer.from(utf8Prefix(chunk, remaining));
            this.storageTruncated = value.length < Buffer.byteLength(chunk);
            let written = 0;
            while (written < value.length)
                written += writeSync(this.file, value, written);
            this.storedBytes += written;
        }
        catch (error) {
            this.storageFailed(error);
        }
    }
    storageFailed(error) {
        this.storageError = (error instanceof Error ? error.message : String(error)).slice(0, 180);
        if (this.file !== undefined) {
            try {
                closeSync(this.file);
            }
            catch { /* Preserve the original storage error. */ }
            this.file = undefined;
        }
    }
}
/** Reads a bounded UTF-8 page. Returned offsets always lie on character boundaries. */
export function readCodeOutput(directory, id, offset = 0, limit = OUTPUT_PREVIEW_BYTES) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) {
        throw new Error('Invalid output id');
    }
    if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error('offset must be a nonnegative byte offset');
    if (!Number.isSafeInteger(limit) || limit < 4 || limit > OUTPUT_PREVIEW_BYTES) {
        throw new Error('limit must be between 4 and ' + OUTPUT_PREVIEW_BYTES + ' bytes');
    }
    const file = openSync(join(directory, id + '.txt'), 'r');
    try {
        const size = fstatSync(file).size;
        if (offset > size)
            throw new Error('offset is beyond the saved output');
        const buffer = Buffer.alloc(Math.min(limit + 3, size - offset));
        const read = readSync(file, buffer, 0, buffer.length, offset);
        if (read > 0 && (buffer[0] & 0xc0) === 0x80) {
            throw new Error('offset splits a UTF-8 character; use the next offset from the previous page');
        }
        const page = utf8Prefix(buffer.subarray(0, read).toString('utf8'), limit);
        const end = offset + Buffer.byteLength(page);
        const nextOffset = end < size ? end : null;
        const text = page + '\n[Output ' + id + ': bytes ' + offset + '-' + end + ' of ' + size +
            (nextOffset === null ? '; end' : '; next offset: ' + nextOffset) + ']';
        return { text, output: { id, bytes: size, storedBytes: size }, nextOffset };
    }
    finally {
        closeSync(file);
    }
}
function utf8Prefix(text, bytes) {
    if (Buffer.byteLength(text) <= bytes)
        return text;
    return appendCappedUtf8({ text: '', bytes: 0, truncated: false }, text, bytes).text;
}
function utf8Suffix(text, bytes) {
    // At most bytes UTF-16 code units can contribute to a bytes-long suffix.
    let start = Math.max(0, text.length - bytes);
    if (start > 0 && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff)
        start--;
    const buffer = Buffer.from(text.slice(start));
    let offset = Math.max(0, buffer.length - bytes);
    while (offset < buffer.length && (buffer[offset] & 0xc0) === 0x80)
        offset++;
    return buffer.subarray(offset).toString('utf8');
}
