import { createInitialSystemMessage, getCurrentSystemMessage, getCurrentSystemPrompt, toToolDeclaration, } from "@earendil-works/pi-ai";
import { runAgentLoop, runAgentLoopContinue } from "./agent-loop.js";
import { getDefaultStreamFn } from "./stream-fn.js";
function defaultConvertToLlm(messages) {
    return messages.filter((message) => message.role === "system" ||
        message.role === "user" ||
        message.role === "assistant" ||
        message.role === "toolResult");
}
const EMPTY_USAGE = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const DEFAULT_MODEL = {
    id: "unknown",
    name: "unknown",
    api: "unknown",
    provider: "unknown",
    baseUrl: "",
    reasoning: false,
    input: [],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 0,
};
function createMutableAgentState(initialState) {
    let tools = initialState?.tools?.slice() ?? [];
    let messages = initialState?.messages?.slice() ?? [];
    const initialMessage = createInitialSystemMessage(initialState?.systemPrompt, tools.map(toToolDeclaration));
    if (messages[0]?.role !== "system" && initialMessage)
        messages.unshift(initialMessage);
    return {
        get systemPrompt() {
            return getCurrentSystemPrompt(messages);
        },
        model: initialState?.model ?? DEFAULT_MODEL,
        thinkingLevel: initialState?.thinkingLevel ?? "off",
        get tools() {
            return tools;
        },
        set tools(nextTools) {
            tools = nextTools.slice();
        },
        get messages() {
            return messages;
        },
        set messages(nextMessages) {
            messages = nextMessages.slice();
        },
        isStreaming: false,
        streamingMessage: undefined,
        pendingToolCalls: new Set(),
        errorMessage: undefined,
    };
}
class PendingMessageQueue {
    messages = [];
    mode;
    onRemoved;
    prioritizeUser;
    constructor(mode, onRemoved, prioritizeUser = false) {
        this.mode = mode;
        this.onRemoved = onRemoved;
        this.prioritizeUser = prioritizeUser;
    }
    enqueue(message) {
        this.messages.push(message);
    }
    hasItems() {
        return this.messages.length > 0;
    }
    peek() {
        if (this.mode === "all")
            return this.messages.slice();
        // A completion notification must not postpone explicit user steering by a turn.
        // Preserve FIFO within each class and keep the remaining messages queued.
        const first = (this.prioritizeUser && this.messages.find((message) => message.role === "user")) || this.messages[0];
        return first ? [first] : [];
    }
    drain() {
        const drained = this.peek();
        if (this.mode === "all")
            this.messages = [];
        else if (drained.length > 0)
            this.messages.splice(this.messages.indexOf(drained[0]), 1);
        if (drained.length > 0)
            this.onRemoved(drained);
        return drained;
    }
    contains(message) {
        return this.messages.includes(message);
    }
    replace(messages, replacement) {
        const index = this.messages.indexOf(messages[0]);
        if (messages.length === 0 ||
            index < 0 ||
            messages.some((message, offset) => this.messages[index + offset] !== message)) {
            return false;
        }
        this.messages.splice(index, messages.length, ...(replacement ? [replacement] : []));
        return true;
    }
    prepend(message) {
        this.messages.unshift(message);
    }
    clear() {
        const removed = this.messages;
        this.messages = [];
        if (removed.length > 0)
            this.onRemoved(removed);
    }
}
/**
 * Stateful wrapper around the low-level agent loop.
 *
 * `Agent` owns the current transcript, emits lifecycle events, executes tools,
 * and exposes queueing APIs for steering and follow-up messages.
 */
