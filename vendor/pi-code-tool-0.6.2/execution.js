import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
/** Owns one execution while its foreground waiter can yield to user input. */
export class CodeCell {
    publishCompletion;
    id = randomUUID();
    controller = new AbortController();
    promise;
    foreground = true;
    yieldRequested = false;
    waitReason = 'steering';
    /** Saved output without session-specific continuation instructions. Never sent as result metadata. */
    observation;
    result;
    detached = false;
    storageError;
    directory;
    state;
    constructor(directory, state, signal, run, publishCompletion) {
        this.publishCompletion = publishCompletion;
        this.directory = directory;
        this.state = state;
        const abort = () => this.controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted)
            abort();
        // Schedule execution after construction so all observers see a complete cell.
        this.promise = Promise.resolve().then(() => run(this)).catch((error) => ({
            content: [{ type: 'text', text: 'Code execution failed: ' +
                        (error instanceof Error ? error.message : String(error)) +
                        '\nHost calls may have completed. Inspect their effects before retrying.' }],
            details: { status: 'error', state, calls: [] },
        })).then((result) => {
            signal?.removeEventListener('abort', abort);
            this.result = result;
            if (this.detached)
                this.persist();
            return result;
        });
    }
    async wait(context, signal) {
        // The original tool call owns the streaming callback. A later wait has a new id.
        this.foreground = !this.detached;
        let notify = () => { };
        const steering = new Promise((resolve) => {
            notify = () => {
                this.yieldRequested = true;
                resolve(undefined);
            };
        });
        const unsubscribe = context.onUserSteering?.(() => { this.waitReason = 'steering'; notify(); });
        const abort = () => { this.waitReason = 'aborted'; notify(); };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            // Subscribe before checking to avoid losing an input between those steps.
            if (context.hasPendingUserSteering?.()) {
                this.waitReason = 'steering';
                notify();
            }
            if (signal?.aborted)
                abort();
            const result = await Promise.race([this.promise, steering]);
            if (result)
                return result;
            this.detached = true;
            this.persist();
            return this.result;
        }
        finally {
            this.foreground = false;
            unsubscribe?.();
            signal?.removeEventListener('abort', abort);
        }
    }
    get isComplete() {
        return this.result !== undefined;
    }
    cancel() {
        this.controller.abort(new Error('Code cell cancelled'));
    }
    get persistenceWarning() {
        return this.storageError ? ' Cell state could not be saved: ' + this.storageError + '.' : '';
    }
    persist() {
        const record = this.result
            ? { version: 1, id: this.id, status: 'complete', result: this.result, observation: this.observation }
            : { version: 1, id: this.id, status: 'running', state: this.state };
        try {
            mkdirSync(this.directory, { recursive: true, mode: 0o700 });
            const file = join(this.directory, this.id + '.json');
            const temporary = file + '.' + randomUUID() + '.tmp';
            try {
                writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
                renameSync(temporary, file);
            }
            finally {
                try {
                    unlinkSync(temporary);
                }
                catch { /* rename removed the temporary path. */ }
            }
            this.storageError = undefined;
        }
        catch (error) {
            this.storageError = (error instanceof Error ? error.message : String(error)).slice(0, 180);
        }
    }
}
/** Missing completion means the old process may have executed effects. Never replay it. */
export function readCodeCell(directory, id) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) {
        throw new Error('Invalid code cell id');
    }
    const record = JSON.parse(readFileSync(join(directory, id + '.json'), 'utf8'));
    if (!record || typeof record !== 'object' || !('version' in record) || record.version !== 1 ||
        !('id' in record) || record.id !== id || !('status' in record)) {
        throw new Error('Malformed saved code cell');
    }
    if (record.status === 'running' && 'state' in record && typeof record.state === 'string') {
        return { version: 1, id, status: 'running', state: record.state };
    }
    if (record.status === 'complete' && 'result' in record && validResult(record.result) &&
        (!('observation' in record) || record.observation === undefined || typeof record.observation === 'string')) {
        return { version: 1, id, status: 'complete', result: record.result,
            observation: 'observation' in record ? record.observation : undefined };
    }
    throw new Error('Malformed saved code cell');
}
function validResult(value) {
    if (!value || typeof value !== 'object' || !('content' in value) || !Array.isArray(value.content) ||
        !value.content.every((block) => block !== null && typeof block === 'object' &&
            'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string') ||
        !('details' in value) || !value.details || typeof value.details !== 'object')
        return false;
    const details = value.details;
    return 'state' in details && typeof details.state === 'string' &&
        'status' in details && ['ok', 'error', 'suspended'].includes(String(details.status)) &&
        'calls' in details && Array.isArray(details.calls) &&
        details.calls.every((name) => typeof name === 'string') &&
        (!('isError' in value) || value.isError === undefined || typeof value.isError === 'boolean') &&
        (!('nestedCalls' in value) || value.nestedCalls === undefined || validNestedCalls(value.nestedCalls)) &&
        (!('usage' in value) || value.usage === undefined || validUsage(value.usage));
}
// Cell JSON is a disk trust boundary, unlike the already typed runtime callbacks.
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validNestedCalls(value) {
    return record(value) && typeof value.complete === 'boolean' && Array.isArray(value.calls) &&
        value.calls.every((call) => record(call) &&
            typeof call.id === 'string' && typeof call.name === 'string' &&
            ['ok', 'error', 'unfinished'].includes(String(call.status)) &&
            (call.arguments === undefined || record(call.arguments)) &&
            (call.argumentsBytes === undefined || typeof call.argumentsBytes === 'number') &&
            (call.durationMs === undefined || typeof call.durationMs === 'number') &&
            (call.error === undefined || typeof call.error === 'string'));
}
function validUsage(value) {
    if (!record(value) || !record(value.cost))
        return false;
    const cost = value.cost;
    return ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']
        .every((key) => typeof value[key] === 'number') &&
        ['input', 'output', 'cacheRead', 'cacheWrite', 'total']
            .every((key) => typeof cost[key] === 'number');
}
