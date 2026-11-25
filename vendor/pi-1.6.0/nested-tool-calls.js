/**
 * Tool calls that a tool makes while it runs (`ctx.executeTool()`), for example from codemode
 * scripts. The agent loop does not know about them: the session runs each one through the agent's
 * tool pipeline (`runToolCall`) with its own hooks, emits `tool_execution_*` events with
 * `parentToolCallId`, and records the calls and their usage on the model-issued call's tool result
 * message.
 *
 * Nothing here runs until a tool calls `ctx.executeTool()`.
 */
import { combineUsage } from "./usage-totals.js";
/**
 * Limits of the nested-call record on a tool result: arguments
 * over the per-call or total size are omitted, calls beyond the count are dropped, and the record
 * is marked incomplete when any of that happens.
 */
export const NESTED_CALL_LIMITS = {
    maxCalls: 256,
    maxArgumentBytesPerCall: 8 * 1024,
    maxArgumentBytesTotal: 32 * 1024,
    maxErrorChars: 500,
};
const encoder = new TextEncoder();
/**
 * Collects the nested calls of one model-issued tool call, including calls made by nested tools.
 * The snapshot becomes `nestedCalls` on the tool result message.
 */
export class NestedCallRecorder {
    calls = [];
    startedAt = new Map();
    complete = true;
    argumentBytes = 0;
    /** Summed usage of every nested result, including calls dropped from the record. */
    usage;
    activeCalls = 0;
    retainedForCollection = false;
    reported = new Set();
    /** Record a call as it starts. Returns undefined when the call is dropped. */
    start(toolCall) {
        this.activeCalls++;
        if (this.calls.length >= NESTED_CALL_LIMITS.maxCalls) {
            this.complete = false;
            return undefined;
        }
        const record = { id: toolCall.id, name: toolCall.name, status: "unfinished" };
        const json = JSON.stringify(toolCall.arguments ?? {});
        const bytes = encoder.encode(json).length;
        if (bytes > NESTED_CALL_LIMITS.maxArgumentBytesPerCall ||
            this.argumentBytes + bytes > NESTED_CALL_LIMITS.maxArgumentBytesTotal) {
            record.argumentsBytes = bytes;
            this.complete = false;
        }
        else {
            record.arguments = JSON.parse(json);
            this.argumentBytes += bytes;
        }
        this.calls.push(record);
        this.startedAt.set(record, performance.now());
        return record;
    }
    finish(record, isError, errorText) {
        this.activeCalls--;
        if (!record)
            return;
        record.status = isError ? "error" : "ok";
        record.durationMs = Math.round(performance.now() - (this.startedAt.get(record) ?? performance.now()));
        this.startedAt.delete(record);
        if (isError && errorText)
            record.error = errorText.slice(0, NESTED_CALL_LIMITS.maxErrorChars);
    }
    addUsage(usage) {
        this.usage = this.usage ? combineUsage(this.usage, usage) : usage;
    }
    get totalUsage() {
        return this.usage;
    }
    get isRetained() {
        return this.activeCalls > 0 || this.retainedForCollection;
    }
    /** Drain completed evidence once; unfinished IDs remain available for their eventual outcome. */
    take() {
        // A foreground result can precede both the host's completion and the cell's final checkpoint.
        // Keep ownership through that gap until the completing cell explicitly drains it.
        this.retainedForCollection = this.activeCalls > 0;
        const calls = this.calls.filter((call) => !this.reported.has(call.id)).map((call) => ({ ...call }));
        for (const call of calls) {
            if (call.status !== "unfinished")
                this.reported.add(call.id);
        }
        const usage = this.usage;
        this.usage = undefined;
        return {
            calls: calls.length === 0 && this.complete
                ? undefined
                : { calls, complete: this.complete && calls.every((call) => call.status !== "unfinished") },
            usage,
        };
    }
    /** Copy of the record so far, or undefined when no nested call was made. */
    snapshot() {
        if (this.calls.length === 0 && this.complete)
            return undefined;
        const calls = this.calls.map((call) => ({ ...call }));
        return { calls, complete: this.complete && calls.every((call) => call.status !== "unfinished") };
    }
}
function textOf(result) {
    return (result.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}
export class NestedToolCallRunner {
    host;
    /** Scopes by the id of the calling tool call. */
    scopes = new Map();
    /** Serializes nested calls that must not run concurrently. */
    queueTail = Promise.resolve();
    constructor(host) {
        this.host = host;
    }
    /**
     * Run `name` on behalf of the call `callerId`. The nested call gets the id `<callerId>/<n>`.
     * Never rejects for tool failures: they come back as `isError: true`.
     */
    async execute(callerId, name, args, options = {}) {
        let scope = this.scopes.get(callerId);
        if (!scope) {
            scope = { recorder: new NestedCallRecorder(), nextId: 1, holdsQueue: false };
            this.scopes.set(callerId, scope);
        }
        const toolCall = {
            type: "toolCall",
            id: `${callerId}/${scope.nextId++}`,
            name,
            arguments: (args ?? {}),
        };
        const record = scope.recorder.start(toolCall);
        await this.host.emit({
            type: "tool_execution_start",
            toolCallId: toolCall.id,
            toolName: name,
            args: toolCall.arguments,
            parentToolCallId: callerId,
        });
        const exclusive = !scope.holdsQueue &&
            (this.host.isSequential() ||
                this.host.getTools().find((tool) => tool.name === name)?.executionMode === "sequential");
        let release;
        if (exclusive) {
            const previous = this.queueTail;
            this.queueTail = new Promise((resolve) => {
                release = resolve;
            });
            await previous;
        }
        this.scopes.set(toolCall.id, {
            recorder: scope.recorder,
            nextId: 1,
            holdsQueue: scope.holdsQueue || exclusive,
        });
        let outcome;
        try {
            outcome = await this.host.runToolCall(toolCall, callerId, options.signal, async (partialResult) => {
                options.onUpdate?.(partialResult);
                await this.host.emit({
                    type: "tool_execution_update",
                    toolCallId: toolCall.id,
                    toolName: name,
                    args: toolCall.arguments,
                    partialResult,
                    parentToolCallId: callerId,
                });
            });
        }
        finally {
            this.scopes.delete(toolCall.id);
            release?.();
        }
        scope.recorder.finish(record, outcome.isError, textOf(outcome.result));
        // Nested results are not persisted, so their usage is only counted through the recorder.
        if (outcome.result.usage)
            scope.recorder.addUsage(outcome.result.usage);
        await this.host.emit({
            type: "tool_execution_end",
            toolCallId: toolCall.id,
            toolName: name,
            result: outcome.result,
            isError: outcome.isError,
            ...(outcome.durationMs === undefined ? {} : { durationMs: outcome.durationMs }),
            parentToolCallId: callerId,
        });
        return outcome;
    }
    /** Drain available evidence, retaining active scopes so detached calls can be collected later. */
    takeRecord(toolCallId) {
        const scope = this.scopes.get(toolCallId);
        if (!scope)
            return undefined;
        const summary = scope.recorder.take();
        if (!scope.recorder.isRetained)
            this.scopes.delete(toolCallId);
        return summary;
    }
    clear() {
        // Ending a foreground agent run does not end a detached host call.
        for (const [id, scope] of this.scopes) {
            if (!scope.recorder.isRetained)
                this.scopes.delete(id);
        }
    }
}
