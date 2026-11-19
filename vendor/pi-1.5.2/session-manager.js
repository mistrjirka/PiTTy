import { getCurrentSystemMessage, uuidv7, } from "@earendil-works/pi-ai";
import { randomUUID } from "crypto";
import { appendFileSync, closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync, } from "fs";
import { readdir, stat } from "fs/promises";
import { basename, join, resolve } from "path";
import { createInterface } from "readline";
import { StringDecoder } from "string_decoder";
import { APP_NAME, getAgentDir as getDefaultAgentDir, getSessionsDir } from "../config.js";
import { normalizePath, pathsEqual, resolvePath } from "../utils/paths.js";
import { createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage, } from "./messages.js";
import { deferAppendedSessionState, deferredStateForDetails, largeDetailsStateRange, parseDeferredSessionEntry, } from "./session-lazy-state.js";
export const CURRENT_SESSION_VERSION = 3;
function createSessionId() {
    return uuidv7();
}
export function assertValidSessionId(id) {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)) {
        throw new Error("Session id must be non-empty, contain only alphanumeric characters, '-', '_', and '.', and start and end with an alphanumeric character");
    }
}
/** Generate a unique short ID (8 hex chars, collision-checked) */
function generateId(byId) {
    for (let i = 0; i < 100; i++) {
        const id = randomUUID().slice(0, 8);
        if (!byId.has(id))
            return id;
    }
    // Fallback to full UUID if somehow we have collisions
    return randomUUID();
}
/** Migrate v1 → v2: add id/parentId tree structure. Mutates in place. */
function migrateV1ToV2(entries) {
    const ids = new Set();
    let prevId = null;
    for (const entry of entries) {
        if (entry.type === "session") {
            entry.version = 2;
            continue;
        }
        entry.id = generateId(ids);
        entry.parentId = prevId;
        prevId = entry.id;
        // Convert firstKeptEntryIndex to firstKeptEntryId for compaction
        if (entry.type === "compaction") {
            const comp = entry;
            if (typeof comp.firstKeptEntryIndex === "number") {
                const targetEntry = entries[comp.firstKeptEntryIndex];
                if (targetEntry && targetEntry.type !== "session") {
                    comp.firstKeptEntryId = targetEntry.id;
                }
                delete comp.firstKeptEntryIndex;
            }
        }
    }
}
/** Migrate v2 → v3: rename hookMessage role to custom. Mutates in place. */
function migrateV2ToV3(entries) {
    for (const entry of entries) {
        if (entry.type === "session") {
            entry.version = 3;
            continue;
        }
        // Update message entries with hookMessage role
        if (entry.type === "message") {
            const msgEntry = entry;
            if (msgEntry.message && msgEntry.message.role === "hookMessage") {
                msgEntry.message.role = "custom";
            }
        }
    }
}
/**
 * Run all necessary migrations to bring entries to current version.
 * Mutates entries in place. Returns true if any migration was applied.
 */
function migrateToCurrentVersion(entries) {
    const header = entries.find((e) => e.type === "session");
    const version = header?.version ?? 1;
    if (version >= CURRENT_SESSION_VERSION)
        return false;
    if (version < 2)
        migrateV1ToV2(entries);
    if (version < 3)
        migrateV2ToV3(entries);
    return true;
}
/** Exported for testing */
export function migrateSessionEntries(entries) {
    migrateToCurrentVersion(entries);
}
/** Exported for compaction.test.ts */
export function parseSessionEntries(content) {
    const entries = [];
    const lines = content.trim().split("\n");
    for (const line of lines) {
        if (!line.trim())
            continue;
        try {
            const entry = JSON.parse(line);
            entries.push(entry);
        }
        catch {
            // Skip malformed lines
        }
    }
    return entries;
}
export function getLatestCompactionEntry(entries) {
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].type === "compaction") {
            return entries[i];
        }
    }
    return null;
}
function buildEntryIndex(entries, byId) {
    if (byId)
        return byId;
    const index = new Map();
    for (const entry of entries) {
        index.set(entry.id, entry);
    }
    return index;
}
function buildSessionPath(entries, leafId, byId) {
    const index = buildEntryIndex(entries, byId);
    let leaf;
    if (leafId === null) {
        return [];
    }
    if (leafId) {
        leaf = index.get(leafId);
    }
    leaf ??= entries[entries.length - 1];
    if (!leaf) {
        return [];
    }
    const path = [];
    let current = leaf;
    while (current) {
        path.push(current);
        current = current.parentId ? index.get(current.parentId) : undefined;
    }
    path.reverse();
    return path;
}
function getSessionContextSettings(path) {
    let thinkingLevel = "off";
    let model = null;
    for (const entry of path) {
        if (entry.type === "thinking_level_change") {
            thinkingLevel = entry.thinkingLevel;
        }
        else if (entry.type === "model_change") {
            model = { provider: entry.provider, modelId: entry.modelId };
        }
        else if (entry.type === "message" && entry.message.role === "assistant") {
            model = { provider: entry.message.provider, modelId: entry.message.model };
        }
    }
    return { thinkingLevel, model };
}
/**
 * Project one selected session entry into LLM/runtime messages.
 * Plain custom entries are display/state entries and do not participate in context.
 */
export function sessionEntryToContextMessages(entry) {
    if (entry.type === "message") {
        const message = entry.message;
        // Session files are parsed without validation; old versions, forks, or
        // hand-edited files can contain messages with null/missing content.
        if (message.role === "system" && message.content == null)
            return [{ ...message, content: "" }];
        if ((message.role === "user" || message.role === "assistant" || message.role === "toolResult") &&
            message.content == null) {
            return [{ ...message, content: [] }];
        }
        return [message];
    }
    if (entry.type === "custom_message") {
        return [
            createCustomMessage(entry.customType, entry.content ?? [], entry.display, entry.details, entry.timestamp),
        ];
    }
    if (entry.type === "branch_summary" && entry.summary) {
        return [createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)];
    }
    if (entry.type === "compaction") {
        const summary = createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);
        return entry.systemMessage ? [entry.systemMessage, summary] : [summary];
    }
    return [];
}
/**
 * Build the active, compaction-aware session entry list.
 *
 * This follows the current leaf path. If the path contains compaction entries,
 * the latest compaction is represented by the compaction entry itself, followed
 * by the kept entries starting at firstKeptEntryId and all entries after the
 * compaction entry. Older summarized entries are omitted.
 */
