/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications.
 * Receives commands as JSON on stdin, outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: AgentSessionEvent objects streamed as they occur
 * - Extension UI: Extension UI requests are emitted, client responds with extension_ui_response
 */
import * as crypto from "node:crypto";
import { flushRawStdout, takeOverStdout, waitForRawStdoutBackpressure, writeRawStdout, } from "../../core/output-guard.js";
import { readProviderUsage } from "../../core/provider-usage.js";
import { killTrackedDetachedChildren } from "../../utils/shell.js";
import { writeDiagnosticsToStderr } from "../diagnostics-stderr.js";
import { theme } from "../interactive/theme/theme.js";
import { toJsonEvent } from "../json-event.js";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.js";
/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(runtimeHost) {
    takeOverStdout();
    let session = runtimeHost.session;
    let unsubscribe;
    let unsubscribeBackpressure;
    const output = (obj) => {
        writeRawStdout(serializeJsonLine(obj));
    };
    const success = (id, command, data) => {
        if (data === undefined) {
            return { id, type: "response", command, success: true };
        }
        return { id, type: "response", command, success: true, data };
    };
    const error = (id, command, message) => {
        return { id, type: "response", command, success: false, error: message };
    };
    // Pending extension UI requests waiting for response
    const pendingExtensionRequests = new Map();
    // Extension shutdown requests (ctx.shutdown()) wait until input is attached, no command is
    // being handled, and the session is idle. See checkShutdownRequested().
    let shutdownRequested = false;
    let shuttingDown = false;
    let inputReady = false;
    let activeCommands = 0;
    // SIGTERM/SIGHUP received so far. Only a repeated signal forces exit during shutdown.
    let signalCount = 0;
    /** Helper for dialog methods with signal/timeout support */
    function createDialogPromise(opts, defaultValue, request, parseResponse) {
        if (opts?.signal?.aborted)
            return Promise.resolve(defaultValue);
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            let timeoutId;
            const cleanup = () => {
                if (timeoutId)
                    clearTimeout(timeoutId);
                opts?.signal?.removeEventListener("abort", onAbort);
                pendingExtensionRequests.delete(id);
            };
            const onAbort = () => {
                cleanup();
                resolve(defaultValue);
            };
            opts?.signal?.addEventListener("abort", onAbort, { once: true });
            if (opts?.timeout) {
                timeoutId = setTimeout(() => {
                    cleanup();
                    resolve(defaultValue);
                }, opts.timeout);
            }
            pendingExtensionRequests.set(id, {
                resolve: (response) => {
                    cleanup();
                    resolve(parseResponse(response));
                },
                reject,
            });
            output({ type: "extension_ui_request", id, ...request });
        });
    }
    /**
     * Create an extension UI context that uses the RPC protocol.
     */
    const createExtensionUIContext = () => ({
        select: (title, options, opts) => createDialogPromise(opts, undefined, { method: "select", title, options, timeout: opts?.timeout }, (r) => "cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
        confirm: (title, message, opts) => createDialogPromise(opts, false, { method: "confirm", title, message, timeout: opts?.timeout }, (r) => "cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false),
        input: (title, placeholder, opts) => createDialogPromise(opts, undefined, { method: "input", title, placeholder, timeout: opts?.timeout }, (r) => "cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
        notify(message, type) {
            // Fire and forget - no response needed
            output({
                type: "extension_ui_request",
                id: crypto.randomUUID(),
                method: "notify",
                message,
                notifyType: type,
            });
        },
        onTerminalInput() {
            // Raw terminal input not supported in RPC mode
            return () => { };
        },
        setStatus(key, text) {
            // Fire and forget - no response needed
            output({
                type: "extension_ui_request",
                id: crypto.randomUUID(),
                method: "setStatus",
                statusKey: key,
                statusText: text,
            });
        },
        setWorkingMessage(_message) {
            // Working message not supported in RPC mode - requires TUI loader access
        },
        setWorkingVisible(_visible) {
            // Working visibility not supported in RPC mode - requires TUI loader access
        },
        setWorkingIndicator(_options) {
            // Working indicator customization not supported in RPC mode - requires TUI loader access
        },
        setHiddenThinkingLabel(_label) {
            // Hidden thinking label not supported in RPC mode - requires TUI message rendering access
        },
        setWidget(key, content, options) {
            // Only support string arrays in RPC mode - factory functions are ignored
            if (content === undefined || Array.isArray(content)) {
                output({
                    type: "extension_ui_request",
                    id: crypto.randomUUID(),
                    method: "setWidget",
                    widgetKey: key,
                    widgetLines: content,
                    widgetPlacement: options?.placement,
                });
            }
            // Component factories are not supported in RPC mode - would need TUI access
        },
        setFooter(_factory) {
            // Custom footer not supported in RPC mode - requires TUI access
        },
        setHeader(_factory) {
            // Custom header not supported in RPC mode - requires TUI access
        },
        setTitle(title) {
            // Fire and forget - host can implement terminal title control
            output({
                type: "extension_ui_request",
                id: crypto.randomUUID(),
                method: "setTitle",
                title,
            });
        },
        async custom() {
            // Custom UI not supported in RPC mode
            return undefined;
        },
        pasteToEditor(text) {
            // Paste handling not supported in RPC mode - falls back to setEditorText
            this.setEditorText(text);
        },
        setEditorText(text) {
            // Fire and forget - host can implement editor control
            output({
                type: "extension_ui_request",
                id: crypto.randomUUID(),
                method: "set_editor_text",
                text,
            });
        },
        getEditorText() {
            // Synchronous method can't wait for RPC response
            // Host should track editor state locally if needed
            return "";
        },
        async editor(title, prefill) {
            const id = crypto.randomUUID();
            return new Promise((resolve, reject) => {
                pendingExtensionRequests.set(id, {
                    resolve: (response) => {
                        if ("cancelled" in response && response.cancelled) {
                            resolve(undefined);
                        }
                        else if ("value" in response) {
                            resolve(response.value);
                        }
                        else {
                            resolve(undefined);
                        }
                    },
                    reject,
                });
                output({ type: "extension_ui_request", id, method: "editor", title, prefill });
            });
        },
        addAutocompleteProvider() {
            // Autocomplete provider composition is not supported in RPC mode
        },
        setEditorComponent() {
            // Custom editor components not supported in RPC mode
        },
        getEditorComponent() {
            // Custom editor components not supported in RPC mode
            return undefined;
        },
        get theme() {
            return theme;
        },
        getAllThemes() {
            return [];
        },
        getTheme(_name) {
            return undefined;
        },
        setTheme(_theme) {
            // Theme switching not supported in RPC mode
            return { success: false, error: "Theme switching not supported in RPC mode" };
        },
        getToolsExpanded() {
            // Tool expansion not supported in RPC mode - no TUI
            return false;
        },
        setToolsExpanded(_expanded) {
            // Tool expansion not supported in RPC mode - no TUI
        },
    });
    runtimeHost.setRebindSession(async () => {
        await rebindSession();
        // stderr, never stdout: stdout carries the RPC protocol.
        writeDiagnosticsToStderr(runtimeHost.takeUnreportedDiagnostics());
    });
    const rebindSession = async () => {
        session = runtimeHost.session;
        // Subscribe before binding so events emitted by session_start handlers (e.g. appended entries) reach the client.
        unsubscribe?.();
        unsubscribeBackpressure?.();
        unsubscribe = session.subscribe((event) => {
            output(toJsonEvent(event));
            if (event.type === "agent_settled") {
                checkShutdownRequested();
            }
        });
        unsubscribeBackpressure = session.agent.subscribe(async () => {
            await waitForRawStdoutBackpressure();
        });
        await session.bindExtensions({
            uiContext: createExtensionUIContext(),
            mode: "rpc",
            commandContextActions: {
                waitForIdle: () => session.waitForIdle(),
                newSession: async (options) => runtimeHost.newSession(options),
                fork: async (entryId, forkOptions) => {
                    const result = await runtimeHost.fork(entryId, forkOptions);
                    return { cancelled: result.cancelled };
                },
                navigateTree: async (targetId, options) => {
                    const result = await session.navigateTree(targetId, {
                        summarize: options?.summarize,
                        customInstructions: options?.customInstructions,
                        replaceInstructions: options?.replaceInstructions,
                        label: options?.label,
                    });
                    return { cancelled: result.cancelled };
                },
                switchSession: async (sessionPath, options) => {
                    return runtimeHost.switchSession(sessionPath, options);
                },
                reload: async () => {
                    await session.reload();
                },
            },
            shutdownHandler: () => {
                shutdownRequested = true;
                // An idle session has no command response or agent_settled left to check the flag.
                // Check on the next tick so the requesting handler finishes first.
                setImmediate(checkShutdownRequested);
            },
            onError: (err) => {
                output({ type: "extension_error", extensionPath: err.extensionPath, event: err.event, error: err.error });
            },
        });
    };
    const registerSignalHandlers = () => {
        const signals = ["SIGTERM"];
        if (process.platform !== "win32") {
            signals.push("SIGHUP");
        }
        for (const signal of signals) {
            const exitCode = signal === "SIGHUP" ? 129 : 143;
            // Handlers stay registered until exit: without one, a signal during shutdown would kill
            // the process before dispose() finishes (for example a pending MCP token refresh).
            process.on(signal, () => {
                signalCount++;
                killTrackedDetachedChildren();
                if (!shuttingDown) {
                    void shutdown(exitCode, signal);
                }
                else if (signalCount > 1) {
                    // Process managers often close stdin and send SIGTERM together, so one signal
                    // during shutdown is not a request to skip cleanup; a repeated one is.
                    process.exit(exitCode);
                }
            });
        }
    };
    await rebindSession();
    registerSignalHandlers();
    // Handle a single command
    const handleCommand = async (command) => {
        const id = command.id;
        switch (command.type) {
            // =================================================================
            // Prompting
            // =================================================================
            case "prompt": {
                const messageId = command.messageId ?? crypto.randomUUID();
                // Start prompt handling immediately, but emit the authoritative response only after
                // prompt preflight succeeds. Queued and immediately handled prompts also count as success.
                let preflightSucceeded = false;
                // Extension commands run inside prompt(); defer shutdown requests until it settles.
                activeCommands++;
                void session
                    .prompt(command.message, {
                    images: command.images,
                    messageId,
                    streamingBehavior: command.streamingBehavior,
                    source: "rpc",
                    preflightResult: (disposition) => {
                        preflightSucceeded = true;
                        output(success(id, "prompt", { disposition, messageId }));
                    },
                })
                    .catch((e) => {
                    if (!preflightSucceeded) {
                        output(error(id, "prompt", e.message));
                    }
                })
                    .finally(() => {
                    activeCommands--;
                    checkShutdownRequested();
                });
                return undefined;
            }
            case "steer": {
                const messageId = command.messageId ?? crypto.randomUUID();
                const disposition = await session.steer(command.message, command.images, { source: "rpc", messageId });
                return success(id, "steer", { disposition, messageId });
            }
            case "follow_up": {
                const messageId = command.messageId ?? crypto.randomUUID();
                const disposition = await session.followUp(command.message, command.images, { source: "rpc", messageId });
                return success(id, "follow_up", { disposition, messageId });
            }
            case "abort": {
                await session.abort();
                return success(id, "abort");
            }
            case "clear_queue": {
                return success(id, "clear_queue", session.clearQueue());
            }
            case "get_queue":
                return success(id, "get_queue", session.getQueueState());
            case "update_queued_message":
                return success(id, "update_queued_message", session.updateQueuedMessage(command.messageId, command.message, command.images, command.expectedRevision));
            case "remove_queued_message":
                return success(id, "remove_queued_message", session.removeQueuedMessage(command.messageId, command.expectedRevision));
            case "combine_queued_messages":
                return success(id, "combine_queued_messages", session.combineQueuedMessages(command.messageIds, command.expectedRevision));
            case "new_session": {
                const options = command.parentSession ? { parentSession: command.parentSession } : undefined;
                const result = await runtimeHost.newSession(options);
                return success(id, "new_session", result);
            }
            // =================================================================
            // State
            // =================================================================
            case "get_state": {
                const state = {
                    model: session.model,
                    thinkingLevel: session.thinkingLevel,
                    isStreaming: session.isStreaming,
                    isCompacting: session.isCompacting,
                    steeringMode: session.steeringMode,
                    followUpMode: session.followUpMode,
                    sessionFile: session.sessionFile,
                    sessionId: session.sessionId,
                    sessionName: session.sessionName,
                    autoCompactionEnabled: session.autoCompactionEnabled,
                    compactionMethod: session.compactionMethod,
                    cacheMaintenance: session.cacheMaintenance,
                    cacheMaintenanceStatus: session.cacheMaintenanceStatus,
                    compactionMethods: session.compactionMethods,
                    messageCount: session.messages.length,
                    pendingMessageCount: session.pendingMessageCount,
                    queue: session.getQueueState(),
                };
                return success(id, "get_state", state);
            }
            case "get_provider_usage": {
                const usageSession = session;
                const model = usageSession.model;
                const sessionId = usageSession.sessionId;
                if (!model) {
                    return success(id, "get_provider_usage", {
                        provider: "",
                        status: "unavailable",
                        observedAt: null,
                        limits: [],
                        source: "provider",
                    });
                }
                const snapshot = await readProviderUsage({
                    provider: model.provider,
                    modelId: model.id,
                    read: (request) => usageSession.extensionRunner.emitProviderUsage({ type: "provider_usage", ...request }),
                    isCurrent: () => session === usageSession &&
                        usageSession.sessionId === sessionId &&
                        usageSession.model?.provider === model.provider &&
                        usageSession.model?.id === model.id,
                });
                return success(id, "get_provider_usage", snapshot);
            }
            case "set_input_active": {
                session.setInputActive(command.active);
                return success(id, "set_input_active");
            }
            // =================================================================
            // Model
            // =================================================================
            case "set_model": {
                const models = session.modelRuntime.getAvailableSnapshot();
                const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
                if (!model) {
                    return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
                }
                await session.setModel(model);
                return success(id, "set_model", model);
            }
            case "cycle_model": {
                const result = await session.cycleModel();
                if (!result) {
                    return success(id, "cycle_model", null);
                }
                return success(id, "cycle_model", result);
            }
            case "get_available_models": {
                const models = session.modelRuntime.getAvailableSnapshot();
                return success(id, "get_available_models", { models });
            }
            case "refresh_provider_models": {
                // Authentication is handled by pi-ai's shared locked auth.json store.
                // This command never accepts or returns credentials.
                if (typeof command.providerId !== "string" || !/^[-a-z0-9]{1,64}$/.test(command.providerId)) {
                    return error(id, "refresh_provider_models", "Invalid provider ID");
                }
                if (session.isStreaming || session.isCompacting) {
                    return error(id, "refresh_provider_models", "Wait for the current agent turn to finish");
                }
                await session.modelRuntime.refresh({ providers: [command.providerId], allowNetwork: false });
                return success(id, "refresh_provider_models", {
                    models: session.modelRuntime.getAvailableSnapshot(),
                });
            }
            // =================================================================
            // Thinking
            // =================================================================
            case "set_thinking_level": {
                session.setThinkingLevel(command.level);
                return success(id, "set_thinking_level");
            }
            case "cycle_thinking_level": {
                const level = session.cycleThinkingLevel();
                if (!level) {
                    return success(id, "cycle_thinking_level", null);
                }
                return success(id, "cycle_thinking_level", { level });
            }
            case "get_available_thinking_levels": {
                const levels = session.getAvailableThinkingLevels();
                return success(id, "get_available_thinking_levels", { levels });
            }
            // =================================================================
            // Queue Modes
            // =================================================================
            case "set_steering_mode": {
                session.setSteeringMode(command.mode);
                return success(id, "set_steering_mode");
            }
            case "set_follow_up_mode": {
                session.setFollowUpMode(command.mode);
                return success(id, "set_follow_up_mode");
            }
            // =================================================================
            // Compaction
            // =================================================================
            case "compact": {
                const result = await session.compact(command.customInstructions);
                return success(id, "compact", result);
            }
            case "set_auto_compaction": {
                session.setAutoCompactionEnabled(command.enabled);
                return success(id, "set_auto_compaction");
            }
            case "set_compaction_method": {
                session.setCompactionMethod(command.method);
                return success(id, "set_compaction_method");
            }
            case "set_cache_maintenance": {
                session.setCacheMaintenance(command.mode);
                return success(id, "set_cache_maintenance");
            }
            // =================================================================
            // Retry
            // =================================================================
            case "set_auto_retry": {
                session.setAutoRetryEnabled(command.enabled);
                return success(id, "set_auto_retry");
            }
            case "abort_retry": {
                session.abortRetry();
                return success(id, "abort_retry");
            }
            // =================================================================
            // Bash
            // =================================================================
            case "bash": {
                const eventResult = await session.extensionRunner.emitUserBash({
                    type: "user_bash",
                    command: command.command,
                    excludeFromContext: command.excludeFromContext ?? false,
                    cwd: session.sessionManager.getCwd(),
                });
                if (eventResult?.result) {
                    session.recordBashResult(command.command, eventResult.result, {
                        excludeFromContext: command.excludeFromContext,
                    });
                    return success(id, "bash", eventResult.result);
                }
                const result = await session.executeBash(command.command, undefined, {
                    excludeFromContext: command.excludeFromContext,
                    id,
                    operations: eventResult?.operations,
                });
                return success(id, "bash", result);
            }
            case "abort_bash": {
                session.abortBash();
                return success(id, "abort_bash");
            }
            // =================================================================
            // Session
            // =================================================================
            case "get_session_stats": {
                const stats = session.getSessionStats();
                return success(id, "get_session_stats", stats);
            }
            case "export_html": {
                const path = await session.exportToHtml(command.outputPath);
                return success(id, "export_html", { path });
            }
            case "switch_session": {
                const result = await runtimeHost.switchSession(command.sessionPath);
                return success(id, "switch_session", result);
            }
            case "fork": {
                const result = await runtimeHost.fork(command.entryId);
                return success(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
            }
            case "clone": {
                const leafId = session.sessionManager.getLeafId();
                if (!leafId) {
                    return error(id, "clone", "Cannot clone session: no current entry selected");
                }
                const result = await runtimeHost.fork(leafId, { position: "at" });
                return success(id, "clone", { cancelled: result.cancelled });
            }
            case "get_fork_messages": {
                const messages = session.getUserMessagesForForking();
                return success(id, "get_fork_messages", { messages });
            }
            case "get_entries": {
                const sessionManager = session.sessionManager;
                let entries = sessionManager.getEntries();
                if (command.since !== undefined) {
                    const sinceIndex = entries.findIndex((e) => e.id === command.since);
                    if (sinceIndex === -1) {
                        return error(id, "get_entries", `Entry not found: ${command.since}`);
                    }
                    entries = entries.slice(sinceIndex + 1);
                }
                return success(id, "get_entries", { entries, leafId: sessionManager.getLeafId() });
            }
            case "get_tree": {
                const sessionManager = session.sessionManager;
                return success(id, "get_tree", { tree: sessionManager.getTree(), leafId: sessionManager.getLeafId() });
            }
            case "get_last_assistant_text": {
                const text = session.getLastAssistantText();
                return success(id, "get_last_assistant_text", { text });
            }
            case "set_session_name": {
                const name = command.name.trim();
                if (!name) {
                    return error(id, "set_session_name", "Session name cannot be empty");
                }
                session.setSessionName(name);
                return success(id, "set_session_name");
            }
            // =================================================================
            // Messages
            // =================================================================
            case "get_messages": {
                return success(id, "get_messages", { messages: session.messages });
            }
            // =================================================================
            // Commands (available for invocation via prompt)
            // =================================================================
            case "get_commands": {
                const commands = [];
                for (const command of session.extensionRunner.getRegisteredCommands()) {
                    commands.push({
                        name: command.invocationName,
                        description: command.description,
                        source: "extension",
                        sourceInfo: command.sourceInfo,
                    });
                }
                for (const template of session.promptTemplates) {
                    commands.push({
                        name: template.name,
                        description: template.description,
                        source: "prompt",
                        sourceInfo: template.sourceInfo,
                    });
                }
                for (const skill of session.resourceLoader.getSkills().skills) {
                    commands.push({
                        name: `skill:${skill.name}`,
                        description: skill.description,
                        source: "skill",
                        sourceInfo: skill.sourceInfo,
                    });
                }
                return success(id, "get_commands", { commands });
            }
            default: {
                const unknownCommand = command;
                return error(id, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
            }
        }
    };
    let detachInput = () => { };
    /** Dispose the runtime and exit. Runs once; later calls (stdin EOF after a signal) do nothing. */
    async function shutdown(exitCode = 0, signal) {
        if (shuttingDown)
            return;
        shuttingDown = true;
        unsubscribe?.();
        unsubscribeBackpressure?.();
        await runtimeHost.dispose();
        detachInput();
        process.stdin.pause();
        if (signal !== "SIGTERM") {
            await flushRawStdout();
        }
        process.exit(exitCode);
    }
    /**
     * Shut down if an extension requested it and nothing still needs the process: input is attached,
     * no command (including a prompt that has not settled) is being handled, and the session is idle.
     * Each of those ending calls this again.
     */
    function checkShutdownRequested() {
        if (!shutdownRequested || shuttingDown || !inputReady || activeCommands > 0 || !session.isIdle)
            return;
        void shutdown();
    }
    const handleInputLine = async (line) => {
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch (parseError) {
            output(error(undefined, "parse", `Failed to parse command: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
            await waitForRawStdoutBackpressure();
            return;
        }
        // Handle extension UI responses
        if (typeof parsed === "object" &&
            parsed !== null &&
            "type" in parsed &&
            parsed.type === "extension_ui_response") {
            const response = parsed;
            const pending = pendingExtensionRequests.get(response.id);
            if (pending) {
                pendingExtensionRequests.delete(response.id);
                pending.resolve(response);
            }
            return;
        }
        const command = parsed;
        const queueError = validateQueueInput(parsed) ?? validateMaintenanceInput(parsed);
        if (queueError) {
            output(error(command.id, command.type, queueError));
            return;
        }
        activeCommands++;
        try {
            let response;
            try {
                response = await handleCommand(command);
            }
            finally {
                activeCommands--;
            }
            if (response) {
                output(response);
                await waitForRawStdoutBackpressure();
            }
            checkShutdownRequested();
        }
        catch (commandError) {
            output(error(command.id, command.type, commandError instanceof Error ? commandError.message : String(commandError)));
            await waitForRawStdoutBackpressure();
        }
    };
    const onInputEnd = () => {
        void shutdown();
    };
    process.stdin.on("end", onInputEnd);
    detachInput = (() => {
        const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
            void handleInputLine(line);
        });
        return () => {
            detachJsonl();
            process.stdin.off("end", onInputEnd);
        };
    })();
    inputReady = true;
    // Handle a shutdown requested during startup (e.g. from session_start).
    checkShutdownRequested();
    // Keep process alive forever
    return new Promise(() => { });
}
/** Validate queue mutation fields at the untyped JSONL input boundary. */
function validateQueueInput(value) {
    if (typeof value !== "object" || value === null || !("type" in value))
        return undefined;
    const command = value;
    const type = command.type;
    const mutation = type === "update_queued_message" || type === "remove_queued_message" || type === "combine_queued_messages";
    const submission = type === "prompt" || type === "steer" || type === "follow_up";
    if (!mutation && !submission)
        return undefined;
    if (type === "prompt" &&
        command.streamingBehavior !== undefined &&
        command.streamingBehavior !== "steer" &&
        command.streamingBehavior !== "followUp") {
        return "streamingBehavior must be 'steer' or 'followUp'.";
    }
    if (type === "combine_queued_messages") {
        if (!Array.isArray(command.messageIds) || command.messageIds.some((id) => typeof id !== "string" || !id)) {
            return "messageIds must be an array of non-empty strings.";
        }
    }
    else if ((mutation || command.messageId !== undefined) &&
        (typeof command.messageId !== "string" || !command.messageId)) {
        return "messageId must be a non-empty string.";
    }
    if ((type === "update_queued_message" || submission) && typeof command.message !== "string") {
        return "message must be a string.";
    }
    if (mutation &&
        command.expectedRevision !== undefined &&
        (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0)) {
        return "expectedRevision must be a non-negative integer.";
    }
    if (command.images !== undefined &&
        (!Array.isArray(command.images) ||
            command.images.some((image) => typeof image !== "object" ||
                image === null ||
                image.type !== "image" ||
                typeof image.data !== "string" ||
                typeof image.mimeType !== "string"))) {
        return "images must contain ImageContent objects.";
    }
    return undefined;
}
/** Validate maintenance settings only at the untyped JSONL input boundary. */
function validateMaintenanceInput(value) {
    if (typeof value !== "object" || value === null || !("type" in value))
        return undefined;
    const command = value;
    if (command.type === "set_compaction_method" && command.method !== "cache-aware" && command.method !== "extension") {
        return "method must be 'cache-aware' or 'extension'.";
    }
    if (command.type === "set_cache_maintenance" &&
        command.mode !== "compact" &&
        command.mode !== "keep-warm" &&
        command.mode !== "off") {
        return "mode must be 'compact', 'keep-warm', or 'off'.";
    }
    if (command.type === "set_input_active" && typeof command.active !== "boolean") {
        return "active must be a boolean.";
    }
    return undefined;
}
