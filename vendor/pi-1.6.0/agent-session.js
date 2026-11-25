/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print, rpc).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and thinking level management
 * - Compaction (manual and auto)
 * - Bash execution
 * - Session switching and branching
 *
 * Modes use this class and add their own I/O layer on top.
 */
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { runToolCall, } from "@earendil-works/pi-agent-core";
import { contentText, getCurrentSystemMessage, getCurrentTools, retryDelayMs } from "@earendil-works/pi-ai";
import { clampThinkingLevel, cleanupSessionResources, getSupportedThinkingLevels, isContextOverflow, isRecoverableLength, isRetryableAssistantError, modelsAreEqual, resetApiProviders, streamSimple, } from "@earendil-works/pi-ai/compat";
import { getThemeByName, theme } from "../modes/interactive/theme/theme.js";
import { stripFrontmatter } from "../utils/frontmatter.js";
import { processImage } from "../utils/image-process.js";
import { sleep } from "../utils/sleep.js";
import { normalizeToolResultImages } from "../utils/tool-result-images.js";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "./auth-guidance.js";
import { executeBashWithOperations } from "./bash-executor.js";
import { generateBugReportSummary } from "./bug-report.js";
import { compactCachedRequest, retainUnseenCompactionEntries, } from "./cache-compaction.js";
import { calculateContextTokens, collectEntriesForBranchSummary, compact, estimateContextTokens, estimateProjectedContextTokens, estimateTokens, generateBranchSummary, prepareCompaction, shouldCompact, } from "./compaction/index.js";
import { DEFAULT_THINKING_LEVEL, THINKING_LEVEL_OPTIONS } from "./defaults.js";
import { exportSessionToHtml } from "./export-html/index.js";
import { createToolHtmlRenderer } from "./export-html/tool-renderer.js";
import { ExtensionRunner, wrapRegisteredTools, } from "./extensions/index.js";
import { emitSessionShutdownEvent } from "./extensions/runner.js";
import { createToolNameMatcher, isMcpToolName } from "./mcp-servers.js";
import { convertToLlm } from "./messages.js";
import { ModelRegistry } from "./model-registry.js";
import { NestedToolCallRunner } from "./nested-tool-calls.js";
import { expandPromptTemplate } from "./prompt-templates.js";
import { QueuedInputs } from "./queued-input.js";
import { exportSessionToJsonl } from "./session-export.js";
import { getLatestCompactionEntry, SessionManager, } from "./session-manager.js";
import { applyToolModifiers, DEFAULT_TOOL_NAMES, } from "./settings-manager.js";
import { getCompactionCacheRequest } from "./side-questions.js";
import { BUILTIN_PATH_PREFIX, createSyntheticSourceInfo, isSyntheticPath } from "./source-info.js";
import { buildSystemPrompt, buildSystemPromptSections, diffSystemPromptSections, normalizeBuildSystemPromptOptions, } from "./system-prompt.js";
import { createLocalBashOperations } from "./tools/bash.js";
import { createAllToolDefinitions } from "./tools/index.js";
import { createToolDefinitionFromAgentTool } from "./tools/tool-definition-wrapper.js";
import { addUsageToTotals, combineUsage, createUsageTotals } from "./usage-totals.js";
import { findLatestResponse, getBranchSelection, getVirtualModelState, isVirtualModel, VIRTUAL_MODEL_STATE_ENTRY, } from "./virtual-models.js";
/**
 * Stream functions that resolve auth through a given ModelRuntime themselves, such as the one
 * createAgentSession installs. Summaries sent through them must not pass pre-resolved credentials:
 * the runtime would take them as an explicit API key instead of the stored OAuth login (#11520).
 */
const runtimeStreamFunctions = new WeakMap();
/** Mark `streamFn` as resolving auth through `modelRuntime` on its own. */
export function markRuntimeStreamFunction(streamFn, modelRuntime) {
    runtimeStreamFunctions.set(streamFn, modelRuntime);
}
/**
 * Parse a skill block from message text.
 * Returns null if the text doesn't contain a skill block.
 */
export function parseSkillBlock(text) {
    const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
    if (!match)
        return null;
    return {
        name: match[1],
        location: match[2],
        content: match[3],
        userMessage: match[4]?.trim() || undefined,
    };
}
// ============================================================================
// Types
// ============================================================================
function withoutDeletedHeaders(headers) {
    return headers
        ? Object.fromEntries(Object.entries(headers).filter((entry) => entry[1] !== null))
        : undefined;
}
function estimateMessagesTokens(messages) {
    let tokens = 0;
    for (const message of messages) {
        tokens += estimateTokens(message);
    }
    return tokens;
}
// ============================================================================
// AgentSession Class
// ============================================================================
/**
 * Index of the model to cycle to, or undefined when there is nothing to switch to.
 * When the current model is not in the list (currentIndex -1), forward picks the first
 * entry and backward the last, so a one-entry list still selects its only model.
 */