export function buildContextEntries(entries, leafId, byId) {
    const path = buildSessionPath(entries, leafId, byId);
    let compaction = null;
    for (const entry of path) {
        if (entry.type === "compaction") {
            compaction = entry;
        }
    }
    if (!compaction) {
        return path;
    }
    const compactionIdx = path.findIndex((entry) => entry.id === compaction.id);
    if (compactionIdx < 0) {
        return path;
    }
    const contextEntries = [compaction];
    let foundFirstKept = false;
    for (let i = 0; i < compactionIdx; i++) {
        const entry = path[i];
        if (entry.id === compaction.firstKeptEntryId) {
            foundFirstKept = true;
        }
        if (foundFirstKept && !(entry.type === "message" && entry.message.role === "system")) {
            contextEntries.push(entry);
        }
    }
    contextEntries.push(...path.slice(compactionIdx + 1));
    return contextEntries;
}
/**
 * Build the session context from entries using tree traversal.
 * If leafId is provided, walks from that entry to root.
 * Handles compaction and branch summaries along the path.
 */
/** Project one entry into model-visible messages, applying its latest context edit if any. */
export function projectContextEntry(entry, edit) {
    const messages = sessionEntryToContextMessages(entry);
    if (!edit)
        return messages;
    const replacement = edit.replacement;
    if (replacement === null)
        return [];
    return messages.map((message) => {
        if (message.role !== "user" &&
            message.role !== "assistant" &&
            message.role !== "toolResult" &&
            message.role !== "custom") {
            return message;
        }
        const content = (message.role === "assistant" || message.role === "toolResult") && typeof replacement.content === "string"
            ? [{ type: "text", text: replacement.content }]
            : replacement.content;
        return { ...message, content };
    });
}
/** Build provenance-preserving, compaction-aware model context. */
export function buildSessionProjection(entries, leafId, byId) {
    const path = buildSessionPath(entries, leafId, byId);
    const { thinkingLevel, model } = getSessionContextSettings(path);
    const contextEntries = buildContextEntries(entries, leafId, byId);
    const edits = new Map();
    for (const entry of contextEntries) {
        if (entry.type === "context_edit")
            edits.set(entry.targetId, entry);
    }
    const projectedEntries = contextEntries.map((sourceEntry, index) => ({
        sourceEntry,
        // buildContextEntries() may retain an older compaction entry because its
        // raw ID lies inside the newest retained range. Only the newest compaction
        // at index zero contributes a checkpoint and summary.
        messages: sourceEntry.type === "compaction" && index > 0
            ? []
            : projectContextEntry(sourceEntry, edits.get(sourceEntry.id)),
    }));
    return {
        entries: projectedEntries,
        messages: projectedEntries.flatMap((entry) => entry.messages),
        thinkingLevel,
        model,
    };
}
/** Build the finalized model context from the canonical session projection. */
export function buildSessionContext(entries, leafId, byId) {
    const { messages, thinkingLevel, model } = buildSessionProjection(entries, leafId, byId);
    return { messages, thinkingLevel, model };
}
/**
 * Compute the default session directory for a cwd.
 * Encodes cwd into a safe directory name under ~/.pi/agent/sessions/.
 */
function getDefaultSessionDirPath(cwd, agentDir = getDefaultAgentDir()) {
    const resolvedCwd = resolvePath(cwd);
    const resolvedAgentDir = resolvePath(agentDir);
    const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    return join(resolvedAgentDir, "sessions", safePath);
}
export function getDefaultSessionDir(cwd, agentDir = getDefaultAgentDir()) {
    const sessionDir = getDefaultSessionDirPath(cwd, agentDir);
    if (!existsSync(sessionDir)) {
        mkdirSync(sessionDir, { recursive: true });
    }
    return sessionDir;
}
const SESSION_READ_BUFFER_SIZE = 1024 * 1024;
const SESSION_HEADER_READ_BUFFER_SIZE = 4096;
/** Bound synchronous header discovery while allowing large cwd and custom metadata fields. */
const MAX_SESSION_HEADER_SCAN_BYTES = 1024 * 1024;
class SessionHeaderScanLimitError extends Error {
    constructor(filePath) {
        super(`Session header exceeds ${MAX_SESSION_HEADER_SCAN_BYTES}-byte scan limit: ${filePath}`);
        this.name = "SessionHeaderScanLimitError";
    }
}
function parseSessionEntryLine(line) {
    if (!line.trim())
        return null;
    try {
        return JSON.parse(line);
    }
    catch {
        // Skip malformed lines
        return null;
    }
}
/** Exported for testing */
export function loadEntriesFromFile(filePath) {
    const resolvedFilePath = normalizePath(filePath);
    if (!existsSync(resolvedFilePath))
        return [];
    const entries = [];
    // Buffer slices from an open read are reused. Copy only incomplete row fragments
    // and join them once when a newline arrives, avoiding O(n²) concatenation
    // for tool results that contain multi-megabyte replay snapshots.
    let fragments = [];
    let partialLength = 0;
    let byteOffset = 0;
    const fd = openSync(resolvedFilePath, "r");
    try {
        const buffer = Buffer.allocUnsafe(SESSION_READ_BUFFER_SIZE);
        while (true) {
            const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
            if (bytesRead === 0)
                break;
            let start = 0;
            while (start < bytesRead) {
                const newline = buffer.indexOf(10, start);
                if (newline < 0 || newline >= bytesRead)
                    break;
                const tail = buffer.subarray(start, newline);
                const fullLine = fragments.length ? Buffer.concat([...fragments, tail], partialLength + tail.length) : tail;
                const entry = parseDeferredSessionEntry(fullLine.toString("utf8"), resolvedFilePath, byteOffset);
                if (entry)
                    entries.push(entry);
                byteOffset += fullLine.length + 1;
                start = newline + 1;
                fragments = [];
                partialLength = 0;
            }
            if (start < bytesRead) {
                const fragment = Buffer.from(buffer.subarray(start, bytesRead));
                fragments.push(fragment);
                partialLength += fragment.length;
            }
        }
        if (partialLength > 0) {
            const line = Buffer.concat(fragments, partialLength);
            const entry = parseDeferredSessionEntry(line.toString("utf8"), resolvedFilePath, byteOffset);
            if (entry)
                entries.push(entry);
        }
    }
    finally {
        closeSync(fd);
    }
    if (entries.length === 0)
        return entries;
    const header = entries[0];
    if (header.type !== "session" || typeof header.id !== "string") {
        return [];
    }
    if (partialLength > 0)
        appendFileSync(resolvedFilePath, "\n");
    return entries;
}
/**
 * Inspect a physical line while searching for the first parsed session entry.
 * Blank and malformed lines are skipped to match loadEntriesFromFile().
 * Returns undefined to keep scanning, null for a parsed non-header entry, or the header.
 */
