/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */
import { EventStream, getCurrentTools, getToolStateChanges, mergeClientIdentity, normalizeContext, PI_ATTRIBUTION, toToolDeclaration, validateToolArguments, } from "@earendil-works/pi-ai";
import { getDefaultStreamFn } from "./stream-fn.js";
/**
 * Request identity of agent loops: pi-ai's defaults with provider attribution to pi. `AgentLoopConfig.identity`
 * overrides it field by field.
 */
export const DEFAULT_AGENT_IDENTITY = { attribution: PI_ATTRIBUTION };
/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(prompts, context, config, signal, streamFn) {
    const stream = createAgentStream();
    void runAgentLoop(prompts, context, config, async (event) => {
        stream.push(event);
    }, signal, streamFn).then((messages) => {
        stream.end(messages);
    });
    return stream;
}
/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export function agentLoopContinue(context, config, signal, streamFn) {
    if (context.messages.length === 0) {
        throw new Error("Cannot continue: no messages in context");
    }
    if (context.messages[context.messages.length - 1].role === "assistant") {
        throw new Error("Cannot continue from message role: assistant");
    }
    const stream = createAgentStream();
    void runAgentLoopContinue(context, config, async (event) => {
        stream.push(event);
    }, signal, streamFn).then((messages) => {
        stream.end(messages);
    });
    return stream;
}
export async function runAgentLoop(prompts, context, config, emit, signal, streamFn) {
    const initialMessages = declareToolChanges(context, prompts);
    const newMessages = [...initialMessages];
    const currentContext = {
        ...context,
        messages: [...context.messages, ...initialMessages],
    };
    await emit({ type: "agent_start" });
    await emit({ type: "turn_start" });
    for (const message of initialMessages) {
        await emit({ type: "message_start", message });
        await emit({ type: "message_end", message });
    }
    await runLoop(currentContext, newMessages, config, signal, emit, streamFn ?? getDefaultStreamFn());
    return newMessages;
}
export async function runAgentLoopContinue(context, config, emit, signal, streamFn) {
    if (context.messages.length === 0) {
        throw new Error("Cannot continue: no messages in context");
    }
    if (context.messages[context.messages.length - 1].role === "assistant") {
        throw new Error("Cannot continue from message role: assistant");
    }
    const newMessages = [];
    const currentContext = { ...context };
    await emit({ type: "agent_start" });
    await emit({ type: "turn_start" });
    await runLoop(currentContext, newMessages, config, signal, emit, streamFn ?? getDefaultStreamFn());
    return newMessages;
}
function createAgentStream() {
    return new EventStream((event) => event.type === "agent_end", (event) => (event.type === "agent_end" ? event.messages : []));
}
/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(initialContext, newMessages, initialConfig, signal, emit, streamFunction) {
    let currentContext = initialContext;
    let config = initialConfig;
    let lastCompletedTurn;
    let explicitContinuation = false;
    // Check for steering messages at start (user may have typed while waiting)
    let pendingMessages = (await config.getSteeringMessages?.()) || [];
    // Outer loop: continues when queued follow-up messages arrive after agent would stop
    while (true) {
        let hasMoreToolCalls = true;
        // Inner loop: process tool calls and steering messages
        while (hasMoreToolCalls || pendingMessages.length > 0) {
            let preparedMessages = [];
            if (lastCompletedTurn) {
                const nextTurnSnapshot = await config.prepareNextTurn?.(lastCompletedTurn);
                if (nextTurnSnapshot) {
                    currentContext = nextTurnSnapshot.context ?? currentContext;
                    preparedMessages = nextTurnSnapshot.messages ?? [];
                    config = {
                        ...config,
                        model: nextTurnSnapshot.model ?? config.model,
                        reasoning: nextTurnSnapshot.thinkingLevel === undefined
                            ? config.reasoning
                            : nextTurnSnapshot.thinkingLevel === "off"
                                ? undefined
                                : nextTurnSnapshot.thinkingLevel,
                    };
                }
                // Preparation can be long-running (for example, compaction). Pick up steering
                // queued while it ran. Only poll again if the earlier poll returned nothing;
                // otherwise one-at-a-time mode would deliver two messages in this turn.
                if (pendingMessages.length === 0) {
                    pendingMessages = (await config.getSteeringMessages?.()) || [];
                }
                await emit({ type: "turn_start" });
            }
            // Process prepared and queued messages before the next assistant response.
            for (const message of declareToolChanges(currentContext, [...preparedMessages, ...pendingMessages])) {
                await emit({ type: "message_start", message });
                await emit({ type: "message_end", message });
                currentContext.messages.push(message);
                newMessages.push(message);
            }
            pendingMessages = [];
            const requestUpdate = await config.prepareRequest?.({
                context: currentContext,
                model: config.model,
                thinkingLevel: config.reasoning ?? "off",
            }, signal);
            if (requestUpdate) {
                currentContext = requestUpdate.context ?? currentContext;
                config = {
                    ...config,
                    model: requestUpdate.model ?? config.model,
                    reasoning: requestUpdate.thinkingLevel === undefined
                        ? config.reasoning
                        : requestUpdate.thinkingLevel === "off"
                            ? undefined
                            : requestUpdate.thinkingLevel,
                };
            }
            // Stream assistant response
            const { message, interrupted } = await streamAssistantResponse(currentContext, config, signal, emit, streamFunction);
            newMessages.push(message);
            if (interrupted) {
                lastCompletedTurn = { message, toolResults: [], context: currentContext, newMessages };
                const decision = await config.finishTurn?.(lastCompletedTurn, signal);
                await emit({ type: "turn_end", message, toolResults: [] });
                if (signal?.aborted || decision?.action === "end") {
                    await emit({ type: "agent_end", messages: newMessages });
                    return;
                }
                pendingMessages = (await config.getSteeringMessages?.()) || [];
                hasMoreToolCalls = false;
                continue;
            }
            if (message.stopReason === "error" || message.stopReason === "aborted") {
                lastCompletedTurn = {
                    message,
                    toolResults: [],
                    context: currentContext,
                    newMessages,
                };
                await config.finishTurn?.(lastCompletedTurn, signal);
                await emit({ type: "turn_end", message, toolResults: [] });
                await emit({ type: "agent_end", messages: newMessages });
                return;
            }
            // Check for tool calls
            const toolCalls = message.content.filter((c) => c.type === "toolCall");
            const toolResults = [];
            hasMoreToolCalls = false;
            if (toolCalls.length > 0) {
                // A "length" stop means the output was cut off by the token limit, so
                // every tool call in the message may carry truncated arguments. Fail
                // them all instead of executing potentially borked calls.
                const executedToolBatch = message.stopReason === "length"
                    ? await failToolCallsFromTruncatedMessage(toolCalls, emit)
                    : await executeToolCalls(currentContext, message, config, signal, emit);
                toolResults.push(...executedToolBatch.messages);
                hasMoreToolCalls = !executedToolBatch.terminate;
                for (const result of toolResults) {
                    currentContext.messages.push(result);
                    newMessages.push(result);
                }
            }
            lastCompletedTurn = {
                message,
                toolResults,
                context: currentContext,
                newMessages,
            };
            const decision = await config.finishTurn?.(lastCompletedTurn, signal);
            await emit({ type: "turn_end", message, toolResults });
            if (decision?.action === "end") {
                await emit({ type: "agent_end", messages: newMessages });
                return;
            }
            explicitContinuation = decision?.action === "continue";
            pendingMessages = (await config.getSteeringMessages?.()) || [];
            if (hasMoreToolCalls || pendingMessages.length > 0) {
                explicitContinuation = false;
            }
        }
        // Agent would stop here. Check for follow-up messages.
        const followUpMessages = (await config.getFollowUpMessages?.()) || [];
        if (followUpMessages.length > 0) {
            // Set as pending so inner loop processes them
            explicitContinuation = false;
            pendingMessages = followUpMessages;
            continue;
        }
        // No natural request was selected, so fulfill the continuation decision with one context-only turn.
        if (explicitContinuation) {
            explicitContinuation = false;
            continue;
        }
        // No more messages, exit
        break;
    }
    await emit({ type: "agent_end", messages: newMessages });
}
/**
 * Declare tool loadout changes to the model.
 *
 * `context.tools` is what the runtime can execute; the transcript's system messages declare
 * what the model may call. Before each request the difference becomes `toolsAdded` and
 * `toolsRemoved` on a system message. When a pending system message exists, its tool fields
 * are treated as intent and replaced with the delta between the committed transcript and
 * the executable set, so replay always yields exactly `context.tools`. Otherwise a new
 * system message is inserted before the first non-system pending message.
 */
