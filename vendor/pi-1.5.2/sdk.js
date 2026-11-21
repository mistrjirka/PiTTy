import { join } from "node:path";
import { Agent, setDefaultStreamFn } from "@earendil-works/pi-agent-core";
import { clampThinkingLevel, streamSimple } from "@earendil-works/pi-ai/compat";
import { getAgentDir } from "../config.js";
import { resolvePath } from "../utils/paths.js";
import { AgentSession, markRuntimeStreamFunction } from "./agent-session.js";
import { formatNoModelsAvailableMessage } from "./auth-guidance.js";
import { CacheWarmer } from "./cache-warmer.js";
import { getClientIdentity } from "./client-identity.js";
import { DEFAULT_THINKING_LEVEL } from "./defaults.js";
import { createToolNameMatcher } from "./mcp-servers.js";
import { convertToLlm } from "./messages.js";
import { findInitialModel } from "./model-resolver.js";
import { ModelRuntime } from "./model-runtime.js";
import { DefaultResourceLoader } from "./resource-loader.js";
import { getDefaultSessionDir, SessionManager } from "./session-manager.js";
import { applyToolModifiers, DEFAULT_TOOL_NAMES, getToolListError, isToolModifier, SettingsManager, } from "./settings-manager.js";
import { SideQuestionSnapshots } from "./side-questions.js";
import { time } from "./timings.js";
import { createBashTool, createCodingTools, createEditTool, createFindTool, createGrepTool, createLsTool, createPowerShellTool, createReadOnlyTools, createReadTool, createWriteTool, withFileMutationQueue, } from "./tools/index.js";
import { getBranchSelection } from "./virtual-models.js";
// Preserve the pre-0.81 fallback for extensions that construct Agent instances
// or invoke low-level agent loops without supplying streamFn. Agent core remains
// provider-agnostic and does not import pi-ai/compat itself.
setDefaultStreamFn(streamSimple);
// Re-exports
export * from "./agent-session-runtime.js";
export { withFileMutationQueue, 
// Tool factories (for custom cwd)
createCodingTools, createReadOnlyTools, createReadTool, createBashTool, createEditTool, createWriteTool, createGrepTool, createFindTool, createLsTool, createPowerShellTool, };
// Helper Functions
function getDefaultAgentDir() {
    return getAgentDir();
}
/**
 * Create an AgentSession with the specified options.
 *
 * @example
 * ```typescript
 * // Minimal - uses defaults
 * const { session } = await createAgentSession();
 *
 * // With explicit model
 * import { getModel } from '@earendil-works/pi-ai';
 * const { session } = await createAgentSession({
 *   model: getModel('anthropic', 'claude-opus-4-5'),
 *   thinkingLevel: 'high',
 * });
 *
 * // Continue previous session
 * const { session, modelFallbackMessage } = await createAgentSession({
 *   continueSession: true,
 * });
 *
 * // Full control
 * const loader = new DefaultResourceLoader({
 *   cwd: process.cwd(),
 *   agentDir: getAgentDir(),
 *   settingsManager: SettingsManager.create(),
 * });
 * await loader.reload();
 * const { session } = await createAgentSession({
 *   model: myModel,
 *   tools: ["read", "bash"],
 *   resourceLoader: loader,
 *   sessionManager: SessionManager.inMemory(),
 * });
 * ```
 */
