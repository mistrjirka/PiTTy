import { createHash } from 'node:crypto';
import { FunctionSnapshot, MontyComplete, MontyCrashedError, MontyRuntimeError, MontySyntaxError, MontyTypingError, NameLookupSnapshot, } from '@pydantic/monty/node';
import { probeTypeCheckerGaps } from './capabilities.js';
import { ToolRegistry } from './registry.js';
import { checkCheckpointSize, normalizeLimits, withInterpreter } from './runtime.js';
import { DEFAULT_MAX_STDOUT_BYTES, appendCappedUtf8 } from './stdout.js';
import { HostToolError } from './types.js';
const PYTHON_KEYWORDS = new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
    'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
    'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
    'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);
/** Drives native persistent feeds, with approvals and tracing at every host call. */
export class CodeRunner {
    registry;
    limits;
    typeCheck;
    constructor(options = {}) {
        this.limits = options.limits ?? {};
        this.typeCheck = options.typeCheck ?? true;
        this.registry = options.tools instanceof ToolRegistry
            ? options.tools
            : new ToolRegistry(options.tools);
    }
    addTool(tool) {
        this.registry.add(tool);
    }
    getTools() {
        return this.registry.list();
    }
    /** Descriptions and tool-registration ordering do not affect compatibility. */
    contract(options = {}) {
        const tools = this.registry.list().map((tool) => ({
            name: tool.name,
            params: tool.params.map((param) => ({
                name: param.name,
                type: param.type.trim(),
                optional: param.optional ?? false,
            })),
            returns: tool.returns.trim(),
        })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
        return createHash('sha256').update(JSON.stringify({
            tools,
            typeCheck: this.typeCheck,
            limits: normalizeLimits({ ...this.limits, ...options.limits }),
            scriptName: options.scriptName ?? 'tool.py',
        })).digest('hex');
    }
    async run(code, options = {}) {
        return (await this.execute(code, options)).result;
    }
    async runCheckpoint(code, options, initial, maxCheckpointBytes) {
        return this.execute(code, options, initial, maxCheckpointBytes);
    }
    async execute(code, options, initial, maxCheckpointBytes) {
        const inputNames = Object.keys(options.inputs ?? {});
        for (const name of inputNames) {
            if (!/^[a-z_][a-z0-9_]*$/i.test(name) || PYTHON_KEYWORDS.has(name)) {
                throw new Error("Input name '" + name + "' is not a valid Python identifier");
            }
        }
        const calls = [];
        const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
        let stdout = { text: '', bytes: 0, truncated: false };
        let retrySuspension = initial?.kind === 'suspended';
        let restoring = false;
        const printCallback = (_stream, text) => {
            if (text)
                retrySuspension = false;
            options.onPrint?.(text);
            stdout = appendCappedUtf8(stdout, text, maxStdoutBytes);
        };
        const fail = (errorKind, error) => ({
            result: {
                status: 'error', output: undefined, stdout: stdout.text,
                stdoutTruncated: stdout.truncated, error, errorKind, calls,
            },
            retrySuspension,
        });
        const abort = () => fail('aborted', 'Run aborted by the host');
        if (options.signal?.aborted)
            return abort();
        if (initial?.kind === 'suspended' && inputNames.length > 0) {
            return fail('state', 'A suspended frame retains its original inputs; resume without inputs or abandon it explicitly.');
        }
        const scriptName = options.scriptName ?? 'tool.py';
        const lineOffset = options.lineOffset ?? 0;
        const locationRe = new RegExp(scriptName.replace(/[.*+?^{}()|[\]\\$]/g, '\\$&') + ':(\\d+):', 'g');
        const pythonFailure = (error) => {
            if (restoring) {
                return fail('state', 'cannot safely restore the Python checkpoint: ' +
                    (error instanceof Error ? error.message : String(error)) +
                    '. The saved state was preserved. Use reset=true to start a new session.');
            }
            if (error instanceof MontyTypingError) {
                const diagnostic = error.display().replace(locationRe, (_match, line) => scriptName + ':' + (Number(line) - lineOffset) + ':');
                const lines = diagnostic.split('\n').filter((line) => line.trim());
                return fail(lines.every((line) => line.includes('error[invalid-syntax]')) ? 'syntax' : 'typing', diagnostic);
            }
            if (error instanceof MontySyntaxError)
                return fail('syntax', error.display('type-msg'));
            if (error instanceof MontyRuntimeError)
                return fail('runtime', error.display('traceback'));
            if (error instanceof MontyCrashedError)
                return fail('runtime', error.display('type-msg'));
            return fail('runtime', error instanceof Error ? error.message : String(error));
        };
        try {
            const gaps = this.typeCheck ? await probeTypeCheckerGaps() : [];
            const stubs = this.typeCheck ? [
                'from typing import Any',
                // Monty imports checker context between feeds. An unassigned export
                // declaration retains private names without restricting later globals.
                '__all__: list[str]',
                ...gaps.map((name) => name + ': Any'),
                await this.registry.renderTypeStubs(),
            ].join('\n') : undefined;
            return await withInterpreter({
                scriptName,
                limits: normalizeLimits({ ...this.limits, ...options.limits }),
                typeCheck: this.typeCheck,
                typeCheckStubs: stubs,
                typeCheckFormat: 'concise',
            }, async (session) => {
                try {
                    let progress;
                    if (initial?.kind === 'suspended') {
                        restoring = true;
                        progress = await session.loadSnapshot(initial.bytes, { printCallback, mount: options.mount });
                        restoring = false;
                    }
                    else {
                        if (initial) {
                            restoring = true;
                            await session.loadSession(initial.bytes);
                            restoring = false;
                        }
                        // Declarations only. They teach the persistent checker about newly
                        // injected inputs without rewriting or executing the user's source.
                        if (this.typeCheck && inputNames.length > 0) {
                            await session.feedRun('from typing import Any\n' + inputNames.map((name) => name + ': Any').join('\n'), { printCallback: () => { } });
                        }
                        if (options.signal?.aborted)
                            return abort();
                        progress = await session.feedStart(code, {
                            inputs: options.inputs,
                            printCallback,
                            mount: options.mount,
                        });
                    }
                    while (!(progress instanceof MontyComplete)) {
                        if (options.signal?.aborted)
                            return abort();
                        if (progress instanceof NameLookupSnapshot) {
                            progress = await progress.resume(this.registry.has(progress.variableName) ? progress.variableName : undefined);
                            continue;
                        }
                        if (!(progress instanceof FunctionSnapshot)) {
                            return fail('runtime', 'Unexpected unresolved Python future; no host future was registered');
                        }
                        if (progress.isOsFunction) {
                            // Mount handling stays native and uses only this run's mounts.
                            retrySuspension = false;
                            progress = await progress.resumeAuto();
                            continue;
                        }
                        const snapshot = progress;
                        const tool = this.registry.get(snapshot.functionName);
                        if (!tool) {
                            progress = await snapshot.resumeNotFound();
                            continue;
                        }
                        const trace = {
                            tool: tool.name, args: snapshot.args, kwargs: snapshot.kwargs,
                            durationMs: 0, ok: false,
                        };
                        const startedAt = performance.now();
                        let denial;
                        if (tool.requiresApproval) {
                            const request = {
                                tool: tool.name, args: snapshot.args, kwargs: snapshot.kwargs,
                                description: tool.description,
                            };
                            const decision = options.onApproval ? await options.onApproval(request) : false;
                            if (options.signal?.aborted)
                                return abort();
                            if (decision === 'suspend') {
                                let checkpoint;
                                if (maxCheckpointBytes !== undefined) {
                                    const bytes = await snapshot.dump();
                                    checkCheckpointSize(bytes, maxCheckpointBytes);
                                    checkpoint = { kind: 'suspended', bytes };
                                }
                                return {
                                    result: {
                                        status: 'suspended', output: undefined, stdout: stdout.text,
                                        stdoutTruncated: stdout.truncated, calls, suspendedCall: request,
                                        error: 'suspended awaiting approval of ' + tool.name + '(...)',
                                    },
                                    checkpoint,
                                    retrySuspension: false,
                                };
                            }
                            trace.approved = decision;
                            if (!decision)
                                denial = options.onApproval
                                    ? tool.name + ' call denied by the user'
                                    : tool.name + ' requires approval but no approver is configured';
                        }
                        let value;
                        let error;
                        if (denial) {
                            trace.error = 'PermissionError: ' + denial;
                            error = new MontyRuntimeError('PermissionError', denial);
                        }
                        else {
                            if (options.signal?.aborted)
                                return abort();
                            // Clear before invoking: a throwing or cancelled tool may already
                            // have changed the world. Never retain its old pending frame.
                            retrySuspension = false;
                            try {
                                value = await tool.execute(snapshot.args, snapshot.kwargs);
                                trace.ok = true;
                            }
                            catch (caught) {
                                const hostError = caught instanceof Error ? caught : new Error(String(caught));
                                const pythonType = hostError instanceof HostToolError ? hostError.pythonType : 'RuntimeError';
                                trace.error = pythonType + ': ' + hostError.message;
                                error = new MontyRuntimeError(pythonType, hostError.message);
                            }
                        }
                        trace.durationMs = performance.now() - startedAt;
                        calls.push(trace);
                        if (options.signal?.aborted)
                            return abort();
                        progress = error ? await snapshot.resumeError(error) : await snapshot.resume(value);
                    }
                    let checkpoint;
                    if (maxCheckpointBytes !== undefined) {
                        const bytes = await session.dump();
                        checkCheckpointSize(bytes, maxCheckpointBytes);
                        checkpoint = { kind: 'idle', bytes };
                    }
                    return {
                        result: {
                            status: 'ok', output: progress.output, stdout: stdout.text,
                            stdoutTruncated: stdout.truncated, calls,
                        },
                        checkpoint,
                        retrySuspension: false,
                    };
                }
                catch (error) {
                    return pythonFailure(error);
                }
            });
        }
        catch (error) {
            return pythonFailure(error);
        }
    }
}