function declareToolChanges(context, pendingMessages) {
    let systemIndex = -1;
    for (let i = pendingMessages.length - 1; i >= 0; i--) {
        if (pendingMessages[i].role === "system") {
            systemIndex = i;
            break;
        }
    }
    const pending = pendingMessages[systemIndex];
    const baseline = pending
        ? pendingMessages.map((message, index) => index === systemIndex ? withToolChanges(pending, NO_CHANGES) : message)
        : pendingMessages;
    const changes = getToolStateChanges(getCurrentTools([...context.messages, ...baseline]), (context.tools ?? []).map(toToolDeclaration));
    const unchanged = changes.toolsAdded.length === 0 && changes.toolsRemoved.length === 0;
    if (pending) {
        // Keep the caller's message object when it already declares no tool changes.
        if (unchanged && !pending.toolsAdded?.length && !pending.toolsRemoved?.length)
            return pendingMessages;
        return baseline.map((message, index) => (index === systemIndex ? withToolChanges(pending, changes) : message));
    }
    if (unchanged)
        return pendingMessages;
    const update = withToolChanges({ role: "system", content: "", timestamp: Date.now() }, changes);
    const insertIndex = pendingMessages.findIndex((message) => message.role !== "system");
    const index = insertIndex === -1 ? pendingMessages.length : insertIndex;
    return [...pendingMessages.slice(0, index), update, ...pendingMessages.slice(index)];
}
const NO_CHANGES = { toolsAdded: [], toolsRemoved: [] };
/** Copy a system message with its tool fields replaced by `changes`; empty lists omit the field. */
function withToolChanges(message, { toolsAdded, toolsRemoved }) {
    const { toolsAdded: _added, toolsRemoved: _removed, ...rest } = message;
    return {
        ...rest,
        ...(toolsAdded.length > 0 ? { toolsAdded } : {}),
        ...(toolsRemoved.length > 0 ? { toolsRemoved } : {}),
    };
}
/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 */
async function streamAssistantResponse(context, config, signal, emit, streamFunction) {
    const steeringSignal = config.getUserSteeringSignal?.();
    const requestSignal = steeringSignal && signal ? AbortSignal.any([steeringSignal, signal]) : (steeringSignal ?? signal);
    const steeringError = new Error("Response interrupted by user steering");
    let rejectSteering = (_error) => { };
    const steering = new Promise((_resolve, reject) => {
        rejectSteering = reject;
    });
    let response;
    const onSteering = () => {
        response?.end();
        rejectSteering(steeringError);
    };
    steeringSignal?.addEventListener("abort", onSteering, { once: true });
    const wait = (promise) => Promise.race([promise, steering]);
    let partialMessage = null;
    let addedPartial = false;
    const finish = async (message, interrupted) => {
        message.thinkingLevel = config.reasoning ?? "off";
        if (addedPartial) {
            context.messages[context.messages.length - 1] = message;
        }
        else {
            context.messages.push(message);
            await emit({ type: "message_start", message: { ...message } });
        }
        await emit({ type: "message_end", message });
        return { message, interrupted };
    };
    try {
        // The signal is reset at queue drain, so input accepted during request preparation is not lost.
        if (steeringSignal?.aborted)
            throw steeringError;
        let messages = context.messages;
        if (config.transformContext) {
            messages = await wait(config.transformContext(messages, requestSignal));
        }
        const llmMessages = await wait(Promise.resolve(config.convertToLlm(messages)));
        const llmContext = normalizeContext({ messages: llmMessages });
        const resolvedApiKey = (config.getApiKey ? await wait(Promise.resolve(config.getApiKey(config.model.provider))) : undefined) ||
            config.apiKey;
        // Do not submit a request if input arrived while an asynchronous context/auth hook was running.
        if (steeringSignal?.aborted)
            throw steeringError;
        const opening = Promise.resolve(streamFunction(config.model, llmContext, {
            ...config,
            apiKey: resolvedApiKey,
            identity: mergeClientIdentity(DEFAULT_AGENT_IDENTITY, config.identity),
            signal: requestSignal,
        }));
        // A provider may finish opening after cancellation. Close its consumer without waiting for it.
        void opening.then((stream) => {
            if (steeringSignal?.aborted)
                stream.end();
        }, () => { });
        response = await wait(opening);
        const iterator = response[Symbol.asyncIterator]();
        while (true) {
            const next = await iterator.next();
            // Provider events can already be buffered when cancellation wins. None may launch tools.
            if (steeringSignal?.aborted && !signal?.aborted)
                throw steeringError;
            if (next.done)
                break;
            const event = next.value;
            switch (event.type) {
                case "start":
                    partialMessage = event.partial;
                    context.messages.push(partialMessage);
                    addedPartial = true;
                    await emit({ type: "message_start", message: { ...partialMessage } });
                    break;
                case "text_start":
                case "text_delta":
                case "text_end":
                case "thinking_start":
                case "thinking_delta":
                case "thinking_end":
                case "toolcall_start":
                case "toolcall_delta":
                case "toolcall_end":
                    if (partialMessage) {
                        partialMessage = event.partial;
                        context.messages[context.messages.length - 1] = partialMessage;
                        await emit({
                            type: "message_update",
                            assistantMessageEvent: event,
                            message: { ...partialMessage },
                        });
                    }
                    break;
                case "done":
                case "error":
                    return finish(await wait(response.result()), false);
            }
        }
        return finish(await wait(response.result()), false);
    }
    catch (error) {
        if (error !== steeringError && !steeringSignal?.aborted)
            throw error;
        // Providers mutate their partial message while streaming. Snapshot before ending the consumer.
        const completed = response ? await Promise.race([response.result(), Promise.resolve(undefined)]) : undefined;
        const message = structuredClone(completed ??
            partialMessage ?? {
            role: "assistant",
            content: [],
            api: config.model.api,
            provider: config.model.provider,
            model: config.model.id,
            usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "aborted",
            timestamp: Date.now(),
        });
        message.stopReason = "aborted";
        message.content = message.content.filter((part) => part.type !== "toolCall");
        if (signal?.aborted)
            message.errorMessage = "Operation aborted";
        else
            delete message.errorMessage;
        response?.end(message);
        return finish(message, !signal?.aborted);
    }
    finally {
        steeringSignal?.removeEventListener("abort", onSteering);
    }
}
/**
 * Fail all tool calls from an assistant message that was truncated by the
 * output token limit. Streamed tool-call arguments are finalized with a
 * best-effort JSON salvage parser, so a truncated message can yield tool calls
 * whose arguments parse and validate but are silently incomplete. None of them
 * are safe to execute; report each as an error so the model can re-issue them.
 */