export async function createAgentSession(options = {}) {
    const cwd = resolvePath(options.cwd ?? options.sessionManager?.getCwd() ?? process.cwd());
    const agentDir = options.agentDir ? resolvePath(options.agentDir) : getDefaultAgentDir();
    let resourceLoader = options.resourceLoader;
    const authPath = options.agentDir ? join(agentDir, "auth.json") : undefined;
    const modelsPath = options.agentDir ? join(agentDir, "models.json") : undefined;
    const modelRuntime = options.modelRuntime ?? (await ModelRuntime.create({ authPath, modelsPath }));
    const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
    const sessionManager = options.sessionManager ?? SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir));
    if (!resourceLoader) {
        resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
        await resourceLoader.reload();
        time("resourceLoader.reload");
    }
    // Check if session has existing data to restore
    const existingSession = sessionManager.buildSessionContext();
    const hasExistingSession = existingSession.messages.length > 0;
    const hasThinkingEntry = sessionManager.getBranch().some((entry) => entry.type === "thinking_level_change");
    let model = options.model;
    let modelFallbackMessage;
    // Assistant messages name the physical model that answered, so a virtual selection is only in
    // model_change entries.
    const sessionModel = getBranchSelection(sessionManager.getBranch(), (provider, modelId) => modelRuntime.getModel(provider, modelId));
    // If session has data, try to restore model from it
    if (!model && hasExistingSession && sessionModel) {
        const restoredModel = modelRuntime.getModel(sessionModel.provider, sessionModel.modelId);
        if (restoredModel && modelRuntime.hasConfiguredAuth(restoredModel.provider)) {
            model = restoredModel;
        }
        if (!model) {
            modelFallbackMessage = `Could not restore model ${sessionModel.provider}/${sessionModel.modelId}`;
        }
    }
    // If still no model, use findInitialModel (checks settings default, then provider defaults)
    if (!model) {
        const result = await findInitialModel({
            scopedModels: [],
            isContinuing: hasExistingSession,
            defaultProvider: settingsManager.getDefaultProvider(),
            defaultModelId: settingsManager.getDefaultModel(),
            defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
            modelThinkingLevels: settingsManager.getAllModelThinkingLevels(),
            modelRuntime,
        });
        model = result.model;
        if (!model) {
            modelFallbackMessage = formatNoModelsAvailableMessage();
        }
        else if (modelFallbackMessage) {
            modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
        }
    }
    let thinkingLevel = options.thinkingLevel;
    // If session has data, restore thinking level from it
    if (thinkingLevel === undefined && hasExistingSession) {
        thinkingLevel = hasThinkingEntry
            ? existingSession.thinkingLevel
            : (settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL);
    }
    // Fall back to per-model override, then global default
    if (thinkingLevel === undefined && model) {
        const perModel = settingsManager.getModelThinkingLevel(model.provider, model.id);
        if (perModel) {
            thinkingLevel = perModel;
        }
    }
    if (thinkingLevel === undefined) {
        thinkingLevel = settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
    }
    // Clamp to model capabilities
    if (!model) {
        thinkingLevel = "off";
    }
    else {
        thinkingLevel = clampThinkingLevel(model, thinkingLevel);
    }
    const toolListError = options.tools ? getToolListError(options.tools) : undefined;
    if (toolListError)
        throw new Error(`Invalid tools option: ${toolListError}`);
    const defaultToolNames = options.noTools ? [] : (settingsManager.getDefaultTools() ?? DEFAULT_TOOL_NAMES);
    // A `tools` list of only `+name`/`-name` entries changes the default selection instead of
    // replacing it, like the `defaultTools` setting.
    const toolModifiers = options.tools?.some(isToolModifier) ? options.tools : undefined;
    const selectedToolNames = toolModifiers ? applyToolModifiers(defaultToolNames, toolModifiers) : options.tools;
    const allowedToolNames = toolModifiers
        ? options.noTools === "all"
            ? selectedToolNames
            : undefined
        : (options.tools ?? (options.noTools === "all" ? [] : undefined));
    const excludedToolNames = options.excludeTools;
    const isExcludedTool = excludedToolNames ? createToolNameMatcher(excludedToolNames) : undefined;
    const initialActiveToolNames = (selectedToolNames ?? defaultToolNames).filter((name) => !isExcludedTool?.(name));
    // Create convertToLlm wrapper that filters images if blockImages is enabled (defense-in-depth)
    const convertToLlmWithBlockImages = (messages) => {
        const converted = convertToLlm(messages);
        // Check setting dynamically so mid-session changes take effect
        if (!settingsManager.getBlockImages()) {
            return converted;
        }
        // Filter out ImageContent from all messages, replacing with text placeholder
        return converted.map((msg) => {
            if (msg.role === "user" || msg.role === "toolResult") {
                const content = msg.content;
                if (Array.isArray(content)) {
                    const hasImages = content.some((c) => c.type === "image");
                    if (hasImages) {
                        const filteredContent = content
                            .map((c) => c.type === "image" ? { type: "text", text: "Image reading is disabled." } : c)
                            .filter((c, i, arr) => 
                        // Dedupe consecutive "Image reading is disabled." texts
                        !(c.type === "text" &&
                            c.text === "Image reading is disabled." &&
                            i > 0 &&
                            arr[i - 1].type === "text" &&
                            arr[i - 1].text === "Image reading is disabled."));
                        return { ...msg, content: filteredContent };
                    }
                }
            }
            return msg;
        });
    };
    const extensionRunnerRef = {};
    let sideQuestions;
    const cacheWarmer = new CacheWarmer(modelRuntime, sessionManager, () => settingsManager.getCacheWarmingMode(), async (event) => extensionRunnerRef.current?.emitCacheWarmingDecision(event) ?? event.action, {
        getMode: () => settingsManager.getCacheMaintenanceMode(),
        canCompact: () => session.canPrepareCacheCompaction,
        canWarm: (request) => !modelRuntime.getProvider(request.model.provider)?.sideQuestionUsesLiveContext,
        prepare: (signal) => session.prepareCacheCompaction(signal),
    });
    const buildRequestOptions = (options = {}) => {
        const providerRetrySettings = settingsManager.getProviderRetrySettings();
        const httpIdleTimeoutMs = settingsManager.getHttpIdleTimeoutMs();
        const effectiveTimeoutMs = httpIdleTimeoutMs === 0 ? 2147483647 : httpIdleTimeoutMs;
        const headerRunner = extensionRunnerRef.current;
        return {
            ...options,
            timeoutMs: options.timeoutMs ?? providerRetrySettings.timeoutMs ?? effectiveTimeoutMs,
            websocketConnectTimeoutMs: options.websocketConnectTimeoutMs ?? settingsManager.getWebSocketConnectTimeoutMs(),
            maxRetries: options.maxRetries ?? providerRetrySettings.maxRetries,
            maxRetryDelayMs: options.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
            // Replaces the agent loop's default identity; read per request so telemetry changes apply at once.
            identity: getClientIdentity(settingsManager),
            transformHeaders: async (headers) => headerRunner?.hasHandlers("before_provider_headers")
                ? headerRunner.emitBeforeProviderHeaders(headers)
                : headers,
        };
    };
    // Warm only requests for the selected model. Requests a virtual selection routed, or that an
    // extension redirected, may not be repeated by the next request, so warming them could be wasted.
    const cacheContextIsCurrent = (requestModel, captureId) => () => {
        const currentModel = agent.state.model;
        return (currentModel.provider === requestModel.provider &&
            currentModel.id === requestModel.id &&
            captureId !== undefined &&
            sideQuestions?.isRequestCurrent(captureId) === true);
    };
    const transformProviderPayload = async (payload) => {
        const runner = extensionRunnerRef.current;
        if (!runner?.hasHandlers("before_provider_request"))
            return payload;
        return runner.emitBeforeProviderRequest(payload);
    };
    const handleProviderResponse = async (response) => {
        const runner = extensionRunnerRef.current;
        if (!runner?.hasHandlers("after_provider_response"))
            return;
        await runner.emit({
            type: "after_provider_response",
            status: response.status,
            headers: response.headers,
        });
    };
    const handleProviderStreamEvent = async (data, model) => {
        const runner = extensionRunnerRef.current;
        if (!runner?.hasHandlers("provider_stream_event"))
            return;
        await runner.emit({
            data,
            type: "provider_stream_event",
            provider: model.provider,
            api: model.api,
            model: model.id,
        });
    };
    const agent = new Agent({
        initialState: {
            systemPrompt: "",
            model,
            thinkingLevel,
            tools: [],
            messages: existingSession.messages,
        },
        convertToLlm: convertToLlmWithBlockImages,
        streamFn: async (model, context, options) => {
            const requestOptions = buildRequestOptions(options);
            // Compaction and summaries use their own routing ids; only session requests
            // replace the cache entry, so warming restarts from them. Keep warming while
            // the current transcript still extends the request's prefix. Agent state may
            // shallow-copy the messages array or refresh the model object without changing
            // the provider request, so top-level object identity is not a valid cache key.
            if (options?.sessionId === sessionManager.getSessionId()) {
                const captureId = sideQuestions?.capture(model, context, requestOptions);
                const warmRequest = { model, context, options: requestOptions };
                cacheWarmer.start(warmRequest, cacheContextIsCurrent(model, captureId));
                const onProviderStreamEvent = requestOptions.onProviderStreamEvent;
                requestOptions.onProviderStreamEvent = async (data, responseModel) => {
                    // Custom providers report verified lifetime through the request-bound stream callback.
                    if (typeof data === "object" && data !== null && "type" in data && data.type === "prompt_cache_timing") {
                        const ttlMs = "ttlMs" in data ? data.ttlMs : undefined;
                        if (typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0) {
                            if (captureId !== undefined)
                                sideQuestions?.observeCacheTiming(captureId, ttlMs);
                            cacheWarmer.observeTiming(warmRequest, ttlMs);
                        }
                    }
                    await onProviderStreamEvent?.(data, responseModel);
                };
            }
            return modelRuntime.streamSimple(model, context, requestOptions);
        },
        onPayload: transformProviderPayload,
        onResponse: handleProviderResponse,
        onProviderStreamEvent: handleProviderStreamEvent,
        sessionId: sessionManager.getSessionId(),
        transformContext: async (messages) => {
            const runner = extensionRunnerRef.current;
            if (!runner)
                return messages;
            return runner.emitContext(messages);
        },
        steeringMode: settingsManager.getSteeringMode(),
        followUpMode: settingsManager.getFollowUpMode(),
        transport: settingsManager.getTransport(),
        thinkingBudgets: settingsManager.getThinkingBudgets(),
        maxRetryDelayMs: settingsManager.getProviderRetrySettings().maxRetryDelayMs,
    });
    // This stream resolves auth through modelRuntime, so summaries must not pre-resolve it (#11520).
    markRuntimeStreamFunction(agent.streamFunction, modelRuntime);
    // Restore missing settings metadata for older sessions.
    if (hasExistingSession) {
        if (!hasThinkingEntry) {
            sessionManager.appendThinkingLevelChange(thinkingLevel);
        }
    }
    else {
        // Save initial model and thinking level for new sessions so they can be restored on resume
        if (model) {
            sessionManager.appendModelChange(model.provider, model.id);
        }
        sessionManager.appendThinkingLevelChange(thinkingLevel);
    }
    const session = new AgentSession({
        agent,
        sessionManager,
        settingsManager,
        cwd,
        scopedModels: options.scopedModels,
        resourceLoader,
        customTools: options.customTools,
        modelRuntime,
        cacheWarmer,
        initialActiveToolNames,
        usesDefaultTools: (options.tools === undefined || toolModifiers !== undefined) && !options.noTools,
        defaultToolModifiers: toolModifiers,
        allowedToolNames,
        excludedToolNames,
        extensionRunnerRef,
        sessionStartEvent: options.sessionStartEvent,
    });
    sideQuestions = new SideQuestionSnapshots({
        agent,
        sessionManager,
        modelRuntime,
        getExtensionRunner: () => extensionRunnerRef.current,
        getSystemPrompt: () => session.systemPrompt,
        buildOptions: buildRequestOptions,
    });
    const extensionsResult = resourceLoader.getExtensions();
    return {
        session,
        extensionsResult,
        modelFallbackMessage,
    };
}
