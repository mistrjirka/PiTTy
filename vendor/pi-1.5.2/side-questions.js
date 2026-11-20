import { normalizeContext, toToolDeclaration, } from "@earendil-works/pi-ai";
import { isVirtualModel } from "./virtual-models.js";
const sources = new WeakMap();
/** Capture final main requests and provide isolated, completed-context side-question snapshots. */
export class SideQuestionSnapshots {
    source;
    captured;
    constructor(source) {
        this.source = source;
        sources.set(source.sessionManager, this);
    }
    capture(model, context, options) {
        const { agent, sessionManager } = this.source;
        this.captured = {
            sessionId: sessionManager.getSessionId(),
            selectedModel: agent.state.model,
            model,
            thinkingLevel: agent.state.thinkingLevel,
            runner: this.source.getExtensionRunner(),
            leafId: sessionManager.getLeafId(),
            // Completed request messages are immutable. Clone only when a side question asks for them.
            context: normalizeContext(context),
            options: copyRequestOptions(options),
        };
    }
    async get(options = {}) {
        options.signal?.throwIfAborted();
        const { agent, sessionManager, modelRuntime } = this.source;
        const sessionId = sessionManager.getSessionId();
        const selection = agent.state.model;
        if (!selection)
            throw new Error("Select a model before asking a side question.");
        const runner = this.source.getExtensionRunner();
        const projection = sessionManager.buildSessionProjection();
        const captured = this.captured;
        const tailStart = captured ? extendingTailIndex(captured.leafId, projection) : undefined;
        const reusable = captured?.sessionId === sessionId &&
            sameModel(captured.selectedModel, selection) &&
            captured.thinkingLevel === agent.state.thinkingLevel &&
            captured.runner === runner &&
            tailStart !== undefined;
        const model = reusable ? captured.model : selection;
        if (isVirtualModel(model)) {
            throw new Error("Run a normal turn with the selected virtual model before asking a side question.");
        }
        const provider = modelRuntime.getProvider(model.provider);
        if (!provider?.streamSideQuestion) {
            throw new Error(`Provider "${model.provider}" does not support safe side questions.`);
        }
        const requestOptions = reusable
            ? copyRequestOptions(captured.options)
            : copyRequestOptions(this.source.buildOptions({
                sessionId,
                reasoning: agent.state.thinkingLevel === "off" ? undefined : agent.state.thinkingLevel,
                thinkingBudgets: agent.thinkingBudgets,
                transport: agent.transport,
                maxRetryDelayMs: agent.maxRetryDelayMs,
            }));
        requestOptions.sessionId = sessionId;
        requestOptions.signal = options.signal;
        requestOptions.disableContinuation = true;
        // An SDK-native aside uses the provider's already transformed live query. Replaying context
        // hooks or requiring a local transcript capture would reject a safe capability unnecessarily.
        if (provider.sideQuestionUsesLiveContext) {
            // Boundary edits can change Pi history without notifying the provider's live query.
            if (captured?.sessionId === sessionId && !reusable) {
                throw new Error("The live provider context is stale after this session change. Run a normal turn before asking a side question.");
            }
            return {
                sessionId,
                model: structuredClone(model),
                context: normalizeContext({ messages: [] }),
                options: requestOptions,
                source: "native-live",
                pendingMessagesOmitted: false,
            };
        }
        if (runner?.hasHandlers("before_provider_request") || runner?.hasHandlers("before_provider_headers")) {
            throw new Error("Side questions cannot safely replay custom provider payload or header hooks. Use a provider with a native side-question capability.");
        }
        if (reusable) {
            const tail = projection.entries.slice(tailStart).flatMap((entry) => entry.messages);
            const complete = completedMessages(tail);
            // A completed answer belongs to the captured request. Other uncaptured contributions may
            // need context hooks, so never append them by bypassing that pipeline.
            if (complete.every((message) => message.role === "assistant")) {
                const converted = await agent.convertToLlm(structuredClone(complete));
                options.signal?.throwIfAborted();
                if (sessionId !== sessionManager.getSessionId() || !sameModel(selection, agent.state.model)) {
                    throw new Error("The session changed while preparing the side question. Ask again in the current session.");
                }
                return {
                    sessionId,
                    model: structuredClone(model),
                    context: normalizeContext({ messages: [...structuredClone(captured.context.messages), ...converted] }),
                    options: requestOptions,
                    source: "request-prefix",
                    pendingMessagesOmitted: complete.length !== tail.length || agent.state.streamingMessage !== undefined,
                };
            }
        }
        if (runner?.hasHandlers("context") || runner?.hasHandlers("context_with_system")) {
            throw new Error("A fresh safe context is not available after this session change. Run a normal turn before asking a side question.");
        }
        let messages = structuredClone(completedMessages(projection.messages));
        const pendingMessagesOmitted = messages.length !== projection.messages.length || agent.state.streamingMessage !== undefined;
        // Old conversations can predate transcript system messages. Apply the same current prompt
        // and declarations, then the core-only projections, without writing a migration entry.
        if (messages[0]?.role !== "system") {
            messages.unshift({
                role: "system",
                content: this.source.getSystemPrompt(),
                toolsAdded: agent.state.tools.map(toToolDeclaration),
                timestamp: Date.now(),
            });
        }
        if (agent.transformContext)
            messages = await agent.transformContext(messages, options.signal);
        const converted = await agent.convertToLlm(messages);
        options.signal?.throwIfAborted();
        if (sessionId !== sessionManager.getSessionId() || !sameModel(selection, agent.state.model)) {
            throw new Error("The session changed while preparing the side question. Ask again in the current session.");
        }
        return {
            sessionId,
            model: structuredClone(model),
            context: normalizeContext({ messages: converted }),
            options: requestOptions,
            source: "current-session",
            pendingMessagesOmitted,
        };
    }
}
/** Read the SDK-owned snapshot source without exposing main-session mutation APIs. */
export function getSideQuestionSnapshot(sessionManager, options) {
    const source = sources.get(sessionManager);
    if (!source) {
        return Promise.reject(new Error("Side-question snapshots are not available in this session host. Update the Pi fork."));
    }
    return source.get(options);
}
function sameModel(left, right) {
    return (left.provider === right.provider &&
        left.id === right.id &&
        left.api === right.api &&
        left.baseUrl === right.baseUrl);
}
function extendingTailIndex(leafId, projection) {
    const index = leafId === null ? -1 : projection.entries.findIndex((entry) => entry.sourceEntry.id === leafId);
    if (leafId !== null && index < 0)
        return undefined;
    const tail = projection.entries.slice(index + 1);
    if (tail.some((entry) => entry.sourceEntry.type === "context_edit" || entry.sourceEntry.type === "compaction"))
        return undefined;
    return index + 1;
}
/** Keep complete tool batches together and leave unfinished or failed terminal output out. */
function completedMessages(messages) {
    let stableEnd = 0;
    const pending = new Set();
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (message.role === "assistant") {
            if (pending.size > 0)
                break;
            if (index === messages.length - 1 && (message.stopReason === "error" || message.stopReason === "aborted"))
                break;
            for (const part of message.content) {
                if (part.type === "toolCall")
                    pending.add(part.id);
            }
        }
        else if (message.role === "toolResult") {
            pending.delete(message.toolCallId);
        }
        else if (pending.size > 0) {
            break;
        }
        if (pending.size === 0)
            stableEnd = index + 1;
    }
    return messages.slice(0, stableEnd);
}
/** Copy provider options only. Main-loop callbacks and its abort signal must never reach an aside. */
function copyRequestOptions(options) {
    return {
        apiKey: options.apiKey,
        fetch: options.fetch,
        env: options.env && { ...options.env },
        headers: options.headers && { ...options.headers },
        identity: options.identity && structuredClone(options.identity),
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
        maxRetryDelayMs: options.maxRetryDelayMs,
        temperature: options.temperature,
        samplingParams: options.samplingParams && structuredClone(options.samplingParams),
        maxTokens: options.maxTokens,
        transport: options.transport,
        cacheRetention: options.cacheRetention,
        sessionId: options.sessionId,
        disableContinuation: true,
        websocketConnectTimeoutMs: options.websocketConnectTimeoutMs,
        metadata: options.metadata && structuredClone(options.metadata),
        toolChoice: options.toolChoice && structuredClone(options.toolChoice),
        reasoning: options.reasoning,
        thinkingBudgets: options.thinkingBudgets && { ...options.thinkingBudgets },
    };
}