async function failToolCallsFromTruncatedMessage(toolCalls, emit) {
    const messages = [];
    for (const toolCall of toolCalls) {
        await emit({
            type: "tool_execution_start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
        });
        const finalized = {
            toolCall,
            result: createErrorToolResult(`Tool call "${toolCall.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`),
            isError: true,
        };
        await emitToolExecutionEnd(finalized, emit);
        const toolResultMessage = createToolResultMessage(finalized);
        await emitToolResultMessage(toolResultMessage, emit);
        messages.push(toolResultMessage);
    }
    return { messages, terminate: false };
}
/**
 * Execute tool calls from an assistant message.
 */
async function executeToolCalls(currentContext, assistantMessage, config, signal, emit) {
    const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
    const hasSequentialToolCall = toolCalls.some((tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential");
    if (config.toolExecution === "sequential" || hasSequentialToolCall) {
        return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
    }
    return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}
async function executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit) {
    const finalizedCalls = [];
    const messages = [];
    for (const toolCall of toolCalls) {
        await emit({
            type: "tool_execution_start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
        });
        const preparation = await prepareToolCallForTurn(currentContext, assistantMessage, toolCall, config, signal);
        let finalized;
        if (preparation.kind === "immediate") {
            finalized = {
                toolCall,
                result: preparation.result,
                isError: preparation.isError,
            };
        }
        else {
            const executed = await executePreparedToolCall(preparation, signal, emitToolExecutionUpdate(toolCall, emit));
            finalized = await finalizeExecutedToolCall(currentContext, assistantMessage, preparation, executed, config, signal);
        }
        await emitToolExecutionEnd(finalized, emit);
        const toolResultMessage = createToolResultMessage(finalized);
        await emitToolResultMessage(toolResultMessage, emit);
        finalizedCalls.push(finalized);
        messages.push(toolResultMessage);
    }
    return {
        messages,
        terminate: shouldTerminateToolBatch(finalizedCalls),
    };
}
async function executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit) {
    const finalizedCalls = [];
    for (const toolCall of toolCalls) {
        await emit({
            type: "tool_execution_start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
        });
        const preparation = await prepareToolCallForTurn(currentContext, assistantMessage, toolCall, config, signal);
        if (preparation.kind === "immediate") {
            const finalized = {
                toolCall,
                result: preparation.result,
                isError: preparation.isError,
            };
            await emitToolExecutionEnd(finalized, emit);
            finalizedCalls.push(finalized);
            continue;
        }
        finalizedCalls.push(async () => {
            if (config.hasPendingUserSteering?.() && !signal?.aborted) {
                const finalized = { toolCall, result: skippedForUserSteering(), isError: true };
                await emitToolExecutionEnd(finalized, emit);
                return finalized;
            }
            if (signal?.aborted) {
                const finalized = {
                    toolCall,
                    result: createErrorToolResult("Operation aborted"),
                    isError: true,
                };
                await emitToolExecutionEnd(finalized, emit);
                return finalized;
            }
            const executed = await executePreparedToolCall(preparation, signal, emitToolExecutionUpdate(toolCall, emit));
            const finalized = await finalizeExecutedToolCall(currentContext, assistantMessage, preparation, executed, config, signal);
            await emitToolExecutionEnd(finalized, emit);
            return finalized;
        });
    }
    const orderedFinalizedCalls = await Promise.all(finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))));
    const messages = [];
    for (const finalized of orderedFinalizedCalls) {
        const toolResultMessage = createToolResultMessage(finalized);
        await emitToolResultMessage(toolResultMessage, emit);
        messages.push(toolResultMessage);
    }
    return {
        messages,
        terminate: shouldTerminateToolBatch(orderedFinalizedCalls),
    };
}
function shouldTerminateToolBatch(finalizedCalls) {
    return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true);
}
function prepareToolCallArguments(tool, toolCall) {
    if (!tool.prepareArguments) {
        return toolCall;
    }
    const preparedArguments = tool.prepareArguments(toolCall.arguments);
    if (preparedArguments === toolCall.arguments) {
        return toolCall;
    }
    return {
        ...toolCall,
        arguments: preparedArguments,
    };
}
function skippedForUserSteering() {
    return {
        content: [
            {
                type: "text",
                text: "Not executed: new user input arrived. Review that input before deciding whether this call is still needed.",
            },
        ],
        details: {},
    };
}
async function prepareToolCallForTurn(context, message, toolCall, config, signal) {
    if (config.hasPendingUserSteering?.() && !signal?.aborted) {
        return { kind: "immediate", result: skippedForUserSteering(), isError: true };
    }
    const prepared = await prepareToolCall(context, message, toolCall, config, signal);
    // Input may arrive while a hook checks the call. The effect has not started yet.
    if (config.hasPendingUserSteering?.() && !signal?.aborted) {
        return { kind: "immediate", result: skippedForUserSteering(), isError: true };
    }
    return prepared;
}
async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal, tools = currentContext.tools ?? []) {
    // Once aborted, skip preparation and the hooks; callers still record this result, so no call
    // is left without one (#9986).
    if (signal?.aborted) {
        return {
            kind: "immediate",
            result: createErrorToolResult("Operation aborted"),
            isError: true,
        };
    }
    const tool = tools.find((t) => t.name === toolCall.name);
    if (!tool) {
        return {
            kind: "immediate",
            result: createErrorToolResult(`Tool ${toolCall.name} not found`),
            isError: true,
        };
    }
    try {
        const preparedToolCall = prepareToolCallArguments(tool, toolCall);
        const validatedArgs = validateToolArguments(tool, preparedToolCall);
        if (config.beforeToolCall) {
            const beforeResult = await config.beforeToolCall({
                assistantMessage,
                toolCall,
                args: validatedArgs,
                context: currentContext,
            }, signal);
            if (signal?.aborted) {
                return {
                    kind: "immediate",
                    result: createErrorToolResult("Operation aborted"),
                    isError: true,
                };
            }
            if (beforeResult?.block) {
                const result = createErrorToolResult(beforeResult.reason || "Tool execution was blocked");
                if (beforeResult.terminate === true) {
                    result.terminate = true;
                }
                return {
                    kind: "immediate",
                    result,
                    isError: true,
                };
            }
        }
        return {
            kind: "prepared",
            toolCall,
            tool,
            args: validatedArgs,
        };
    }
    catch (error) {
        return {
            kind: "immediate",
            result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
            isError: true,
        };
    }
}
function emitToolExecutionUpdate(toolCall, emit) {
    return (partialResult) => emit({
        type: "tool_execution_update",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.arguments,
        partialResult,
    });
}
/**
 * Run one tool call through the same steps as a model-issued call: argument preparation, schema
 * validation, `beforeToolCall`, execution, and `afterToolCall`. Emits no events and adds no
 * messages. Tools that call other tools use this so the hooks (for example permission checks)
 * apply to those calls too.
 *
 * Never rejects for tool failures: an aborted `signal`, unknown tools, validation errors, blocked
 * calls, and thrown errors come back as `isError: true`. An aborted `signal` is checked first,
 * before the hooks run.
 */
