/**
 * Extension runner - executes extensions and manages their lifecycle.
 */
import { getCurrentSystemMessage, } from "@earendil-works/pi-ai";
import { theme } from "../../modes/interactive/theme/theme.js";
import { getSideQuestionSnapshot } from "../side-questions.js";
import { buildSystemPrompt, normalizeBuildSystemPromptOptions, } from "../system-prompt.js";
// Extension shortcuts compete with canonical keybinding ids from keybindings.json.
// Only editor-global shortcuts are reserved here. Picker-specific bindings are not.
const RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS = [
    "app.interrupt",
    "app.clear",
    "app.exit",
    "app.suspend",
    "app.thinking.cycle",
    "app.model.cycleForward",
    "app.model.cycleBackward",
    "app.model.select",
    "app.tools.expand",
    "app.thinking.toggle",
    "app.editor.external",
    "app.message.copy",
    "app.message.followUp",
    "tui.input.submit",
    "tui.select.confirm",
    "tui.select.cancel",
    "tui.input.copy",
    "tui.editor.deleteToLineEnd",
];
const buildBuiltinKeybindings = (resolvedKeybindings) => {
    const builtinKeybindings = {};
    for (const [keybinding, keys] of Object.entries(resolvedKeybindings)) {
        if (keys === undefined)
            continue;
        const keyList = Array.isArray(keys) ? keys : [keys];
        const restrictOverride = RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS.includes(keybinding);
        for (const key of keyList) {
            const normalizedKey = key.toLowerCase();
            // If multiple actions bind the same key, the reserved action wins so extensions
            // remain blocked by reserved shortcuts regardless of iteration order.
            const existing = builtinKeybindings[normalizedKey];
            if (existing?.restrictOverride && !restrictOverride)
                continue;
            builtinKeybindings[normalizedKey] = {
                keybinding,
                restrictOverride,
            };
        }
    }
    return builtinKeybindings;
};
function isUserBashEventResult(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const candidate = value;
    const hasOperations = candidate.operations !== undefined;
    const hasResult = candidate.result !== undefined;
    if (hasOperations === hasResult)
        return false;
    if (hasOperations) {
        const operations = candidate.operations;
        if (typeof operations !== "object" || operations === null)
            return false;
        return typeof operations.exec === "function";
    }
    const result = candidate.result;
    if (typeof result !== "object" || result === null)
        return false;
    const resultRecord = result;
    return (typeof resultRecord.output === "string" &&
        "exitCode" in resultRecord &&
        (resultRecord.exitCode === undefined || typeof resultRecord.exitCode === "number") &&
        typeof resultRecord.cancelled === "boolean" &&
        typeof resultRecord.truncated === "boolean" &&
        (resultRecord.fullOutputPath === undefined || typeof resultRecord.fullOutputPath === "string"));
}
/**
 * Helper function to emit session_shutdown event to extensions.
 * Returns true if the event was emitted, false if there were no handlers.
 */
export async function emitSessionShutdownEvent(extensionRunner, event) {
    if (extensionRunner.hasHandlers("session_shutdown")) {
        await extensionRunner.emit(event);
        return true;
    }
    return false;
}
function snapshotEventHandlers(extensions, event) {
    return extensions.map((ext) => ({ ext, handlers: ext.handlers.get(event)?.slice() ?? [] }));
}
function sameMessages(left, right) {
    return left.length === right.length && left.every((message, index) => message === right[index]);
}
/**
 * Re-attach the prompt and tool state after a `context` handler. Handlers only see the
 * conversation; the system messages belong to Pi. An unchanged conversation keeps every
 * system message in place, so models with mid-conversation support keep their cached
 * prefix. A changed one gets the replayed prompt sections and tool declarations as one
 * leading system message, so pruning, windowing, or slicing from a compaction summary
 * cannot drop them.
 */
