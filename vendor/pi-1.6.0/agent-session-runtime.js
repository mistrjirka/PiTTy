import { constants, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join, parse } from "node:path";
import { pathsEqual, resolvePath } from "../utils/paths.js";
import { emitSessionShutdownEvent } from "./extensions/runner.js";
import { assertSessionCwdExists } from "./session-cwd.js";
import { SessionManager } from "./session-manager.js";
/**
 * Thrown when /import references a JSONL file path that does not exist.
 */
export class SessionImportFileNotFoundError extends Error {
    filePath;
    constructor(filePath) {
        super(`File not found: ${filePath}`);
        this.name = "SessionImportFileNotFoundError";
        this.filePath = filePath;
    }
}
function extractUserMessageText(content) {
    if (typeof content === "string") {
        return content;
    }
    return content
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("");
}
/**
 * Owns the current AgentSession plus its cwd-bound services.
 *
 * Session replacement methods tear down the current runtime first, then create
 * and apply the next runtime. If creation fails, the error is propagated to the
 * caller. The caller is responsible for user-facing error handling.
 */
export class AgentSessionRuntime {
    rebindSession;
    beforeSessionInvalidate;
    _session;
    _services;
    createRuntime;
    _diagnostics;
    _modelFallbackMessage;
    /** `type\0message` of every diagnostic takeUnreportedDiagnostics() returned so far. */
    reportedDiagnosticKeys = new Set();
    constructor(_session, _services, createRuntime, _diagnostics = [], _modelFallbackMessage) {
        this._session = _session;
        this._services = _services;
        this.createRuntime = createRuntime;
        this._diagnostics = _diagnostics;
        this._modelFallbackMessage = _modelFallbackMessage;
    }
    get services() {
        return this._services;
    }
    get session() {
        return this._session;
    }
    get cwd() {
        return this._services.cwd;
    }
    get diagnostics() {
        return this._diagnostics;
    }
    get modelFallbackMessage() {
        return this._modelFallbackMessage;
    }
    /**
     * Return the current runtime's diagnostics that were not reported yet, and mark them reported.
     *
     * The host calls this at startup and after each session replacement (/new, /resume, /fork,
     * import), whose runtime collects its diagnostics again. A diagnostic with the same type and
     * message as one returned before is left out, so an unchanged settings warning is not repeated
     * on every replacement.
     */
    takeUnreportedDiagnostics() {
        return this._diagnostics.filter((diagnostic) => {
            const key = `${diagnostic.type}\0${diagnostic.message}`;
            if (this.reportedDiagnosticKeys.has(key))
                return false;
            this.reportedDiagnosticKeys.add(key);
            return true;
        });
    }
    setRebindSession(rebindSession) {
        this.rebindSession = rebindSession;
    }
    /**
     * Set a synchronous callback that runs after `session_shutdown` handlers finish
     * but before the current session is invalidated.
     *
     * This is for host-owned UI teardown that must not yield to the event loop,
     * such as detaching extension-provided TUI components before the old extension
     * context becomes stale.
     */
    setBeforeSessionInvalidate(beforeSessionInvalidate) {
        this.beforeSessionInvalidate = beforeSessionInvalidate;
    }
    async emitBeforeSwitch(reason, targetSessionFile) {
        const runner = this.session.extensionRunner;
        if (!runner.hasHandlers("session_before_switch")) {
            return { cancelled: false };
        }
        const result = await runner.emit({
            type: "session_before_switch",
            reason,
            targetSessionFile,
        });
        return { cancelled: result?.cancel === true };
    }
    async emitBeforeFork(entryId, options) {
        const runner = this.session.extensionRunner;
        if (!runner.hasHandlers("session_before_fork")) {
            return { cancelled: false };
        }
        const result = await runner.emit({
            type: "session_before_fork",
            entryId,
            ...options,
        });
        return { cancelled: result?.cancel === true };
    }
    async teardownCurrent(reason, targetSessionFile) {
        // Settle any active response first so the aborted turn (including tool
        // results) is persisted to the outgoing session before it is replaced.
        await this.session.abort();
        await emitSessionShutdownEvent(this.session.extensionRunner, {
            type: "session_shutdown",
            reason,
            targetSessionFile,
        });
        this.beforeSessionInvalidate?.();
        this.session.dispose();
    }
    apply(result) {
        this._session = result.session;
        this._services = result.services;
        this._diagnostics = result.diagnostics;
        this._modelFallbackMessage = result.modelFallbackMessage;
    }
    async finishSessionReplacement(withSession) {
        if (this.rebindSession) {
            await this.rebindSession(this.session);
        }
        if (withSession) {
            await withSession(this.session.createReplacedSessionContext());
        }
    }
    async switchSession(sessionPath, options) {
        const beforeResult = await this.emitBeforeSwitch("resume", sessionPath);
        if (beforeResult.cancelled) {
            return beforeResult;
        }
        const previousSessionFile = this.session.sessionFile;
        const sessionManager = SessionManager.open(sessionPath, undefined, options?.cwdOverride);
        assertSessionCwdExists(sessionManager, this.cwd);
        await this.teardownCurrent("resume", sessionManager.getSessionFile());
        this.apply(await this.createRuntime({
            cwd: sessionManager.getCwd(),
            agentDir: this.services.agentDir,
            sessionManager,
            sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
            projectTrustContext: options?.projectTrustContextFactory?.(sessionManager.getCwd()),
        }));
        await this.finishSessionReplacement(options?.withSession);
        return { cancelled: false };
    }
    async newSession(options) {
        const beforeResult = await this.emitBeforeSwitch("new");
        if (beforeResult.cancelled) {
            return beforeResult;
        }
        const previousSessionFile = this.session.sessionFile;
        const sessionDir = this.session.sessionManager.getSessionDir();
        const sessionManager = this.session.sessionManager.isPersisted()
            ? SessionManager.create(this.cwd, sessionDir)
            : SessionManager.inMemory(this.cwd);
        if (options?.parentSession) {
            sessionManager.newSession({ parentSession: options.parentSession });
        }
        await this.teardownCurrent("new", sessionManager.getSessionFile());
        this.apply(await this.createRuntime({
            cwd: this.cwd,
            agentDir: this.services.agentDir,
            sessionManager,
            sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile },
        }));
        if (options?.setup) {
            await options.setup(this.session.sessionManager);
            this.session.refreshContext();
        }
        await this.finishSessionReplacement(options?.withSession);
        return { cancelled: false };
    }
    async fork(entryId, options) {
        const position = options?.position ?? "before";
        const beforeResult = await this.emitBeforeFork(entryId, { position });
        if (beforeResult.cancelled) {
            return { cancelled: true };
        }
        let targetLeafId;
        let selectedText;
        const selectedEntry = this.session.sessionManager.getEntry(entryId);
        if (!selectedEntry) {
            throw new Error("Invalid entry ID for forking");
        }
        if (position === "at") {
            targetLeafId = selectedEntry.id;
        }
        else {
            if (selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
                throw new Error("Invalid entry ID for forking");
            }
            targetLeafId = selectedEntry.parentId;
            selectedText = extractUserMessageText(selectedEntry.message.content);
        }
        const previousSessionFile = this.session.sessionFile;
        if (this.session.sessionManager.isPersisted()) {
            const currentSessionFile = this.session.sessionFile;
            if (!currentSessionFile) {
                throw new Error("Persisted session is missing a session file");
            }
            const sessionDir = this.session.sessionManager.getSessionDir();
            if (!targetLeafId) {
                const sessionManager = SessionManager.create(this.cwd, sessionDir);
                sessionManager.newSession({ parentSession: currentSessionFile });
                await this.teardownCurrent("fork", sessionManager.getSessionFile());
                this.apply(await this.createRuntime({
                    cwd: this.cwd,
                    agentDir: this.services.agentDir,
                    sessionManager,
                    sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
                }));
                await this.finishSessionReplacement(options?.withSession);
                return { cancelled: false, selectedText };
            }
            if (!existsSync(currentSessionFile)) {
                throw new Error("This session has not been saved yet. Send a message before cloning or forking it.");
            }
            const sessionManager = SessionManager.open(currentSessionFile, sessionDir);
            const forkedSessionPath = sessionManager.createBranchedSession(targetLeafId);
            if (!forkedSessionPath) {
                throw new Error("Failed to create forked session");
            }
            await this.teardownCurrent("fork", sessionManager.getSessionFile());
            this.apply(await this.createRuntime({
                cwd: sessionManager.getCwd(),
                agentDir: this.services.agentDir,
                sessionManager,
                sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
            }));
            await this.finishSessionReplacement(options?.withSession);
            return { cancelled: false, selectedText };
        }
        const sessionManager = this.session.sessionManager;
        await this.teardownCurrent("fork", sessionManager.getSessionFile());
        if (!targetLeafId) {
            sessionManager.newSession({ parentSession: previousSessionFile });
        }
        else {
            sessionManager.createBranchedSession(targetLeafId);
        }
        this.apply(await this.createRuntime({
            cwd: this.cwd,
            agentDir: this.services.agentDir,
            sessionManager,
            sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
        }));
        await this.finishSessionReplacement(options?.withSession);
        return { cancelled: false, selectedText };
    }
    /**
     * Import a session JSONL file and switch runtime state to the imported session.
     *
     * @returns `{ cancelled: true }` when cancelled by `session_before_switch`, otherwise `{ cancelled: false }`.
     * @throws {SessionImportFileNotFoundError} When the input path does not exist.
     * @throws {MissingSessionCwdError} When the imported session cwd cannot be resolved and no override is provided.
     */
    async importFromJsonl(inputPath, cwdOverride) {
        const resolvedPath = resolvePath(inputPath);
        if (!existsSync(resolvedPath)) {
            throw new SessionImportFileNotFoundError(resolvedPath);
        }
        const sessionDir = this.session.sessionManager.getSessionDir();
        if (!existsSync(sessionDir)) {
            mkdirSync(sessionDir, { recursive: true });
        }
        let destinationPath = join(sessionDir, basename(resolvedPath));
        const sourceAlreadyStored = pathsEqual(destinationPath, resolvedPath);
        if (!sourceAlreadyStored) {
            const { name, ext } = parse(destinationPath);
            let suffix = 1;
            while (existsSync(destinationPath)) {
                destinationPath = join(sessionDir, `${name}-${suffix++}${ext}`);
            }
        }
        const beforeResult = await this.emitBeforeSwitch("resume", destinationPath);
        if (beforeResult.cancelled) {
            return beforeResult;
        }
        const previousSessionFile = this.session.sessionFile;
        if (!sourceAlreadyStored) {
            copyFileSync(resolvedPath, destinationPath, constants.COPYFILE_EXCL);
        }
        const sessionManager = SessionManager.open(destinationPath, sessionDir, cwdOverride);
        try {
            assertSessionCwdExists(sessionManager, this.cwd);
        }
        catch (error) {
            // The import did not happen; drop the copy so a retry with a cwd override or a fork leaves no stray file.
            if (!sourceAlreadyStored)
                rmSync(destinationPath, { force: true });
            throw error;
        }
        await this.teardownCurrent("resume", sessionManager.getSessionFile());
        this.apply(await this.createRuntime({
            cwd: sessionManager.getCwd(),
            agentDir: this.services.agentDir,
            sessionManager,
            sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
        }));
        await this.finishSessionReplacement();
        return { cancelled: false };
    }
    /**
     * Dispose the session for process exit. Also waits for credential writes in progress: an OAuth
     * refresh may already have spent the old single-use refresh token, so exiting before the new one
     * is saved would lose the login (#11692).
     */
    async dispose() {
        await this.session.abort();
        await emitSessionShutdownEvent(this.session.extensionRunner, {
            type: "session_shutdown",
            reason: "quit",
        });
        this.beforeSessionInvalidate?.();
        this.session.dispose();
        await this.services.modelRuntime.settleCredentialWrites();
    }
}
/**
 * Create the initial runtime from a runtime factory and initial session target.
 *
 * The same factory is stored on the returned AgentSessionRuntime and reused for
 * later /new, /resume, /fork, and import flows.
 */
export async function createAgentSessionRuntime(createRuntime, options) {
    assertSessionCwdExists(options.sessionManager, options.cwd);
    const result = await createRuntime(options);
    return new AgentSessionRuntime(result.session, result.services, createRuntime, result.diagnostics, result.modelFallbackMessage);
}
export { createAgentSessionFromServices, createAgentSessionServices, } from "./agent-session-services.js";