export async function runToolCall(toolCall, options) {
    const { assistantMessage, context, signal } = options;
    const preparation = await prepareToolCall(context, assistantMessage, toolCall, options, signal, options.tools);
    if (preparation.kind === "immediate") {
        return { toolCall, result: preparation.result, isError: preparation.isError };
    }
    const executed = await executePreparedToolCall(preparation, signal, options.onUpdate ?? (() => { }));
    return finalizeExecutedToolCall(context, assistantMessage, preparation, executed, options, signal);
}
async function executePreparedToolCall(prepared, signal, onUpdate) {
    const updateEvents = [];
    let acceptingUpdates = true;
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);
    try {
        const result = await prepared.tool.execute(prepared.toolCall.id, prepared.args, signal, (partialResult) => {
            if (!acceptingUpdates)
                return;
            updateEvents.push(Promise.resolve(onUpdate(partialResult)));
        });
        const durationMs = elapsed();
        acceptingUpdates = false;
        await Promise.all(updateEvents);
        return { result, isError: result.isError === true, durationMs };
    }
    catch (error) {
        const durationMs = elapsed();
        acceptingUpdates = false;
        await Promise.all(updateEvents);
        return {
            result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
            isError: true,
            durationMs,
        };
    }
    finally {
        acceptingUpdates = false;
    }
}
async function finalizeExecutedToolCall(currentContext, assistantMessage, prepared, executed, config, signal) {
    let result = executed.result;
    let isError = executed.isError;
    if (config.afterToolCall) {
        try {
            const afterResult = await config.afterToolCall({
                assistantMessage,
                toolCall: prepared.toolCall,
                args: prepared.args,
                result,
                isError,
                context: currentContext,
            }, signal);
            if (afterResult) {
                // Structured content not replaced along with the content may no longer match it.
                const structuredContent = afterResult.structuredContent ?? (afterResult.content ? undefined : result.structuredContent);
                result = {
                    ...result,
                    content: afterResult.content ?? result.content,
                    details: afterResult.details ?? result.details,
                    usage: afterResult.usage ?? result.usage,
                    terminate: afterResult.terminate ?? result.terminate,
                };
                if (structuredContent === undefined)
                    delete result.structuredContent;
                else
                    result.structuredContent = structuredContent;
                isError = afterResult.isError ?? isError;
            }
        }
        catch (error) {
            result = createErrorToolResult(error instanceof Error ? error.message : String(error));
            isError = true;
        }
    }
    return {
        toolCall: prepared.toolCall,
        result,
        isError,
        durationMs: executed.durationMs,
    };
}
function createErrorToolResult(message) {
    return {
        content: [{ type: "text", text: message }],
        details: {},
    };
}
async function emitToolExecutionEnd(finalized, emit) {
    await emit({
        type: "tool_execution_end",
        toolCallId: finalized.toolCall.id,
        toolName: finalized.toolCall.name,
        result: finalized.result,
        isError: finalized.isError,
        ...(finalized.durationMs === undefined ? {} : { durationMs: finalized.durationMs }),
    });
}
function createToolResultMessage(finalized) {
    return {
        role: "toolResult",
        toolCallId: finalized.toolCall.id,
        toolName: finalized.toolCall.name,
        // Untyped tools (JS extensions) can return results without content; normalize
        // so the null never enters session history or provider payloads.
        content: finalized.result.content ?? [],
        details: finalized.result.details,
        ...(finalized.result.nestedCalls ? { nestedCalls: finalized.result.nestedCalls } : {}),
        usage: finalized.result.usage,
        isError: finalized.isError,
        ...(finalized.durationMs === undefined ? {} : { durationMs: finalized.durationMs }),
        timestamp: Date.now(),
    };
}
async function emitToolResultMessage(toolResultMessage, emit) {
    await emit({ type: "message_start", message: toolResultMessage });
    await emit({ type: "message_end", message: toolResultMessage });
}
