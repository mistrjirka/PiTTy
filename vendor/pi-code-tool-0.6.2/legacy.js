import { FunctionSnapshot, MontyComplete, MontyRuntimeError, MontyTypingError, MountDir, NameLookupSnapshot, } from '@pydantic/monty/node';
import { checkCheckpointSize, withInterpreter } from './runtime.js';
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Validate only fields needed for recovery. Keep the original JSON separately. */
export function parseLegacyState(value) {
    const invalid = () => { throw new Error('malformed legacy Python state'); };
    if (!record(value) || (value.version !== 1 && value.version !== 2) ||
        !Array.isArray(value.snippets) || !Array.isArray(value.calls))
        return invalid();
    const snippet = (item) => record(item) && typeof item.code === 'string' &&
        (item.inputs === undefined || record(item.inputs));
    if (!value.snippets.every(snippet))
        return invalid();
    for (const call of value.calls) {
        if (!record(call) || typeof call.tool !== 'string' ||
            (call.key !== undefined && typeof call.key !== 'string') ||
            (call.denied !== undefined && call.denied !== true) ||
            (call.error !== undefined && (!record(call.error) ||
                typeof call.error.pythonType !== 'string' || typeof call.error.message !== 'string')))
            return invalid();
        // Older Monty rejected a missing return value. Do not silently turn it into None.
        const outcomes = Number(Object.hasOwn(call, 'result')) + Number(call.error !== undefined) +
            Number(call.denied === true);
        if (outcomes !== 1)
            return invalid();
    }
    if (value.suspended !== undefined && (!snippet(value.suspended) ||
        !record(value.suspended) || !Number.isSafeInteger(value.suspended.cacheLen) ||
        Number(value.suspended.cacheLen) < 0 || Number(value.suspended.cacheLen) > value.calls.length))
        return invalid();
    return value;
}
function recordedInputs(state, pending) {
    let inputs = {};
    for (const snippet of state.snippets)
        inputs = { ...inputs, ...snippet.inputs };
    if (pending)
        inputs = { ...inputs, ...state.suspended?.inputs };
    return inputs;
}
function abortIfRequested(options) {
    if (options.signal?.aborted)
        throw new Error('Run aborted by the host');
}
/**
 * Import once using the old continuation's current-file observations. Original
 * file bytes were never stored in v1/v2. Every historical helper stays cache-only,
 * and history must consume its entire cache before new code can run.
 */