function restoreSystemMessages(current, visible, returned) {
    if (sameMessages(returned, visible))
        return current;
    const head = getCurrentSystemMessage(current);
    return head ? [head, ...returned] : returned;
}
export async function emitProjectTrustEvent(extensionsResult, event, ctx) {
    const errors = [];
    for (const { ext, handlers } of snapshotEventHandlers(extensionsResult.extensions, "project_trust")) {
        // A single extension may register multiple handlers for the same event.
        // The first project_trust handler that returns yes/no wins; undecided falls through.
        for (const handler of handlers) {
            try {
                const handlerResult = (await handler(event, ctx));
                if (handlerResult.trusted === "undecided") {
                    continue;
                }
                return { result: handlerResult, errors };
            }
            catch (error) {
                errors.push({
                    extensionPath: ext.path,
                    event: event.type,
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                });
            }
        }
    }
    return { errors };
}
const noOpUIContext = {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify: () => { },
    onTerminalInput: () => () => { },
    setStatus: () => { },
    setWorkingMessage: () => { },
    setWorkingVisible: () => { },
    setWorkingIndicator: () => { },
    setHiddenThinkingLabel: () => { },
    setWidget: () => { },
    setFooter: () => { },
    setHeader: () => { },
    setTitle: () => { },
    custom: async () => undefined,
    pasteToEditor: () => { },
    setEditorText: () => { },
    getEditorText: () => "",
    editor: async () => undefined,
    addAutocompleteProvider: () => { },
    setEditorComponent: () => { },
    getEditorComponent: () => undefined,
    get theme() {
        return theme;
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: (_theme) => ({ success: false, error: "UI not available" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => { },
};
export class ExtensionRunner {
    extensions;
    runtime;
    uiContext;
    mode = "print";
    cwd;
    sessionManager;
    modelRegistry;
    errorListeners = new Set();
    getModel = () => undefined;
    getScopedModels = () => [];
    isIdleFn = () => true;
    isProjectTrustedFn = () => true;
    getSignalFn = () => undefined;
    waitForIdleFn = async () => { };
    abortFn = () => { };
    hasPendingMessagesFn = () => false;
    getContextUsageFn = () => undefined;
    compactFn = () => { };
    getSystemPromptFn = () => "";
    getSystemPromptOptionsFn = () => normalizeBuildSystemPromptOptions({ cwd: this.cwd });
    executeToolFn;
    getCallableToolsFn = () => [];
    /** Registered MCP servers already reported as unhandled. */
    reportedMcpServers = new Set();
    newSessionHandler = async () => ({ cancelled: false });
    forkHandler = async () => ({ cancelled: false });
    navigateTreeHandler = async () => ({ cancelled: false });
    switchSessionHandler = async () => ({ cancelled: false });
    reloadHandler = async () => { };
    shutdownHandler = () => { };
    shortcutDiagnostics = [];
    commandDiagnostics = [];
    staleMessage;
    uiPromptDepth = 0;
    activeUIPrompt;
    constructor(extensions, runtime, cwd, sessionManager, modelRegistry) {
        this.extensions = extensions;
        this.runtime = runtime;
        // A handler still running when its session is replaced must not report into the replacement's UI.
        this.runtime.reportError = (error) => {
            if (!this.staleMessage)
                this.emitError(error);
        };
        this.uiContext = noOpUIContext;
        this.cwd = cwd;
        this.sessionManager = sessionManager;
        this.modelRegistry = modelRegistry;
    }
    bindCore(actions, contextActions, providerActions) {
        // Copy actions into the shared runtime (all extension APIs reference this)
        this.runtime.sendMessage = actions.sendMessage;
        this.runtime.sendUserMessage = actions.sendUserMessage;
        this.runtime.appendEntry = actions.appendEntry;
        this.runtime.setSessionName = actions.setSessionName;
        this.runtime.getSessionName = actions.getSessionName;
        this.runtime.setLabel = actions.setLabel;
        this.runtime.getActiveTools = actions.getActiveTools;
        this.runtime.getAllTools = actions.getAllTools;
        this.runtime.getSettings = actions.getSettings;
        this.runtime.setActiveTools = actions.setActiveTools;
        this.runtime.refreshTools = actions.refreshTools;
        this.runtime.getCommands = actions.getCommands;
        this.runtime.setModel = actions.setModel;
        this.runtime.getThinkingLevel = actions.getThinkingLevel;
        this.runtime.setThinkingLevel = actions.setThinkingLevel;
        this.runtime.createContext = () => this.createContext();
        // Context actions (required)
        this.getModel = contextActions.getModel;
        this.getScopedModels = contextActions.getScopedModels;
        this.isIdleFn = contextActions.isIdle;
        this.isProjectTrustedFn = contextActions.isProjectTrusted;
        this.getSignalFn = contextActions.getSignal;
        this.abortFn = contextActions.abort;
        this.hasPendingMessagesFn = contextActions.hasPendingMessages;
        this.shutdownHandler = contextActions.shutdown;
        this.getContextUsageFn = contextActions.getContextUsage;
        this.compactFn = contextActions.compact;
        this.getSystemPromptFn = contextActions.getSystemPrompt;
        this.getSystemPromptOptionsFn =
            contextActions.getSystemPromptOptions ?? (() => normalizeBuildSystemPromptOptions({ cwd: this.cwd }));
        this.executeToolFn = contextActions.executeTool;
        this.getCallableToolsFn = contextActions.getCallableTools ?? (() => []);
        // Servers registered from now on reach the extension that connects them right away. Servers
        // registered during loading are read on session_start.
        this.runtime.mcpServers.setChangeListener(() => {
            void this.emit({ type: "mcp_servers_change", servers: this.runtime.mcpServers.list() });
            this.reportUnhandledMcpServers();
        });
        // Flush provider registrations queued during extension loading
        for (const { name, config, extensionPath } of this.runtime.pendingProviderRegistrations) {
            try {
                if (providerActions?.registerProvider) {
                    providerActions.registerProvider(name, config);
                }
                else {
                    this.modelRegistry.registerProvider(name, config);
                }
            }
            catch (err) {
                this.emitError({
                    extensionPath,
                    event: "register_provider",
                    error: err instanceof Error ? err.message : String(err),
                    stack: err instanceof Error ? err.stack : undefined,
                });
            }
        }
        this.runtime.pendingProviderRegistrations = [];
        for (const { provider, extensionPath } of this.runtime.pendingNativeProviderRegistrations) {
            try {
                if (providerActions?.registerNativeProvider) {
                    providerActions.registerNativeProvider(provider);
                }
                else {
                    this.modelRegistry.registerProvider(provider);
                }
            }
            catch (err) {
                this.emitError({
                    extensionPath,
                    event: "register_provider",
                    error: err instanceof Error ? err.message : String(err),
                    stack: err instanceof Error ? err.stack : undefined,
                });
            }
        }
        this.runtime.pendingNativeProviderRegistrations = [];
        const registerVirtualModel = (definition) => {
            if (providerActions?.registerVirtualModel)
                providerActions.registerVirtualModel(definition);
            else
                this.modelRegistry.registerVirtualModel(definition);
        };
        for (const { definition, extensionPath } of this.runtime.pendingVirtualModelRegistrations) {
            try {
                registerVirtualModel(definition);
            }
            catch (err) {
                this.emitError({
                    extensionPath,
                    event: "register_virtual_model",
                    error: err instanceof Error ? err.message : String(err),
                    stack: err instanceof Error ? err.stack : undefined,
                });
            }
        }
        this.runtime.pendingVirtualModelRegistrations = [];
        // From this point on, provider registration/unregistration takes effect immediately
        // without requiring a /reload.
        this.runtime.registerProvider = (name, config) => {
            if (providerActions?.registerProvider) {
                providerActions.registerProvider(name, config);
                return;
            }
            this.modelRegistry.registerProvider(name, config);
        };
        this.runtime.registerNativeProvider = (provider) => {
            if (providerActions?.registerNativeProvider) {
                providerActions.registerNativeProvider(provider);
                return;
            }
            this.modelRegistry.registerProvider(provider);
        };
        this.runtime.unregisterProvider = (name) => {
            if (providerActions?.unregisterProvider) {
                providerActions.unregisterProvider(name);
                return;
            }
            this.modelRegistry.unregisterProvider(name);
        };
        this.runtime.registerVirtualModel = registerVirtualModel;
        this.runtime.unregisterVirtualModel = (provider, id) => {
            if (providerActions?.unregisterVirtualModel)
                providerActions.unregisterVirtualModel(provider, id);
            else
                this.modelRegistry.unregisterVirtualModel(provider, id);
        };
    }
    bindCommandContext(actions) {
        if (actions) {
            this.waitForIdleFn = actions.waitForIdle;
            this.newSessionHandler = actions.newSession;
            this.forkHandler = actions.fork;
            this.navigateTreeHandler = actions.navigateTree;
            this.switchSessionHandler = actions.switchSession;
            this.reloadHandler = actions.reload;
            return;
        }
        this.waitForIdleFn = async () => { };
        this.newSessionHandler = async () => ({ cancelled: false });
        this.forkHandler = async () => ({ cancelled: false });
        this.navigateTreeHandler = async () => ({ cancelled: false });
        this.switchSessionHandler = async () => ({ cancelled: false });
        this.reloadHandler = async () => { };
    }
    setUIContext(uiContext, mode = "print") {
        this.uiContext = uiContext ? this.wrapUIPromptContext(uiContext) : noOpUIContext;
        this.mode = mode;
    }
    wrapUIPromptContext(ui) {
        return {
            ...ui,
            select: (title, options, opts) => this.withUIPrompt("select", title, () => ui.select(title, options, opts)),
            confirm: (title, message, opts) => this.withUIPrompt("confirm", title, () => ui.confirm(title, message, opts)),
            input: (title, placeholder, opts) => this.withUIPrompt("input", title, () => ui.input(title, placeholder, opts)),
            editor: (title, prefill) => this.withUIPrompt("editor", title, () => ui.editor(title, prefill)),
            custom: (factory, options) => this.withUIPrompt("custom", undefined, () => ui.custom(factory, options)),
        };
    }
    withUIPrompt(kind, title, run) {
        const outerPrompt = this.uiPromptDepth++ === 0;
        if (outerPrompt) {
            this.activeUIPrompt = { kind, title };
            this.emitUIPromptEvent({ type: "ui_prompt_start", reason: "ui_prompt", kind, ...(title ? { title } : {}) });
        }
        const finish = () => {
            if (--this.uiPromptDepth > 0)
                return;
            this.uiPromptDepth = 0;
            const prompt = this.activeUIPrompt ?? { kind, title };
            this.activeUIPrompt = undefined;
            this.emitUIPromptEvent({
                type: "ui_prompt_end",
                reason: "ui_prompt",
                kind: prompt.kind,
                ...(prompt.title ? { title: prompt.title } : {}),
            });
        };
        try {
            return run().finally(finish);
        }
        catch (err) {
            finish();
            throw err;
        }
    }
    emitUIPromptEvent(event) {
        queueMicrotask(() => {
            void this.emit(event);
        });
    }
    /** Whether an extension is waiting for a user-facing dialog. */
    get isAwaitingInput() {
        return this.uiPromptDepth > 0;
    }
    getUIContext() {
        return this.uiContext;
    }
    hasUI() {
        return this.uiContext !== noOpUIContext;
    }
    getExtensionPaths() {
        return this.extensions.map((e) => e.path);
    }
    /** Get all registered tools from all extensions (first registration per name wins). */
    getAllRegisteredTools() {
        const toolsByName = new Map();
        for (const ext of this.extensions) {
            for (const tool of ext.tools.values()) {
                if (!toolsByName.has(tool.definition.name)) {
                    toolsByName.set(tool.definition.name, tool);
                }
            }
        }
        return Array.from(toolsByName.values());
    }
    /** Get a tool definition by name. Returns undefined if not found. */
    getToolDefinition(toolName) {
        for (const ext of this.extensions) {
            const tool = ext.tools.get(toolName);
            if (tool) {
                return tool.definition;
            }
        }
        return undefined;
    }
    getFlags() {
        const allFlags = new Map();
        for (const ext of this.extensions) {
            for (const [name, flag] of ext.flags) {
                if (!allFlags.has(name)) {
                    allFlags.set(name, flag);
                }
            }
        }
        return allFlags;
    }
    setFlagValue(name, value) {
        this.runtime.flagValues.set(name, value);
    }
    getFlagValues() {
        return new Map(this.runtime.flagValues);
    }
    getShortcuts(resolvedKeybindings) {
        this.shortcutDiagnostics = [];
        const builtinKeybindings = buildBuiltinKeybindings(resolvedKeybindings);
        const extensionShortcuts = new Map();
        const addDiagnostic = (message, extensionPath) => {
            this.shortcutDiagnostics.push({ type: "warning", message, path: extensionPath });
            if (!this.hasUI()) {
                console.warn(message);
            }
        };
        for (const ext of this.extensions) {
            for (const [key, shortcut] of ext.shortcuts) {
                const normalizedKey = key.toLowerCase();
                const builtInKeybinding = builtinKeybindings[normalizedKey];
                if (builtInKeybinding?.restrictOverride === true) {
                    addDiagnostic(`Extension shortcut '${key}' from ${shortcut.extensionPath} conflicts with built-in shortcut. Skipping.`, shortcut.extensionPath);
                    continue;
                }
                if (builtInKeybinding?.restrictOverride === false) {
                    addDiagnostic(`Extension shortcut conflict: '${key}' is built-in shortcut for ${builtInKeybinding.keybinding} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`, shortcut.extensionPath);
                }
                const existingExtensionShortcut = extensionShortcuts.get(normalizedKey);
                if (existingExtensionShortcut) {
                    addDiagnostic(`Extension shortcut conflict: '${key}' registered by both ${existingExtensionShortcut.extensionPath} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`, shortcut.extensionPath);
                }
                extensionShortcuts.set(normalizedKey, shortcut);
            }
        }
        return extensionShortcuts;
    }
    getShortcutDiagnostics() {
        return this.shortcutDiagnostics;
    }
    invalidate(message = "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().") {
        if (!this.staleMessage) {
            this.staleMessage = message;
            this.runtime.invalidate(message);
        }
    }
    assertActive() {
        if (this.staleMessage) {
            throw new Error(this.staleMessage);
        }
    }
    onError(listener) {
        this.errorListeners.add(listener);
        return () => this.errorListeners.delete(listener);
    }
    emitError(error) {
        for (const listener of this.errorListeners) {
            listener(error);
        }
    }
    /**
     * Report registered MCP servers when no extension handles `mcp_servers_change`, which means
     * nothing connects them (for example when another MCP extension replaced the built-in one).
     */
    reportUnhandledMcpServers() {
        if (this.hasHandlers("mcp_servers_change"))
            return;
        for (const server of this.runtime.mcpServers.list()) {
            if (this.reportedMcpServers.has(server.name))
                continue;
            this.reportedMcpServers.add(server.name);
            this.emitError({
                extensionPath: server.extensionPath,
                event: "register_mcp_server",
                error: `MCP server "${server.name}" is registered, but no loaded extension connects MCP servers; another extension may have replaced the built-in MCP support`,
            });
        }
    }
    hasHandlers(eventType) {
        for (const ext of this.extensions) {
            const handlers = ext.handlers.get(eventType);
            if (handlers && handlers.length > 0) {
                return true;
            }
        }
        return false;
    }
    getMessageRenderer(customType) {
        for (const ext of this.extensions) {
            const renderer = ext.messageRenderers.get(customType);
            if (renderer) {
                return renderer;
            }
        }
        return undefined;
    }
    /** Markdown transformers in extension load order; each one leaves Markdown of unregistered surfaces unchanged. */
    getMarkdownTransformers() {
        return this.extensions.flatMap((ext) => {
            if (!ext.markdownTransformer)
                return [];
            const { transformer, messageTypes } = ext.markdownTransformer;
            return [
                (markdown, context) => (messageTypes.has(context.messageType) ? transformer(markdown, context) : markdown),
            ];
        });
    }
    /** Renderers of calls to `toolName`: extension resolvers in load order, then `base`. */
    resolveToolRenderers(toolName, base) {
        const resolvers = this.extensions.flatMap((ext) => ext.toolRenderers ?? []);
        const resolve = (index) => index < resolvers.length ? resolvers[index](toolName, () => resolve(index + 1)) : base();
        return resolve(0);
    }
    getEntryRenderer(customType) {
        for (const ext of this.extensions) {
            const renderer = ext.entryRenderers?.get(customType);
            if (renderer) {
                return renderer;
            }
        }
        return undefined;
    }
    resolveRegisteredCommands() {
        const commands = [];
        const counts = new Map();
        for (const ext of this.extensions) {
            for (const command of ext.commands.values()) {
                commands.push(command);
                counts.set(command.name, (counts.get(command.name) ?? 0) + 1);
            }
        }
        const seen = new Map();
        const takenInvocationNames = new Set();
        return commands.map((command) => {
            const occurrence = (seen.get(command.name) ?? 0) + 1;
            seen.set(command.name, occurrence);
            let invocationName = (counts.get(command.name) ?? 0) > 1 ? `${command.name}:${occurrence}` : command.name;
            if (takenInvocationNames.has(invocationName)) {
                let suffix = occurrence;
                do {
                    suffix++;
                    invocationName = `${command.name}:${suffix}`;
                } while (takenInvocationNames.has(invocationName));
            }
            takenInvocationNames.add(invocationName);
            return {
                ...command,
                invocationName,
            };
        });
    }
    getModelRegistry() {
        return this.modelRegistry;
    }
    getRegisteredCommands() {
        this.commandDiagnostics = [];
        return this.resolveRegisteredCommands();
    }
    getCommandDiagnostics() {
        return this.commandDiagnostics;
    }
    getCommand(name) {
        return this.resolveRegisteredCommands().find((command) => command.invocationName === name);
    }
    /**
     * Request a graceful shutdown. Called by extension tools and event handlers.
     * The actual shutdown behavior is provided by the mode via bindExtensions().
     */
    shutdown() {
        this.shutdownHandler();
    }
    getActiveTools() {
        this.assertActive();
        return this.runtime.getActiveTools();
    }
    /**
     * Create an ExtensionContext for use in event handlers and tool execution.
     * Context values are resolved at call time, so changes via bindCore/bindUI are reflected.
     */
    createContext() {
        const runner = this;
        const getModel = this.getModel;
        const getScopedModels = this.getScopedModels;
        return {
            get ui() {
                runner.assertActive();
                return runner.uiContext;
            },
            get mode() {
                runner.assertActive();
                return runner.mode;
            },
            get hasUI() {
                runner.assertActive();
                return runner.hasUI();
            },
            get cwd() {
                runner.assertActive();
                return runner.cwd;
            },
            get sessionManager() {
                runner.assertActive();
                return runner.sessionManager;
            },
            get modelRegistry() {
                runner.assertActive();
                return runner.modelRegistry;
            },
            get model() {
                runner.assertActive();
                return getModel();
            },
            get scopedModels() {
                runner.assertActive();
                return getScopedModels();
            },
            get thinkingLevel() {
                runner.assertActive();
                return runner.runtime.getThinkingLevel();
            },
            isIdle: () => {
                runner.assertActive();
                return runner.isIdleFn();
            },
            isProjectTrusted: () => {
                runner.assertActive();
                return runner.isProjectTrustedFn();
            },
            get signal() {
                runner.assertActive();
                return runner.getSignalFn();
            },
            abort: () => {
                runner.assertActive();
                runner.abortFn();
            },
            hasPendingMessages: () => {
                runner.assertActive();
                return runner.hasPendingMessagesFn();
            },
            shutdown: () => {
                runner.assertActive();
                runner.shutdownHandler();
            },
            getContextUsage: () => {
                runner.assertActive();
                return runner.getContextUsageFn();
            },
            getCompactionMethod: () => {
                runner.assertActive();
                return runner.runtime.getSettings().compaction?.method === "extension" ? "extension" : "cache-aware";
            },
            compact: (options) => {
                runner.assertActive();
                runner.compactFn(options);
            },
            getSystemPrompt: () => {
                runner.assertActive();
                return runner.getSystemPromptFn();
            },
            getSideQuestionSnapshot: (options) => {
                runner.assertActive();
                return getSideQuestionSnapshot(runner.sessionManager, options);
            },
        };
    }
    /**
     * Create the context for executing the tool call `toolCallId`: the extension context plus
     * `tools` and `executeTool()`. `signal` is the default signal of nested calls.
     */
    createToolContext(toolCallId, signal) {
        const runner = this;
        // createContext() returns a fresh object, so adding properties does not affect other contexts.
        return Object.defineProperties(this.createContext(), {
            tools: {
                get() {
                    runner.assertActive();
                    return runner.getCallableToolsFn();
                },
            },
            executeTool: {
                value: async (name, args, options = {}) => {
                    runner.assertActive();
                    if (!runner.executeToolFn) {
                        return {
                            toolCall: { type: "toolCall", id: `${toolCallId}/0`, name, arguments: {} },
                            result: {
                                content: [{ type: "text", text: "Nested tool calls are not available in this context" }],
                                details: {},
                            },
                            isError: true,
                        };
                    }
                    return runner.executeToolFn(toolCallId, name, args, { ...options, signal: options.signal ?? signal });
                },
            },
        });
    }
    createCommandContext() {
        // Use property descriptors instead of object spread so the guarded getters from
        // createContext() stay lazy. A spread would eagerly read them once and freeze the
        // old values into the returned object, bypassing stale-instance checks.
        const context = Object.defineProperties({}, Object.getOwnPropertyDescriptors(this.createContext()));
        context.getSystemPromptOptions = () => {
            this.assertActive();
            return this.getSystemPromptOptionsFn();
        };
        context.waitForIdle = () => {
            this.assertActive();
            return this.waitForIdleFn();
        };
        context.newSession = (options) => {
            this.assertActive();
            return this.newSessionHandler(options);
        };
        context.fork = (entryId, options) => {
            this.assertActive();
            return this.forkHandler(entryId, options);
        };
        context.navigateTree = (targetId, options) => {
            this.assertActive();
            return this.navigateTreeHandler(targetId, options);
        };
        context.switchSession = (sessionPath, options) => {
            this.assertActive();
            return this.switchSessionHandler(sessionPath, options);
        };
        context.reload = () => {
            this.assertActive();
            return this.reloadHandler();
        };
        return context;
    }
    async emitBoundary(baseEvent, buildContext) {
        const ctx = this.createContext();
        let entries = [];
        let shouldContinue = false;
        let context = await buildContext(entries);
        let valid = true;
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, baseEvent.type)) {
            for (const handler of handlers) {
                const event = {
                    ...baseEvent,
                    entries,
                    continue: shouldContinue,
                    context,
                };
                try {
                    const handlerResult = (await handler(event, ctx));
                    if (handlerResult?.entries !== undefined)
                        entries = handlerResult.entries;
                    if (handlerResult?.continue !== undefined)
                        shouldContinue = handlerResult.continue;
                }
                catch (err) {
                    this.emitError({
                        extensionPath: ext.path,
                        event: baseEvent.type,
                        error: err instanceof Error ? err.message : String(err),
                        stack: err instanceof Error ? err.stack : undefined,
                    });
                }
                try {
                    context = await buildContext(entries);
                    valid = true;
                }
                catch (err) {
                    valid = false;
                    this.emitError({
                        extensionPath: ext.path,
                        event: baseEvent.type,
                        error: `Invalid boundary entries: ${err instanceof Error ? err.message : String(err)}`,
                        stack: err instanceof Error ? err.stack : undefined,
                    });
                }
            }
        }
        return valid
            ? { entries, continue: shouldContinue, context, valid: true }
            : { entries: [], continue: false, context, valid: false };
    }
    isSessionBeforeEvent(event) {
        return (event.type === "session_before_switch" ||
            event.type === "session_before_fork" ||
            event.type === "session_before_compact" ||
            event.type === "session_before_tree");
    }
    async emit(event) {
        const ctx = this.createContext();
        let result;
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, event.type)) {
            for (const handler of handlers) {
                try {
                    const handlerResult = await handler(event, ctx);
                    if (this.isSessionBeforeEvent(event) && handlerResult) {
                        result = handlerResult;
                        // Stop at the first checkpoint to avoid duplicate summaries and overwritten metadata.
                        if (result.cancel ||
                            (event.type === "session_before_compact" && result.compaction)) {
                            return result;
                        }
                    }
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    this.emitError({
                        extensionPath: ext.path,
                        event: event.type,
                        error: message,
                        stack,
                    });
                }
            }
        }
        return result;
    }
    /** Return the first account-bound usage snapshot without invoking another provider. */
    async emitProviderUsage(event) {
        const ctx = this.createContext();
        for (const { handlers } of snapshotEventHandlers(this.extensions, event.type)) {
            for (const handler of handlers) {
                event.signal.throwIfAborted();
                const result = (await handler(event, ctx));
                if (result !== undefined)
                    return result;
            }
        }
        return undefined;
    }
    /** Returns the event's own action unless a handler overrides it; the last override wins. */
    async emitCacheWarmingDecision(event) {
        const ctx = this.createContext();
        let action = event.action;
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, event.type)) {
            for (const handler of handlers) {
                try {
                    const result = (await handler(event, ctx));
                    if (result?.action !== undefined)
                        action = result.action;
                }
                catch (err) {
                    this.emitError({
                        extensionPath: ext.path,
                        event: event.type,
                        error: err instanceof Error ? err.message : String(err),
                        stack: err instanceof Error ? err.stack : undefined,
                    });
                }
            }
        }
        return action;
    }
    async emitMessageEnd(event) {
        const ctx = this.createContext();
        let currentMessage = event.message;
        let modified = false;
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, "message_end")) {
            for (const handler of handlers) {
                try {
                    const currentEvent = { ...event, message: currentMessage };
                    const handlerResult = (await handler(currentEvent, ctx));
                    if (!handlerResult?.message)
                        continue;
                    if (handlerResult.message.role !== currentMessage.role) {
                        this.emitError({
                            extensionPath: ext.path,
                            event: "message_end",
                            error: "message_end handlers must return a message with the same role",
                        });
                        continue;
                    }
                    currentMessage = handlerResult.message;
                    modified = true;
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "message_end",
                        error: message,
                        stack,
                    });
                }
            }
        }
        return modified ? currentMessage : undefined;
    }
    async emitToolResult(event) {
        const ctx = this.createContext();
        const currentEvent = { ...event };
        let modified = false;
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, "tool_result")) {
            for (const handler of handlers) {
                try {
                    const handlerResult = (await handler(currentEvent, ctx));
                    if (!handlerResult)
                        continue;
                    if (handlerResult.content !== undefined) {
                        currentEvent.content = handlerResult.content;
                        // Structured content that is not replaced along with the content may no longer match it.
                        if (handlerResult.structuredContent === undefined)
                            delete currentEvent.structuredContent;
                        modified = true;
                    }
                    if (handlerResult.details !== undefined) {
                        currentEvent.details = handlerResult.details;
                        modified = true;
                    }
                    if (handlerResult.structuredContent !== undefined) {
                        currentEvent.structuredContent = handlerResult.structuredContent;
                        modified = true;
                    }
                    if (handlerResult.isError !== undefined) {
                        currentEvent.isError = handlerResult.isError;
                        modified = true;
                    }
                    if (handlerResult.usage !== undefined) {
                        currentEvent.usage = handlerResult.usage;
                        modified = true;
                    }
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "tool_result",
                        error: message,
                        stack,
                    });
                }
            }
        }
        if (!modified) {
            return undefined;
        }
        return {
            content: currentEvent.content,
            details: currentEvent.details,
            structuredContent: currentEvent.structuredContent,
            isError: currentEvent.isError,
            usage: currentEvent.usage,
        };
    }
    async emitToolCall(event) {
        const ctx = this.createContext();
        let result;
        for (const { handlers } of snapshotEventHandlers(this.extensions, "tool_call")) {
            for (const handler of handlers) {
                const handlerResult = await handler(event, ctx);
                if (handlerResult) {
                    result = handlerResult;
                    if (result.block) {
                        return result;
                    }
                }
            }
        }
        return result;
    }
    async emitUserBash(event) {
        const ctx = this.createContext();
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, "user_bash")) {
            for (const handler of handlers) {
                try {
                    const handlerResult = await handler(event, ctx);
                    if (handlerResult === undefined)
                        continue;
                    if (!isUserBashEventResult(handlerResult)) {
                        throw new Error("Invalid user_bash handler result: return undefined for local execution or exactly one valid { operations } or { result } object");
                    }
                    return handlerResult;
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "user_bash",
                        error: message,
                        stack,
                    });
                    throw err;
                }
            }
        }
        return undefined;
    }
    /**
     * Run the request-time transforms in two phases. `context` handlers see the conversation
     * only and Pi restores the prompt and tool state after each; `context_with_system`
     * handlers then see the full transcript and their output is used as returned.
     */
    async emitContext(messages) {
        const ctx = this.createContext();
        let currentMessages = structuredClone(messages);
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, "context")) {
            for (const handler of handlers) {
                try {
                    const visibleMessages = currentMessages.filter((message) => message.role !== "system");
                    const visibleSnapshot = visibleMessages.slice();
                    const event = { type: "context", messages: visibleMessages };
                    const handlerResult = (await handler(event, ctx));
                    // Handlers may return a new list or edit event.messages in place.
                    const returned = handlerResult?.messages ??
                        (sameMessages(visibleMessages, visibleSnapshot) ? undefined : visibleMessages);
                    if (!returned)
                        continue;
                    currentMessages = restoreSystemMessages(currentMessages, visibleSnapshot, returned);
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "context",
                        error: message,
                        stack,
                    });
                }
            }
        }
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, "context_with_system")) {
            for (const handler of handlers) {
                try {
                    const hadLeadingSystemMessage = currentMessages[0]?.role === "system";
                    const event = { type: "context_with_system", messages: currentMessages };
                    const handlerResult = (await handler(event, ctx));
                    currentMessages = handlerResult?.messages ?? currentMessages;
                    // Providers read the prompt and initial tools from the leading system message.
                    // Losing it is never intended; report it but honor the handler's output.
                    if (hadLeadingSystemMessage && currentMessages[0]?.role !== "system") {
                        this.emitError({
                            extensionPath: ext.path,
                            event: "context_with_system",
                            error: "Handler removed the leading system message; the request has no prompt or initial tool declarations. Keep it at index 0 or replace a dropped prefix with getCurrentSystemMessage().",
                        });
                    }
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "context_with_system",
                        error: message,
                        stack,
                    });
                }
            }
        }
        return currentMessages;
    }
    async emitBeforeProviderRequest(payload) {
        const ctx = this.createContext();
        let currentPayload = payload;
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, "before_provider_request")) {
            for (const handler of handlers) {
                try {
                    const event = {
                        type: "before_provider_request",
                        payload: currentPayload,
                    };
                    const handlerResult = await handler(event, ctx);
                    if (handlerResult !== undefined) {
                        currentPayload = handlerResult;
                    }
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "before_provider_request",
                        error: message,
                        stack,
                    });
                }
            }
        }
        return currentPayload;
    }
    async emitBeforeProviderHeaders(headers) {
        const ctx = this.createContext();
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, "before_provider_headers")) {
            for (const handler of handlers) {
                try {
                    // Handlers mutate `headers` in place; the return value is ignored.
                    const event = {
                        type: "before_provider_headers",
                        headers,
                    };
                    await handler(event, ctx);
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "before_provider_headers",
                        error: message,
                        stack,
                    });
                }
            }
        }
        return headers;
    }
    async emitBeforeAgentStart(trigger, systemPromptOptions) {
        const currentOptions = normalizeBuildSystemPromptOptions(systemPromptOptions);
        const renderCurrentSystemPrompt = () => buildSystemPrompt(currentOptions);
        const ctx = Object.defineProperties({}, Object.getOwnPropertyDescriptors(this.createContext()));
        ctx.getSystemPrompt = () => {
            this.assertActive();
            return renderCurrentSystemPrompt();
        };
        const messages = [];
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, "before_agent_start")) {
            for (const handler of handlers) {
                try {
                    const event = {
                        ...trigger,
                        type: "before_agent_start",
                        get systemPrompt() {
                            return renderCurrentSystemPrompt();
                        },
                        systemPromptOptions: currentOptions,
                    };
                    const handlerResult = await handler(event, ctx);
                    if (handlerResult) {
                        const result = handlerResult;
                        if (result.message)
                            messages.push(result.message);
                        if (result.systemPrompt !== undefined) {
                            currentOptions.forceSystemPrompt = result.systemPrompt;
                        }
                    }
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "before_agent_start",
                        error: message,
                        stack,
                    });
                }
            }
        }
        return { messages, systemPromptOptions: currentOptions };
    }
    async emitResourcesDiscover(cwd, reason) {
        const ctx = this.createContext();
        const skillPaths = [];
        const promptPaths = [];
        const themePaths = [];
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, "resources_discover")) {
            for (const handler of handlers) {
                try {
                    const event = { type: "resources_discover", cwd, reason };
                    const handlerResult = await handler(event, ctx);
                    const result = handlerResult;
                    if (result?.skillPaths?.length) {
                        skillPaths.push(...result.skillPaths.map((path) => ({ path, extensionPath: ext.path })));
                    }
                    if (result?.promptPaths?.length) {
                        promptPaths.push(...result.promptPaths.map((path) => ({ path, extensionPath: ext.path })));
                    }
                    if (result?.themePaths?.length) {
                        themePaths.push(...result.themePaths.map((path) => ({ path, extensionPath: ext.path })));
                    }
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const stack = err instanceof Error ? err.stack : undefined;
                    this.emitError({
                        extensionPath: ext.path,
                        event: "resources_discover",
                        error: message,
                        stack,
                    });
                }
            }
        }
        return { skillPaths, promptPaths, themePaths };
    }
    /** Emit input event. Transforms chain, "handled" short-circuits. */
    async emitInput(text, images, source, streamingBehavior) {
        const ctx = this.createContext();
        let currentText = text;
        let currentImages = images;
        for (const { ext, handlers } of snapshotEventHandlers(this.extensions, "input")) {
            for (const handler of handlers) {
                try {
                    const event = {
                        type: "input",
                        text: currentText,
                        images: currentImages,
                        source,
                        streamingBehavior,
                    };
                    const result = (await handler(event, ctx));
                    if (result?.action === "handled")
                        return result;
                    if (result?.action === "transform") {
                        currentText = result.text;
                        currentImages = result.images ?? currentImages;
                    }
                }
                catch (err) {
                    this.emitError({
                        extensionPath: ext.path,
                        event: "input",
                        error: err instanceof Error ? err.message : String(err),
                        stack: err instanceof Error ? err.stack : undefined,
                    });
                }
            }
        }
        return currentText !== text || currentImages !== images
            ? { action: "transform", text: currentText, images: currentImages }
            : { action: "continue" };
    }
}
