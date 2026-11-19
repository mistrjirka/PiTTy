import { Monty, MontyRuntimeError, MontyTypingError } from '@pydantic/monty/node';
import { checkCode, normalizeLimits } from './runtime.js';
/** Common agent-code imports, probed against the actual installed interpreter. */
const CANDIDATE_MODULES = [
    'json', 're', 'datetime', 'math', 'os', 'sys', 'typing', 'asyncio', 'pathlib',
    'time', 'random', 'collections', 'itertools', 'functools', 'string', 'textwrap',
    'base64', 'hashlib', 'statistics', 'io', 'copy', 'enum', 'dataclasses', 'uuid',
    'csv', 'urllib',
];
let defaultModules;
export async function probeImportableModules(candidates = CANDIDATE_MODULES) {
    if (candidates === CANDIDATE_MODULES) {
        defaultModules ??= probeModules(candidates);
        return [...await defaultModules];
    }
    return probeModules(candidates);
}
async function probeModules(candidates) {
    const pool = await Monty.create({ minProcesses: 0, maxProcesses: 1, requestTimeout: 5 });
    const importable = [];
    try {
        for (const name of candidates) {
            if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/i.test(name))
                continue;
            const session = await pool.checkout({ limits: normalizeLimits({ maxDurationSecs: 1 }) });
            try {
                await session.feedRun('import ' + name, { printCallback: () => { } });
                importable.push(name);
            }
            catch (error) {
                if (!(error instanceof MontyRuntimeError) || error.exception.typeName !== 'ModuleNotFoundError')
                    throw error;
                // A missing module is a capability result, not an extension-load error.
            }
            finally {
                await session.close();
            }
        }
        return importable;
    }
    finally {
        await pool.close();
    }
}
/** Known historical gaps. A fixed interpreter needs no declaration workaround. */
const TY_GAP_CANDIDATES = [
    'open', 'bytearray', 'PermissionError', 'FileNotFoundError',
    'IsADirectoryError', 'NotADirectoryError',
];
let defaultGaps;
export async function probeTypeCheckerGaps(candidates = TY_GAP_CANDIDATES) {
    if (candidates === TY_GAP_CANDIDATES) {
        defaultGaps ??= probeGaps(candidates);
        return [...await defaultGaps];
    }
    return probeGaps(candidates);
}
async function probeGaps(candidates) {
    const gaps = [];
    for (const name of candidates) {
        if (!/^[a-z_][a-z0-9_]*$/i.test(name))
            continue;
        try {
            await checkCode(name, { typeCheck: true });
        }
        catch (error) {
            if (!(error instanceof MontyTypingError))
                throw error;
            gaps.push(name);
        }
    }
    return gaps;
}
