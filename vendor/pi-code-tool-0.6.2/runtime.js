import { Monty } from '@pydantic/monty/node';
/** Native checkpoints are only portable between the exact same Monty version. */
export const MONTY_VERSION = '1.0.0';
export const DEFAULT_MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;
export function normalizeLimits(limits = {}) {
    if (limits.maxAllocations !== undefined) {
        throw new Error('maxAllocations is not supported by this interpreter; use maxMemory');
    }
    const normalized = {
        maxFeedDurationSecs: limits.maxDurationSecs ?? 5,
        maxMemory: limits.maxMemory ?? 64 * 1024 * 1024,
        maxRecursionDepth: limits.maxRecursionDepth ?? 1000,
    };
    for (const [name, value] of Object.entries(normalized)) {
        if (!Number.isFinite(value) || value <= 0)
            throw new Error(name + ' must be a positive finite number');
    }
    return normalized;
}
/** Each operation owns its workers, including failure, cancellation and suspension. */
export async function withInterpreter(options, use) {
    const pool = await Monty.create({
        minProcesses: 0,
        maxProcesses: 1,
        requestTimeout: Math.max(5, (options.limits?.maxFeedDurationSecs ?? 5) + 2),
    });
    let session;
    try {
        session = await pool.checkout(options);
        return await use(session);
    }
    finally {
        try {
            await session?.close();
        }
        finally {
            await pool.close();
        }
    }
}
/**
 * Parse/type-check without running candidate code. The first host lookup pauses
 * before it; no mount, host function or filesystem operation is supplied.
 */
export async function checkCode(code, options = {}) {
    const barrier = 'pi_code_validation_barrier';
    await withInterpreter({
        scriptName: options.scriptName ?? 'tool.py',
        typeCheck: options.typeCheck ?? false,
        typeCheckFormat: 'concise',
        typeCheckStubs: [
            'from typing import Any',
            'def ' + barrier + '() -> None: ...',
            options.stubs ?? '',
        ].join('\n'),
        limits: normalizeLimits(),
    }, async (session) => {
        await session.feedStart(barrier + '()\n' + code, { printCallback: () => { } });
    });
}
export function checkCheckpointSize(bytes, maxBytes) {
    if (bytes.byteLength > maxBytes) {
        throw new Error('Python checkpoint exceeds the ' + maxBytes + '-byte limit. Previous state was preserved; ' +
            'completed host calls were not undone. Use reset=true to start a smaller session.');
    }
}