function parseSessionHeaderCandidate(line) {
    if (!line.trim())
        return undefined;
    const entry = parseSessionEntryLine(line);
    if (!entry)
        return undefined;
    if (entry.type !== "session" || typeof entry.id !== "string")
        return null;
    return entry;
}
function readSessionHeader(filePath) {
    const fd = openSync(filePath, "r");
    try {
        const decoder = new StringDecoder("utf8");
        const buffer = Buffer.allocUnsafe(SESSION_HEADER_READ_BUFFER_SIZE);
        const lineChunks = [];
        let scannedBytes = 0;
        while (scannedBytes < MAX_SESSION_HEADER_SCAN_BYTES) {
            const readLength = Math.min(buffer.length, MAX_SESSION_HEADER_SCAN_BYTES - scannedBytes);
            const bytesRead = readSync(fd, buffer, 0, readLength, null);
            if (bytesRead === 0) {
                lineChunks.push(decoder.end());
                return parseSessionHeaderCandidate(lineChunks.join("")) ?? null;
            }
            scannedBytes += bytesRead;
            const chunk = decoder.write(buffer.subarray(0, bytesRead));
            let lineStart = 0;
            let newlineIndex = chunk.indexOf("\n", lineStart);
            while (newlineIndex !== -1) {
                lineChunks.push(chunk.slice(lineStart, newlineIndex));
                const header = parseSessionHeaderCandidate(lineChunks.join(""));
                if (header !== undefined)
                    return header;
                lineChunks.length = 0;
                lineStart = newlineIndex + 1;
                newlineIndex = chunk.indexOf("\n", lineStart);
            }
            lineChunks.push(chunk.slice(lineStart));
        }
        // Probe for EOF so a final header without a newline is allowed when it ends
        // exactly at the scan limit. Any additional byte exceeds the bounded scan.
        const probe = Buffer.allocUnsafe(1);
        if (readSync(fd, probe, 0, probe.length, null) === 0) {
            lineChunks.push(decoder.end());
            return parseSessionHeaderCandidate(lineChunks.join("")) ?? null;
        }
        throw new SessionHeaderScanLimitError(filePath);
    }
    finally {
        closeSync(fd);
    }
}
function readSessionHeaderForDiscovery(filePath) {
    try {
        return readSessionHeader(filePath);
    }
    catch {
        // Discovery is best-effort: unreadable or oversized files are not sessions,
        // and one corrupt file must not prevent other sessions from being found.
        return null;
    }
}
function getSessionHeaderCwd(header) {
    const cwd = header.cwd;
    return typeof cwd === "string" ? cwd : undefined;
}
function sessionCwdMatches(cwd, resolvedCwd) {
    return cwd !== undefined && cwd !== "" && pathsEqual(resolvePath(cwd), resolvedCwd);
}
/** Exported for testing */
export function findMostRecentSession(sessionDir, cwd) {
    const resolvedSessionDir = normalizePath(sessionDir);
    const resolvedCwd = cwd ? resolvePath(cwd) : undefined;
    try {
        const files = readdirSync(resolvedSessionDir)
            .filter((file) => file.endsWith(".jsonl"))
            .map((file) => join(resolvedSessionDir, file))
            .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        for (const { path } of files) {
            const header = readSessionHeaderForDiscovery(path);
            if (header && (!resolvedCwd || sessionCwdMatches(getSessionHeaderCwd(header), resolvedCwd)))
                return path;
        }
        return null;
    }
    catch {
        // Directory access and stat races make recent-session discovery unavailable.
        return null;
    }
}
function isMessageWithContent(message) {
    return typeof message.role === "string" && "content" in message;
}
function extractTextContent(message) {
    const content = message.content;
    if (typeof content === "string") {
        return content;
    }
    return content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(" ");
}
function getMessageActivityTime(entry) {
    const message = entry.message;
    if (!isMessageWithContent(message))
        return undefined;
    if (message.role !== "user" && message.role !== "assistant")
        return undefined;
    const msgTimestamp = message.timestamp;
    if (typeof msgTimestamp === "number") {
        return msgTimestamp;
    }
    const t = new Date(entry.timestamp).getTime();
    return Number.isNaN(t) ? undefined : t;
}
async function buildSessionInfo(filePath, signal, fileStats) {
    try {
        const stats = fileStats ?? (await stat(filePath));
        let header = null;
        let messageCount = 0;
        let firstMessage = "";
        const allMessages = [];
        let name;
        let lastActivityTime;
        // No signal for the stream: leaving the loop early stops readline from listening for the stream's
        // errors, so a later abort would destroy it with an 'error' no listener handles (#11956). The loop
        // checks the signal instead, and the stream is destroyed when reading stops, closing its file.
        const stream = createReadStream(filePath, { encoding: "utf8" });
        try {
            const rl = createInterface({ input: stream, crlfDelay: Infinity });
            for await (const line of rl) {
                signal?.throwIfAborted();
                const entry = parseSessionEntryLine(line);
                if (!entry)
                    continue;
                if (!header) {
                    if (entry.type !== "session")
                        return null;
                    header = entry;
                    continue;
                }
                // Extract session name (use latest, including explicit clears)
                if (entry.type === "session_info") {
                    name = entry.name?.trim() || undefined;
                }
                if (entry.type !== "message")
                    continue;
                messageCount++;
                const activityTime = getMessageActivityTime(entry);
                if (typeof activityTime === "number") {
                    lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
                }
                const message = entry.message;
                if (!isMessageWithContent(message))
                    continue;
                if (message.role !== "user" && message.role !== "assistant")
                    continue;
                const textContent = extractTextContent(message);
                if (!textContent)
                    continue;
                allMessages.push(textContent);
                if (!firstMessage && message.role === "user") {
                    firstMessage = textContent;
                }
            }
        }
        finally {
            stream.destroy();
        }
        // An abort while readline waited for the end of the file, after the last line.
        signal?.throwIfAborted();
        if (!header)
            return null;
        const cwd = typeof header.cwd === "string" ? header.cwd : "";
        const parentSessionPath = header.parentSession;
        const headerTime = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
        const modified = typeof lastActivityTime === "number" && lastActivityTime > 0
            ? new Date(lastActivityTime)
            : !Number.isNaN(headerTime)
                ? new Date(headerTime)
                : stats.mtime;
        return {
            path: filePath,
            id: header.id,
            cwd,
            name,
            parentSessionPath,
            created: new Date(header.timestamp),
            modified,
            messageCount,
            firstMessage: firstMessage || "(no messages)",
            allMessagesText: allMessages.join(" "),
        };
    }
    catch {
        signal?.throwIfAborted();
        return null;
    }
}
const MAX_CONCURRENT_SESSION_INFO_LOADS = 10;
const MAX_CONCURRENT_SESSION_DISCOVERY_LOADS = 64;
const CURRENT_SESSION_LIST_PUBLISH_INTERVAL = 10;
const ALL_SESSION_LIST_PUBLISH_INTERVAL = 100;
async function mapWithConcurrency(items, limit, map, signal) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const worker = async () => {
        while (nextIndex < items.length) {
            signal?.throwIfAborted();
            const index = nextIndex++;
            results[index] = await map(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return results;
}
function sortSessionInfos(sessions) {
    return sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}
function buildSessionInfosWithConcurrency(files, onLoaded, signal) {
    return mapWithConcurrency(files, MAX_CONCURRENT_SESSION_INFO_LOADS, async (file, index) => {
        const info = await buildSessionInfo(file.path, signal, file.stats);
        onLoaded(info, index);
        return info;
    }, signal);
}
async function listSessionsFromDir(dir, onProgress, signal) {
    signal?.throwIfAborted();
    if (!existsSync(dir))
        return [];
    try {
        const dirEntries = await readdir(dir);
        const files = dirEntries
            .filter((file) => file.endsWith(".jsonl"))
            .sort((a, b) => b.localeCompare(a))
            .map((file) => ({ path: join(dir, file) }));
        const total = files.length;
        const partialSessions = [];
        let loaded = 0;
        const results = await buildSessionInfosWithConcurrency(files, (info) => {
            loaded++;
            if (info)
                partialSessions.push(info);
            const publishPartial = loaded === 1 || loaded % CURRENT_SESSION_LIST_PUBLISH_INTERVAL === 0 || loaded === files.length;
            onProgress?.(loaded, total, publishPartial ? sortSessionInfos([...partialSessions]) : undefined);
        }, signal);
        return results.filter((info) => info !== null);
    }
    catch {
        signal?.throwIfAborted();
        return [];
    }
}
/**
 * Manages conversation sessions as append-only trees stored in JSONL files.
 *
 * Each session entry has an id and parentId forming a tree structure. The "leaf"
 * pointer tracks the current position. Appending creates a child of the current leaf.
 * Branching moves the leaf to an earlier entry, allowing new branches without
 * modifying history.
 *
 * Use buildSessionContext() to get the resolved message list for the LLM, which
 * handles compaction summaries and follows the path from root to current leaf.
 */
export class SessionManager {
    sessionId = "";
    sessionFile;
    sessionDir;
    cwd;
    persist;
    flushed = false;
    fileEntries = [];
    byId = new Map();
    labelsById = new Map();
    labelTimestampsById = new Map();
    leafId = null;
    constructor(cwd, sessionDir, sessionFile, persist, newSessionOptions, preloadedFileEntries) {
        this.cwd = resolvePath(cwd);
        this.sessionDir = normalizePath(sessionDir);
        this.persist = persist;
        if (persist && this.sessionDir && !existsSync(this.sessionDir)) {
            mkdirSync(this.sessionDir, { recursive: true });
        }
        if (sessionFile) {
            this._setSessionFile(sessionFile, preloadedFileEntries);
        }
        else if (preloadedFileEntries?.length) {
            this._loadEntries(preloadedFileEntries, newSessionOptions);
        }
        else {
            this.newSession(newSessionOptions);
        }
    }
    /** Switch to a different session file (used for resume and branching) */
    setSessionFile(sessionFile) {
        this._setSessionFile(sessionFile);
    }
    _setSessionFile(sessionFile, preloadedFileEntries) {
        this.sessionFile = resolvePath(sessionFile);
        if (existsSync(this.sessionFile)) {
            const entries = preloadedFileEntries ?? loadEntriesFromFile(this.sessionFile);
            // If file was empty, initialize it with a valid session header. If it was
            // non-empty but did not parse as a pi session, fail without modifying it.
            if (entries.length === 0) {
                const explicitPath = this.sessionFile;
                if (statSync(explicitPath).size > 0) {
                    throw new Error(`Session file is not a valid ${APP_NAME} session: ${explicitPath}`);
                }
                this.newSession();
                this.sessionFile = explicitPath;
                this._rewriteFile();
                this.flushed = true;
                return;
            }
            this._loadEntries(entries);
            this.flushed = true;
        }
        else {
            const explicitPath = this.sessionFile;
            this.newSession();
            this.sessionFile = explicitPath; // preserve explicit path from --session flag
        }
    }
    newSession(options) {
        if (options?.id !== undefined) {
            assertValidSessionId(options.id);
        }
        this.sessionId = options?.id ?? createSessionId();
        const timestamp = new Date().toISOString();
        const header = {
            type: "session",
            version: CURRENT_SESSION_VERSION,
            id: this.sessionId,
            timestamp,
            cwd: this.cwd,
            parentSession: options?.parentSession,
        };
        this.fileEntries = [header];
        this.byId.clear();
        this.labelsById.clear();
        this.labelTimestampsById.clear();
        this.leafId = null;
        this.flushed = false;
        if (this.persist) {
            const fileTimestamp = timestamp.replace(/[:.]/g, "-");
            this.sessionFile = join(this.getSessionDir(), `${fileTimestamp}_${this.sessionId}.jsonl`);
        }
        return this.sessionFile;
    }
    _loadEntries(entries, options) {
        const header = entries.find((e) => e.type === "session");
        if (header) {
            this.fileEntries = entries;
            this.sessionId = header.id;
            if (migrateToCurrentVersion(this.fileEntries)) {
                this._rewriteFile();
            }
        }
        else {
            this.newSession(options);
            this.fileEntries = this.fileEntries.concat(entries);
        }
        this._buildIndex();
    }
    _buildIndex() {
        this.byId.clear();
        this.labelsById.clear();
        this.labelTimestampsById.clear();
        this.leafId = null;
        for (const entry of this.fileEntries) {
            if (entry.type === "session")
                continue;
            this.byId.set(entry.id, entry);
            this.leafId = entry.id;
            if (entry.type === "label") {
                if (entry.label) {
                    this.labelsById.set(entry.targetId, entry.label);
                    this.labelTimestampsById.set(entry.targetId, entry.timestamp);
                }
                else {
                    this.labelsById.delete(entry.targetId);
                    this.labelTimestampsById.delete(entry.targetId);
                }
            }
        }
    }
    _rewriteFile() {
        if (!this.persist || !this.sessionFile)
            return;
        // Keep the old file readable until the replacement is complete. Stream
        // large deferred state strings directly from the original JSONL file,
        // without materializing all interpreter snapshots during migration.
        const target = this.sessionFile;
        const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
        const statePositions = [];
        let succeeded = false;
        try {
            const mode = existsSync(target) ? statSync(target).mode & 0o777 : 0o600;
            const fd = openSync(temporary, "wx", mode);
            try {
                let byteOffset = 0;
                const buffer = Buffer.allocUnsafe(1024 * 1024);
                for (const entry of this.fileEntries) {
                    let reference;
                    let serializable = entry;
                    if (entry.type === "message" && entry.message.role === "toolResult") {
                        const details = entry.message.details;
                        if (details && typeof details === "object") {
                            const deferred = deferredStateForDetails(details);
                            if (deferred && deferred.override === undefined) {
                                reference = deferred;
                                const shallowDetails = {};
                                for (const [key, value] of Object.entries(details)) {
                                    shallowDetails[key] = key === "state" ? "" : value;
                                }
                                serializable = {
                                    ...entry,
                                    message: { ...entry.message, details: shallowDetails },
                                };
                            }
                        }
                    }
                    const serialized = JSON.stringify(serializable);
                    if (!reference) {
                        writeFileSync(fd, `${serialized}\n`);
                        byteOffset += Buffer.byteLength(serialized) + 1;
                        continue;
                    }
                    const range = largeDetailsStateRange(serialized, 0);
                    if (!range)
                        throw new Error("Unable to locate deferred state in rewritten session.");
                    const prefix = serialized.slice(0, range.start);
                    const suffix = serialized.slice(range.end);
                    writeSync(fd, prefix);
                    const offset = byteOffset + Buffer.byteLength(prefix);
                    const srcFd = openSync(reference.path, "r");
                    try {
                        let copied = 0;
                        while (copied < reference.length) {
                            const length = Math.min(buffer.length, reference.length - copied);
                            const read = readSync(srcFd, buffer, 0, length, reference.offset + copied);
                            if (!read)
                                throw new Error("Deferred state was truncated while rewriting session.");
                            writeSync(fd, buffer, 0, read);
                            copied += read;
                        }
                    }
                    finally {
                        closeSync(srcFd);
                    }
                    writeSync(fd, `${suffix}\n`);
                    statePositions.push({ reference, offset, length: reference.length });
                    byteOffset = offset + reference.length + Buffer.byteLength(suffix) + 1;
                }
            }
            finally {
                closeSync(fd);
            }
            renameSync(temporary, target);
            for (const { reference, offset, length } of statePositions) {
                reference.path = target;
                reference.offset = offset;
                reference.length = length;
            }
            succeeded = true;
        }
        finally {
            if (!succeeded) {
                try {
                    unlinkSync(temporary);
                }
                catch {
                    /* Original file remains intact. */
                }
            }
        }
    }
    isPersisted() {
        return this.persist;
    }
    getCwd() {
        return this.cwd;
    }
    getSessionDir() {
        return this.sessionDir;
    }
    usesDefaultSessionDir() {
        return pathsEqual(this.sessionDir, getDefaultSessionDirPath(this.cwd));
    }
    getSessionId() {
        return this.sessionId;
    }
    getSessionFile() {
        return this.sessionFile;
    }
    /**
     * A new session file is created only once the session contains a user or assistant message.
     * Setup entries alone (model, thinking level, system prompt) stay in memory so opening and
     * closing pi without chatting leaves no file behind. Starting at the user message (not the
     * first assistant reply) keeps the prompt on disk if the first turn never completes (#10000).
     */
    _hasConversation() {
        return this.fileEntries.some((e) => e.type === "message" && (e.message.role === "user" || e.message.role === "assistant"));
    }
    _persist(entry) {
        if (!this.persist || !this.sessionFile)
            return;
        if (!this.flushed) {
            if (!this._hasConversation())
                return;
            const fd = openSync(this.sessionFile, "wx");
            try {
                for (const e of this.fileEntries) {
                    writeFileSync(fd, `${JSON.stringify(e)}\n`);
                }
            }
            finally {
                closeSync(fd);
            }
            this.flushed = true;
        }
        else {
            appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
        }
    }
    _appendEntry(entry) {
        const previousLeafId = this.leafId;
        this.fileEntries.push(entry);
        this.byId.set(entry.id, entry);
        this.leafId = entry.id;
        // Record the physical append point for lazy retention of new code-tool
        // snapshots. The first flush is handled by the normal loader on resume.
        const appendOffset = this.persist && this.flushed && this.sessionFile ? statSync(this.sessionFile).size : undefined;
        try {
            this._persist(entry);
        }
        catch (error) {
            // Keep memory in line with the file: an entry that was not written must not become the
            // parent of later entries, or the file would hold entries pointing to a missing parent.
            this.fileEntries.pop();
            this.byId.delete(entry.id);
            this.leafId = previousLeafId;
            throw error;
        }
        if (appendOffset !== undefined && this.sessionFile) {
            deferAppendedSessionState(entry, this.sessionFile, appendOffset);
        }
    }
    /** Append a message as child of current leaf, then advance leaf. Returns entry id.
     * Does not allow writing CompactionSummaryMessage and BranchSummaryMessage directly.
     * Reason: we want these to be top-level entries in the session, not message session entries,
     * so it is easier to find them.
     * These need to be appended via appendCompaction() and appendBranchSummary() methods.
     */
    appendMessage(message) {
        const entry = {
            type: "message",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            message,
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Append a thinking level change as child of current leaf, then advance leaf. Returns entry id. */
    appendThinkingLevelChange(thinkingLevel) {
        const entry = {
            type: "thinking_level_change",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            thinkingLevel,
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Append a model change as child of current leaf, then advance leaf. Returns entry id. */
    appendModelChange(provider, modelId) {
        const entry = {
            type: "model_change",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            provider,
            modelId,
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Append model-attributed usage that does not participate in LLM context. Returns the appended entry. */
    appendUsage(kind, provider, model, usage, note) {
        const entry = {
            type: "usage",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            kind,
            provider,
            model,
            usage,
            ...(note ? { note } : {}),
        };
        this._appendEntry(entry);
        return entry;
    }
    /** Append a compaction summary as child of current leaf, then advance leaf. Returns entry id. */
    appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromHook, usage) {
        const timestamp = new Date().toISOString();
        const systemMessage = getCurrentSystemMessage(this.buildSessionProjection().messages);
        const id = generateId(this.byId);
        const entry = {
            type: "compaction",
            id,
            parentId: this.leafId,
            timestamp,
            summary,
            firstKeptEntryId: firstKeptEntryId ?? id,
            tokensBefore,
            details,
            usage,
            fromHook,
            ...(systemMessage ? { systemMessage: { ...systemMessage, timestamp: new Date(timestamp).getTime() } } : {}),
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Append a custom entry (for extensions) as child of current leaf, then advance leaf. Returns entry id. */
    appendCustomEntry(customType, data) {
        const entry = {
            type: "custom",
            customType,
            data,
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Append a session info entry (e.g., display name). Returns entry id. */
    appendSessionInfo(name) {
        const sanitizedName = name.replace(/[\r\n]+/g, " ").trim();
        const entry = {
            type: "session_info",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            name: sanitizedName,
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Get the current session name from the latest session_info entry, if any. */
    getSessionName() {
        // Walk entries in reverse to find the latest session_info entry.
        // Empty names explicitly clear the session title. Reads fileEntries directly: the footer
        // calls this on every frame, and getEntries() copies the whole session.
        for (let i = this.fileEntries.length - 1; i >= 0; i--) {
            const entry = this.fileEntries[i];
            if (entry.type === "session_info") {
                return entry.name?.trim() || undefined;
            }
        }
        return undefined;
    }
    /**
     * Append a custom message entry (for extensions) that participates in LLM context.
     * @param customType Extension identifier for filtering on reload
     * @param content Message content (string or TextContent/ImageContent array)
     * @param display Whether to show in TUI (true = styled display, false = hidden)
     * @param details Optional extension-specific metadata (not sent to LLM)
     * @returns Entry id
     */
    appendCustomMessageEntry(customType, content, display, details) {
        const entry = {
            type: "custom_message",
            customType,
            content,
            display,
            details,
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Append a branch-local edit to an earlier model-visible entry. */
    appendContextEdit(targetId, replacement) {
        if (replacement !== null &&
            (typeof replacement !== "object" ||
                !("content" in replacement) ||
                (typeof replacement.content !== "string" && !Array.isArray(replacement.content)))) {
            throw new Error("Context edit replacement must be null or contain string/array content");
        }
        const target = this.byId.get(targetId);
        if (!target)
            throw new Error(`Entry ${targetId} not found`);
        if (!this.getBranch().some((entry) => entry.id === targetId)) {
            throw new Error(`Entry ${targetId} is not on the active branch`);
        }
        const editable = target.type === "custom_message" ||
            (target.type === "message" &&
                (target.message.role === "user" ||
                    target.message.role === "assistant" ||
                    target.message.role === "toolResult"));
        if (!editable)
            throw new Error(`Entry ${targetId} does not contribute editable model content`);
        const targetRole = target.type === "message" ? target.message.role : "custom";
        const normalizedReplacement = replacement !== null &&
            (targetRole === "assistant" || targetRole === "toolResult") &&
            typeof replacement.content === "string"
            ? { content: [{ type: "text", text: replacement.content }] }
            : replacement;
        const entry = {
            type: "context_edit",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            targetId,
            replacement: normalizedReplacement,
        };
        this._appendEntry(entry);
        return entry.id;
    }
    // =========================================================================
    // Tree Traversal
    // =========================================================================
    getLeafId() {
        return this.leafId;
    }
    getLeafEntry() {
        return this.leafId ? this.byId.get(this.leafId) : undefined;
    }
    getEntry(id) {
        return this.byId.get(id);
    }
    /**
     * Get all direct children of an entry.
     */
    getChildren(parentId) {
        const children = [];
        for (const entry of this.byId.values()) {
            if (entry.parentId === parentId) {
                children.push(entry);
            }
        }
        return children;
    }
    /**
     * Get the label for an entry, if any.
     */
    getLabel(id) {
        return this.labelsById.get(id);
    }
    /**
     * Set or clear a label on an entry.
     * Labels are user-defined markers for bookmarking/navigation.
     * Pass undefined or empty string to clear the label.
     */
    appendLabelChange(targetId, label) {
        if (!this.byId.has(targetId)) {
            throw new Error(`Entry ${targetId} not found`);
        }
        const entry = {
            type: "label",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            targetId,
            label,
        };
        this._appendEntry(entry);
        if (label) {
            this.labelsById.set(targetId, label);
            this.labelTimestampsById.set(targetId, entry.timestamp);
        }
        else {
            this.labelsById.delete(targetId);
            this.labelTimestampsById.delete(targetId);
        }
        return entry.id;
    }
    /**
     * Walk from entry to root, returning all entries in path order.
     * Includes all entry types (messages, compaction, model changes, etc.).
     * Use buildSessionContext() to get the resolved messages for the LLM.
     */
    getBranch(fromId) {
        const path = [];
        const startId = fromId ?? this.leafId;
        let current = startId ? this.byId.get(startId) : undefined;
        while (current) {
            path.push(current);
            current = current.parentId ? this.byId.get(current.parentId) : undefined;
        }
        path.reverse();
        return path;
    }
    /**
     * Build the active, compaction-aware entry list for context/rendering.
     * Uses tree traversal from current leaf.
     */
    buildContextEntries() {
        return buildContextEntries(this.getEntries(), this.leafId, this.byId);
    }
    /**
     * Build the session context (what gets sent to the LLM).
     * Uses tree traversal from current leaf.
     */
    buildSessionProjection() {
        return buildSessionProjection(this.getEntries(), this.leafId, this.byId);
    }
    buildSessionContext() {
        const { messages, thinkingLevel, model } = this.buildSessionProjection();
        return { messages, thinkingLevel, model };
    }
    /**
     * Get session header.
     */
    getHeader() {
        const h = this.fileEntries.find((e) => e.type === "session");
        return h ? h : null;
    }
    /** Number of session entries (excludes header), without copying them like `getEntries()`. */
    getEntryCount() {
        return this.byId.size;
    }
    /**
     * Get all session entries (excludes header). Returns a shallow copy.
     * The session is append-only: use appendXXX() to add entries, branch() to
     * change the leaf pointer. Entries cannot be modified or deleted.
     */
    getEntries() {
        return this.fileEntries.filter((e) => e.type !== "session");
    }
    /**
     * Get the session as a tree structure. Returns a shallow defensive copy of all entries.
     * A well-formed session has exactly one root (first entry with parentId === null).
     * Orphaned entries (broken parent chain) are also returned as roots.
     */
    getTree() {
        const entries = this.getEntries();
        const nodeMap = new Map();
        const roots = [];
        // Create nodes with resolved labels
        for (const entry of entries) {
            const label = this.labelsById.get(entry.id);
            const labelTimestamp = this.labelTimestampsById.get(entry.id);
            nodeMap.set(entry.id, { entry, children: [], label, labelTimestamp });
        }
        // Build tree
        for (const entry of entries) {
            const node = nodeMap.get(entry.id);
            if (entry.parentId === null || entry.parentId === entry.id) {
                roots.push(node);
            }
            else {
                const parent = nodeMap.get(entry.parentId);
                if (parent) {
                    parent.children.push(node);
                }
                else {
                    // Orphan - treat as root
                    roots.push(node);
                }
            }
        }
        // Sort children by timestamp (oldest first, newest at bottom)
        // Use iterative approach to avoid stack overflow on deep trees
        const stack = [...roots];
        while (stack.length > 0) {
            const node = stack.pop();
            node.children.sort((a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime());
            stack.push(...node.children);
        }
        return roots;
    }
    // =========================================================================
    // Branching
    // =========================================================================
    /**
     * Start a new branch from an earlier entry.
     * Moves the leaf pointer to the specified entry. The next appendXXX() call
     * will create a child of that entry, forming a new branch. Existing entries
     * are not modified or deleted.
     */
    branch(branchFromId) {
        if (!this.byId.has(branchFromId)) {
            throw new Error(`Entry ${branchFromId} not found`);
        }
        this.leafId = branchFromId;
    }
    /**
     * Reset the leaf pointer to null (before any entries).
     * The next appendXXX() call will create a new root entry (parentId = null).
     * Use this when navigating to re-edit the first user message.
     */
    resetLeaf() {
        this.leafId = null;
    }
    /**
     * Start a new branch with a summary of the abandoned path.
     * Same as branch(), but also appends a branch_summary entry that captures
     * context from the abandoned conversation path.
     */
    branchWithSummary(branchFromId, summary, details, fromHook, usage) {
        if (branchFromId !== null && !this.byId.has(branchFromId)) {
            throw new Error(`Entry ${branchFromId} not found`);
        }
        const fromId = this.leafId ?? "root";
        this.leafId = branchFromId;
        const entry = {
            type: "branch_summary",
            id: generateId(this.byId),
            parentId: branchFromId,
            timestamp: new Date().toISOString(),
            fromId,
            summary,
            details,
            usage,
            fromHook,
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /**
     * Create a new session file containing only the path from root to the specified leaf.
     * Useful for extracting a single conversation path from a branched session.
     * Returns the new session file path, or undefined if not persisting.
     */
    createBranchedSession(leafId) {
        const previousSessionFile = this.sessionFile;
        const path = this.getBranch(leafId);
        if (path.length === 0) {
            throw new Error(`Entry ${leafId} not found`);
        }
        // Filter out LabelEntry from path - we'll recreate them from the resolved map.
        // Because labels are real tree entries, later entries can be children of labels;
        // removing labels requires re-chaining the retained path to avoid orphaned subtrees.
        const pathWithoutLabels = [];
        const replacementByLabelId = new Map();
        const pendingLabelIds = [];
        let pathParentId = null;
        for (const entry of path) {
            if (entry.type === "label") {
                pendingLabelIds.push(entry.id);
                continue;
            }
            for (const labelId of pendingLabelIds) {
                replacementByLabelId.set(labelId, entry.id);
            }
            pendingLabelIds.length = 0;
            pathWithoutLabels.push(entry.type === "compaction"
                ? {
                    ...entry,
                    parentId: pathParentId,
                    firstKeptEntryId: entry.firstKeptEntryId === entry.id
                        ? entry.id
                        : (replacementByLabelId.get(entry.firstKeptEntryId) ?? entry.firstKeptEntryId),
                }
                : { ...entry, parentId: pathParentId });
            pathParentId = entry.id;
        }
        const newSessionId = createSessionId();
        const timestamp = new Date().toISOString();
        const fileTimestamp = timestamp.replace(/[:.]/g, "-");
        const newSessionFile = join(this.getSessionDir(), `${fileTimestamp}_${newSessionId}.jsonl`);
        const header = {
            type: "session",
            version: CURRENT_SESSION_VERSION,
            id: newSessionId,
            timestamp,
            cwd: this.cwd,
            parentSession: this.persist ? previousSessionFile : undefined,
        };
        // Collect labels for entries in the path
        const pathEntryIds = new Set(pathWithoutLabels.map((e) => e.id));
        const labelsToWrite = [];
        for (const [targetId, label] of this.labelsById) {
            if (pathEntryIds.has(targetId)) {
                labelsToWrite.push({ targetId, label, timestamp: this.labelTimestampsById.get(targetId) });
            }
        }
        if (this.persist) {
            // Build label entries
            const lastEntryId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id || null;
            let parentId = lastEntryId;
            const labelEntries = [];
            for (const { targetId, label, timestamp: labelTimestamp } of labelsToWrite) {
                const labelEntry = {
                    type: "label",
                    id: generateId(new Set(pathEntryIds)),
                    parentId,
                    timestamp: labelTimestamp,
                    targetId,
                    label,
                };
                pathEntryIds.add(labelEntry.id);
                labelEntries.push(labelEntry);
                parentId = labelEntry.id;
            }
            this.fileEntries = [header, ...pathWithoutLabels, ...labelEntries];
            this.sessionId = newSessionId;
            this.sessionFile = newSessionFile;
            this._buildIndex();
            // Use the same rule as _persist(): write now if the branched path already
            // has a conversation, otherwise let _persist() create the file later.
            if (this._hasConversation()) {
                this._rewriteFile();
                this.flushed = true;
            }
            else {
                this.flushed = false;
            }
            return newSessionFile;
        }
        // In-memory mode: replace current session with the path + labels
        const labelEntries = [];
        let parentId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id || null;
        for (const { targetId, label, timestamp: labelTimestamp } of labelsToWrite) {
            const labelEntry = {
                type: "label",
                id: generateId(new Set([...pathEntryIds, ...labelEntries.map((e) => e.id)])),
                parentId,
                timestamp: labelTimestamp,
                targetId,
                label,
            };
            labelEntries.push(labelEntry);
            parentId = labelEntry.id;
        }
        this.fileEntries = [header, ...pathWithoutLabels, ...labelEntries];
        this.sessionId = newSessionId;
        this._buildIndex();
        return undefined;
    }
    /**
     * Create a new session.
     * @param cwd Working directory (stored in session header)
     * @param sessionDir Optional session directory. If omitted, uses default (~/.pi/agent/sessions/<encoded-cwd>/).
     */
    static create(cwd, sessionDir, options) {
        const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
        return new SessionManager(cwd, dir, undefined, true, options);
    }
    /**
     * Open a specific session file.
     * @param path Path to session file
     * @param sessionDir Optional session directory for /new or /branch. If omitted, derives from file's parent.
     * @param cwdOverride Optional cwd override instead of the session header cwd.
     */
    static open(path, sessionDir, cwdOverride) {
        const resolvedPath = resolvePath(path);
        let header = null;
        let preloadedFileEntries;
        if (cwdOverride === undefined && existsSync(resolvedPath)) {
            try {
                header = readSessionHeader(resolvedPath);
            }
            catch (error) {
                if (!(error instanceof SessionHeaderScanLimitError))
                    throw error;
                // The bounded scan is only a discovery optimization. A full load remains
                // authoritative for legacy files with very large headers or prefixes.
                preloadedFileEntries = loadEntriesFromFile(resolvedPath);
                const firstEntry = preloadedFileEntries[0];
                header = firstEntry?.type === "session" ? firstEntry : null;
            }
        }
        const cwd = cwdOverride ?? (header ? getSessionHeaderCwd(header) : undefined) ?? process.cwd();
        // If no sessionDir provided, derive from file's parent directory
        const dir = sessionDir ? normalizePath(sessionDir) : resolve(resolvedPath, "..");
        return new SessionManager(cwd, dir, resolvedPath, true, undefined, preloadedFileEntries);
    }
    /**
     * Continue the most recent session, or create new if none.
     * @param cwd Working directory
     * @param sessionDir Optional session directory. If omitted, uses default (~/.pi/agent/sessions/<encoded-cwd>/).
     */
    static continueRecent(cwd, sessionDir) {
        const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
        const filterCwd = sessionDir !== undefined && !pathsEqual(dir, getDefaultSessionDirPath(cwd));
        const mostRecent = findMostRecentSession(dir, filterCwd ? cwd : undefined);
        if (mostRecent) {
            return new SessionManager(cwd, dir, mostRecent, true);
        }
        return new SessionManager(cwd, dir, undefined, true);
    }
    /** Create an in-memory session (no file persistence), optionally from entries held outside the filesystem. */
    static inMemory(cwd = process.cwd(), options, entries) {
        return new SessionManager(cwd, "", undefined, false, options, entries);
    }
    /**
     * Fork a session from another project directory into the current project.
     * Creates a new session in the target cwd with the full history from the source session.
     * @param sourcePath Path to the source session file
     * @param targetCwd Target working directory (where the new session will be stored)
     * @param sessionDir Optional session directory. If omitted, uses default for targetCwd.
     */
    static forkFrom(sourcePath, targetCwd, sessionDir, options) {
        const resolvedSourcePath = resolvePath(sourcePath);
        const resolvedTargetCwd = resolvePath(targetCwd);
        const sourceEntries = loadEntriesFromFile(resolvedSourcePath);
        if (sourceEntries.length === 0) {
            throw new Error(`Cannot fork: source session file is empty or invalid: ${resolvedSourcePath}`);
        }
        const sourceHeader = sourceEntries.find((e) => e.type === "session");
        if (!sourceHeader) {
            throw new Error(`Cannot fork: source session has no header: ${resolvedSourcePath}`);
        }
        const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(resolvedTargetCwd);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        // Create new session file with new ID but forked content
        if (options?.id !== undefined) {
            assertValidSessionId(options.id);
        }
        const newSessionId = options?.id ?? createSessionId();
        const timestamp = new Date().toISOString();
        const fileTimestamp = timestamp.replace(/[:.]/g, "-");
        const newSessionFile = join(dir, `${fileTimestamp}_${newSessionId}.jsonl`);
        // Write new header pointing to source as parent, with updated cwd
        const newHeader = {
            type: "session",
            version: CURRENT_SESSION_VERSION,
            id: newSessionId,
            timestamp,
            cwd: resolvedTargetCwd,
            parentSession: resolvedSourcePath,
        };
        // Write the header and all non-header entries through one fd. Reopening the file per entry
        // is slow where open/close is expensive (e.g. filesystem security monitors).
        const fd = openSync(newSessionFile, "wx");
        try {
            writeFileSync(fd, `${JSON.stringify(newHeader)}\n`);
            for (const entry of sourceEntries) {
                if (entry.type !== "session") {
                    writeFileSync(fd, `${JSON.stringify(entry)}\n`);
                }
            }
        }
        finally {
            closeSync(fd);
        }
        return new SessionManager(resolvedTargetCwd, dir, newSessionFile, true);
    }
    /**
     * Find an exact session ID without loading transcript bodies.
     * @param cwd Working directory (used to compute default session directory)
     * @param id Exact session ID
     * @param sessionDir Optional session directory. If omitted, uses default (~/.pi/agent/sessions/<encoded-cwd>/).
     */
    static findById(cwd, id, sessionDir) {
        const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
        const filterCwd = sessionDir !== undefined && !pathsEqual(dir, getDefaultSessionDirPath(cwd));
        const resolvedCwd = resolvePath(cwd);
        try {
            for (const file of readdirSync(dir)) {
                if (!file.endsWith(".jsonl"))
                    continue;
                const path = join(dir, file);
                const header = readSessionHeaderForDiscovery(path);
                if (header?.id !== id)
                    continue;
                if (filterCwd && !sessionCwdMatches(getSessionHeaderCwd(header), resolvedCwd))
                    continue;
                return path;
            }
        }
        catch {
            // Exact session discovery is best-effort, matching list().
        }
        return undefined;
    }
    /**
     * List all sessions for a directory.
     * @param cwd Working directory (used to compute default session directory)
     * @param sessionDir Optional session directory. If omitted, uses default (~/.pi/agent/sessions/<encoded-cwd>/).
     * @param onProgress Optional callback for progress updates (loaded, total)
     */
    static async list(cwd, sessionDir, onProgress, signal) {
        const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
        const filterCwd = sessionDir !== undefined && !pathsEqual(dir, getDefaultSessionDirPath(cwd));
        const resolvedCwd = resolvePath(cwd);
        const includeSession = (session) => !filterCwd || sessionCwdMatches(session.cwd, resolvedCwd);
        const progress = onProgress
            ? (loaded, total, partialSessions) => onProgress(loaded, total, partialSessions?.filter(includeSession))
            : undefined;
        const sessions = (await listSessionsFromDir(dir, progress, signal)).filter(includeSession);
        return sortSessionInfos(sessions);
    }
    static async listAll(sessionDirOrOnProgress, onProgressOrSignal, signal) {
        const customSessionDir = typeof sessionDirOrOnProgress === "string" ? normalizePath(sessionDirOrOnProgress) : undefined;
        const progress = typeof sessionDirOrOnProgress === "function"
            ? sessionDirOrOnProgress
            : typeof onProgressOrSignal === "function"
                ? onProgressOrSignal
                : undefined;
        const abortSignal = typeof sessionDirOrOnProgress === "string" || typeof onProgressOrSignal === "function"
            ? signal
            : (onProgressOrSignal ?? signal);
        abortSignal?.throwIfAborted();
        if (customSessionDir) {
            return sortSessionInfos(await listSessionsFromDir(customSessionDir, progress, abortSignal));
        }
        const sessionsDir = getSessionsDir();
        try {
            if (!existsSync(sessionsDir))
                return [];
            const entries = await readdir(sessionsDir, { withFileTypes: true });
            const dirs = entries
                .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
                .map((entry) => join(sessionsDir, entry.name));
            const dirFiles = await mapWithConcurrency(dirs, MAX_CONCURRENT_SESSION_DISCOVERY_LOADS, async (dir) => {
                try {
                    return (await readdir(dir)).filter((file) => file.endsWith(".jsonl")).map((file) => join(dir, file));
                }
                catch {
                    return [];
                }
            }, abortSignal);
            const allFiles = dirFiles.flat();
            const candidates = await mapWithConcurrency(allFiles, MAX_CONCURRENT_SESSION_DISCOVERY_LOADS, async (path) => {
                try {
                    return { path, stats: await stat(path) };
                }
                catch {
                    return { path };
                }
            }, abortSignal);
            candidates.sort((a, b) => (b.stats?.mtimeMs ?? Number.NEGATIVE_INFINITY) - (a.stats?.mtimeMs ?? Number.NEGATIVE_INFINITY) ||
                basename(b.path).localeCompare(basename(a.path)));
            const totalFiles = candidates.length;
            let loaded = 0;
            let firstCandidateLoaded = false;
            const partialSessions = [];
            const results = await buildSessionInfosWithConcurrency(candidates, (info, index) => {
                loaded++;
                if (index === 0)
                    firstCandidateLoaded = true;
                if (info)
                    partialSessions.push(info);
                const publishPartial = firstCandidateLoaded &&
                    (index === 0 || loaded % ALL_SESSION_LIST_PUBLISH_INTERVAL === 0 || loaded === totalFiles);
                progress?.(loaded, totalFiles, publishPartial ? sortSessionInfos([...partialSessions]) : undefined);
            }, abortSignal);
            return sortSessionInfos(results.filter((info) => info !== null));
        }
        catch {
            abortSignal?.throwIfAborted();
            return [];
        }
    }
}