function getNextCycleIndex(currentIndex, length, direction) {
    if (length === 0)
        return undefined;
    if (currentIndex === -1)
        return direction === "forward" ? 0 : length - 1;
    if (length === 1)
        return undefined;
    return direction === "forward" ? (currentIndex + 1) % length : (currentIndex - 1 + length) % length;
}
export class AgentSession {
    agent;
    sessionManager;
    settingsManager;
    _scopedModels;
    // Event subscription state
    _unsubscribeAgent;
    _eventListeners = [];
    _isAgentRunActive = false;
    _promptPreflightCount = 0;
    _agentRunAbortRequested = false;
    _idleWaitPromise;
    _resolveIdleWait;
    _queuedInputs;
    /** Serialize input preparation, never the model run, so asynchronous hooks cannot reorder submissions. */
    _inputAdmission = Promise.resolve();
    /** Messages queued to be included with the next user prompt as context ("asides"). */
    _pendingNextTurnMessages = [];
    /** Context-only custom messages queued during a run, flushed once the current turn's tool results are in. */
    _pendingCustomMessages = [];
    // Compaction state
    _compactionAbortController = undefined;
    _completedManualCompactions = new WeakSet();
    _autoCompactionAbortController = undefined;
    _overflowRecoveryAttempted = false;
    _cacheCompaction;
    _inputActive = false;
    // Branch summarization state
    _branchSummaryAbortController = undefined;
    // Retry state
    _retryAbortController = undefined;
    _retryAttempt = 0;
    /**
     * Failed response that the next request repeats, set by auto-retry and overflow recovery. The
     * retry is routed with it as `failed`, since the context no longer contains it.
     */
    _failedResponse;
    // Bash execution state
    _bashAbortControllers = new Set();
    _pendingBashMessages = [];
    // Extension system
    _extensionRunner;
    _turnIndex = 0;
    _entryIdsByMessage = new WeakMap();
    _boundaryDispatchedMessages = new WeakSet();
    _lastAssistantMessage;
    _lastActivityOutcome = "completed";
    _isBeforeSettle = false;
    _beforeSettleAbortController;
    _abortDuringBeforeSettle = false;
    _isEmittingAgentSettled = false;
    _deferredSettledActions = [];
    _resourceLoader;
    _customTools;
    _baseToolDefinitions = new Map();
    _cwd;
    _extensionRunnerRef;
    _initialActiveToolNames;
    /**
     * Tools of the restored or reloaded loadout that are not registered yet, such as tools of MCP
     * servers that are still connecting. They are activated when they are registered, and dropped when
     * `setActiveToolsByName()` deactivates a tool of that loadout or the next agent run starts.
     */
    _pendingToolNames = new Set();
    /** The restored or reloaded loadout that `_pendingToolNames` belongs to. */
    _restoredToolNames = new Set();
    _usesDefaultTools;
    _defaultToolModifiers;
    /** Matches the `--tools` entries: tool names or patterns. */
    _allowedTools;
    /**
     * Whether the allowlist filters MCP tools: it is empty (`--no-tools`) or names an MCP tool
     * (`mcp__*`). Otherwise it keeps MCP tools registered for codemode and tool_search.
     */
    _allowlistFiltersMcp = false;
    _excludedTools;
    _baseToolsOverride;
    _sessionStartEvent;
    _extensionUIContext;
    _extensionMode = "print";
    _extensionCommandContextActions;
    _extensionAbortHandler;
    _extensionShutdownHandler;
    _extensionErrorListener;
    _extensionErrorUnsubscriber;
    // Set by bindExtensions(): reload() restarts extensions only if the host started them.
    _extensionsBound = false;
    _modelRuntime;
    _cacheWarmer;
    // Tool registry for extension getTools/setTools
    _toolRegistry = new Map();
    /** Created on the first `ctx.executeTool()` call. */
    _nestedToolCalls;
    /** Declared tools whose declarations requests leave out, from `prepareLoadout` hooks. */
    _hiddenDeclarations = new Set();
    _toolDefinitions = new Map();
    _toolPromptSnippets = new Map();
    _toolPromptGuidelines = new Map();
    _baseSystemPromptOptions;
    /** Prompt options after before_agent_start mutations for the active run. */
    _runSystemPromptOptions;
    constructor(config) {
        this.agent = config.agent;
        this._queuedInputs = new QueuedInputs(this.agent, () => this._emitQueueUpdate());
        this.sessionManager = config.sessionManager;
        this.settingsManager = config.settingsManager;
        this._scopedModels = config.scopedModels ?? [];
        this._resourceLoader = config.resourceLoader;
        this._customTools = config.customTools ?? [];
        this._cwd = config.cwd;
        this._modelRuntime = config.modelRuntime;
        this._cacheWarmer = config.cacheWarmer;
        if (this._cacheWarmer) {
            this._cacheWarmer.onWarmed = (entry) => this._emit({ type: "entry_appended", entry });
        }
        this._extensionRunnerRef = config.extensionRunnerRef;
        this._initialActiveToolNames = config.initialActiveToolNames;
        this._usesDefaultTools = config.usesDefaultTools ?? false;
        this._defaultToolModifiers = config.defaultToolModifiers ?? [];
        if (config.allowedToolNames) {
            this._allowedTools = createToolNameMatcher(config.allowedToolNames);
            this._allowlistFiltersMcp =
                config.allowedToolNames.length === 0 || config.allowedToolNames.some((entry) => entry.startsWith("mcp__"));
        }
        this._excludedTools = config.excludedToolNames ? createToolNameMatcher(config.excludedToolNames) : undefined;
        this._baseToolsOverride = config.baseToolsOverride;
        this._sessionStartEvent = config.sessionStartEvent ?? { type: "session_start", reason: "startup" };
        // Always subscribe to agent events for internal handling
        // (session persistence, extensions, auto-compaction, retry logic)
        this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
        this._installAgentToolHooks();
        this._installAgentNextTurnRefresh();
        this._installAgentRequestProjection();
        this._installAgentBoundaryHooks();
        this._installHiddenDeclarationsProjection();
        this._installAgentForcedPromptProjection();
        this._buildRuntime({
            activeToolNames: this._initialActiveToolNames,
            includeAllExtensionTools: true,
        });
        if (this._usesDefaultTools)
            this._restoreToolsFromTranscript(this._defaultToolModifiers);
    }
    get modelRuntime() {
        return this._modelRuntime;
    }
    async _getRequiredRequestAuth(model, signal) {
        let result;
        try {
            result = await this._modelRuntime.getAuth(model, { signal });
        }
        catch (error) {
            const cause = error instanceof Error ? error.cause : undefined;
            if (cause instanceof Error && cause.message === "authHeader requires a resolved API key") {
                throw new Error(formatNoApiKeyFoundMessage(model.provider));
            }
            throw error;
        }
        if (result && (result.auth.apiKey || result.auth.headers)) {
            const requestModel = result.auth.baseUrl ? { ...model, baseUrl: result.auth.baseUrl } : model;
            return {
                model: requestModel,
                apiKey: result.auth.apiKey,
                headers: withoutDeletedHeaders(result.auth.headers),
                env: result.env,
            };
        }
        const isOAuth = this._modelRuntime.isUsingOAuth(model.provider);
        if (isOAuth) {
            throw new Error(`Authentication failed for "${model.provider}". ` +
                `Credentials may have expired or network is unavailable. ` +
                `Run '/login ${model.provider}' to re-authenticate.`);
        }
        throw new Error(formatNoApiKeyFoundMessage(model.provider));
    }
    async _getSummarizationRequestAuth(selectedModel, signal) {
        // Route a virtual model first: summaries size their input and output from the model they get.
        const { model, thinkingLevel } = isVirtualModel(selectedModel)
            ? await this._modelRuntime.resolveModel(selectedModel, convertToLlm(this.messages), {
                reason: "direct",
                thinkingLevel: this.thinkingLevel,
                signal,
            })
            : { model: selectedModel, thinkingLevel: this.thinkingLevel };
        if (this.agent.streamFunction === streamSimple) {
            return { ...(await this._getRequiredRequestAuth(model, signal)), thinkingLevel };
        }
        if (runtimeStreamFunctions.get(this.agent.streamFunction) === this._modelRuntime) {
            return { model, thinkingLevel };
        }
        try {
            const result = await this._modelRuntime.getAuth(model, { signal });
            if (!result)
                return { model, thinkingLevel };
            const requestModel = result.auth.baseUrl ? { ...model, baseUrl: result.auth.baseUrl } : model;
            return {
                model: requestModel,
                apiKey: result.auth.apiKey,
                headers: withoutDeletedHeaders(result.auth.headers),
                env: result.env,
                thinkingLevel,
            };
        }
        catch (error) {
            if (signal?.aborted)
                throw error;
            return { model, thinkingLevel };
        }
    }
    /**
     * The model whose limits apply to `message`, or undefined when the message came from another
     * model. Under a virtual selection, that is the physical model that produced it.
     */
    _modelForMessage(message) {
        const model = this.model;
        if (model && isVirtualModel(model))
            return this._modelRuntime.getPhysicalModel(message.provider, message.model);
        return model?.provider === message.provider && model.id === message.model ? model : undefined;
    }
    /** Record the live model and thinking level on the current branch, so a resume restores them. */
    _recordSelection() {
        const branch = this.sessionManager.getBranch();
        this._recordModelSelection(branch);
        this._recordThinkingLevel(branch);
    }
    /**
     * Record the model on the current branch when the branch implies another one. Tree navigation
     * can leave the latest `model_change` on another branch; responses cannot record a virtual
     * selection because they name physical models. Responses do record a physical selection unless
     * the branch holds a virtual one; checking a physical selection against responses would record
     * it on every prompt while `prepareRequest` redirects to another model.
     */
    _recordModelSelection(branch) {
        const model = this.model;
        if (!model)
            return;
        const getModel = (provider, modelId) => this._modelRuntime.getModel(provider, modelId);
        const recorded = getBranchSelection(branch, getModel);
        if (!recorded || (recorded.provider === model.provider && recorded.modelId === model.id))
            return;
        const recordedModel = getModel(recorded.provider, recorded.modelId);
        if (!isVirtualModel(model) && !(recordedModel && isVirtualModel(recordedModel)))
            return;
        this.sessionManager.appendModelChange(model.provider, model.id);
    }
    /**
     * Record the thinking level on the current branch when the branch implies another one (#11451).
     * Tree navigation can leave the latest `thinking_level_change` on another branch. The recorded
     * level is compared after clamping to the current model, so a level clamped on resume (e.g.
     * `xhigh` running as `high`) is not recorded over the requested one.
     */
    _recordThinkingLevel(branch) {
        const recorded = branch.findLast((entry) => entry.type === "thinking_level_change");
        if (!recorded)
            return;
        const recordedLevel = recorded.thinkingLevel;
        const availableLevels = this.getAvailableThinkingLevels();
        const effective = availableLevels.includes(recordedLevel)
            ? recordedLevel
            : this._clampThinkingLevel(recordedLevel, availableLevels);
        if (effective === this.thinkingLevel)
            return;
        this.sessionManager.appendThinkingLevelChange(this.thinkingLevel);
    }
    /** The model whose limits apply to the conversation. */
    _limitsModel() {
        return this.routedModel?.model ?? this.model;
    }
    /**
     * Install tool hooks once on the Agent instance.
     *
     * The callbacks read `this._extensionRunner` at execution time, so extension reload swaps in the
     * new runner without reinstalling hooks. Extension-specific tool wrappers are still used to adapt
     * registered tool execution to the extension context. Tool call and tool result interception now
     * happens here instead of in wrappers.
     */
    _installAgentToolHooks() {
        this.agent.beforeToolCall = (context) => this._beforeToolCall(context);
        this.agent.afterToolCall = (context) => this._afterToolCall(context);
    }
    /** `tool_call` handlers. `parentToolCallId` is set for calls another tool made. */
    async _beforeToolCall({ toolCall, args }, parentToolCallId) {
        const runner = this._extensionRunner;
        if (!runner.hasHandlers("tool_call")) {
            return undefined;
        }
        try {
            return await runner.emitToolCall({
                type: "tool_call",
                toolName: toolCall.name,
                toolCallId: toolCall.id,
                ...(parentToolCallId ? { parentToolCallId } : {}),
                input: args,
            });
        }
        catch (err) {
            if (err instanceof Error) {
                throw err;
            }
            throw new Error(`Extension failed, blocking execution: ${String(err)}`);
        }
    }
    /** `tool_result` handlers and image normalization. `parentToolCallId` is set for calls another tool made. */
    async _afterToolCall({ toolCall, args, result, isError }, parentToolCallId) {
        const runner = this._extensionRunner;
        const hookResult = runner.hasHandlers("tool_result")
            ? await runner.emitToolResult({
                type: "tool_result",
                toolName: toolCall.name,
                toolCallId: toolCall.id,
                ...(parentToolCallId ? { parentToolCallId } : {}),
                input: args,
                content: result.content,
                details: result.details,
                ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent }),
                isError,
                usage: result.usage,
            })
            : undefined;
        const content = hookResult?.content ?? result.content ?? [];
        // Runs after the extension hook so images injected or replaced by extensions are normalized too.
        const resizeOptions = this._limitsModel()?.inputLimits?.images?.resize;
        const normalizedContent = await normalizeToolResultImages(content, {
            autoResizeImages: this.settingsManager.getImageAutoResize(),
            ...(resizeOptions ? { resizeOptions } : {}),
        });
        if (!hookResult && normalizedContent === content) {
            return undefined;
        }
        // The hook result already dropped structured content that replaced content no longer matches.
        return {
            content: normalizedContent,
            details: hookResult?.details,
            structuredContent: hookResult ? hookResult.structuredContent : result.structuredContent,
            isError: hookResult?.isError ?? isError,
            usage: hookResult?.usage,
        };
    }
    /**
     * Run a call that the tool call `parentToolCallId` made through `ctx.executeTool()`. It goes
     * through the agent's tool pipeline with the session's hooks, against the callable tools.
     */
    async _executeNestedToolCall(parentToolCallId, name, args, options) {
        this._nestedToolCalls ??= new NestedToolCallRunner({
            getTools: () => this._getCallableTools(),
            isSequential: () => this.agent.toolExecution === "sequential",
            runToolCall: (toolCall, parentId, signal, onUpdate) => {
                const assistantMessage = this._findLastAssistantMessage();
                if (!assistantMessage) {
                    return Promise.resolve({
                        toolCall,
                        result: { content: [{ type: "text", text: "No assistant message issued this call" }], details: {} },
                        isError: true,
                    });
                }
                return runToolCall(toolCall, {
                    tools: this._getCallableTools(),
                    assistantMessage,
                    context: { messages: this.agent.state.messages, tools: this.agent.state.tools },
                    beforeToolCall: (context) => this._beforeToolCall(context, parentId),
                    afterToolCall: (context) => this._afterToolCall(context, parentId),
                    signal,
                    onUpdate,
                });
            },
            emit: async (event) => {
                await this._extensionRunner.emit(event);
                this._emit(event);
            },
        });
        return this._nestedToolCalls.execute(parentToolCallId, name, args, options);
    }
    /** Whether `projection`, the current session projection, exceeds the compaction threshold of `model`. */
    _exceedsCompactionThreshold(model, projection) {
        if (model.contextWindow <= 0)
            return false;
        return shouldCompact(estimateProjectedContextTokens(projection, this.sessionManager.getBranch()).tokens, model.contextWindow, this.settingsManager.getCompactionSettings(this.model));
    }
    async _compactBeforeNextAssistantResponse(context) {
        const projection = this.sessionManager.buildSessionProjection();
        // A virtual selection is checked in prepareRequest, against the model the request is routed to.
        const model = this.model;
        if (!model || isVirtualModel(model) || !this._exceedsCompactionThreshold(model, projection)) {
            return { ...context, messages: projection.messages };
        }
        await this._runAutoCompaction("threshold", false);
        return { ...context, messages: this.sessionManager.buildSessionProjection().messages };
    }
    _installAgentRequestProjection() {
        const previousPrepareRequest = this.agent.prepareRequest;
        this.agent.prepareRequest = async (request, signal) => {
            const failed = this._failedResponse;
            this._failedResponse = undefined;
            const prepare = async () => {
                const projection = this.sessionManager.buildSessionProjection();
                const canonicalContext = {
                    ...request.context,
                    messages: projection.messages,
                    // Messages declare the provider-visible loadout; context.tools keeps executable implementations.
                    tools: this.agent.state.tools.slice(),
                };
                const previous = await previousPrepareRequest?.({
                    ...request,
                    context: canonicalContext,
                    model: this.agent.state.model,
                    thinkingLevel: this.agent.state.thinkingLevel,
                }, signal);
                return { previous, context: previous?.context ?? canonicalContext, projection };
            };
            let { previous, context, projection } = await prepare();
            const model = previous?.model ?? this.agent.state.model;
            const thinkingLevel = previous?.thinkingLevel ?? this.agent.state.thinkingLevel;
            if (!isVirtualModel(model))
                return { ...previous, context, model, thinkingLevel };
            // The selection stays in agent state; only this request uses the routed model. A routing
            // failure rejects, which ends the run with an error response. Only messages the user wrote
            // start a turn; extension messages can follow them, e.g. from before_agent_start.
            const lastResponse = context.messages.findLastIndex((message) => message.role === "assistant");
            const userTurn = context.messages.slice(lastResponse + 1).some((message) => message.role === "user");
            const state = getVirtualModelState(this.sessionManager.getBranch(), model.provider, model.id);
            const route = await this._modelRuntime.resolveModel(model, convertToLlm(context.messages), {
                reason: failed ? "retry" : userTurn ? "user" : "continuation",
                thinkingLevel,
                signal,
                failed,
                state,
            });
            if (route.state !== undefined && route.state !== state) {
                const data = { provider: model.provider, modelId: model.id, state: route.state };
                const entry = this.sessionManager.getEntry(this.sessionManager.appendCustomEntry(VIRTUAL_MODEL_STATE_ENTRY, data));
                if (entry)
                    this._emit({ type: "entry_appended", entry });
            }
            // The route stands: the router already decided this request. The state entry does not change
            // the projection.
            if (this._exceedsCompactionThreshold(route.model, projection)) {
                await this._runAutoCompaction("threshold", false);
                ({ previous, context } = await prepare());
            }
            return { ...previous, context, model: route.model, thinkingLevel: route.thinkingLevel };
        };
    }
    async _dispatchTurnEndBoundary(message, toolResults) {
        this._lastActivityOutcome =
            message.stopReason === "aborted" ? "aborted" : message.stopReason === "error" ? "error" : "completed";
        const messageEntryId = this._findPersistedMessageEntryId(message);
        if (!this._extensionRunner.hasHandlers("turn_end"))
            return false;
        if (!messageEntryId) {
            this._extensionRunner.emitError({
                extensionPath: "<boundary>",
                event: "turn_end",
                error: "turn_end could not resolve the persisted assistant entry ID",
            });
            return false;
        }
        const toolResultEntryIds = toolResults.flatMap((result) => {
            const entryId = this._findPersistedMessageEntryId(result);
            return entryId ? [entryId] : [];
        });
        const boundary = await this._extensionRunner.emitBoundary({
            type: "turn_end",
            turnIndex: this._turnIndex,
            message,
            toolResults,
            messageEntryId,
            toolResultEntryIds,
            outcome: this._lastActivityOutcome,
        }, (entries) => this._buildBoundaryContext(entries, "turn_end"));
        this._commitBoundaryDrafts(boundary.entries);
        if (boundary.continue && !this._buildBoundaryContext([], "turn_end").canContinue) {
            this._reportInvalidBoundaryContinuation("turn_end");
            return false;
        }
        return boundary.continue;
    }
    _installAgentBoundaryHooks() {
        const previousFinishTurn = this.agent.finishTurn;
        this.agent.finishTurn = async (turn, signal) => {
            this._boundaryDispatchedMessages.add(turn.message);
            const extensionContinue = await this._dispatchTurnEndBoundary(turn.message, turn.toolResults);
            const previousDecision = await previousFinishTurn?.(turn, signal);
            if (previousDecision?.action === "end")
                return previousDecision;
            if (extensionContinue || previousDecision?.action === "continue")
                return { action: "continue" };
            return undefined;
        };
    }
    _installAgentNextTurnRefresh() {
        const previousPrepareNextTurnWithContext = this.agent.prepareNextTurnWithContext ??
            (this.agent.prepareNextTurn
                ? async (_turn, signal) => await this.agent.prepareNextTurn?.(signal)
                : undefined);
        this.agent.prepareNextTurnWithContext = async (turn, signal) => {
            const context = await this._compactBeforeNextAssistantResponse(turn.context);
            const previousSnapshot = await previousPrepareNextTurnWithContext?.({ ...turn, context }, signal);
            const nextContext = previousSnapshot?.context ?? context;
            const runOptions = this._runSystemPromptOptions ?? this._baseSystemPromptOptions;
            const options = normalizeBuildSystemPromptOptions({
                ...runOptions,
                selectedTools: this.getActiveToolNames(),
                toolSnippets: { ...this._baseSystemPromptOptions.toolSnippets, ...runOptions.toolSnippets },
                toolGuidelines: { ...this._baseSystemPromptOptions.toolGuidelines, ...runOptions.toolGuidelines },
            });
            const updateMessage = this._preparePromptAndToolLoadout(options, nextContext.messages);
            // Keep session.systemPrompt and ctx.getSystemPrompt() in step with what the provider sees.
            this._runSystemPromptOptions = options;
            return {
                ...previousSnapshot,
                context: {
                    ...nextContext,
                    tools: this.agent.state.tools.slice(),
                },
                messages: updateMessage
                    ? [...(previousSnapshot?.messages ?? []), updateMessage]
                    : previousSnapshot?.messages,
                model: this.agent.state.model,
                thinkingLevel: this.agent.state.thinkingLevel,
            };
        };
    }
    // =========================================================================
    // Event Subscription
    // =========================================================================
    _refreshFinalizedContext() {
        const projection = this.sessionManager.buildSessionProjection();
        for (const entry of projection.entries) {
            for (const message of entry.messages)
                this._entryIdsByMessage.set(message, entry.sourceEntry.id);
        }
        this.agent.state.messages = projection.messages;
    }
    _applyBoundaryDrafts(manager, drafts) {
        const appended = [];
        for (const draft of drafts) {
            let entryId;
            switch (draft.type) {
                case "custom":
                    entryId = manager.appendCustomEntry(draft.customType, draft.data);
                    break;
                case "custom_message":
                    entryId = manager.appendCustomMessageEntry(draft.customType, draft.content, draft.display, draft.details);
                    break;
                case "context_edit":
                    entryId = manager.appendContextEdit(draft.targetId, draft.replacement);
                    break;
                case "compaction": {
                    const tokensBefore = estimateProjectedContextTokens(manager.buildSessionProjection(), manager.getBranch()).tokens;
                    entryId = manager.appendCompaction(draft.summary, draft.firstKeptEntryId, tokensBefore, draft.details, true, draft.usage);
                    break;
                }
            }
            const entry = manager.getEntry(entryId);
            if (entry)
                appended.push(entry);
        }
        return appended;
    }
    _createBoundaryPreviewManager(drafts) {
        const header = this.sessionManager.getHeader();
        if (!header)
            throw new Error("Session header is missing");
        const manager = SessionManager.inMemory(this._cwd, undefined, [header, ...this.sessionManager.getBranch()]);
        this._applyBoundaryDrafts(manager, drafts);
        return manager;
    }
    _getPendingBoundaryMessages() {
        return [...this.agent.peekQueuedMessages(), ...this._pendingCustomMessages];
    }
    _buildBoundaryContext(drafts, boundary) {
        const projection = this._createBoundaryPreviewManager(drafts).buildSessionProjection();
        const pendingMessages = this._getPendingBoundaryMessages();
        const llmMessages = convertToLlm(projection.messages);
        const finalRole = llmMessages[llmMessages.length - 1]?.role;
        const hasNonSystemContext = llmMessages.some((message) => message.role !== "system");
        const contextCanContinue = hasNonSystemContext && finalRole !== "assistant";
        const pendingCustomContext = this._pendingCustomMessages.length > 0;
        return {
            contextEntries: projection.entries,
            contextMessages: projection.messages,
            llmMessages,
            pendingMessages,
            canContinue: contextCanContinue ||
                pendingCustomContext ||
                (boundary === "turn_end"
                    ? this.agent.hasQueuedMessages()
                    : finalRole === "assistant" && this.agent.hasQueuedMessages()),
        };
    }
    _commitBoundaryDrafts(drafts) {
        const appended = this._applyBoundaryDrafts(this.sessionManager, drafts);
        this._refreshFinalizedContext();
        for (const entry of appended)
            this._emit({ type: "entry_appended", entry });
    }
    _reportInvalidBoundaryContinuation(event) {
        this._extensionRunner.emitError({
            extensionPath: "<boundary>",
            event,
            error: `${event} requested continuation without runnable model context`,
        });
    }
    /** Emit an event to all listeners */
    _emit(event) {
        for (const l of this._eventListeners) {
            l(event);
        }
    }
    _emitQueueUpdate() {
        const queue = this.getQueueState();
        this._emit({
            type: "queue_update",
            steering: this.getSteeringMessages(),
            followUp: this.getFollowUpMessages(),
            ...queue,
        });
    }
    async _emitSessionCompactFailed(event) {
        if (this._extensionRunner.hasHandlers("session_compact_failed")) {
            await this._extensionRunner.emit({ type: "session_compact_failed", ...event });
        }
    }
    _getIdleWaitPromise() {
        if (!this._idleWaitPromise) {
            this._idleWaitPromise = new Promise((resolve) => {
                this._resolveIdleWait = resolve;
            });
        }
        return this._idleWaitPromise;
    }
    _resolveIdleWaitIfIdle() {
        if (!this.isIdle || !this._resolveIdleWait) {
            return;
        }
        const resolve = this._resolveIdleWait;
        this._idleWaitPromise = undefined;
        this._resolveIdleWait = undefined;
        resolve();
    }
    async _emitAgentSettled() {
        this._cacheWarmer?.onAgentSettled();
        this._isAgentRunActive = false;
        this._isEmittingAgentSettled = true;
        try {
            const aborted = this._agentRunAbortRequested;
            await this._extensionRunner.emit({ type: "agent_settled", aborted });
            this._emit({ type: "agent_settled", aborted });
        }
        finally {
            this._isEmittingAgentSettled = false;
        }
        const deferred = this._deferredSettledActions.splice(0);
        if (deferred.length > 0) {
            try {
                for (const action of deferred)
                    await action();
            }
            finally {
                this._resolveIdleWaitIfIdle();
            }
            return;
        }
        this._resolveIdleWaitIfIdle();
    }
    /** Internal handler for agent events - shared by subscribe and reconnect */
    _handleAgentEvent = async (event) => {
        // An abort requested while the run was starting, e.g. during before_agent_start, stops it
        // here. agent_start is awaited before the first request.
        if (event.type === "agent_start" && this._agentRunAbortRequested)
            this.agent.abort();
        // Record the calls a tool made through ctx.executeTool() and their usage on its result message.
        if (this._nestedToolCalls) {
            if (event.type === "message_start" && event.message.role === "toolResult") {
                const message = event.message;
                const summary = this._nestedToolCalls.takeRecord(message.toolCallId);
                if (summary?.calls) {
                    message.nestedCalls = message.nestedCalls
                        ? {
                            calls: [...message.nestedCalls.calls, ...summary.calls.calls],
                            complete: message.nestedCalls.complete && summary.calls.complete,
                        }
                        : summary.calls;
                }
                if (summary?.usage) {
                    message.usage = message.usage ? combineUsage(message.usage, summary.usage) : summary.usage;
                }
            }
            else if (event.type === "agent_end") {
                this._nestedToolCalls.clear();
            }
        }
        // When a user message starts, check if it's from either queue and remove it BEFORE emitting
        // This ensures the UI sees the updated queue state
        if (event.type === "message_start" && event.message.role === "user") {
            this._overflowRecoveryAttempted = false;
            // Normalize queued images at delivery, before events and persistence see the message,
            // so they get the same resize as idle prompts with the current model's limits (#11738).
            if (this._queuedInputs.takeImagesToNormalize(event.message)) {
                await this._normalizeQueuedMessageImages(event.message);
            }
        }
        // Emit to extensions first, then notify public listeners.
        await this._emitExtensionEvent(event);
        this._emit(event.type === "agent_end" ? { ...event, willRetry: this._willRetryAfterAgentEnd(event) } : event);
        // Handle session persistence
        if (event.type === "message_end") {
            let entryId;
            // Check if this is a custom message from extensions
            if (event.message.role === "custom") {
                // Persist as CustomMessageEntry
                entryId = this.sessionManager.appendCustomMessageEntry(event.message.customType, event.message.content, event.message.display, event.message.details);
            }
            else if (event.message.role === "system" ||
                event.message.role === "user" ||
                event.message.role === "assistant" ||
                event.message.role === "toolResult") {
                // Regular LLM message - persist as SessionMessageEntry
                entryId = this.sessionManager.appendMessage(event.message);
            }
            if (entryId)
                this._entryIdsByMessage.set(event.message, entryId);
            // Other message types (bashExecution, compactionSummary, branchSummary) are persisted elsewhere
            if (event.message.role === "assistant") {
                const assistantMsg = event.message;
                this._lastAssistantMessage = assistantMsg;
                if (assistantMsg.stopReason !== "error" && assistantMsg.stopReason !== "length") {
                    this._overflowRecoveryAttempted = false;
                }
                // Reset retry counter immediately on successful assistant response
                // This prevents accumulation across multiple LLM calls within a turn
                if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
                    this._emit({
                        type: "auto_retry_end",
                        success: true,
                        attempt: this._retryAttempt,
                    });
                    this._retryAttempt = 0;
                }
            }
        }
        // A turn ends after its assistant message and every tool result has been appended,
        // so this is the first point in the run where a context-only custom message can be
        // inserted without landing between a tool call and its result. Flushing after the
        // extension and listener dispatch above also picks up messages that turn_end
        // handlers queued.
        if (event.type === "turn_end") {
            this._flushPendingCustomMessages();
            await this._applyPreparedCacheCompaction();
        }
    };
    _willRetryAfterAgentEnd(event) {
        if (this._agentRunAbortRequested)
            return false;
        const settings = this.settingsManager.getRetrySettings();
        if (!settings.enabled || this._retryAttempt >= settings.maxRetries) {
            return false;
        }
        for (let i = event.messages.length - 1; i >= 0; i--) {
            const message = event.messages[i];
            if (message.role === "assistant") {
                return this._isRetryableError(message);
            }
        }
        return false;
    }
    _findPersistedMessageEntryId(message) {
        const mapped = this._entryIdsByMessage.get(message);
        if (mapped)
            return mapped;
        for (const entry of [...this.sessionManager.getBranch()].reverse()) {
            if (entry.type === "message" && entry.message === message)
                return entry.id;
        }
        const messageIndex = this.agent.state.messages.indexOf(message);
        if (messageIndex < 0)
            return undefined;
        const projection = this.sessionManager.buildSessionProjection();
        let projectedIndex = 0;
        for (const entry of projection.entries) {
            for (let i = 0; i < entry.messages.length; i++) {
                if (projectedIndex === messageIndex) {
                    this._entryIdsByMessage.set(message, entry.sourceEntry.id);
                    return entry.sourceEntry.id;
                }
                projectedIndex++;
            }
        }
        return undefined;
    }
    /**
     * Persistently omit a failed attempt and its tool results from model context. Results are
     * found in the projected context, so the pair stays together whether the attempt comes from
     * the current run or a resumed session. An unpaired result fails the next request (#11227).
     */
    _omitRecoveryAttempt(message) {
        const toolCallIds = new Set(message.content.flatMap((block) => (block.type === "toolCall" ? [block.id] : [])));
        // A context edit replaces the projected copy, so match it by source entry as well.
        const entryId = this._findPersistedMessageEntryId(message);
        const messages = this.agent.state.messages;
        const index = messages.findIndex((m) => m === message || (entryId !== undefined && this._entryIdsByMessage.get(m) === entryId));
        const toolResults = [];
        for (const m of index < 0 ? [] : messages.slice(index + 1)) {
            if (m.role === "assistant")
                break;
            if (m.role === "toolResult" && toolCallIds.has(m.toolCallId))
                toolResults.push(m);
        }
        const targets = [message, ...toolResults];
        const targetIds = targets.map((target) => this._findPersistedMessageEntryId(target));
        const unresolvedProjectedTarget = targets.some((target, index) => targetIds[index] === undefined && this.agent.state.messages.includes(target));
        if (unresolvedProjectedTarget) {
            throw new Error("Cannot persist recovery omission because a projected message has no source entry");
        }
        for (const targetId of targetIds) {
            if (!targetId)
                continue;
            const editId = this.sessionManager.appendContextEdit(targetId, null);
            const entry = this.sessionManager.getEntry(editId);
            if (entry)
                this._emit({ type: "entry_appended", entry });
        }
        this._refreshFinalizedContext();
    }
    /** Find the last assistant message in agent state (including aborted ones) */
    _findLastAssistantMessage() {
        const messages = this.agent.state.messages;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "assistant") {
                return msg;
            }
        }
        return undefined;
    }
    _replaceMessageInPlace(target, replacement) {
        // Agent-core stores the finalized message object in its state before emitting message_end.
        // SessionManager persistence happens later in _handleAgentEvent() with event.message.
        // Mutating this object in place keeps agent state, later turn/agent events, listeners,
        // and the eventual SessionManager.appendMessage(event.message) persistence in sync.
        if (target === replacement) {
            return;
        }
        const targetRecord = target;
        for (const key of Object.keys(targetRecord)) {
            delete targetRecord[key];
        }
        Object.assign(targetRecord, replacement);
    }
    /** Emit extension events based on agent events */
    async _emitExtensionEvent(event) {
        if (event.type === "agent_start") {
            this._turnIndex = 0;
            await this._extensionRunner.emit({ type: "agent_start" });
        }
        else if (event.type === "agent_end") {
            await this._extensionRunner.emit({ type: "agent_end", messages: event.messages });
        }
        else if (event.type === "turn_start") {
            const extensionEvent = {
                type: "turn_start",
                turnIndex: this._turnIndex,
                timestamp: Date.now(),
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "turn_end") {
            if (event.message.role === "assistant" && !this._boundaryDispatchedMessages.delete(event.message)) {
                await this._dispatchTurnEndBoundary(event.message, event.toolResults);
            }
            this._turnIndex++;
        }
        else if (event.type === "message_start") {
            const extensionEvent = {
                type: "message_start",
                message: event.message,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "message_update") {
            const extensionEvent = {
                type: "message_update",
                message: event.message,
                assistantMessageEvent: event.assistantMessageEvent,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "message_end") {
            const extensionEvent = {
                type: "message_end",
                message: event.message,
            };
            const replacement = await this._extensionRunner.emitMessageEnd(extensionEvent);
            if (replacement) {
                // Untyped extension handlers can return messages with null/missing content;
                // normalize so it never enters agent state or session history.
                const normalized = (replacement.role === "user" ||
                    replacement.role === "assistant" ||
                    replacement.role === "toolResult" ||
                    replacement.role === "custom") &&
                    replacement.content == null
                    ? { ...replacement, content: [] }
                    : replacement;
                this._replaceMessageInPlace(event.message, normalized);
            }
        }
        else if (event.type === "tool_execution_start") {
            const extensionEvent = {
                type: "tool_execution_start",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "tool_execution_update") {
            const extensionEvent = {
                type: "tool_execution_update",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
                partialResult: event.partialResult,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "tool_execution_end") {
            const extensionEvent = {
                type: "tool_execution_end",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                result: event.result,
                isError: event.isError,
                ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
            };
            await this._extensionRunner.emit(extensionEvent);
        }
    }
    /**
     * Subscribe to agent events.
     * Session persistence is handled internally (saves messages on message_end).
     * Multiple listeners can be added. Returns unsubscribe function for this listener.
     */
    subscribe(listener) {
        this._eventListeners.push(listener);
        // Return unsubscribe function for this specific listener
        return () => {
            const index = this._eventListeners.indexOf(listener);
            if (index !== -1) {
                this._eventListeners.splice(index, 1);
            }
        };
    }
    /** Disconnect from agent events during disposal. */
    _disconnectFromAgent() {
        if (this._unsubscribeAgent) {
            this._unsubscribeAgent();
            this._unsubscribeAgent = undefined;
        }
    }
    /**
     * Remove all listeners and disconnect from agent.
     * Call this when completely done with the session.
     */
    dispose() {
        try {
            this.abortRetry();
            this.abortCompaction();
            this.abortBranchSummary();
            this.abortBash();
            this.agent.abort();
        }
        catch {
            // Dispose must succeed even if an abort hook throws.
        }
        this._extensionRunner.invalidate("This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().");
        this._disconnectFromAgent();
        this._queuedInputs.dispose();
        this._eventListeners = [];
        if (this._cacheWarmer) {
            this._cacheWarmer.onWarmed = undefined;
            this._cacheWarmer.cancel();
        }
        cleanupSessionResources(this.sessionId);
    }
    // =========================================================================
    // Read-only State Access
    // =========================================================================
    /** Refresh the public finalized transcript from the canonical session projection. */
    refreshContext() {
        this._refreshFinalizedContext();
    }
    /** Full agent state */
    get state() {
        return this.agent.state;
    }
    /** Current cache-warming state and the policy inputs that produced it. */
    get cacheWarmingStatus() {
        return this._cacheWarmer?.status;
    }
    /** Persist the cache-warming mode and immediately reconcile active warming. */
    setCacheWarmingMode(mode) {
        this.settingsManager.setCacheWarmingMode(mode);
        this._cacheWarmer?.onModeChanged();
    }
    get compactionMethod() {
        return this.settingsManager.getCompactionMethod();
    }
    setCompactionMethod(method) {
        this.settingsManager.setCompactionMethod(method);
        this._cacheCompaction?.controller.abort();
        this._cacheWarmer?.onModeChanged();
    }
    get cacheMaintenance() {
        return this.settingsManager.getCacheMaintenanceMode();
    }
    get cacheMaintenanceStatus() {
        if (this.cacheMaintenance === "compact" && !this.autoCompactionEnabled) {
            return { state: "inactive", action: "compact", reason: "Automatic compaction disabled" };
        }
        if (this.cacheMaintenance === "keep-warm" &&
            this.model &&
            this._modelRuntime.getProvider(this.model.provider)?.sideQuestionUsesLiveContext) {
            return { state: "inactive", action: "warm", reason: "This provider does not support safe cache warming" };
        }
        return this._cacheWarmer?.status;
    }
    setCacheMaintenance(mode) {
        this.settingsManager.setCacheMaintenanceMode(mode);
        this._cacheCompaction?.controller.abort();
        this._cacheWarmer?.onModeChanged();
    }
    /** UI input activity vetoes maintenance without interrupting the user's tools. */
    setInputActive(active) {
        this._inputActive = active;
        if (active && !this.isStreaming)
            this._cacheCompaction?.controller.abort();
    }
    get compactionMethods() {
        const provider = this.model && this._modelRuntime.getProvider(this.model.provider);
        const customWireHooks = !provider?.sideQuestionUsesLiveContext &&
            (this._extensionRunner.hasHandlers("before_provider_request") ||
                this._extensionRunner.hasHandlers("before_provider_headers"));
        const isolated = Boolean(provider?.streamSideQuestion) && !customWireHooks;
        const extension = Boolean(this._extensionRunner.getCommand("one-round-compaction"));
        return [
            {
                id: "cache-aware",
                available: isolated,
                reason: isolated
                    ? undefined
                    : customWireHooks
                        ? "Custom provider payload or header hooks cannot be replayed safely"
                        : "Provider has no isolated summary capability; ordinary compaction uses a standalone summary",
            },
            {
                id: "extension",
                available: extension,
                reason: extension ? undefined : "Two-model compaction extension is not loaded",
            },
        ];
    }
    /** Current model (may be undefined if not yet selected) */
    get model() {
        return this.agent.state.model;
    }
    /** Current thinking level */
    get thinkingLevel() {
        return this.agent.state.thinkingLevel;
    }
    /** Under a virtual selection, the physical model and thinking level of the latest successful response. */
    get routedModel() {
        if (!this.model || !isVirtualModel(this.model))
            return undefined;
        const latest = findLatestResponse(this.agent.state.messages);
        const model = latest && this._modelRuntime.getPhysicalModel(latest.provider, latest.model);
        return model && { model, thinkingLevel: latest?.thinkingLevel };
    }
    /** Whether the session is currently processing an agent run or post-run continuation. */
    get isStreaming() {
        return this._isAgentRunActive;
    }
    /** Whether the session has no active agent run, compaction, branch summary, retry, or queued continuation. */
    get isIdle() {
        return !this._isAgentRunActive && !this.isCompacting;
    }
    /** Current effective system prompt, including changes not yet sent to the model. */
    get systemPrompt() {
        return buildSystemPrompt(this._runSystemPromptOptions ?? this._baseSystemPromptOptions);
    }
    /** Current retry attempt (0 if not retrying) */
    get retryAttempt() {
        return this._retryAttempt;
    }
    /**
     * Get the names of currently active tools, which are the tools declared to the model.
     * Tools with `codemode` or `deferred` exposure are callable from other tools without being active.
     */
    getActiveToolNames() {
        return this.agent.state.tools.map((t) => t.name);
    }
    /** Get the names of the tools that tools can call through `ctx.executeTool()`. */
    getCallableToolNames() {
        return this._getCallableTools().map((t) => t.name);
    }
    /**
     * Get all configured tools with name, description, parameter schema, prompt guidelines, and source metadata.
     */
    getAllTools() {
        return Array.from(this._toolDefinitions.values()).map(({ definition, sourceInfo }) => ({
            name: definition.name,
            description: definition.description,
            parameters: definition.parameters,
            promptGuidelines: definition.promptGuidelines,
            exposure: this._getToolExposure(definition.name),
            ...(definition.namespace ? { namespace: definition.namespace } : {}),
            ...(definition.annotations ? { annotations: { ...definition.annotations } } : {}),
            ...(definition.reachesTools ? { reachesTools: definition.reachesTools } : {}),
            sourceInfo,
        }));
    }
    getToolDefinition(name) {
        return this._toolDefinitions.get(name)?.definition;
    }
    /**
     * Set active tools by name.
     * Only tools in the registry can be enabled. Unknown and hidden tool names are ignored.
     * Also rebuilds the system prompt to reflect the new tool set.
     * Changes take effect on the next agent turn.
     */
    setActiveToolsByName(toolNames) {
        const previous = this.getActiveToolNames();
        this._setActiveTools(toolNames);
        // A loadout that deactivates a tool of the restored one replaces it, and its pending tools are
        // dropped. One that only adds tools, like activating tool_search, keeps them, and so does one
        // that only deactivates tools outside the restored loadout, such as an extension's own tool that
        // the restore or reload activated as newly registered.
        const active = new Set(this.getActiveToolNames());
        if (previous.some((name) => !active.has(name) && this._restoredToolNames.has(name))) {
            this._pendingToolNames.clear();
        }
    }
    _setActiveTools(toolNames) {
        const tools = this._applyToolLoadout(toolNames);
        for (const tool of tools)
            this._pendingToolNames.delete(tool.name);
        this._rebuildSystemPrompt(tools.map((tool) => tool.name));
    }
    /**
     * Whether `--tools` and `--exclude-tools` keep the tool registered. MCP tools stay registered
     * unless the allowlist filters them (see `_allowlistFiltersMcp`).
     */
    _isAllowedTool(name) {
        if (this._excludedTools?.(name))
            return false;
        if (!this._allowedTools || this._allowedTools(name))
            return true;
        return !this._allowlistFiltersMcp && isMcpToolName(name);
    }
    /**
     * Whether the tool may be active, which declares it to the model. MCP tools the allowlist keeps
     * without matching them are only for codemode and tool_search: they may be declared only when
     * tool_search can load them (non-`direct` exposure and tool_search registered). This also applies
     * to tools restored from the transcript or set by extensions.
     */
    _isActivatable(name) {
        if (!this._allowedTools || this._allowedTools(name) || !isMcpToolName(name))
            return true;
        return this._getToolExposure(name) !== "direct" && this._toolRegistry.has("tool_search");
    }
    _getToolExposure(name) {
        return this._toolDefinitions.get(name)?.definition.exposure ?? "direct";
    }
    /**
     * Tools callable through `ctx.executeTool()`: the active `direct` tools and every registered
     * `codemode` or `deferred` tool.
     */
    _getCallableTools(active = new Set(this.getActiveToolNames())) {
        return [...this._toolRegistry.values()].filter((tool) => {
            const exposure = this._getToolExposure(tool.name);
            return exposure === "codemode" || exposure === "deferred" || (exposure === "direct" && active.has(tool.name));
        });
    }
    /**
     * Set the agent's tools for the given active tool names and return them. The active tools are
     * the registered, non-hidden ones; they are declared to the model. Active tools with a
     * `prepareLoadout` hook can change the declared descriptions and hide declarations from
     * requests (see {@link _installHiddenDeclarationsProjection}).
     *
     * The active tools are a set: tools that stay active keep their current order and newly active
     * ones are appended, so reordering the same names does not change the prompt (#11495).
     */
    _applyToolLoadout(toolNames) {
        const requested = new Set(toolNames);
        const kept = this.getActiveToolNames().filter((name) => requested.has(name));
        const tools = [...new Set([...kept, ...requested])].flatMap((name) => {
            const tool = this._toolRegistry.get(name);
            return tool && this._getToolExposure(name) !== "hidden" && this._isActivatable(name) ? [tool] : [];
        });
        const hooks = tools.flatMap((tool) => {
            const entry = this._toolDefinitions.get(tool.name);
            return entry?.definition.prepareLoadout ? [entry] : [];
        });
        const hidden = new Set();
        let declared = tools;
        if (hooks.length > 0) {
            const loadout = {
                declared: tools,
                callable: this._getCallableTools(new Set(tools.map((tool) => tool.name))),
                registered: [...this._toolRegistry.values()],
                getExposure: (name) => this._getToolExposure(name),
                getNamespace: (name) => this._toolDefinitions.get(name)?.definition.namespace,
                getPromptGuidelines: (name) => this._toolPromptGuidelines.get(name) ?? [],
            };
            const descriptions = new Map();
            for (const { definition, sourceInfo } of hooks) {
                try {
                    const changes = definition.prepareLoadout?.(loadout);
                    for (const [name, description] of Object.entries(changes?.descriptions ?? {})) {
                        descriptions.set(name, description);
                    }
                    for (const name of changes?.hiddenDeclarations ?? [])
                        hidden.add(name);
                }
                catch (error) {
                    this._extensionRunner.emitError({
                        extensionPath: sourceInfo.path,
                        event: "prepare_loadout",
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                    });
                }
            }
            declared = tools.map((tool) => {
                const description = descriptions.get(tool.name);
                return description === undefined ? tool : { ...tool, description };
            });
        }
        this._hiddenDeclarations = hidden;
        this.agent.state.tools = declared;
        return declared;
    }
    /** Whether compaction or branch summarization is currently running */
    get isCompacting() {
        return (this._autoCompactionAbortController !== undefined ||
            this._cacheCompaction !== undefined ||
            this._compactionAbortController !== undefined ||
            this._branchSummaryAbortController !== undefined);
    }
    /** All messages including custom types like BashExecutionMessage */
    get messages() {
        return this.agent.state.messages;
    }
    /** Current steering mode */
    get steeringMode() {
        return this.agent.steeringMode;
    }
    /** Current follow-up mode */
    get followUpMode() {
        return this.agent.followUpMode;
    }
    /** Current session file path, or undefined if sessions are disabled */
    get sessionFile() {
        return this.sessionManager.getSessionFile();
    }
    /** Current session ID */
    get sessionId() {
        return this.sessionManager.getSessionId();
    }
    /** Current session display name, if set */
    get sessionName() {
        return this.sessionManager.getSessionName();
    }
    /** Scoped models for cycling (from --models flag) */
    get scopedModels() {
        return this._scopedModels;
    }
    /** Update scoped models for cycling */
    setScopedModels(scopedModels) {
        this._scopedModels = scopedModels;
    }
    /** File-based prompt templates */
    get promptTemplates() {
        return this._resourceLoader.getPrompts().prompts;
    }
    _normalizePromptSnippet(text) {
        if (!text)
            return undefined;
        const oneLine = text
            .replace(/[\r\n]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        return oneLine.length > 0 ? oneLine : undefined;
    }
    _normalizePromptGuidelines(guidelines) {
        if (!guidelines || guidelines.length === 0) {
            return [];
        }
        const unique = new Set();
        for (const guideline of guidelines) {
            const normalized = guideline.trim();
            if (normalized.length > 0) {
                unique.add(normalized);
            }
        }
        return Array.from(unique);
    }
    _rebuildSystemPrompt(toolNames) {
        this._cacheCompaction?.controller.abort();
        const validToolNames = toolNames.filter((name) => this._toolRegistry.has(name));
        const toolSnippets = {};
        for (const name of this._toolRegistry.keys()) {
            const snippet = this._toolPromptSnippets.get(name);
            // Tools without a snippet are not listed.
            if (snippet)
                toolSnippets[name] = snippet;
        }
        const loaderSystemPrompt = this._resourceLoader.getSystemPrompt();
        const loaderAppendSystemPrompt = this._resourceLoader.getAppendSystemPrompt();
        const appendSystemPrompt = loaderAppendSystemPrompt.length > 0 ? loaderAppendSystemPrompt.join("\n\n") : "";
        const loadedSkills = this._resourceLoader.getSkills().skills;
        const loadedContextFiles = this._resourceLoader.getAgentsFiles().agentsFiles;
        this._baseSystemPromptOptions = normalizeBuildSystemPromptOptions({
            cwd: this._cwd,
            skills: loadedSkills,
            contextFiles: loadedContextFiles,
            customPrompt: loaderSystemPrompt,
            appendSystemPrompt,
            selectedTools: validToolNames,
            hiddenTools: [...this._hiddenDeclarations],
            toolSnippets,
            toolGuidelines: Object.fromEntries(this._toolPromptGuidelines),
        });
    }
    /**
     * Apply a prompt and tool loadout for the next request. Sets the executable tools and
     * returns a system message patching the prompt sections the model currently has (replayed
     * from `messages`), or undefined when the prompt is unchanged. Tool changes are declared by
     * the agent loop before the request.
     *
     * A forced prompt does not affect the transcript: the structured sections are still diffed
     * and persisted, and the forced text is projected onto the request by
     * {@link _installAgentForcedPromptProjection}.
     */
    _preparePromptAndToolLoadout(options, messages = this.agent.state.messages) {
        options.selectedTools = this._applyToolLoadout(options.selectedTools).map((tool) => tool.name);
        // The tool list and rules must match the declarations the request carries.
        options.hiddenTools = [...this._hiddenDeclarations];
        const sections = diffSystemPromptSections(getCurrentSystemMessage(messages)?.sections ?? {}, buildSystemPromptSections(options));
        return sections ? { role: "system", content: "", sections, timestamp: Date.now() } : undefined;
    }
    /**
     * Send a forced prompt as the provider's leading system prompt without recording it.
     *
     * A `before_agent_start` handler that returns `systemPrompt` needs that exact text at the
     * head of the request; a mid-conversation system message would leave the original prompt
     * in place. The forced text is a rendering of the current prompt, so the transcript keeps
     * its structured sections and the request is projected instead: the system messages
     * collapse into one head holding the forced text and the current tools. Runs after the
     * `context` extension handlers.
     */
    /**
     * Remove the declarations that `prepareLoadout` hooks hide from every request. The whole
     * transcript is filtered with the current set, so the projected declarations stay consistent
     * across requests and only change when the loadout does.
     */
    _installHiddenDeclarationsProjection() {
        const previousTransformContext = this.agent.transformContext;
        this.agent.transformContext = async (messages, signal) => {
            const transformed = previousTransformContext ? await previousTransformContext(messages, signal) : messages;
            const hidden = this._hiddenDeclarations;
            if (hidden.size === 0)
                return transformed;
            return transformed.map((message) => {
                if (message.role !== "system" || (!message.toolsAdded && !message.toolsRemoved))
                    return message;
                const { toolsAdded, toolsRemoved, ...rest } = message;
                const added = toolsAdded?.filter((tool) => !hidden.has(tool.name)) ?? [];
                const removed = toolsRemoved?.filter((tool) => !hidden.has(tool.name)) ?? [];
                return {
                    ...rest,
                    ...(added.length > 0 ? { toolsAdded: added } : {}),
                    ...(removed.length > 0 ? { toolsRemoved: removed } : {}),
                };
            });
        };
    }
    _installAgentForcedPromptProjection() {
        const previousTransformContext = this.agent.transformContext;
        this.agent.transformContext = async (messages, signal) => {
            const transformed = previousTransformContext ? await previousTransformContext(messages, signal) : messages;
            const forced = this._runSystemPromptOptions?.forceSystemPrompt;
            if (forced === undefined)
                return transformed;
            const current = getCurrentSystemMessage(transformed);
            const head = {
                role: "system",
                content: forced,
                ...(current?.toolsAdded ? { toolsAdded: current.toolsAdded } : {}),
                timestamp: current?.timestamp ?? Date.now(),
            };
            return [head, ...transformed.filter((message) => message.role !== "system")];
        };
    }
    /**
     * Restore the active tool loadout declared by the session transcript, if it declares one.
     * Tools reachable only from other tools are never declared, but they do not depend on the active
     * set, so the transcript's declarations are the whole loadout.
     * @param modifiers `+name`/`-name` entries applied to the restored loadout.
     */
    _restoreToolsFromTranscript(modifiers = []) {
        this._pendingToolNames.clear();
        this._restoredToolNames.clear();
        // All system messages on the branch, including those before a compaction. Compaction snapshots
        // are derived from these, so replaying them gives the current loadout.
        const systemMessages = this.sessionManager
            .getBranch()
            .flatMap((entry) => (entry.type === "message" && entry.message.role === "system" ? [entry.message] : []));
        // No recorded loadout: keep the current tools.
        if (systemMessages.length === 0)
            return;
        // Tools the branch ever added or removed. Removed tools stay inactive.
        const mentioned = new Set(systemMessages
            .flatMap((message) => [...(message.toolsAdded ?? []), ...(message.toolsRemoved ?? [])])
            .map((tool) => tool.name));
        // Extension tools the branch never mentioned were registered after it recorded its loadout, so
        // they are activated like newly registered tools. Built-in tools follow `defaultTools` instead.
        const newTools = [...this._toolRegistry.keys()].filter((name) => !mentioned.has(name) && !this._baseToolDefinitions.has(name) && this._isActivatedOnRegistration(name));
        // The recorded loadout plus the new tools, with `--tools +name`/`-name` applied.
        const names = applyToolModifiers([...getCurrentTools(systemMessages).map((tool) => tool.name), ...newTools], modifiers);
        // Recorded tools that are not registered yet, such as MCP tools of servers still connecting, are
        // activated when they register. Excluded tools never register, so they are not kept pending.
        this._pendingToolNames = new Set(names.filter((name) => this._isAllowedTool(name)));
        this._restoredToolNames = new Set(applyToolModifiers(getCurrentTools(systemMessages).map((tool) => tool.name), modifiers));
        // Ignores names that are not registered.
        this._setActiveTools(names);
    }
    // =========================================================================
    // Prompting
    // =========================================================================
    /**
     * Start a run from a user or custom message. The session counts as busy from here on, so
     * messages sent while before_agent_start handlers run are queued into this run instead of
     * starting another, and an abort requested meanwhile aborts the run as soon as it exists.
     * @param onStarted Called once the run's messages are prepared, before the first request.
     */
    async _startRun(trigger, onStarted) {
        this._isAgentRunActive = true;
        this._agentRunAbortRequested = false;
        let messages;
        try {
            messages = await this._prepareRun(trigger);
        }
        catch (error) {
            this._isAgentRunActive = false;
            this._flushPendingBashMessages();
            this._flushPendingCustomMessages();
            this._resolveIdleWaitIfIdle();
            throw error;
        }
        // Messages held while the run was starting go before its starting messages, as they would
        // have while idle. No run exists yet, so they cannot split a tool call from its result.
        this._flushPendingBashMessages();
        this._flushPendingCustomMessages();
        onStarted?.();
        // Compaction before the prompt may have scheduled a retry; the new prompt replaces it.
        this._failedResponse = undefined;
        this._recordSelection();
        // The run records the loadout in the transcript; restored tools that did not register by now
        // are dropped, so a tool that never registers does not stay pending.
        this._pendingToolNames.clear();
        try {
            await this.agent.prompt(messages);
            while (!this._agentRunAbortRequested) {
                if (await this._handlePostAgentRun()) {
                    if (this._agentRunAbortRequested)
                        break;
                    await this.agent.continue();
                    continue;
                }
                if (this._agentRunAbortRequested || !(await this._runBeforeSettleBoundary()))
                    break;
                if (this._agentRunAbortRequested)
                    break;
                await this.agent.continue();
            }
        }
        finally {
            if (this._agentRunAbortRequested)
                this._finishCancelledRetry();
            this._failedResponse = undefined;
            this._runSystemPromptOptions = undefined;
            this._flushPendingBashMessages();
            this._flushPendingCustomMessages();
            await this._emitAgentSettled();
        }
    }
    /**
     * Prepare a run and return its starting messages: compact first when needed, emit
     * before_agent_start, apply the run's prompt options and tool loadout, and build the starting
     * message followed by pending nextTurn messages (consumed here) and handler messages, with a
     * system patch first when the prompt changed.
     */
    async _prepareRun(trigger) {
        // Check if we need to compact before sending (catches aborted responses).
        // The starting message is sent below, so do not call agent.continue() here.
        const lastAssistant = this._findLastAssistantMessage();
        if (lastAssistant) {
            await this._checkCompaction(lastAssistant, false);
        }
        const selectedToolsBefore = this._baseSystemPromptOptions.selectedTools;
        const result = await this._extensionRunner.emitBeforeAgentStart(trigger, this._baseSystemPromptOptions);
        // Handlers may edit event.systemPromptOptions.selectedTools or call setActiveTools(),
        // which updates the live loadout instead. An explicit edit wins; otherwise the live
        // loadout is authoritative, so a setActiveTools() call is not undone here.
        const handlerEditedTools = result.systemPromptOptions.selectedTools.length !== selectedToolsBefore.length ||
            result.systemPromptOptions.selectedTools.some((name, index) => name !== selectedToolsBefore[index]);
        if (!handlerEditedTools)
            result.systemPromptOptions.selectedTools = this.getActiveToolNames();
        const messages = [];
        if (trigger.messageType === "custom") {
            messages.push(trigger.message);
        }
        else {
            // Normalize images after before_agent_start so extension-driven model selection
            // determines the resize profile used for the request and history.
            const normalized = await this._normalizePromptImages(trigger.images);
            const text = normalized.hints.length > 0 ? `${trigger.prompt}\n\n${normalized.hints.join("\n")}` : trigger.prompt;
            messages.push({
                role: "user",
                content: [{ type: "text", text }, ...normalized.images],
                timestamp: Date.now(),
            });
        }
        // Inject any pending "nextTurn" messages as context alongside the starting message
        messages.push(...this._pendingNextTurnMessages);
        this._pendingNextTurnMessages = [];
        for (const msg of result.messages) {
            messages.push({
                role: "custom",
                customType: msg.customType,
                // Untyped extensions can pass null/missing content; normalize at ingestion.
                content: msg.content ?? [],
                display: msg.display,
                details: msg.details,
                timestamp: Date.now(),
            });
        }
        const updateMessage = this._preparePromptAndToolLoadout(result.systemPromptOptions);
        this._runSystemPromptOptions = result.systemPromptOptions;
        if (updateMessage)
            messages.unshift(updateMessage);
        return messages;
    }
    async _handlePostAgentRun() {
        const message = this._lastAssistantMessage;
        this._lastAssistantMessage = undefined;
        if (this._agentRunAbortRequested) {
            this._finishCancelledRetry();
            return false;
        }
        if (!message)
            return this.agent.hasQueuedMessages();
        if (this._isRetryableError(message) && (await this._prepareRetry(message))) {
            if (this._agentRunAbortRequested)
                this._finishCancelledRetry();
            this._failedResponse = message;
            return !this._agentRunAbortRequested;
        }
        if (this._agentRunAbortRequested) {
            this._finishCancelledRetry();
            return false;
        }
        if (message.stopReason === "error" && this._retryAttempt > 0) {
            this._emit({
                type: "auto_retry_end",
                success: false,
                attempt: this._retryAttempt,
                finalError: message.errorMessage,
            });
            this._retryAttempt = 0;
        }
        if (await this._checkCompaction(message)) {
            return !this._agentRunAbortRequested;
        }
        // The low-level loop drains both queues before agent_end. Messages queued by
        // agent_end handlers require a fresh run before pre-settlement handlers fire.
        return !this._agentRunAbortRequested && this.agent.hasQueuedMessages();
    }
    async _runBeforeSettleBoundary() {
        if (!this._extensionRunner.hasHandlers("agent_before_settle"))
            return this.agent.hasQueuedMessages();
        this._isBeforeSettle = true;
        this._abortDuringBeforeSettle = false;
        this._beforeSettleAbortController = new AbortController();
        try {
            const result = await this._extensionRunner.emitBoundary({ type: "agent_before_settle", outcome: this._lastActivityOutcome }, (entries) => this._buildBoundaryContext(entries, "agent_before_settle"));
            this._commitBoundaryDrafts(result.entries);
            this._flushPendingCustomMessages();
            const finalContext = this._buildBoundaryContext([], "agent_before_settle");
            if (this._abortDuringBeforeSettle)
                return false;
            const shouldContinue = result.continue || this.agent.hasQueuedMessages();
            if (shouldContinue && !finalContext.canContinue) {
                if (result.continue)
                    this._reportInvalidBoundaryContinuation("agent_before_settle");
                return false;
            }
            return shouldContinue;
        }
        finally {
            this._isBeforeSettle = false;
            this._beforeSettleAbortController = undefined;
        }
    }
    async _runInputHandlers(text, images, source, streamingBehavior) {
        if (!this._extensionRunner.hasHandlers("input")) {
            return { text, images };
        }
        const inputResult = await this._extensionRunner.emitInput(text, images, source, streamingBehavior);
        if (inputResult.action === "handled") {
            return undefined;
        }
        if (inputResult.action === "transform") {
            return { text: inputResult.text, images: inputResult.images ?? images };
        }
        return { text, images };
    }
    async _normalizePromptImages(images) {
        if (!images)
            return { images: [], hints: [] };
        const normalizedImages = [];
        const hints = [];
        for (const image of images) {
            const processed = await processImage(Buffer.from(image.data, "base64"), image.mimeType, {
                autoResizeImages: this.settingsManager.getImageAutoResize(),
                resizeOptions: this._limitsModel()?.inputLimits?.images?.resize,
            });
            if (!processed.ok) {
                hints.push(processed.message);
                continue;
            }
            normalizedImages.push({ type: "image", data: processed.data, mimeType: processed.mimeType });
            hints.push(...processed.hints);
        }
        return { images: normalizedImages, hints };
    }
    /**
     * Send a prompt to the agent.
     * - Handles extension commands (registered via pi.registerCommand) immediately, even during streaming
     * - Expands file-based prompt templates by default
     * - During streaming, queues via steer() or followUp() based on streamingBehavior option
     * - Validates model and API key before sending (when not streaming)
     * @throws Error if streaming and no streamingBehavior specified
     * @throws Error if no model selected or no API key available (when not streaming)
     */
    async prompt(text, options) {
        const submittedDuringCompaction = this._compactionAbortController;
        if (this._isEmittingAgentSettled) {
            this._deferredSettledActions.push(async () => await this.prompt(text, options));
            return;
        }
        const expandPromptTemplates = options?.expandPromptTemplates ?? true;
        const preflightResult = options?.preflightResult;
        // Handle extension commands first (execute immediately, even during streaming)
        // Extension commands manage their own LLM interaction via pi.sendMessage()
        if (expandPromptTemplates && text.startsWith("/")) {
            const handled = await this._tryExecuteExtensionCommand(text);
            if (handled) {
                // Extension command executed, no prompt to send
                preflightResult?.("handled");
                return;
            }
        }
        const admitted = await this._admitInput(async () => {
            if (this._branchSummaryAbortController !== undefined) {
                throw new Error("Cannot submit a prompt while branch summarization is in progress.");
            }
            // Reserve context through input hooks and auth checks. Only preparation is serialized:
            // the next submission can queue while this one's model run is still active.
            this._promptPreflightCount++;
            try {
                const trigger = await this._preparePrompt(text, options, submittedDuringCompaction);
                if (!trigger)
                    return {};
                // Manual compaction can begin during an auth check.
                if (trigger.messageType === "user" &&
                    this._queuePromptIfBusy(trigger.prompt, trigger.images, options, submittedDuringCompaction)) {
                    return {};
                }
                return { run: this._startRun(trigger, () => preflightResult?.("started")) };
            }
            finally {
                this._promptPreflightCount--;
            }
        });
        await admitted.run;
    }
    async _admitInput(admit) {
        const previous = this._inputAdmission;
        let release = () => { };
        this._inputAdmission = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await admit();
        }
        finally {
            release();
        }
    }
    _queuePromptIfBusy(text, images, options, submittedDuringCompaction) {
        const manualCompaction = this._compactionAbortController !== undefined;
        const hasPending = this.agent.hasQueuedMessages();
        if (!this.isStreaming && !manualCompaction && !submittedDuringCompaction && !hasPending)
            return false;
        const behavior = options?.streamingBehavior ??
            (manualCompaction || submittedDuringCompaction || hasPending ? "followUp" : undefined);
        if (!behavior) {
            throw new Error("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.");
        }
        this._acceptQueuedInput(text, images, behavior, options?.source ?? "interactive", options?.messageId);
        options?.preflightResult?.("queued");
        if (!this.isStreaming &&
            !manualCompaction &&
            (!submittedDuringCompaction || this._completedManualCompactions.has(submittedDuringCompaction))) {
            this._scheduleQueuedPrompt();
        }
        return true;
    }
    _acceptQueuedInput(message, images, mode, source, messageId) {
        const input = this._queuedInputs.add(message, images, mode, messageId);
        // A foreground-tool adapter may release the active turn only after the queue owns this input.
        if (this._extensionRunner.hasHandlers("input_queued")) {
            void this._extensionRunner.emit({
                type: "input_queued",
                messageId: input.id,
                message: input.message,
                images: input.images,
                mode: input.mode,
                source,
            });
        }
    }
    _scheduleQueuedPrompt() {
        void this._resumeQueuedPrompt().catch((error) => {
            this._extensionRunner.emitError({
                extensionPath: "<runtime>",
                event: "queued_prompt",
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }
    async _resumeQueuedPrompt() {
        const admitted = await this._admitInput(async () => {
            if (!this.isIdle)
                return {};
            const next = this.agent.peekNextQueuedMessage();
            if (!next)
                return {};
            let trigger;
            let restore;
            if (next.message.role === "custom") {
                const { message, mode } = next;
                this.agent.replaceQueuedMessages([message]);
                trigger = { messageType: "custom", message };
                restore = () => this.agent.prependQueuedMessage(message, mode);
            }
            else {
                const input = this._queuedInputs.takeNext();
                if (!input)
                    return {};
                trigger = { messageType: "user", prompt: input.info.message, images: input.info.images };
                restore = () => this._queuedInputs.restore(input);
            }
            let started = false;
            const run = this._startRun(trigger, () => {
                started = true;
            }).catch((error) => {
                if (!started)
                    restore();
                throw error;
            });
            return { run };
        });
        await admitted.run;
    }
    /**
     * Run input hooks, expand templates, queue while streaming, and validate model and auth.
     * Returns the run trigger, or undefined when the prompt was handled or queued.
     */
    async _preparePrompt(text, options, submittedDuringCompaction) {
        const expandPromptTemplates = options?.expandPromptTemplates ?? true;
        const preflightResult = options?.preflightResult;
        // Emit input event for extension interception (before skill/template expansion)
        const processedInput = await this._runInputHandlers(text, options?.images, options?.source ?? "interactive", this.isStreaming ? options?.streamingBehavior : undefined);
        if (!processedInput) {
            preflightResult?.("handled");
            return undefined;
        }
        const { text: currentText, images: currentImages } = processedInput;
        // Expand skill commands (/skill:name args) and prompt templates (/template args)
        let expandedText = currentText;
        if (expandPromptTemplates) {
            expandedText = this._expandSkillCommand(expandedText);
            expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
        }
        if (this._queuePromptIfBusy(expandedText, currentImages, options, submittedDuringCompaction))
            return undefined;
        // Validate model
        if (!this.model) {
            throw new Error(formatNoModelSelectedMessage());
        }
        const hasConfiguredAuth = this._modelRuntime.hasConfiguredAuth(this.model.provider) ||
            (await this._modelRuntime.checkAuth(this.model.provider)) !== undefined;
        if (!hasConfiguredAuth) {
            const isOAuth = this._modelRuntime.isUsingOAuth(this.model.provider);
            if (isOAuth) {
                throw new Error(`Authentication failed for "${this.model.provider}". ` +
                    `Credentials may have expired or network is unavailable. ` +
                    `Run '/login ${this.model.provider}' to re-authenticate.`);
            }
            throw new Error(formatNoApiKeyFoundMessage(this.model.provider));
        }
        return { messageType: "user", prompt: expandedText, images: currentImages };
    }
    /**
     * Try to execute an extension command. Returns true if command was found and executed.
     */
    async _tryExecuteExtensionCommand(text) {
        // Parse command name and args
        const spaceIndex = text.indexOf(" ");
        const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
        const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
        const command = this._extensionRunner.getCommand(commandName);
        if (!command)
            return false;
        // Get command context from extension runner (includes session control methods)
        const ctx = this._extensionRunner.createCommandContext();
        try {
            await command.handler(args, ctx);
            return true;
        }
        catch (err) {
            // Emit error via extension runner
            this._extensionRunner.emitError({
                extensionPath: `command:${commandName}`,
                event: "command",
                error: err instanceof Error ? err.message : String(err),
            });
            return true;
        }
    }
    /**
     * Expand skill commands (/skill:name args) to their full content.
     * Returns the expanded text, or the original text if not a skill command or skill not found.
     * Emits errors via extension runner if file read fails.
     */
    _expandSkillCommand(text) {
        if (!text.startsWith("/skill:"))
            return text;
        const spaceIndex = text.indexOf(" ");
        const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
        const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
        const skill = this.resourceLoader.getSkills().skills.find((s) => s.name === skillName);
        if (!skill)
            return text; // Unknown skill, pass through
        try {
            const content = readFileSync(skill.filePath, "utf-8");
            const body = stripFrontmatter(content).trim();
            const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
            return args ? `${skillBlock}\n\n${args}` : skillBlock;
        }
        catch (err) {
            // Emit error like extension commands do
            this._extensionRunner.emitError({
                extensionPath: skill.filePath,
                event: "skill_expansion",
                error: err instanceof Error ? err.message : String(err),
            });
            return text; // Return original on error
        }
    }
    async _queueUserInput(text, images, behavior, source, messageId) {
        if (text.startsWith("/")) {
            this._throwIfExtensionCommand(text);
        }
        const processedInput = await this._runInputHandlers(text, images, source, this.isStreaming ? behavior : undefined);
        if (!processedInput)
            return "handled";
        let expandedText = this._expandSkillCommand(processedInput.text);
        expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
        this._acceptQueuedInput(expandedText, processedInput.images, behavior, source, messageId);
        return "queued";
    }
    /**
     * Queue a steering message while the agent is running.
     * Delivered after the current assistant turn finishes executing its tool calls,
     * before the next LLM call.
     * Expands skill commands and prompt templates. Errors on extension commands.
     * @param images Optional image attachments to include with the message
     * @param options Input source; defaults to interactive
     * @throws Error if text is an extension command
     */
    async steer(text, images, options) {
        return this._admitInput(() => this._queueUserInput(text, images, "steer", options?.source ?? "interactive", options?.messageId));
    }
    /**
     * Queue a follow-up message to be processed after the agent finishes.
     * Delivered only when agent has no more tool calls or steering messages.
     * Expands skill commands and prompt templates. Errors on extension commands.
     * @param images Optional image attachments to include with the message
     * @param options Input source; defaults to interactive
     * @throws Error if text is an extension command
     */
    async followUp(text, images, options) {
        return this._admitInput(() => this._queueUserInput(text, images, "followUp", options?.source ?? "interactive", options?.messageId));
    }
    /** Replace a queued user message's images in place with normalized ones, appending hints to its text. */
    async _normalizeQueuedMessageImages(message) {
        if (typeof message.content === "string")
            return;
        const [first, ...rest] = message.content;
        if (first?.type !== "text")
            return;
        const images = rest.filter((block) => block.type === "image");
        const normalized = await this._normalizePromptImages(images);
        const text = normalized.hints.length > 0 ? `${first.text}\n\n${normalized.hints.join("\n")}` : first.text;
        message.content = [
            { type: "text", text },
            ...rest.filter((block) => block.type !== "image"),
            ...normalized.images,
        ];
    }
    /**
     * Throw an error if the text is an extension command.
     */
    _throwIfExtensionCommand(text) {
        const spaceIndex = text.indexOf(" ");
        const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
        const command = this._extensionRunner.getCommand(commandName);
        if (command) {
            throw new Error(`Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`);
        }
    }
    /**
     * Send a custom message to the session. Creates a CustomMessageEntry.
     *
     * Handles four cases:
     * - Streaming: queues message, processed when loop pulls from queue
     * - Streaming + triggerTurn false: appended to state/session once the current turn ends
     * - Not streaming + triggerTurn: appends to state/session, starts new turn
     * - Not streaming + no trigger: appends to state/session, no turn
     * Explicit turn triggers wait in the existing delivery queues during compaction.
     *
     * @param message Custom message with customType, content, display, details
     * @param options.triggerTurn If true and not streaming, triggers a new LLM turn
     * @param options.deliverAs Delivery mode: "steer", "followUp", or "nextTurn"
     */
    async sendCustomMessage(message, options) {
        const appMessage = {
            role: "custom",
            customType: message.customType,
            // Untyped extensions can pass null/missing content; normalize at ingestion.
            content: message.content ?? [],
            display: message.display,
            details: message.details,
            timestamp: Date.now(),
        };
        if (options?.deliverAs === "nextTurn") {
            this._pendingNextTurnMessages.push(appMessage);
        }
        else if (options?.triggerTurn && this._isEmittingAgentSettled) {
            this._deferredSettledActions.push(async () => await this.sendCustomMessage(message, options));
        }
        else if ((this.isStreaming && options?.triggerTurn !== false) ||
            (options?.triggerTurn === true &&
                (this._compactionAbortController !== undefined ||
                    this._autoCompactionAbortController !== undefined ||
                    this._cacheCompaction !== undefined ||
                    this.agent.hasQueuedMessages()))) {
            if (options?.deliverAs === "followUp") {
                this.agent.followUp(appMessage);
            }
            else {
                this.agent.steer(appMessage);
            }
            if (this.isIdle)
                this._scheduleQueuedPrompt();
        }
        else if (options?.triggerTurn) {
            await this._startRun({ messageType: "custom", message: appMessage });
        }
        else if (this.isStreaming) {
            // Appending now would put the message between an assistant tool call and its
            // result, which providers that validate message order reject on replay. Defer
            // to the end of the turn. Nothing is emitted yet: message events must not
            // describe messages the session tree does not contain.
            this._pendingCustomMessages.push(appMessage);
        }
        else {
            this._appendCustomMessage(appMessage);
        }
    }
    _appendCustomMessage(appMessage) {
        this.sessionManager.appendCustomMessageEntry(appMessage.customType, appMessage.content, appMessage.display, appMessage.details);
        this._refreshFinalizedContext();
        this._emit({ type: "message_start", message: appMessage });
        this._emit({ type: "message_end", message: appMessage });
    }
    /**
     * Append custom messages queued while the agent was running.
     * Called once the current turn's tool results are in agent state and session history.
     */
    _flushPendingCustomMessages() {
        if (this._pendingCustomMessages.length === 0)
            return;
        const pending = this._pendingCustomMessages;
        this._pendingCustomMessages = [];
        for (const appMessage of pending) {
            this._appendCustomMessage(appMessage);
        }
    }
    /**
     * Send a user message to the agent. Always triggers a turn.
     * When the agent is streaming, use deliverAs to specify how to queue the message.
     *
     * @param content User message content (string or content array)
     * @param options.deliverAs Delivery mode when streaming: "steer" or "followUp"
     * @param options.expandPromptTemplates Whether to dispatch extension commands and expand skill commands and prompt templates. Default: false.
     */
    async sendUserMessage(content, options) {
        // Normalize content to text string + optional images
        let text;
        let images;
        if (typeof content === "string") {
            text = content;
        }
        else {
            const textParts = [];
            images = [];
            for (const part of content) {
                if (part.type === "text") {
                    textParts.push(part.text);
                }
                else {
                    images.push(part);
                }
            }
            text = textParts.join("\n");
            if (images.length === 0)
                images = undefined;
        }
        await this.prompt(text, {
            expandPromptTemplates: options?.expandPromptTemplates ?? false,
            streamingBehavior: options?.deliverAs,
            images,
            source: "extension",
        });
    }
    /**
     * Clear all queued messages and return them.
     * Useful for restoring to editor when user aborts.
     * @returns Object with steering and followUp arrays
     */
    clearQueue() {
        return this._queuedInputs.clear();
    }
    /** Snapshot of inputs the agent has not yet consumed. */
    getQueueState() {
        return this._queuedInputs.getState();
    }
    /** Edit one pending input without rerunning input hooks or template expansion. */
    updateQueuedMessage(messageId, message, images, expectedRevision) {
        return this._queuedInputs.update(messageId, message, images, expectedRevision);
    }
    /** Cancel one pending input without aborting the current agent operation. */
    removeQueuedMessage(messageId, expectedRevision) {
        return this._queuedInputs.remove(messageId, expectedRevision);
    }
    /** Combine consecutive pending inputs with the same delivery mode. */
    combineQueuedMessages(messageIds, expectedRevision) {
        return this._queuedInputs.combine(messageIds, expectedRevision);
    }
    /** Number of pending user inputs across both delivery queues. */
    get pendingMessageCount() {
        return this.getQueueState().messages.length;
    }
    /** Get pending steering text for interactive clients. */
    getSteeringMessages() {
        return this.getQueueState()
            .messages.filter((message) => message.mode === "steer")
            .map((message) => message.message);
    }
    /** Get pending follow-up text for interactive clients. */
    getFollowUpMessages() {
        return this.getQueueState()
            .messages.filter((message) => message.mode === "followUp")
            .map((message) => message.message);
    }
    get resourceLoader() {
        return this._resourceLoader;
    }
    /**
     * Abort current operation and wait for agent to become idle.
     */
    async abort() {
        if (this._isAgentRunActive) {
            this._agentRunAbortRequested = true;
        }
        this.abortRetry();
        this.abortCompaction();
        this.abortBranchSummary();
        if (this._isBeforeSettle)
            this._abortDuringBeforeSettle = true;
        this._beforeSettleAbortController?.abort();
        this.agent.abort();
        await this.waitForIdle();
    }
    async waitForIdle() {
        if (this.isIdle) {
            return;
        }
        await this._getIdleWaitPromise();
    }
    // =========================================================================
    // Model Management
    // =========================================================================
    async _emitModelSelect(nextModel, previousModel, source) {
        if (modelsAreEqual(previousModel, nextModel))
            return;
        this._cacheCompaction?.controller.abort();
        this._cacheWarmer?.cancel();
        await this._extensionRunner.emit({
            type: "model_select",
            model: nextModel,
            previousModel,
            source,
        });
    }
    /**
     * Set model directly.
     * Validates that auth is configured and saves to the session transcript.
     * Persists to global defaults only when options.persist is true.
     * @throws Error if no auth is configured for the model
     */
    async setModel(model, options = {}) {
        if (!(await this._modelRuntime.checkAuth(model.provider))) {
            throw new Error(`No API key for ${model.provider}/${model.id}`);
        }
        const previousModel = this.model;
        const thinkingLevel = this._getThinkingLevelForModelSwitch(model);
        this.agent.state.model = model;
        this.sessionManager.appendModelChange(model.provider, model.id);
        if (options.persist) {
            this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
            this._addPersistedDefaultToNonEmptyScope(model);
        }
        // Apply thinking level for the new model.
        // Per-model thinking level overrides take priority over the global default.
        // Model persistence does not implicitly rewrite the global thinking default.
        this.setThinkingLevel(thinkingLevel);
        await this._emitModelSelect(model, previousModel, "set");
    }
    _addPersistedDefaultToNonEmptyScope(model) {
        if (this._scopedModels.length === 0)
            return;
        if (this._scopedModels.some((scoped) => modelsAreEqual(scoped.model, model)))
            return;
        this._scopedModels = [...this._scopedModels, { model }];
        const enabledModels = this.settingsManager.getEnabledModels();
        if (!enabledModels?.length)
            return;
        const modelReference = `${model.provider}/${model.id}`;
        if (enabledModels.some((pattern) => pattern.toLowerCase() === modelReference.toLowerCase()))
            return;
        this.settingsManager.setEnabledModels([...enabledModels, modelReference]);
    }
    /**
     * Cycle to next/previous model.
     * Uses scoped models (from --models flag) if available, otherwise all available models.
     * @param direction - "forward" (default) or "backward"
     * @returns The new model info, or undefined if only one model available
     */
    async cycleModel(direction = "forward", options = {}) {
        if (this._scopedModels.length > 0) {
            return this._cycleScopedModel(direction, options);
        }
        return this._cycleAvailableModel(direction, options);
    }
    async _cycleScopedModel(direction, options) {
        const availableIds = new Set(this._modelRuntime.getAvailableSnapshot().map((model) => `${model.provider}\0${model.id}`));
        const scopedModels = this._scopedModels.filter((scoped) => availableIds.has(`${scoped.model.provider}\0${scoped.model.id}`));
        const currentModel = this.model;
        const currentIndex = scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));
        const nextIndex = getNextCycleIndex(currentIndex, scopedModels.length, direction);
        if (nextIndex === undefined)
            return undefined;
        const next = scopedModels[nextIndex];
        const thinkingLevel = this._getThinkingLevelForModelSwitch(next.model, next.thinkingLevel);
        // Apply model
        this.agent.state.model = next.model;
        this.sessionManager.appendModelChange(next.model.provider, next.model.id);
        if (options.persist) {
            this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);
            this._addPersistedDefaultToNonEmptyScope(next.model);
        }
        // Apply thinking level for the new model.
        // - Explicit scoped model thinking level overrides defaults
        // - Per-model thinking level overrides take priority over the global default
        // setThinkingLevel clamps to model capabilities.
        // Model persistence does not implicitly rewrite the global thinking default.
        this.setThinkingLevel(thinkingLevel);
        await this._emitModelSelect(next.model, currentModel, "cycle");
        return { model: next.model, thinkingLevel: this.thinkingLevel, isScoped: true };
    }
    async _cycleAvailableModel(direction, options) {
        const availableModels = this._modelRuntime.getAvailableSnapshot();
        const currentModel = this.model;
        const currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));
        const nextIndex = getNextCycleIndex(currentIndex, availableModels.length, direction);
        if (nextIndex === undefined)
            return undefined;
        const nextModel = availableModels[nextIndex];
        const thinkingLevel = this._getThinkingLevelForModelSwitch(nextModel);
        this.agent.state.model = nextModel;
        this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
        if (options.persist) {
            this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);
            this._addPersistedDefaultToNonEmptyScope(nextModel);
        }
        // Apply thinking level for the new model.
        // Model persistence does not implicitly rewrite the global thinking default.
        this.setThinkingLevel(thinkingLevel);
        await this._emitModelSelect(nextModel, currentModel, "cycle");
        return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
    }
    // =========================================================================
    // Thinking Level Management
    // =========================================================================
    /**
     * Set thinking level.
     * Clamps to model capabilities based on available thinking levels.
     * Saves the clamped level to the session transcript only if the level actually changes.
     * Persists the requested level to global defaults only when options.persist is true.
     */
    setThinkingLevel(level, options = {}) {
        const availableLevels = this.getAvailableThinkingLevels();
        const effectiveLevel = availableLevels.includes(level) ? level : this._clampThinkingLevel(level, availableLevels);
        // Only persist if actually changing
        const previousLevel = this.agent.state.thinkingLevel;
        const isChanging = effectiveLevel !== previousLevel;
        this.agent.state.thinkingLevel = effectiveLevel;
        if (options.persist) {
            this.settingsManager.setDefaultThinkingLevel(level);
        }
        if (isChanging) {
            this._cacheCompaction?.controller.abort();
            this.sessionManager.appendThinkingLevelChange(effectiveLevel);
            this._emit({ type: "thinking_level_changed", level: effectiveLevel });
            void this._extensionRunner.emit({
                type: "thinking_level_select",
                level: effectiveLevel,
                previousLevel,
            });
        }
    }
    /**
     * Cycle to next thinking level.
     * @returns New level, or undefined if model doesn't support thinking
     */
    cycleThinkingLevel(options = {}) {
        if (!this.supportsThinking())
            return undefined;
        const levels = this.getAvailableThinkingLevels();
        const currentIndex = levels.indexOf(this.thinkingLevel);
        const nextIndex = (currentIndex + 1) % levels.length;
        const nextLevel = levels[nextIndex];
        this.setThinkingLevel(nextLevel, options);
        return nextLevel;
    }
    /**
     * Get available thinking levels for current model.
     * The provider will clamp to what the specific model supports internally.
     */
    getAvailableThinkingLevels() {
        if (!this.model)
            return [...THINKING_LEVEL_OPTIONS];
        return getSupportedThinkingLevels(this.model);
    }
    /**
     * Check if current model supports thinking/reasoning.
     */
    supportsThinking() {
        return !!this.model?.reasoning;
    }
    _getThinkingLevelForModelSwitch(targetModel, explicitLevel) {
        if (explicitLevel !== undefined) {
            return explicitLevel;
        }
        // Per-model default takes priority when switching to a model that has one
        if (targetModel) {
            const perModel = this.settingsManager.getModelThinkingLevel(targetModel.provider, targetModel.id);
            if (perModel !== undefined) {
                return perModel;
            }
        }
        return this.settingsManager.getDefaultThinkingLevel() ?? this.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
    }
    _clampThinkingLevel(level, _availableLevels) {
        return this.model ? clampThinkingLevel(this.model, level) : "off";
    }
    // =========================================================================
    // Queue Mode Management
    // =========================================================================
    syncQueueModesFromSettings() {
        this.agent.steeringMode = this.settingsManager.getSteeringMode();
        this.agent.followUpMode = this.settingsManager.getFollowUpMode();
    }
    /**
     * Set steering message mode.
     * Saves to settings.
     */
    setSteeringMode(mode) {
        this.agent.steeringMode = mode;
        this.settingsManager.setSteeringMode(mode);
    }
    /**
     * Set follow-up message mode.
     * Saves to settings.
     */
    setFollowUpMode(mode) {
        this.agent.followUpMode = mode;
        this.settingsManager.setFollowUpMode(mode);
    }
    // =========================================================================
    // Compaction
    // =========================================================================
    /** An idle session or a running tool can prepare a summary without racing a model request. */
    get canPrepareCacheCompaction() {
        return (this.autoCompactionEnabled &&
            this.cacheMaintenance === "compact" &&
            !this.isCompacting &&
            !this._inputActive &&
            !this._extensionRunner.isAwaitingInput &&
            this._extensionRunner.getUIContext().getEditorText().trim().length === 0 &&
            this._promptPreflightCount === 0 &&
            !this._isBeforeSettle &&
            !this._isEmittingAgentSettled &&
            (!this.isStreaming || (this.agent.state.pendingToolCalls.size > 0 && !this.agent.state.streamingMessage)));
    }
    /** Prepare during tools, or serialize idle maintenance with incoming input. */
    async prepareCacheCompaction(signal) {
        const prepare = async () => {
            if (!this.canPrepareCacheCompaction || signal.aborted)
                return false;
            const request = getCompactionCacheRequest(this.sessionManager);
            if (!request)
                return false;
            const entries = this.sessionManager.getBranch();
            const candidate = prepareCompaction(entries, this.settingsManager.getCompactionSettings(request.model));
            if (!candidate)
                return false;
            const preparation = retainUnseenCompactionEntries(candidate, entries, request);
            const controller = new AbortController();
            const combinedSignal = AbortSignal.any([signal, controller.signal]);
            const work = {
                controller,
                signal: combinedSignal,
                request,
                entries,
                preparation,
                method: this.compactionMethod,
                fromExtension: false,
                onAbort: () => {
                    void this._applyPreparedCacheCompaction();
                },
                promise: Promise.resolve().then(() => this._prepareCacheCompactionResult(work)),
            };
            this._cacheCompaction = work;
            work.signal.addEventListener("abort", work.onAbort, { once: true });
            this._emit({ type: "compaction_start", reason: "cache-expiry" });
            const result = await work.promise;
            if (!this.isStreaming || !result)
                await this._applyPreparedCacheCompaction();
            return result !== undefined && !work.signal.aborted;
        };
        return this.isStreaming ? prepare() : this._admitInput(prepare);
    }
    async _prepareCacheCompactionResult(work) {
        const timeout = setTimeout(() => work.controller.abort(), 10 * 60_000);
        timeout.unref?.();
        let onAbort = () => { };
        const aborted = new Promise((_, reject) => {
            onAbort = () => reject(new Error("Compaction cancelled"));
            work.signal.addEventListener("abort", onAbort, { once: true });
        });
        try {
            work.signal.throwIfAborted();
            return await Promise.race([
                (async () => {
                    const extension = await this._extensionRunner.emit({
                        type: "session_before_compact",
                        method: work.method,
                        cacheRequest: work.request,
                        preparation: work.preparation,
                        branchEntries: work.entries,
                        reason: "cache-expiry",
                        willRetry: false,
                        signal: work.signal,
                    });
                    work.signal.throwIfAborted();
                    if (extension?.cancel) {
                        work.controller.abort();
                        throw new Error("Compaction cancelled");
                    }
                    work.fromExtension = extension?.compaction !== undefined;
                    const result = extension?.compaction ??
                        (await this._runDefaultCompaction(work.preparation, work.request.model, undefined, work.signal, "cache-expiry", work.request, work.method));
                    return { result, fromExtension: work.fromExtension };
                })(),
                aborted,
            ]);
        }
        catch (error) {
            if (!work.signal.aborted)
                work.errorMessage = error instanceof Error ? error.message : String(error);
            return undefined;
        }
        finally {
            clearTimeout(timeout);
            work.signal.removeEventListener("abort", onAbort);
        }
    }
    async _applyPreparedCacheCompaction() {
        const work = this._cacheCompaction;
        if (!work)
            return;
        work.applyPromise ??= this._commitPreparedCacheCompaction(work);
        await work.applyPromise;
    }
    async _commitPreparedCacheCompaction(work) {
        const prepared = await work.promise;
        if (this._cacheCompaction !== work)
            return;
        let result;
        let aborted = work.signal.aborted;
        try {
            const branch = this.sessionManager.getBranch();
            const samePrefix = work.entries.every((entry, index) => branch[index]?.id === entry.id);
            const invalidatingChange = branch
                .slice(work.entries.length)
                .some((entry) => entry.type === "compaction" ||
                entry.type === "context_edit" ||
                entry.type === "model_change" ||
                entry.type === "thinking_level_change");
            const current = work.request.sessionId === this.sessionId &&
                samePrefix &&
                !invalidatingChange &&
                this.compactionMethod === work.method &&
                this.autoCompactionEnabled &&
                this.cacheMaintenance === "compact" &&
                getCompactionCacheRequest(this.sessionManager) !== undefined;
            if (!current)
                aborted = true;
            if (prepared && !aborted) {
                const boundary = retainUnseenCompactionEntries({ ...work.preparation, firstKeptEntryId: prepared.result.firstKeptEntryId }, work.entries, work.request);
                const checkpoint = { ...prepared.result, firstKeptEntryId: boundary.firstKeptEntryId };
                const entryId = this.sessionManager.appendCompaction(checkpoint.summary, checkpoint.firstKeptEntryId, checkpoint.tokensBefore, checkpoint.details, prepared.fromExtension, checkpoint.usage);
                this._refreshFinalizedContext();
                result = { ...checkpoint, estimatedTokensAfter: estimateMessagesTokens(this.agent.state.messages) };
                const entry = this.sessionManager.getEntry(entryId);
                await this._extensionRunner.emit({
                    type: "session_compact",
                    compactionEntry: entry,
                    fromExtension: prepared.fromExtension,
                    reason: "cache-expiry",
                    willRetry: false,
                });
            }
            else {
                await this._emitSessionCompactFailed({
                    reason: "cache-expiry",
                    errorMessage: work.errorMessage,
                    aborted,
                    willRetry: false,
                    fromExtension: work.fromExtension,
                });
            }
        }
        catch (error) {
            work.errorMessage = error instanceof Error ? error.message : String(error);
        }
        finally {
            work.signal.removeEventListener("abort", work.onAbort);
            if (this._cacheCompaction === work)
                this._cacheCompaction = undefined;
            this._resolveIdleWaitIfIdle();
            this._emit({
                type: "compaction_end",
                reason: "cache-expiry",
                result,
                aborted,
                willRetry: false,
                errorMessage: work.errorMessage,
            });
            if (!this.isStreaming && !aborted)
                this._scheduleQueuedPrompt();
        }
    }
    /** Generate the selected summary, preserving the captured prefix when the provider supports it. */
    async _runDefaultCompaction(preparation, model, customInstructions, signal, reason, cacheRequest, method = this.compactionMethod) {
        if (method === "cache-aware" && cacheRequest) {
            const provider = this._modelRuntime.getProvider(cacheRequest.model.provider);
            if (provider?.streamSideQuestion &&
                !provider.sideQuestionUsesLiveContext &&
                !this._extensionRunner.hasHandlers("before_provider_request") &&
                !this._extensionRunner.hasHandlers("before_provider_headers")) {
                return compactCachedRequest(this._modelRuntime, cacheRequest, preparation, signal, customInstructions);
            }
        }
        if (reason === "cache-expiry") {
            throw new Error("The selected provider or extension did not provide an isolated compaction");
        }
        // Required context reduction remains available even without a reusable cached request.
        const request = await this._getSummarizationRequestAuth(model, signal);
        const result = await compact(preparation, request.model, request.apiKey, request.headers, customInstructions, signal, request.thinkingLevel, this.agent.streamFunction, request.env, this.settingsManager.getRetrySettings(), this._summarizationRetryCallbacks({ source: "compaction", reason }));
        return method === "cache-aware"
            ? {
                ...result,
                details: {
                    ...result.details,
                    method: "standalone",
                    requestedMethod: method,
                    fallbackReason: "An isolated cached request was unavailable",
                },
            }
            : result;
    }
    _clearManualCompactionState() {
        this._compactionAbortController = undefined;
        this._resolveIdleWaitIfIdle();
    }
    /**
     * Manually compact the session context.
     *
     * This is the manual entry point used by `/compact`, RPC, and extensions. It is
     * separate from automatic threshold/overflow compaction, which enters through
     * `_checkCompaction()` and `_runAutoCompaction()`. After preparation and the
     * `session_before_compact` hook, both paths call the lower-level `compact()`
     * function imported from `./compaction/index.ts`, unless the hook cancels or
     * supplies a custom result.
     *
     * Aborts the current agent operation first. Manual compaction never retries or
     * continues the interrupted agent turn.
     *
     * @param customInstructions Optional instructions for the compaction summary
     */
    async compact(customInstructions) {
        await this.abort();
        this._compactionAbortController = new AbortController();
        this._emit({ type: "compaction_start", reason: "manual" });
        let fromExtension = false;
        let cancelledByExtension = false;
        try {
            const model = this.model;
            if (!model) {
                throw new Error(formatNoModelSelectedMessage());
            }
            const settings = this.settingsManager.getCompactionSettings(model);
            const pathEntries = this.sessionManager.getBranch();
            const method = this.compactionMethod;
            const cacheRequest = method === "cache-aware" ? getCompactionCacheRequest(this.sessionManager) : undefined;
            let preparation = prepareCompaction(pathEntries, settings);
            if (!preparation) {
                // Check why we can't compact
                const lastEntry = pathEntries[pathEntries.length - 1];
                if (lastEntry?.type === "compaction") {
                    throw new Error("Already compacted");
                }
                throw new Error("Nothing to compact (session too small)");
            }
            if (cacheRequest)
                preparation = retainUnseenCompactionEntries(preparation, pathEntries, cacheRequest);
            let extensionCompaction;
            if (this._extensionRunner.hasHandlers("session_before_compact")) {
                const result = (await this._extensionRunner.emit({
                    type: "session_before_compact",
                    method,
                    cacheRequest,
                    preparation,
                    branchEntries: pathEntries,
                    customInstructions,
                    reason: "manual",
                    willRetry: false,
                    signal: this._compactionAbortController.signal,
                }));
                if (result?.cancel) {
                    cancelledByExtension = true;
                    throw new Error("Compaction cancelled");
                }
                if (result?.compaction) {
                    extensionCompaction = result.compaction;
                    fromExtension = true;
                }
            }
            let summary;
            let firstKeptEntryId;
            let tokensBefore;
            let usage;
            let details;
            if (extensionCompaction) {
                // Extension provided compaction content
                summary = extensionCompaction.summary;
                firstKeptEntryId = extensionCompaction.firstKeptEntryId;
                tokensBefore = extensionCompaction.tokensBefore;
                usage = extensionCompaction.usage;
                details = extensionCompaction.details;
            }
            else {
                // Shared default summary generator, also used by automatic compaction.
                const result = await this._runDefaultCompaction(preparation, model, customInstructions, this._compactionAbortController.signal, "manual", cacheRequest, method);
                summary = result.summary;
                firstKeptEntryId = result.firstKeptEntryId;
                tokensBefore = result.tokensBefore;
                usage = result.usage;
                details = result.details;
            }
            if (this._compactionAbortController.signal.aborted) {
                throw new Error("Compaction cancelled");
            }
            this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension, usage);
            const newEntries = this.sessionManager.getEntries();
            this._refreshFinalizedContext();
            const estimatedTokensAfter = estimateMessagesTokens(this.sessionManager.buildSessionProjection().messages);
            // Get the saved compaction entry for the extension event
            const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary);
            if (this._extensionRunner && savedCompactionEntry) {
                await this._extensionRunner.emit({
                    type: "session_compact",
                    compactionEntry: savedCompactionEntry,
                    fromExtension,
                    reason: "manual",
                    willRetry: false,
                });
            }
            const compactionResult = {
                summary,
                firstKeptEntryId,
                tokensBefore,
                estimatedTokensAfter,
                usage,
                details,
            };
            this._completedManualCompactions.add(this._compactionAbortController);
            // compaction_end listeners may submit queued prompts, so expose idle state before notifying them.
            this._clearManualCompactionState();
            this._emit({
                type: "compaction_end",
                reason: "manual",
                result: compactionResult,
                aborted: false,
                willRetry: false,
            });
            // Accepted prompts start a new run only after successful manual compaction.
            // A failed or explicitly aborted compaction leaves the queue intact.
            this._scheduleQueuedPrompt();
            return compactionResult;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const aborted = this._compactionAbortController.signal.aborted || cancelledByExtension;
            const errorMessage = aborted ? undefined : `Compaction failed: ${message}`;
            this._clearManualCompactionState();
            this._emit({
                type: "compaction_end",
                reason: "manual",
                result: undefined,
                aborted,
                willRetry: false,
                errorMessage,
            });
            await this._emitSessionCompactFailed({
                reason: "manual",
                errorMessage,
                aborted,
                willRetry: false,
                fromExtension,
            });
            throw error;
        }
        finally {
            this._clearManualCompactionState();
        }
    }
    /**
     * Cancel in-progress compaction (manual or auto).
     */
    abortCompaction() {
        this._compactionAbortController?.abort();
        this._autoCompactionAbortController?.abort();
        this._cacheCompaction?.controller.abort();
    }
    /**
     * Cancel in-progress branch summarization.
     */
    abortBranchSummary() {
        this._branchSummaryAbortController?.abort();
    }
    /**
     * Dispatch automatic compaction after `agent_end` or before prompt submission.
     * Manual compaction does not call this method; it enters through `compact()`.
     *
     * Automatic cases:
     * 1. Overflow with retry: a context-overflow error or recoverable length stop;
     *    remove the failed assistant message, compact, and retry the turn once.
     * 2. Overflow without retry: a successful response exceeded the configured
     *    context window; compact but preserve the completed response.
     * 3. Threshold without retry: valid or estimated context usage crossed the
     *    configured threshold; compact without retrying the completed response.
     *
     * Each case calls `_runAutoCompaction()`. After preparation and the
     * `session_before_compact` hook, that method calls the lower-level `compact()`
     * function imported from `./compaction/index.ts`, unless the hook cancels or
     * supplies a custom result.
     *
     * @param assistantMessage The assistant message to check
     * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
     * @returns Whether the post-run loop should call `agent.continue()` for overflow recovery or queued messages
     */
    async _checkCompaction(assistantMessage, skipAbortedCheck = true) {
        const settings = this.settingsManager.getCompactionSettings(this.model);
        if (!settings.enabled)
            return false;
        // Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
        if (skipAbortedCheck && assistantMessage.stopReason === "aborted")
            return false;
        // Skip overflow check if the message came from a different model.
        // This handles the case where user switched from a smaller-context model (e.g. opus)
        // to a larger-context model (e.g. codex) - the overflow error from the old model
        // shouldn't trigger compaction for the new model. Under a virtual selection, the
        // physical model that produced the message supplies the limits.
        const messageModel = this._modelForMessage(assistantMessage);
        const sameModel = messageModel !== undefined;
        const contextWindow = (messageModel ?? this.model)?.contextWindow ?? 0;
        // Skip compaction checks if this assistant message is older than the latest
        // compaction boundary. This prevents a stale pre-compaction usage/error
        // from retriggering compaction on the first prompt after compaction.
        const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
        const assistantIsFromBeforeCompaction = compactionEntry !== null && assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
        if (assistantIsFromBeforeCompaction) {
            return false;
        }
        // Automatic cases 1 and 2: context overflow.
        // A length stop is recoverable when output ended below the model's original desired limit,
        // independent of the configured context size or any context-clamped provider request limit.
        const currentProjection = this.sessionManager.buildSessionProjection();
        const assistantEntryId = this._findPersistedMessageEntryId(assistantMessage);
        const assistantIsProjected = assistantEntryId === undefined ||
            currentProjection.entries.some((entry) => entry.sourceEntry.id === assistantEntryId &&
                entry.messages.some((message) => message.role === "assistant"));
        const branch = this.sessionManager.getBranch();
        const assistantIndex = assistantEntryId ? branch.findIndex((entry) => entry.id === assistantEntryId) : -1;
        const entriesAfterAssistant = assistantIndex >= 0 ? branch.slice(assistantIndex + 1) : [];
        const hasPostAssistantContextEdit = entriesAfterAssistant.some((entry) => entry.type === "context_edit");
        const latestAssistantEdit = entriesAfterAssistant
            .filter((entry) => entry.type === "context_edit" && entry.targetId === assistantEntryId)
            .at(-1);
        const assistantRetainedForExplicitRecovery = assistantEntryId === undefined ||
            (!entriesAfterAssistant.some((entry) => entry.type === "compaction") &&
                latestAssistantEdit?.replacement !== null);
        const assistantUsageMatchesProjection = assistantIsProjected && !hasPostAssistantContextEdit;
        const explicitOverflow = assistantMessage.stopReason === "error" && isContextOverflow(assistantMessage);
        const contextOverflow = sameModel &&
            ((explicitOverflow && assistantRetainedForExplicitRecovery) ||
                (assistantUsageMatchesProjection && isContextOverflow(assistantMessage, contextWindow)));
        const recoverableLength = sameModel && assistantIsProjected && isRecoverableLength(assistantMessage, messageModel.maxTokens);
        if (contextOverflow || recoverableLength) {
            const willRetry = assistantMessage.stopReason !== "stop";
            // Case 2: the response completed successfully. Compact, but do not retry because
            // agent.continue() cannot continue from a completed assistant response.
            if (!willRetry) {
                return await this._runAutoCompaction("overflow", false);
            }
            if (this._overflowRecoveryAttempted) {
                const errorMessage = contextOverflow
                    ? "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model."
                    : "Truncated response recovery failed after one compact-and-retry attempt.";
                this._emit({
                    type: "compaction_end",
                    reason: "overflow",
                    result: undefined,
                    aborted: false,
                    willRetry: false,
                    errorMessage,
                });
                await this._emitSessionCompactFailed({
                    reason: "overflow",
                    errorMessage,
                    aborted: false,
                    willRetry: false,
                    fromExtension: false,
                });
                return false;
            }
            // Persistently omit the selected final attempt before post-run recovery compaction.
            this._overflowRecoveryAttempted = true;
            this._omitRecoveryAttempt(assistantMessage);
            const retry = await this._runAutoCompaction("overflow", willRetry);
            if (retry)
                this._failedResponse = assistantMessage;
            return retry;
        }
        // Case 3: threshold compaction without retry.
        // For error messages or all-zero usage messages, estimate from the last valid response.
        // This ensures sessions that hit persistent API errors (e.g. 529) or malformed zero-usage
        // responses can still compact and do not reset context accounting.
        let contextTokens;
        const projection = currentProjection;
        const hasContextEdits = projection.entries.some((entry) => entry.sourceEntry.type === "context_edit");
        const directContextTokens = assistantMessage.usage ? calculateContextTokens(assistantMessage.usage) : 0;
        if (hasContextEdits) {
            contextTokens = estimateProjectedContextTokens(projection, branch).tokens;
        }
        else if (assistantMessage.stopReason === "error" || directContextTokens === 0) {
            const messages = this.agent.state.messages;
            const estimate = estimateContextTokens(messages);
            // Without provider usage, estimate.tokens is the pure message-size estimate.
            // Only usage-backed estimates need the stale pre-compaction check.
            if (estimate.lastUsageIndex !== null) {
                // Verify the usage source is post-compaction. Kept pre-compaction messages
                // have stale usage reflecting the old (larger) context and would falsely
                // trigger compaction right after one just finished.
                const usageMsg = messages[estimate.lastUsageIndex];
                if (compactionEntry &&
                    usageMsg.role === "assistant" &&
                    usageMsg.timestamp <= new Date(compactionEntry.timestamp).getTime()) {
                    return false;
                }
            }
            contextTokens = estimate.tokens;
        }
        else {
            contextTokens = directContextTokens;
        }
        if (shouldCompact(contextTokens, contextWindow, settings)) {
            return await this._runAutoCompaction("threshold", false);
        }
        return false;
    }
    /**
     * Execute threshold or overflow compaction. Manual compaction uses
     * `AgentSession.compact()` instead. Both paths call the lower-level `compact()`
     * function imported from `./compaction/index.ts` after preparation and extension
     * interception.
     *
     * @param reason Automatic trigger selected by `_checkCompaction()`
     * @param willRetry Whether to continue the interrupted turn after overflow compaction
     * @returns Whether the post-run loop should call `agent.continue()`
     */
    async _runAutoCompaction(reason, willRetry) {
        const model = this.model;
        const settings = this.settingsManager.getCompactionSettings(model);
        let abortController;
        let started = false;
        let fromExtension = false;
        let cancelledByExtension = false;
        try {
            if (!model) {
                return false;
            }
            const pathEntries = this.sessionManager.getBranch();
            const method = this.compactionMethod;
            const cacheRequest = method === "cache-aware" ? getCompactionCacheRequest(this.sessionManager) : undefined;
            let preparation = prepareCompaction(pathEntries, settings);
            if (!preparation) {
                return false;
            }
            if (cacheRequest)
                preparation = retainUnseenCompactionEntries(preparation, pathEntries, cacheRequest);
            abortController = new AbortController();
            this._autoCompactionAbortController = abortController;
            started = true;
            this._emit({ type: "compaction_start", reason });
            abortController.signal.throwIfAborted();
            let extensionCompaction;
            if (this._extensionRunner.hasHandlers("session_before_compact")) {
                const extensionResult = (await this._extensionRunner.emit({
                    type: "session_before_compact",
                    method,
                    cacheRequest,
                    preparation,
                    branchEntries: pathEntries,
                    customInstructions: undefined,
                    reason,
                    willRetry,
                    signal: abortController.signal,
                }));
                if (extensionResult?.cancel) {
                    cancelledByExtension = true;
                    throw new Error("Compaction cancelled");
                }
                if (extensionResult?.compaction) {
                    extensionCompaction = extensionResult.compaction;
                    fromExtension = true;
                }
            }
            abortController.signal.throwIfAborted();
            let summary;
            let firstKeptEntryId;
            let tokensBefore;
            let usage;
            let details;
            if (extensionCompaction) {
                // Extension provided compaction content
                summary = extensionCompaction.summary;
                firstKeptEntryId = extensionCompaction.firstKeptEntryId;
                tokensBefore = extensionCompaction.tokensBefore;
                usage = extensionCompaction.usage;
                details = extensionCompaction.details;
            }
            else {
                // Shared default summary generator, also used by manual compaction.
                const compactResult = await this._runDefaultCompaction(preparation, model, undefined, abortController.signal, reason, cacheRequest, method);
                summary = compactResult.summary;
                firstKeptEntryId = compactResult.firstKeptEntryId;
                tokensBefore = compactResult.tokensBefore;
                usage = compactResult.usage;
                details = compactResult.details;
            }
            abortController.signal.throwIfAborted();
            this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension, usage);
            const newEntries = this.sessionManager.getEntries();
            this._refreshFinalizedContext();
            const estimatedTokensAfter = estimateMessagesTokens(this.sessionManager.buildSessionProjection().messages);
            // Get the saved compaction entry for the extension event
            const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary);
            if (this._extensionRunner && savedCompactionEntry) {
                await this._extensionRunner.emit({
                    type: "session_compact",
                    compactionEntry: savedCompactionEntry,
                    fromExtension,
                    reason,
                    willRetry,
                });
            }
            const result = {
                summary,
                firstKeptEntryId,
                tokensBefore,
                estimatedTokensAfter,
                usage,
                details,
            };
            this._emit({ type: "compaction_end", reason, result, aborted: false, willRetry });
            if (willRetry)
                return true;
            // Auto-compaction can complete while follow-up/steering/custom messages are waiting.
            // Continue once so queued messages are delivered.
            return this.agent.hasQueuedMessages();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "compaction failed";
            const aborted = abortController?.signal.aborted === true || cancelledByExtension;
            if (started) {
                const errorMessage = aborted
                    ? undefined
                    : reason === "overflow"
                        ? `Context overflow recovery failed: ${message}`
                        : `Auto-compaction failed: ${message}`;
                this._emit({
                    type: "compaction_end",
                    reason,
                    result: undefined,
                    aborted,
                    willRetry: false,
                    errorMessage,
                });
                await this._emitSessionCompactFailed({
                    reason,
                    errorMessage,
                    aborted,
                    willRetry: false,
                    fromExtension,
                });
            }
            return false;
        }
        finally {
            if (this._autoCompactionAbortController === abortController) {
                this._autoCompactionAbortController = undefined;
            }
            this._resolveIdleWaitIfIdle();
        }
    }
    /**
     * Toggle auto-compaction setting.
     */
    setAutoCompactionEnabled(enabled) {
        this.settingsManager.setCompactionEnabled(enabled);
        if (!enabled)
            this._cacheCompaction?.controller.abort();
        this._cacheWarmer?.onModeChanged();
    }
    /** Whether auto-compaction is enabled */
    get autoCompactionEnabled() {
        return this.settingsManager.getCompactionEnabled();
    }
    async bindExtensions(bindings) {
        if (bindings.uiContext !== undefined) {
            this._extensionUIContext = bindings.uiContext;
        }
        if (bindings.mode !== undefined) {
            this._extensionMode = bindings.mode;
        }
        if (bindings.commandContextActions !== undefined) {
            this._extensionCommandContextActions = bindings.commandContextActions;
        }
        if (bindings.abortHandler !== undefined) {
            this._extensionAbortHandler = bindings.abortHandler;
        }
        if (bindings.shutdownHandler !== undefined) {
            this._extensionShutdownHandler = bindings.shutdownHandler;
        }
        if (bindings.onError !== undefined) {
            this._extensionErrorListener = bindings.onError;
        }
        this._extensionsBound = true;
        this._applyExtensionBindings(this._extensionRunner);
        await this._extensionRunner.emit(this._sessionStartEvent);
        this._extensionRunner.reportUnhandledMcpServers();
        await this.extendResourcesFromExtensions(this._sessionStartEvent.reason === "reload" ? "reload" : "startup");
    }
    async extendResourcesFromExtensions(reason) {
        if (!this._extensionRunner.hasHandlers("resources_discover")) {
            return;
        }
        const { skillPaths, promptPaths, themePaths } = await this._extensionRunner.emitResourcesDiscover(this._cwd, reason);
        if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) {
            return;
        }
        const extensionPaths = {
            skillPaths: this.buildExtensionResourcePaths(skillPaths),
            promptPaths: this.buildExtensionResourcePaths(promptPaths),
            themePaths: this.buildExtensionResourcePaths(themePaths),
        };
        this._resourceLoader.extendResources(extensionPaths);
        this._rebuildSystemPrompt(this.getActiveToolNames());
    }
    buildExtensionResourcePaths(entries) {
        return entries.map((entry) => {
            const source = this.getExtensionSourceLabel(entry.extensionPath);
            const baseDir = isSyntheticPath(entry.extensionPath) ? undefined : dirname(entry.extensionPath);
            return {
                path: entry.path,
                metadata: {
                    source,
                    scope: "temporary",
                    origin: "top-level",
                    baseDir,
                },
            };
        });
    }
    getExtensionSourceLabel(extensionPath) {
        if (isSyntheticPath(extensionPath)) {
            return `extension:${extensionPath.replace(/[<>]/g, "")}`;
        }
        const base = basename(extensionPath);
        const name = base.replace(/\.(ts|js)$/, "");
        return `extension:${name}`;
    }
    _applyExtensionBindings(runner) {
        runner.setUIContext(this._extensionUIContext, this._extensionMode);
        runner.bindCommandContext(this._extensionCommandContextActions);
        this._extensionErrorUnsubscriber?.();
        this._extensionErrorUnsubscriber = this._extensionErrorListener
            ? runner.onError(this._extensionErrorListener)
            : undefined;
    }
    _refreshCurrentModelFromRegistry() {
        const currentModel = this.model;
        if (!currentModel) {
            return;
        }
        const refreshedModel = this._modelRuntime.getModel(currentModel.provider, currentModel.id);
        if (!refreshedModel || refreshedModel === currentModel) {
            return;
        }
        this.agent.state.model = refreshedModel;
    }
    _bindExtensionCore(runner) {
        const getCommands = () => {
            const extensionCommands = runner.getRegisteredCommands().map((command) => ({
                name: command.invocationName,
                description: command.description,
                source: "extension",
                sourceInfo: command.sourceInfo,
            }));
            const templates = this.promptTemplates.map((template) => ({
                name: template.name,
                description: template.description,
                source: "prompt",
                sourceInfo: template.sourceInfo,
            }));
            const skills = this._resourceLoader.getSkills().skills.map((skill) => ({
                name: `skill:${skill.name}`,
                description: skill.description,
                source: "skill",
                sourceInfo: skill.sourceInfo,
            }));
            return [...extensionCommands, ...templates, ...skills];
        };
        runner.bindCore({
            sendMessage: (message, options) => {
                this.sendCustomMessage(message, options).catch((err) => {
                    runner.emitError({
                        extensionPath: "<runtime>",
                        event: "send_message",
                        error: err instanceof Error ? err.message : String(err),
                    });
                });
            },
            sendUserMessage: (content, options) => {
                this.sendUserMessage(content, options).catch((err) => {
                    runner.emitError({
                        extensionPath: "<runtime>",
                        event: "send_user_message",
                        error: err instanceof Error ? err.message : String(err),
                    });
                });
            },
            appendEntry: (customType, data) => {
                const entryId = this.sessionManager.appendCustomEntry(customType, data);
                const entry = this.sessionManager.getEntry(entryId);
                if (entry) {
                    this._emit({ type: "entry_appended", entry });
                }
            },
            setSessionName: (name) => {
                this.setSessionName(name);
            },
            getSessionName: () => {
                return this.sessionManager.getSessionName();
            },
            setLabel: (entryId, label) => {
                this.sessionManager.appendLabelChange(entryId, label);
            },
            getActiveTools: () => this.getActiveToolNames(),
            getAllTools: () => this.getAllTools(),
            getSettings: () => this.settingsManager.getSettings(),
            setActiveTools: (toolNames) => this.setActiveToolsByName(toolNames),
            refreshTools: () => this._refreshToolRegistry(),
            getCommands,
            setModel: async (model) => {
                if (!this._modelRuntime.hasConfiguredAuth(model.provider))
                    return false;
                await this.setModel(model);
                return true;
            },
            getThinkingLevel: () => this.thinkingLevel,
            setThinkingLevel: (level) => this.setThinkingLevel(level),
        }, {
            getModel: () => this.model,
            getScopedModels: () => this._scopedModels,
            isIdle: () => this.isIdle,
            isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
            getSignal: () => this._beforeSettleAbortController?.signal ?? this.agent.signal,
            abort: () => {
                if (this._extensionAbortHandler) {
                    this._extensionAbortHandler();
                    return;
                }
                void this.abort();
            },
            hasPendingMessages: () => this.pendingMessageCount > 0,
            hasPendingUserSteering: () => this.agent.hasPendingUserSteering(),
            hasPendingUserInput: () => this.agent.hasPendingUserInput(),
            onUserSteering: (listener) => this.agent.onUserSteering(listener),
            shutdown: () => {
                this._extensionShutdownHandler?.();
            },
            getContextUsage: () => this.getContextUsage(),
            compact: (options) => {
                void (async () => {
                    try {
                        const result = await this.compact(options?.customInstructions);
                        options?.onComplete?.(result);
                    }
                    catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        options?.onError?.(err);
                    }
                })();
            },
            getSystemPrompt: () => this.systemPrompt,
            getSystemPromptOptions: () => this._baseSystemPromptOptions,
            executeTool: (callerId, name, args, options) => this._executeNestedToolCall(callerId, name, args, options),
            takeNestedToolCalls: (callerId) => this._nestedToolCalls?.takeRecord(callerId),
            publishToolCompletion: (callerId, result) => {
                const entry = this.sessionManager.appendToolCompletion(callerId, result);
                if (!entry)
                    return;
                this._refreshFinalizedContext();
                // The durable append already transferred ownership. A broken observer must not make
                // the caller retry the completed evidence or prevent other observers seeing it.
                for (const listener of this._eventListeners) {
                    try {
                        listener({ type: "entry_appended", entry });
                    }
                    catch (error) {
                        console.error("Tool completion observer failed:", error);
                    }
                }
            },
            getCallableTools: () => this._getCallableTools(),
        }, {
            registerProvider: (name, config) => {
                this._modelRuntime.registerProvider(name, config);
                this._refreshCurrentModelFromRegistry();
            },
            registerNativeProvider: (provider) => {
                this._modelRuntime.registerNativeProvider(provider);
                this._refreshCurrentModelFromRegistry();
            },
            unregisterProvider: (name) => {
                this._modelRuntime.unregisterProvider(name);
                this._refreshCurrentModelFromRegistry();
            },
            registerVirtualModel: (definition) => {
                this._modelRuntime.registerVirtualModel(definition);
                this._refreshCurrentModelFromRegistry();
            },
            unregisterVirtualModel: (provider, id) => {
                this._modelRuntime.unregisterVirtualModel(provider, id);
                this._refreshCurrentModelFromRegistry();
            },
        });
    }
    _refreshToolRegistry(options) {
        // Tools that were already activated on registration. A tool whose exposure changes to
        // `direct` or `model-only` (for example from `hidden`) is activated like a new tool.
        const previousActivatedOnRegistration = new Set([...this._toolRegistry.keys()].filter((name) => this._isActivatedOnRegistration(name)));
        const previousActiveToolNames = this.getActiveToolNames();
        const allowedTools = this._allowedTools;
        const registeredTools = this._extensionRunner.getAllRegisteredTools();
        const allCustomTools = [
            ...registeredTools,
            ...this._customTools.map((definition) => ({
                definition,
                sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, { source: "sdk" }),
            })),
        ].filter((tool) => this._isAllowedTool(tool.definition.name));
        const definitionRegistry = new Map(Array.from(this._baseToolDefinitions.entries())
            .filter(([name]) => this._isAllowedTool(name))
            .map(([name, definition]) => [
            name,
            {
                definition,
                sourceInfo: createSyntheticSourceInfo(`${BUILTIN_PATH_PREFIX}${name}`, { source: "builtin" }),
            },
        ]));
        for (const tool of allCustomTools) {
            definitionRegistry.set(tool.definition.name, {
                definition: tool.definition,
                sourceInfo: tool.sourceInfo,
            });
        }
        this._toolDefinitions = definitionRegistry;
        this._toolPromptSnippets = new Map(Array.from(definitionRegistry.values())
            .map(({ definition }) => {
            const snippet = this._normalizePromptSnippet(definition.promptSnippet);
            return snippet ? [definition.name, snippet] : undefined;
        })
            .filter((entry) => entry !== undefined));
        this._toolPromptGuidelines = new Map(Array.from(definitionRegistry.values())
            .map(({ definition }) => {
            const guidelines = this._normalizePromptGuidelines(definition.promptGuidelines);
            return guidelines.length > 0 ? [definition.name, guidelines] : undefined;
        })
            .filter((entry) => entry !== undefined));
        const runner = this._extensionRunner;
        const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, runner);
        const wrappedBuiltInTools = wrapRegisteredTools(Array.from(this._baseToolDefinitions.values())
            .filter((definition) => this._isAllowedTool(definition.name))
            .map((definition) => ({
            definition,
            sourceInfo: createSyntheticSourceInfo(`${BUILTIN_PATH_PREFIX}${definition.name}`, {
                source: "builtin",
            }),
        })), runner);
        const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
        for (const tool of wrappedExtensionTools) {
            toolRegistry.set(tool.name, tool);
        }
        this._toolRegistry = toolRegistry;
        const nextActiveToolNames = (options?.activeToolNames ? [...options.activeToolNames] : [...previousActiveToolNames]).filter((name) => this._isAllowedTool(name));
        if (allowedTools) {
            for (const toolName of this._toolRegistry.keys()) {
                // Naming or matching a tool activates it even when it is not active by default. MCP tools
                // kept registered without being named stay inactive.
                if (allowedTools(toolName) && this._isDeclarable(toolName)) {
                    nextActiveToolNames.push(toolName);
                }
            }
        }
        else if (options?.includeAllExtensionTools) {
            for (const tool of wrappedExtensionTools) {
                if (this._isActivatedOnRegistration(tool.name))
                    nextActiveToolNames.push(tool.name);
            }
        }
        else if (!options?.activeToolNames) {
            for (const toolName of this._toolRegistry.keys()) {
                if (!previousActivatedOnRegistration.has(toolName) && this._isActivatedOnRegistration(toolName)) {
                    nextActiveToolNames.push(toolName);
                }
            }
        }
        // Pending tools that are registered now become active.
        nextActiveToolNames.push(...this._pendingToolNames);
        this._setActiveTools([...new Set(nextActiveToolNames)]);
    }
    /** Whether activating the tool declares it to the model. */
    _isDeclarable(name) {
        const exposure = this._getToolExposure(name);
        return exposure === "direct" || exposure === "model-only";
    }
    /** Whether registering the tool activates it, which declares it to the model. */
    _isActivatedOnRegistration(name) {
        return this._isDeclarable(name) && this._toolDefinitions.get(name)?.definition.defaultActive !== false;
    }
    _buildRuntime(options) {
        const autoResizeImages = this.settingsManager.getImageAutoResize();
        const shellCommandPrefix = this.settingsManager.getShellCommandPrefix();
        const shellPath = this.settingsManager.getShellPath();
        const baseToolDefinitions = this._baseToolsOverride
            ? Object.fromEntries(Object.entries(this._baseToolsOverride).map(([name, tool]) => [
                name,
                createToolDefinitionFromAgentTool(tool),
            ]))
            : createAllToolDefinitions(this._cwd, {
                read: { autoResizeImages },
                bash: { commandPrefix: shellCommandPrefix, shellPath },
            });
        this._baseToolDefinitions = new Map(Object.entries(baseToolDefinitions).map(([name, tool]) => [name, tool]));
        const extensionsResult = this._resourceLoader.getExtensions();
        if (options.flagValues) {
            for (const [name, value] of options.flagValues) {
                extensionsResult.runtime.flagValues.set(name, value);
            }
        }
        this._extensionRunner = new ExtensionRunner(extensionsResult.extensions, extensionsResult.runtime, this._cwd, this.sessionManager, new ModelRegistry(this._modelRuntime));
        if (this._extensionRunnerRef) {
            this._extensionRunnerRef.current = this._extensionRunner;
        }
        this._bindExtensionCore(this._extensionRunner);
        this._applyExtensionBindings(this._extensionRunner);
        const defaultActiveToolNames = this._baseToolsOverride
            ? Object.keys(this._baseToolsOverride)
            : ["read", "bash", "edit", "write"];
        const baseActiveToolNames = options.activeToolNames ?? defaultActiveToolNames;
        this._refreshToolRegistry({
            activeToolNames: baseActiveToolNames,
            includeAllExtensionTools: options.includeAllExtensionTools,
        });
    }
    async reload(options) {
        if (this.isStreaming) {
            throw new Error("Wait for the current response to finish before reloading.");
        }
        if (this.isCompacting) {
            throw new Error("Wait for compaction to finish before reloading.");
        }
        const oldRunner = this._extensionRunner;
        const previousFlagValues = oldRunner.getFlagValues();
        await emitSessionShutdownEvent(oldRunner, { type: "session_shutdown", reason: "reload" });
        oldRunner.invalidate();
        const getDefaultTools = () => this._usesDefaultTools
            ? applyToolModifiers(this.settingsManager.getDefaultTools() ?? DEFAULT_TOOL_NAMES, this._defaultToolModifiers)
            : [];
        const previousDefaultTools = new Set(getDefaultTools());
        await this.settingsManager.reload();
        this.syncQueueModesFromSettings();
        resetApiProviders();
        await this._resourceLoader.reload();
        // Activate tools newly added to defaultTools. Removed ones stay active, and tools disabled
        // during the session stay disabled unless the setting newly adds them.
        const addedDefaultTools = getDefaultTools().filter((name) => !previousDefaultTools.has(name));
        // Tools the new extensions register later, such as MCP tools, are pending until then.
        for (const name of this.getActiveToolNames())
            this._pendingToolNames.add(name);
        this._restoredToolNames = new Set(this.getActiveToolNames());
        this._buildRuntime({
            activeToolNames: [...this.getActiveToolNames(), ...addedDefaultTools],
            flagValues: previousFlagValues,
            includeAllExtensionTools: true,
        });
        if (this._extensionsBound) {
            await options?.beforeSessionStart?.();
            await this._extensionRunner.emit({ type: "session_start", reason: "reload" });
            this._extensionRunner.reportUnhandledMcpServers();
            await this.extendResourcesFromExtensions("reload");
        }
    }
    // =========================================================================
    // Auto-Retry
    // =========================================================================
    /**
     * Check if an error is retryable (overloaded, rate limit, server errors).
     * Context overflow errors are NOT retryable (handled by compaction instead).
     */
    _isRetryableError(message) {
        // Context overflow is handled by compaction, not retry.
        if (isContextOverflow(message, (this._modelForMessage(message) ?? this.model)?.contextWindow ?? 0))
            return false;
        return isRetryableAssistantError(message);
    }
    /**
     * Retry policy + callbacks shared by compaction and branch-summary summarization calls.
     * Uses the same `settings.retry` budget/backoff as agent-turn retries so a single transient
     * stream drop no longer fails the whole operation. `source` carries the context
     * the TUI needs to render the retry and recreate the underlying indicator.
     */
    _summarizationRetryCallbacks(source) {
        return {
            onRetryScheduled: (attempt, maxAttempts, delayMs, errorMessage) => {
                this._emit({
                    type: "summarization_retry_scheduled",
                    attempt,
                    maxAttempts,
                    delayMs,
                    errorMessage,
                });
            },
            onRetryAttemptStart: () => {
                this._emit({
                    type: "summarization_retry_attempt_start",
                    ...source,
                });
            },
            onRetryFinished: () => {
                this._emit({ type: "summarization_retry_finished" });
            },
        };
    }
    _finishCancelledRetry() {
        if (this._retryAttempt === 0)
            return;
        const attempt = this._retryAttempt;
        this._retryAttempt = 0;
        this._emit({
            type: "auto_retry_end",
            success: false,
            attempt,
            finalError: "Retry cancelled",
        });
    }
    /**
     * Prepare a retryable error for continuation with exponential backoff.
     * @returns true if the caller should continue the agent, false otherwise
     */
    async _prepareRetry(message) {
        const settings = this.settingsManager.getRetrySettings();
        if (!settings.enabled) {
            return false;
        }
        this._retryAttempt++;
        if (this._retryAttempt > settings.maxRetries) {
            // Preserve the completed attempt count so post-run handling can emit the final failure.
            this._retryAttempt--;
            return false;
        }
        const delayMs = retryDelayMs(settings, this._retryAttempt);
        this._emit({
            type: "auto_retry_start",
            attempt: this._retryAttempt,
            maxAttempts: settings.maxRetries,
            delayMs,
            errorMessage: message.errorMessage || "Unknown error",
        });
        // Keep the failed attempt in raw history while durably omitting it from model projection.
        this._omitRecoveryAttempt(message);
        // Wait with exponential backoff (abortable)
        this._retryAbortController = new AbortController();
        try {
            await sleep(delayMs, this._retryAbortController.signal);
        }
        catch {
            // Aborted during sleep - emit end event so UI can clean up
            this._finishCancelledRetry();
            return false;
        }
        finally {
            this._retryAbortController = undefined;
        }
        return true;
    }
    /**
     * Cancel in-progress retry.
     */
    abortRetry() {
        this._retryAbortController?.abort();
    }
    /** Whether auto-retry is currently in progress */
    get isRetrying() {
        return this._retryAbortController !== undefined;
    }
    /** Whether auto-retry is enabled */
    get autoRetryEnabled() {
        return this.settingsManager.getRetryEnabled();
    }
    /**
     * Toggle auto-retry setting.
     */
    setAutoRetryEnabled(enabled) {
        this.settingsManager.setRetryEnabled(enabled);
    }
    // =========================================================================
    // Bash Execution
    // =========================================================================
    /**
     * Execute a bash command.
     * Adds result to agent context and session.
     * @param command The bash command to execute
     * @param onChunk Optional streaming callback for output
     * @param options.excludeFromContext If true, command output won't be sent to LLM (!! prefix)
     * @param options.id Optional identifier included in bash execution update events
     * @param options.operations Custom BashOperations for remote execution
     */
    async executeBash(command, onChunk, options) {
        const abortController = new AbortController();
        this._bashAbortControllers.add(abortController);
        // Apply command prefix if configured (e.g., "shopt -s expand_aliases" for alias support)
        const prefix = this.settingsManager.getShellCommandPrefix();
        const shellPath = this.settingsManager.getShellPath();
        const resolvedCommand = prefix ? `${prefix}\n${command}` : command;
        try {
            const result = await executeBashWithOperations(resolvedCommand, this.sessionManager.getCwd(), options?.operations ?? createLocalBashOperations({ shellPath }), {
                onChunk: (delta) => {
                    onChunk?.(delta);
                    this._emit({ type: "bash_execution_update", id: options?.id, delta });
                },
                signal: abortController.signal,
            });
            this.recordBashResult(command, result, options);
            return result;
        }
        finally {
            this._bashAbortControllers.delete(abortController);
        }
    }
    /**
     * Record a bash execution result in session history.
     * Used by executeBash and by extensions that handle bash execution themselves.
     */
    recordBashResult(command, result, options) {
        const bashMessage = {
            role: "bashExecution",
            command,
            output: result.output,
            exitCode: result.exitCode,
            cancelled: result.cancelled,
            truncated: result.truncated,
            fullOutputPath: result.fullOutputPath,
            timestamp: Date.now(),
            excludeFromContext: options?.excludeFromContext,
        };
        // If agent is streaming, defer adding to avoid breaking tool_use/tool_result ordering
        if (this.isStreaming) {
            // Queue for later - will be flushed on agent_end
            this._pendingBashMessages.push(bashMessage);
        }
        else {
            this.sessionManager.appendMessage(bashMessage);
            this._refreshFinalizedContext();
        }
    }
    /**
     * Cancel running bash command.
     */
    abortBash() {
        for (const abortController of [...this._bashAbortControllers]) {
            abortController.abort();
        }
    }
    /** Whether a bash command is currently running */
    get isBashRunning() {
        return this._bashAbortControllers.size > 0;
    }
    /** Whether there are pending bash messages waiting to be flushed */
    get hasPendingBashMessages() {
        return this._pendingBashMessages.length > 0;
    }
    /**
     * Flush pending bash messages to agent state and session.
     * Called after agent turn completes to maintain proper message ordering.
     */
    _flushPendingBashMessages() {
        if (this._pendingBashMessages.length === 0)
            return;
        for (const bashMessage of this._pendingBashMessages) {
            this.sessionManager.appendMessage(bashMessage);
        }
        this._pendingBashMessages = [];
        this._refreshFinalizedContext();
    }
    // =========================================================================
    // Session Management
    // =========================================================================
    /**
     * Set a display name for the current session.
     */
    setSessionName(name) {
        this.sessionManager.appendSessionInfo(name);
        const event = { type: "session_info_changed", name: this.sessionManager.getSessionName() };
        this._emit(event);
        void this._extensionRunner.emit(event);
    }
    // =========================================================================
    // Tree Navigation
    // =========================================================================
    /**
     * Navigate to a different node in the session tree.
     * Unlike fork() which creates a new session file, this stays in the same file.
     *
     * @param targetId The entry ID to navigate to
     * @param options.summarize Whether user wants to summarize abandoned branch
     * @param options.customInstructions Custom instructions for summarizer
     * @param options.replaceInstructions If true, customInstructions replaces the default prompt
     * @param options.label Label to attach to the branch summary entry
     * @returns Result with editorText (if user message) and cancelled status
     */
    async navigateTree(targetId, options = {}) {
        if (this.isStreaming || this._promptPreflightCount > 0) {
            throw new Error("Wait for the current response to finish before navigating the session tree.");
        }
        if (this.isCompacting) {
            throw new Error("Wait for the current compaction or tree navigation to finish before navigating the session tree.");
        }
        const oldLeafId = this.sessionManager.getLeafId();
        // No-op if already at target
        if (targetId === oldLeafId) {
            return { cancelled: false };
        }
        // Model required for summarization
        if (options.summarize && !this.model) {
            throw new Error("No model available for summarization");
        }
        const targetEntry = this.sessionManager.getEntry(targetId);
        if (!targetEntry) {
            throw new Error(`Entry ${targetId} not found`);
        }
        // Collect entries to summarize (from old leaf to common ancestor)
        const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(this.sessionManager, oldLeafId, targetId);
        // Prepare event data - mutable so extensions can override
        let customInstructions = options.customInstructions;
        let replaceInstructions = options.replaceInstructions;
        let label = options.label;
        const preparation = {
            targetId,
            oldLeafId,
            commonAncestorId,
            entriesToSummarize,
            userWantsSummary: options.summarize ?? false,
            customInstructions,
            replaceInstructions,
            label,
        };
        // Set up abort controller for summarization
        const abortController = new AbortController();
        this._branchSummaryAbortController = abortController;
        try {
            let extensionSummary;
            let fromExtension = false;
            // Emit session_before_tree event
            if (this._extensionRunner.hasHandlers("session_before_tree")) {
                const result = (await this._extensionRunner.emit({
                    type: "session_before_tree",
                    preparation,
                    signal: abortController.signal,
                }));
                if (result?.cancel) {
                    return { cancelled: true };
                }
                if (result?.summary && options.summarize) {
                    extensionSummary = result.summary;
                    fromExtension = true;
                }
                // Allow extensions to override instructions and label
                if (result?.customInstructions !== undefined) {
                    customInstructions = result.customInstructions;
                }
                if (result?.replaceInstructions !== undefined) {
                    replaceInstructions = result.replaceInstructions;
                }
                if (result?.label !== undefined) {
                    label = result.label;
                }
            }
            // Run default summarizer if needed
            let summaryText;
            let summaryDetails;
            let summaryUsage;
            if (options.summarize && entriesToSummarize.length > 0 && !extensionSummary) {
                const signal = abortController.signal;
                const branchSummarySettings = this.settingsManager.getBranchSummarySettings();
                const result = await generateBranchSummary(entriesToSummarize, {
                    ...(await this._getSummarizationRequestAuth(this.model, signal)),
                    signal,
                    customInstructions,
                    replaceInstructions,
                    reserveTokens: branchSummarySettings.reserveTokens,
                    streamFn: this.agent.streamFunction,
                    retry: this.settingsManager.getRetrySettings(),
                    callbacks: this._summarizationRetryCallbacks({ source: "branchSummary" }),
                });
                if (result.aborted) {
                    return { cancelled: true, aborted: true };
                }
                if (result.error) {
                    throw new Error(result.error);
                }
                summaryText = result.summary;
                summaryUsage = result.usage;
                summaryDetails = {
                    readFiles: result.readFiles || [],
                    modifiedFiles: result.modifiedFiles || [],
                };
            }
            else if (extensionSummary) {
                summaryText = extensionSummary.summary;
                summaryDetails = extensionSummary.details;
                summaryUsage = extensionSummary.usage;
            }
            // Determine the new leaf position based on target type
            let newLeafId;
            let editorText;
            if (targetEntry.type === "message" && targetEntry.message.role === "user") {
                // User message: leaf = parent (null if root), text goes to editor
                newLeafId = targetEntry.parentId;
                editorText = contentText(targetEntry.message.content, "");
            }
            else if (targetEntry.type === "custom_message") {
                // Custom message: leaf = parent (null if root), text goes to editor
                newLeafId = targetEntry.parentId;
                editorText = contentText(targetEntry.content, "");
            }
            else {
                // Non-user message: leaf = selected node
                newLeafId = targetId;
            }
            // Switch leaf (with or without summary)
            // Summary is attached at the navigation target position (newLeafId), not the old branch
            let summaryEntry;
            if (summaryText) {
                // Create summary at target position (can be null for root)
                const summaryId = this.sessionManager.branchWithSummary(newLeafId, summaryText, summaryDetails, fromExtension, summaryUsage);
                summaryEntry = this.sessionManager.getEntry(summaryId);
                // Attach label to the summary entry
                if (label) {
                    this.sessionManager.appendLabelChange(summaryId, label);
                }
            }
            else if (newLeafId === null) {
                // No summary, navigating to root - reset leaf
                this.sessionManager.resetLeaf();
            }
            else {
                // No summary, navigating to non-root
                this.sessionManager.branch(newLeafId);
            }
            // Attach label to target entry when not summarizing (no summary entry to label)
            if (label && !summaryText) {
                this.sessionManager.appendLabelChange(targetId, label);
            }
            // Update finalized context from the canonical session projection.
            this._refreshFinalizedContext();
            this._restoreToolsFromTranscript();
            // The selected context is installed; session_tree handlers may now prompt or navigate again.
            this._branchSummaryAbortController = undefined;
            await this._extensionRunner.emit({
                type: "session_tree",
                newLeafId: this.sessionManager.getLeafId(),
                oldLeafId,
                summaryEntry,
                fromExtension: summaryText ? fromExtension : undefined,
            });
            // Emit to custom tools
            return { editorText, cancelled: false, summaryEntry };
        }
        finally {
            // A navigation started from session_tree owns the controller now; do not clear it.
            if (this._branchSummaryAbortController === abortController) {
                this._branchSummaryAbortController = undefined;
            }
            this._resolveIdleWaitIfIdle();
        }
    }
    /**
     * Get all user messages from session for fork selector.
     */
    getUserMessagesForForking() {
        const entries = this.sessionManager.getEntries();
        const result = [];
        for (const entry of entries) {
            if (entry.type !== "message")
                continue;
            if (entry.message.role !== "user")
                continue;
            const text = contentText(entry.message.content, "");
            if (text) {
                result.push({ entryId: entry.id, text });
            }
        }
        return result;
    }
    /**
     * Get session statistics. Aggregates over ALL session entries (including
     * history that was compacted away), so token/cost totals reflect what was
     * actually billed across the session.
     */
    getSessionStats() {
        let userMessages = 0;
        let assistantMessages = 0;
        let toolResults = 0;
        let totalMessages = 0;
        let toolCalls = 0;
        const usageTotals = createUsageTotals();
        for (const entry of this.sessionManager.getEntries()) {
            if (entry.type === "usage") {
                addUsageToTotals(usageTotals, entry.usage);
            }
            else if (entry.type === "tool_completion" && entry.result.usage) {
                addUsageToTotals(usageTotals, entry.result.usage);
            }
            else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
                addUsageToTotals(usageTotals, entry.usage);
            }
            if (entry.type !== "message")
                continue;
            totalMessages++;
            const message = entry.message;
            if (message.role === "user") {
                userMessages++;
            }
            else if (message.role === "toolResult") {
                toolResults++;
                if (message.usage) {
                    addUsageToTotals(usageTotals, message.usage);
                }
            }
            else if (message.role === "assistant") {
                assistantMessages++;
                const assistantMsg = message;
                if (Array.isArray(assistantMsg.content)) {
                    toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
                }
                addUsageToTotals(usageTotals, assistantMsg.usage);
            }
        }
        return {
            sessionFile: this.sessionFile,
            sessionId: this.sessionId,
            userMessages,
            assistantMessages,
            toolCalls,
            toolResults,
            totalMessages,
            tokens: {
                input: usageTotals.input,
                output: usageTotals.output,
                cacheRead: usageTotals.cacheRead,
                cacheWrite: usageTotals.cacheWrite,
                total: usageTotals.input + usageTotals.output + usageTotals.cacheRead + usageTotals.cacheWrite,
            },
            cost: usageTotals.cost,
            contextUsage: this.getContextUsage(),
        };
    }
    getContextUsage() {
        const model = this._limitsModel();
        if (!model)
            return undefined;
        const contextWindow = model.contextWindow ?? 0;
        if (contextWindow <= 0)
            return undefined;
        // After compaction, the last assistant usage reflects pre-compaction context size.
        // We can only trust usage from an assistant that responded after the latest compaction.
        // If no such assistant exists, context token count is unknown until the next LLM response.
        const projection = this.sessionManager.buildSessionProjection();
        const branch = this.sessionManager.getBranch();
        const latestCompaction = getLatestCompactionEntry(branch);
        if (latestCompaction) {
            const projectedAssistants = new Set(projection.entries.flatMap((entry) => entry.messages.some((message) => message.role === "assistant" &&
                message.stopReason !== "aborted" &&
                message.stopReason !== "error" &&
                calculateContextTokens(message.usage) > 0)
                ? [entry.sourceEntry.id]
                : []));
            const compactionIndex = branch.findIndex((entry) => entry.id === latestCompaction.id);
            const hasPostCompactionUsage = branch
                .slice(compactionIndex + 1)
                .some((entry) => projectedAssistants.has(entry.id));
            if (!hasPostCompactionUsage)
                return { tokens: null, contextWindow, percent: null };
        }
        const estimate = estimateProjectedContextTokens(projection, branch);
        const percent = (estimate.tokens / contextWindow) * 100;
        return {
            tokens: estimate.tokens,
            contextWindow,
            percent,
        };
    }
    /**
     * Export session to HTML.
     * @param outputPath Optional output path (defaults to session directory)
     * @param options Optional export presentation settings
     * @returns Path to exported file
     */
    async exportToHtml(outputPath, options = {}) {
        const themeName = [options.themeName, this.settingsManager.getTheme()].find((candidate) => candidate !== undefined && getThemeByName(candidate) !== undefined);
        // Create tool renderer if we have an extension runner (for custom tool HTML rendering)
        const toolRenderer = createToolHtmlRenderer({
            getToolRenderers: (name) => this._extensionRunner.resolveToolRenderers(name, () => this.getToolDefinition(name)),
            theme,
            cwd: this.sessionManager.getCwd(),
        });
        return await exportSessionToHtml(this.sessionManager, this.state, {
            outputPath,
            themeName,
            toolRenderer,
        });
    }
    /**
     * Export the current session branch to a JSONL file.
     * Writes the session header followed by all entries on the current branch path.
     * @param outputPath Target file path. If omitted, generates a timestamped file in cwd.
     * @returns The resolved output file path.
     */
    exportToJsonl(outputPath) {
        return exportSessionToJsonl(this.sessionManager, outputPath);
    }
    /**
     * Ask the current model to describe what went wrong in this session for a bug report.
     * Used when the user declines to share the transcript itself.
     */
    async summarizeForBugReport(options) {
        const model = this.model;
        if (!model) {
            throw new Error("No model selected");
        }
        return generateBugReportSummary({
            ...(await this._getSummarizationRequestAuth(model, options.signal)),
            messages: this.messages,
            hint: options.hint,
            signal: options.signal,
            streamFn: this.agent.streamFunction,
            retry: this.settingsManager.getRetrySettings(),
            sessionId: this.sessionId,
        });
    }
    // =========================================================================
    // Utilities
    // =========================================================================
    /**
     * Get text content of the last assistant reply.
     * Useful for /copy command.
     * @returns Text content, or undefined if no assistant message exists or the last reply has no text
     */
    getLastAssistantText() {
        const lastAssistant = this.messages
            .slice()
            .reverse()
            .find((m) => {
            if (m.role !== "assistant")
                return false;
            const msg = m;
            // Skip messages without text from a turn that did not end normally: aborted, failed or only
            // calling tools (#12119). A reply that ended normally stays the last reply even without text.
            if (msg.stopReason !== "stop" && !msg.content.some((c) => c.type === "text" && c.text.trim()))
                return false;
            return true;
        });
        if (!lastAssistant)
            return undefined;
        let text = "";
        for (const content of lastAssistant.content) {
            if (content.type === "text") {
                text += content.text;
            }
        }
        return text.trim() || undefined;
    }
    // =========================================================================
    // Extension System
    // =========================================================================
    createReplacedSessionContext() {
        const context = Object.defineProperties({}, Object.getOwnPropertyDescriptors(this._extensionRunner.createCommandContext()));
        context.sendMessage = (message, options) => this.sendCustomMessage(message, options);
        context.sendUserMessage = (content, options) => this.sendUserMessage(content, options);
        return context;
    }
    /**
     * Check if extensions have handlers for a specific event type.
     */
    hasExtensionHandlers(eventType) {
        return this._extensionRunner.hasHandlers(eventType);
    }
    /**
     * Get the extension runner (for setting UI context and error handlers).
     */
    get extensionRunner() {
        return this._extensionRunner;
    }
}