export async function importLegacyState(state, runner, options, maxCheckpointBytes) {
    abortIfRequested(options);
    const sourceBytes = state.snippets.reduce((total, snippet) => total + Buffer.byteLength(snippet.code) + 1, 0) +
        Buffer.byteLength(state.suspended?.code ?? '');
    if (sourceBytes > maxCheckpointBytes)
        throw new Error('legacy Python source exceeds the checkpoint size limit');
    const history = state.snippets.map((snippet) => snippet.code).join('\n') || 'pass';
    const historyCalls = state.suspended?.cacheLen ?? state.calls.length;
    const config = await runner.interpreterOptions(options);
    const knownHelpers = new Set([...runner.getTools().map((tool) => tool.name), ...state.calls.map((call) => call.tool)]);
    const mounts = [];
    try {
        // Bind only current authorized paths. Even an SDK caller's read-write mount
        // becomes read-only while rebuilding history. Never reuse stored mount paths.
        const currentMounts = options.mount ? (Array.isArray(options.mount) ? options.mount : [options.mount]) : [];
        for (const mount of currentMounts)
            mounts.push(new MountDir({
                hostPath: mount.hostPath,
                virtualPath: mount.virtualPath,
                mode: 'read-only',
                memoryUsageLimit: mount.memoryUsageLimit,
            }));
        async function reconstruct(pending) {
            const inputs = recordedInputs(state, pending);
            const declarations = runner.inputDeclarations(inputs);
            return withInterpreter(config, async (session) => {
                let cursor = 0;
                async function drive(progress, end, pause) {
                    while (!(progress instanceof MontyComplete)) {
                        abortIfRequested(options);
                        if (progress instanceof NameLookupSnapshot) {
                            progress = await progress.resume(knownHelpers.has(progress.variableName) ? progress.variableName : undefined);
                            continue;
                        }
                        if (!(progress instanceof FunctionSnapshot))
                            throw new Error('unresolved legacy Python future');
                        if (progress.isOsFunction) {
                            // Old filesystem calls use open/Path.*. Native checks use only
                            // fresh read-only mounts, including catchable write denials.
                            // Other OS calls keep native default errors (e.g. old os.getenv),
                            // without invoking the newer system.sleep/system.async_sleep waits.
                            progress = progress.functionName === 'open' || progress.functionName.startsWith('Path.')
                                ? await progress.resumeAuto() : await progress.resumeNotHandled();
                            continue;
                        }
                        if (cursor === end) {
                            if (pause && runner.registry.get(progress.functionName)?.requiresApproval)
                                return progress;
                            throw new Error('uncached historical helper call ' + progress.functionName +
                                ' at saved call ' + (cursor + 1));
                        }
                        const saved = state.calls[cursor];
                        if (saved.tool !== progress.functionName)
                            throw new Error('historical helper order changed at saved call ' +
                                (cursor + 1) + ': expected ' + saved.tool + ', reached ' + progress.functionName);
                        // This is the legacy serializer, including its historical Map limitation.
                        // V1 may have no key. Do not claim stronger identity than the state saved.
                        if (saved.key !== undefined && saved.key !== JSON.stringify([progress.args, progress.kwargs])) {
                            throw new Error('historical helper arguments changed at saved call ' + (cursor + 1) + ' (' + saved.tool + ')');
                        }
                        cursor++;
                        if (saved.error) {
                            progress = await progress.resumeError(new MontyRuntimeError(saved.error.pythonType, saved.error.message));
                        }
                        else if (saved.denied) {
                            progress = await progress.resumeError(new MontyRuntimeError('PermissionError', saved.tool + ' call denied by the user'));
                        }
                        else {
                            progress = await progress.resume(saved.result);
                        }
                    }
                    if (cursor !== end)
                        throw new Error('historical code consumed ' + cursor + ' of ' + end + ' saved helper calls');
                    if (pause)
                        throw new Error('saved suspended code ended without reaching its pending approval');
                    return progress;
                }
                abortIfRequested(options);
                if (declarations)
                    await session.feedRun(declarations, { printCallback: () => { } });
                await drive(await session.feedStart(history, {
                    inputs, mount: mounts, printCallback: () => { },
                }), historyCalls, false);
                let bytes;
                if (pending) {
                    // Inputs were injected before history, matching the saved pending run.
                    // Do not inject them again after historical assignments have executed.
                    const progress = await drive(await session.feedStart(state.suspended.code, {
                        mount: mounts, printCallback: () => { },
                    }), state.calls.length, true);
                    if (!(progress instanceof FunctionSnapshot))
                        throw new Error('missing legacy approval checkpoint');
                    bytes = await progress.dump();
                }
                else {
                    bytes = await session.dump();
                }
                checkCheckpointSize(bytes, maxCheckpointBytes);
                abortIfRequested(options);
                return bytes;
            });
        }
        // The rollback heap excludes pending inputs. Rebuilding the paused frame
        // separately preserves legacy overrides without corrupting explicit abandon.
        const checkpoint = state.snippets.length > 0 || historyCalls > 0 ? await reconstruct(false) : null;
        const suspended = state.suspended ? await reconstruct(true) : null;
        return { checkpoint, suspended };
    }
    catch (error) {
        const cause = error instanceof MontyTypingError ? error.display() :
            error instanceof MontyRuntimeError ? error.display('traceback') :
                error instanceof Error ? error.message : String(error);
        throw new Error('cannot safely restore legacy Python state: ' + cause +
            '\nThe original saved state was preserved. No historical helper ran and no file was changed. ' +
            'Resolve the reported incompatibility and retry, or use reset=true to discard this Python state explicitly.');
    }
    finally {
        for (const mount of mounts)
            mount.close();
    }
}