export class Agent {
    _state;
    listeners = new Set();
    steeringQueue;
    followUpQueue;
    queueRemovalListeners = new Set();
    convertToLlm;
    transformContext;
    streamFunction;
    getApiKey;
    onPayload;
    onResponse;
    onProviderStreamEvent;
    beforeToolCall;
    afterToolCall;
    finishTurn;
    prepareRequest;
    prepareNextTurn;
    prepareNextTurnWithContext;
    activeRun;
    /** Session identifier forwarded to providers for cache-aware backends. */
    sessionId;
    /** Optional per-level thinking token budgets forwarded to the stream function. */
    thinkingBudgets;
    /** Preferred transport forwarded to the stream function. */
    transport;
    /** Optional cap for provider-requested retry delays. */
    maxRetryDelayMs;
    /** Tool execution strategy for assistant messages that contain multiple tool calls. */
    toolExecution;
    /** Request identity forwarded to the stream function, over `DEFAULT_AGENT_IDENTITY`. */
    identity;
    constructor(options) {
        // Older compiled consumers may omit options or streamFn even though the current API requires them.
        const runtimeOptions = options ?? {};
        this._state = createMutableAgentState(runtimeOptions.initialState);
        this.convertToLlm = runtimeOptions.convertToLlm ?? defaultConvertToLlm;
        this.transformContext = runtimeOptions.transformContext;
        this.streamFunction = runtimeOptions.streamFn ?? getDefaultStreamFn();
        this.getApiKey = runtimeOptions.getApiKey;
        this.onPayload = runtimeOptions.onPayload;
        this.onResponse = runtimeOptions.onResponse;
        this.onProviderStreamEvent = runtimeOptions.onProviderStreamEvent;
        this.beforeToolCall = runtimeOptions.beforeToolCall;
        this.afterToolCall = runtimeOptions.afterToolCall;
        this.finishTurn = runtimeOptions.finishTurn;
        this.prepareRequest = runtimeOptions.prepareRequest;
        this.prepareNextTurn = runtimeOptions.prepareNextTurn;
        this.prepareNextTurnWithContext = runtimeOptions.prepareNextTurnWithContext;
        const onQueueRemoved = (messages) => {
            for (const listener of this.queueRemovalListeners)
                listener(messages);
        };
        this.steeringQueue = new PendingMessageQueue(runtimeOptions.steeringMode ?? "one-at-a-time", onQueueRemoved, true);
        this.followUpQueue = new PendingMessageQueue(runtimeOptions.followUpMode ?? "one-at-a-time", onQueueRemoved);
        this.sessionId = runtimeOptions.sessionId;
        this.thinkingBudgets = runtimeOptions.thinkingBudgets;
        this.transport = runtimeOptions.transport ?? "auto";
        this.maxRetryDelayMs = runtimeOptions.maxRetryDelayMs;
        this.toolExecution = runtimeOptions.toolExecution ?? "parallel";
        this.identity = runtimeOptions.identity;
    }
    /**
     * Subscribe to agent lifecycle events.
     *
     * Listener promises are awaited in subscription order and are included in
     * the current run's settlement. Listeners also receive the active abort
     * signal for the current run.
     *
     * `agent_end` is the final emitted event for a run, but the agent does not
     * become idle until all awaited listeners for that event have settled.
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    /**
     * Current agent state.
     *
     * Assigning `state.tools` or `state.messages` copies the provided top-level array.
     */
    get state() {
        return this._state;
    }
    /** Controls how queued steering messages are drained. */
    set steeringMode(mode) {
        this.steeringQueue.mode = mode;
    }
    get steeringMode() {
        return this.steeringQueue.mode;
    }
    /** Controls how queued follow-up messages are drained. */
    set followUpMode(mode) {
        this.followUpQueue.mode = mode;
    }
    get followUpMode() {
        return this.followUpQueue.mode;
    }
    /** Queue a message to be injected after the current assistant turn finishes. */
    steer(message) {
        this.steeringQueue.enqueue(message);
    }
    /** Queue a message to run only after the agent would otherwise stop. */
    followUp(message) {
        this.followUpQueue.enqueue(message);
    }
    /** Observe consumption or clearing synchronously, before asynchronous message events. */
    subscribeQueueRemoval(listener) {
        this.queueRemovalListeners.add(listener);
        return () => this.queueRemovalListeners.delete(listener);
    }
    /** Whether this exact message is still available for queue mutation. */
    isMessageQueued(message) {
        return this.steeringQueue.contains(message) || this.followUpQueue.contains(message);
    }
    /** Atomically replace consecutive pending messages from one queue, or leave both queues unchanged. */
    replaceQueuedMessages(messages, replacement) {
        return this.steeringQueue.replace(messages, replacement) || this.followUpQueue.replace(messages, replacement);
    }
    /** Restore an input whose preparation failed before its run started. */
    prependQueuedMessage(message, mode) {
        (mode === "steer" ? this.steeringQueue : this.followUpQueue).prepend(message);
    }
    /** Remove all queued steering messages. */
    clearSteeringQueue() {
        this.steeringQueue.clear();
    }
    /** Remove all queued follow-up messages. */
    clearFollowUpQueue() {
        this.followUpQueue.clear();
    }
    /** Remove all queued steering and follow-up messages. */
    clearAllQueues() {
        this.clearSteeringQueue();
        this.clearFollowUpQueue();
    }
    /** Returns true when either queue still contains pending messages. */
    hasQueuedMessages() {
        return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
    }
    /** Preview the messages selected for the next turn without consuming them. */
    peekQueuedMessages() {
        const steering = this.steeringQueue.peek();
        return steering.length > 0 ? steering : this.followUpQueue.peek();
    }
    /** Preview the first pending message and its delivery mode without consuming it. */
    peekNextQueuedMessage() {
        const steering = this.steeringQueue.peek()[0];
        if (steering)
            return { message: steering, mode: "steer" };
        const followUp = this.followUpQueue.peek()[0];
        return followUp ? { message: followUp, mode: "followUp" } : undefined;
    }
    /** Active abort signal for the current run, if any. */
    get signal() {
        return this.activeRun?.abortController.signal;
    }
    /** Abort the current run, if one is active. */
    abort() {
        this.activeRun?.abortController.abort();
    }
    /**
     * Resolve when the current run and all awaited event listeners have finished.
     *
     * This resolves after `agent_end` listeners settle.
     */
    waitForIdle() {
        return this.activeRun?.promise ?? Promise.resolve();
    }
    /** Clear conversation state and queues while retaining the replayed prompt/tool baseline. */
    reset() {
        if (this.activeRun) {
            throw new Error("Agent is already processing. Wait for completion before resetting.");
        }
        const baseline = getCurrentSystemMessage(this._state.messages);
        this._state.messages = baseline ? [baseline] : [];
        this._state.isStreaming = false;
        this._state.streamingMessage = undefined;
        this._state.pendingToolCalls = new Set();
        this._state.errorMessage = undefined;
        this.clearFollowUpQueue();
        this.clearSteeringQueue();
    }
    async prompt(input, images) {
        if (this.activeRun) {
            throw new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.");
        }
        const messages = this.normalizePromptInput(input, images);
        await this.runPromptMessages(messages);
    }
    /** Continue from the current transcript. The last message must be a user or tool-result message. */
    async continue() {
        if (this.activeRun) {
            throw new Error("Agent is already processing. Wait for completion before continuing.");
        }
        const lastMessage = this._state.messages[this._state.messages.length - 1];
        if (!lastMessage || this._state.messages.every((message) => message.role === "system")) {
            throw new Error("No messages to continue from");
        }
        if (lastMessage.role === "assistant") {
            const queuedSteering = this.steeringQueue.drain();
            if (queuedSteering.length > 0) {
                await this.runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });
                return;
            }
            const queuedFollowUps = this.followUpQueue.drain();
            if (queuedFollowUps.length > 0) {
                await this.runPromptMessages(queuedFollowUps);
                return;
            }
            throw new Error("Cannot continue from message role: assistant");
        }
        await this.runContinuation();
    }
    normalizePromptInput(input, images) {
        if (Array.isArray(input)) {
            return input;
        }
        if (typeof input !== "string") {
            return [input];
        }
        const content = [{ type: "text", text: input }];
        if (images && images.length > 0) {
            content.push(...images);
        }
        return [{ role: "user", content, timestamp: Date.now() }];
    }
    async runPromptMessages(messages, options = {}) {
        await this.runWithLifecycle(async (signal) => {
            await runAgentLoop(messages, this.createContextSnapshot(), this.createLoopConfig(options), (event) => this.processEvents(event), signal, this.streamFunction);
        });
    }
    async runContinuation() {
        await this.runWithLifecycle(async (signal) => {
            await runAgentLoopContinue(this.createContextSnapshot(), this.createLoopConfig(), (event) => this.processEvents(event), signal, this.streamFunction);
        });
    }
    createContextSnapshot() {
        return {
            messages: this._state.messages.slice(),
            tools: this._state.tools.slice(),
        };
    }
    createLoopConfig(options = {}) {
        let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;
        return {
            model: this._state.model,
            reasoning: this._state.thinkingLevel === "off" ? undefined : this._state.thinkingLevel,
            sessionId: this.sessionId,
            onPayload: this.onPayload,
            onResponse: this.onResponse,
            onProviderStreamEvent: this.onProviderStreamEvent,
            transport: this.transport,
            thinkingBudgets: this.thinkingBudgets,
            maxRetryDelayMs: this.maxRetryDelayMs,
            identity: this.identity,
            toolExecution: this.toolExecution,
            beforeToolCall: this.beforeToolCall,
            afterToolCall: this.afterToolCall,
            finishTurn: this.finishTurn,
            prepareRequest: this.prepareRequest,
            prepareNextTurn: this.prepareNextTurnWithContext || this.prepareNextTurn
                ? async (context) => {
                    if (this.prepareNextTurnWithContext) {
                        return await this.prepareNextTurnWithContext(context, this.signal);
                    }
                    return await this.prepareNextTurn?.(this.signal);
                }
                : undefined,
            convertToLlm: this.convertToLlm,
            transformContext: this.transformContext,
            getApiKey: this.getApiKey,
            getSteeringMessages: async () => {
                if (skipInitialSteeringPoll) {
                    skipInitialSteeringPoll = false;
                    return [];
                }
                return this.steeringQueue.drain();
            },
            getFollowUpMessages: async () => this.followUpQueue.drain(),
        };
    }
    async runWithLifecycle(executor) {
        if (this.activeRun) {
            throw new Error("Agent is already processing.");
        }
        const abortController = new AbortController();
        let resolvePromise = () => { };
        const promise = new Promise((resolve) => {
            resolvePromise = resolve;
        });
        this.activeRun = { promise, resolve: resolvePromise, abortController };
        this._state.isStreaming = true;
        this._state.streamingMessage = undefined;
        this._state.errorMessage = undefined;
        try {
            await executor(abortController.signal);
        }
        catch (error) {
            await this.handleRunFailure(error, abortController.signal.aborted);
        }
        finally {
            this.finishRun();
        }
    }
    async handleRunFailure(error, aborted) {
        const failureMessage = {
            role: "assistant",
            content: [{ type: "text", text: "" }],
            api: this._state.model.api,
            provider: this._state.model.provider,
            model: this._state.model.id,
            usage: EMPTY_USAGE,
            stopReason: aborted ? "aborted" : "error",
            errorMessage: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
        };
        await this.processEvents({ type: "message_start", message: failureMessage });
        await this.processEvents({ type: "message_end", message: failureMessage });
        await this.processEvents({ type: "turn_end", message: failureMessage, toolResults: [] });
        await this.processEvents({ type: "agent_end", messages: [failureMessage] });
    }
    finishRun() {
        this._state.isStreaming = false;
        this._state.streamingMessage = undefined;
        this._state.pendingToolCalls = new Set();
        this.activeRun?.resolve();
        this.activeRun = undefined;
    }
    /**
     * Reduce internal state for a loop event, then await listeners.
     *
     * `agent_end` only means no further loop events will be emitted. The run is
     * considered idle later, after all awaited listeners for `agent_end` finish
     * and `finishRun()` clears runtime-owned state.
     */
    async processEvents(event) {
        switch (event.type) {
            case "message_start":
                this._state.streamingMessage = event.message;
                break;
            case "message_update":
                this._state.streamingMessage = event.message;
                break;
            case "message_end":
                this._state.streamingMessage = undefined;
                this._state.messages.push(event.message);
                break;
            case "tool_execution_start": {
                const pendingToolCalls = new Set(this._state.pendingToolCalls);
                pendingToolCalls.add(event.toolCallId);
                this._state.pendingToolCalls = pendingToolCalls;
                break;
            }
            case "tool_execution_end": {
                const pendingToolCalls = new Set(this._state.pendingToolCalls);
                pendingToolCalls.delete(event.toolCallId);
                this._state.pendingToolCalls = pendingToolCalls;
                break;
            }
            case "turn_end":
                if (event.message.role === "assistant" && event.message.errorMessage) {
                    this._state.errorMessage = event.message.errorMessage;
                }
                break;
            case "agent_end":
                this._state.streamingMessage = undefined;
                break;
        }
        const signal = this.activeRun?.abortController.signal;
        if (!signal) {
            throw new Error("Agent listener invoked outside active run");
        }
        for (const listener of this.listeners) {
            await listener(event, signal);
        }
    }
}
