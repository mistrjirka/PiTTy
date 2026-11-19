import { importLegacyState, parseLegacyState } from './legacy.js';
import { CodeRunner } from './runner.js';
import { DEFAULT_MAX_CHECKPOINT_BYTES, MONTY_VERSION, checkCheckpointSize } from './runtime.js';
const stateFailure = (error, aborted = false) => ({
    status: 'error', output: undefined, stdout: '', stdoutTruncated: false,
    calls: [], errorKind: aborted ? 'aborted' : 'state', error,
});
/**
 * Persistent Python heap and call stack, stored as native checkpoints.
 * V1/v2 state imports lazily, once, using saved helper results and current
 * read-only filesystem observations. Native state never replays earlier code.
 *
 * A failed snippet restores its previous Python heap. External changes remain.
 * A suspended snippet also retains that idle heap for explicit abandonment.
 */
export class Session {
    runner;
    maxCheckpointBytes;
    checkpoint = null;
    contract = null;
    completed = 0;
    suspended = null;
    legacy = null;
    busy = false;
    constructor(options = {}) {
        this.runner = new CodeRunner(options);
        this.maxCheckpointBytes = options.maxCheckpointBytes ?? DEFAULT_MAX_CHECKPOINT_BYTES;
        if (!Number.isSafeInteger(this.maxCheckpointBytes) || this.maxCheckpointBytes < 1) {
            throw new Error('maxCheckpointBytes must be a positive safe integer');
        }
    }
    get length() {
        return this.legacy?.state.snippets.length ?? this.completed;
    }
    get suspendedCode() {
        return this.legacy?.state.suspended?.code ?? this.suspended?.code ?? null;
    }
    async run(code, options = {}) {
        if (this.suspendedCode !== null) {
            throw new Error('A run is suspended; call resume() or abandon() before running new code');
        }
        return this.execute(code, options, false);
    }
    async resume(options = {}) {
        const code = this.suspendedCode;
        if (code === null)
            throw new Error('No suspended run to resume');
        return this.execute(code, options, true);
    }
    /** Discard only the paused frame. Completed host effects are not undone. */
    abandon() {
        this.ensureIdle();
        if (this.legacy) {
            const { state } = this.legacy;
            if (!state.suspended)
                return false;
            const retained = { ...state, calls: state.calls.slice(0, state.suspended.cacheLen) };
            delete retained.suspended;
            this.legacy = { state: retained, serialized: JSON.stringify(retained) };
            return true;
        }
        if (!this.suspended)
            return false;
        this.suspended = null;
        if (!this.checkpoint)
            this.contract = null;
        return true;
    }
    reset() {
        this.ensureIdle();
        this.checkpoint = null;
        this.contract = null;
        this.suspended = null;
        this.legacy = null;
        this.completed = 0;
    }
    ensureIdle() {
        if (this.busy)
            throw new Error('This Python session is already executing');
    }
    async execute(code, options, resuming) {
        this.ensureIdle();
        if (Buffer.byteLength(code) > this.maxCheckpointBytes) {
            return stateFailure('Submitted Python code exceeds the checkpoint size limit. Previous state was preserved.');
        }
        this.busy = true;
        try {
            if (this.legacy) {
                try {
                    const contract = this.runner.contract(options);
                    const imported = await importLegacyState(this.legacy.state, this.runner, options, this.maxCheckpointBytes);
                    const pendingCode = this.legacy.state.suspended?.code;
                    // Commit both heaps together only after all cache and checkpoint checks.
                    this.checkpoint = imported.checkpoint?.toString('base64') ?? null;
                    this.suspended = imported.suspended && pendingCode !== undefined
                        ? { code: pendingCode, checkpoint: imported.suspended.toString('base64') } : null;
                    this.contract = this.checkpoint || this.suspended ? contract : null;
                    this.completed = this.legacy.state.snippets.length;
                    this.legacy = null;
                }
                catch (error) {
                    const cause = error instanceof Error ? error.message : String(error);
                    return stateFailure(cause.startsWith('cannot safely restore') ? cause :
                        'cannot safely restore legacy Python state: ' + cause +
                            '\nThe original saved state was preserved. Resolve the reported cause and retry, ' +
                            'or use reset=true to discard this Python state explicitly.', options.signal?.aborted);
                }
            }
            const contract = this.runner.contract(options);
            if (this.contract !== null && contract !== this.contract) {
                return stateFailure('cannot safely restore this Python session after helper types, execution limits, ' +
                    'or type-check settings changed. Saved state was preserved and no code ran. ' +
                    'Use reset=true to start a session with the current settings.');
            }
            const previous = this.suspended;
            const serialized = resuming ? previous.checkpoint : this.checkpoint;
            const initial = serialized ? {
                kind: resuming ? 'suspended' : 'idle',
                bytes: Buffer.from(serialized, 'base64'),
            } : undefined;
            const outcome = await this.runner.runCheckpoint(code, options, initial, this.maxCheckpointBytes);
            const result = outcome.result;
            if (result.status === 'ok') {
                if (outcome.checkpoint?.kind !== 'idle')
                    throw new Error('Missing completed interpreter checkpoint');
                this.checkpoint = outcome.checkpoint.bytes.toString('base64');
                this.contract = contract;
                this.suspended = null;
                this.completed++;
            }
            else if (result.status === 'suspended') {
                if (outcome.checkpoint?.kind !== 'suspended')
                    throw new Error('Missing suspended interpreter checkpoint');
                this.suspended = { code, checkpoint: outcome.checkpoint.bytes.toString('base64') };
                this.contract = contract;
            }
            else if (resuming && !outcome.retrySuspension) {
                // Reusing the old pending frame here could repeat a tool that already
                // executed, including when serialization or a size limit fails afterward.
                this.suspended = null;
                if (!this.checkpoint)
                    this.contract = null;
                result.error += '\nThe suspended snippet stopped. Previous Python state was restored; ' +
                    'completed host calls were not undone. There is no pending frame to retry.';
            }
            return result;
        }
        finally {
            this.busy = false;
        }
    }
    dump() {
        if (this.legacy)
            return this.legacy.serialized;
        const state = {
            version: 3,
            montyVersion: MONTY_VERSION,
            length: this.completed,
            contract: this.contract,
            checkpoint: this.checkpoint,
            suspended: this.suspended,
        };
        return JSON.stringify(state);
    }
    static load(serialized, options = {}) {
        let state;
        try {
            state = JSON.parse(serialized);
        }
        catch {
            throw new Error('cannot safely restore invalid Python state. Saved state must be preserved; use reset=true.');
        }
        if (state && (state.version === 1 || state.version === 2)) {
            const session = new Session(options);
            try {
                session.legacy = { state: parseLegacyState(state), serialized };
            }
            catch (error) {
                throw new Error('cannot safely restore legacy Python state: ' +
                    (error instanceof Error ? error.message : String(error)) +
                    '. Saved state must be preserved; use reset=true to discard it explicitly.');
            }
            return session;
        }
        if (!state || state.version !== 3) {
            throw new Error('cannot safely restore an unsupported Python state version. Saved state must be preserved; use reset=true.');
        }
        if (state.montyVersion !== MONTY_VERSION) {
            throw new Error('cannot safely restore a Python checkpoint from a different interpreter version. ' +
                'Saved state must be preserved; use reset=true to start a new session.');
        }
        const session = new Session(options);
        const validContract = state.contract === null ||
            (typeof state.contract === 'string' && /^[a-f0-9]{64}$/.test(state.contract));
        if (!Number.isSafeInteger(state.length) || state.length < 0 || !validContract ||
            (state.checkpoint !== null && typeof state.checkpoint !== 'string') ||
            (state.suspended !== null && (!state.suspended || typeof state.suspended.code !== 'string' ||
                typeof state.suspended.checkpoint !== 'string')) ||
            ((state.checkpoint !== null || state.suspended !== null) && state.contract === null)) {
            throw new Error('cannot safely restore malformed Python state. Saved state must be preserved; use reset=true.');
        }
        for (const checkpoint of [state.checkpoint, state.suspended?.checkpoint]) {
            if (checkpoint === null || checkpoint === undefined)
                continue;
            if (checkpoint.length === 0 || checkpoint.length % 4 !== 0 ||
                !/^[A-Za-z0-9+/]*={0,2}$/.test(checkpoint)) {
                throw new Error('cannot safely restore malformed Python checkpoint bytes. Use reset=true.');
            }
            if (checkpoint.length > Math.ceil(session.maxCheckpointBytes / 3) * 4) {
                throw new Error('cannot safely restore a Python checkpoint above the size limit. Use reset=true.');
            }
            const bytes = Buffer.from(checkpoint, 'base64');
            checkCheckpointSize(bytes, session.maxCheckpointBytes);
            if (bytes.toString('base64') !== checkpoint) {
                throw new Error('cannot safely restore malformed Python checkpoint bytes. Use reset=true.');
            }
        }
        session.checkpoint = state.checkpoint;
        session.contract = state.contract;
        session.completed = state.length;
        session.suspended = state.suspended;
        return session;
    }
}
