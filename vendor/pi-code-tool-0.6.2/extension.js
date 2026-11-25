/**
 * pi extension: a `code` code-mode tool backed by monty's sandboxed Python
 * interpreter. Host tools appear to the model as plain Python functions;
 * print() output streams back; variables persist across calls within a
 * session; session state rides in tool-result `details` so it survives
 * session restore and branching.
 *
 * Use directly with `pi -e src/pi/extension.ts`, or copy/symlink into
 * `.pi/extensions/`.
 */
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { MountDir } from '@pydantic/monty/node';
import { probeImportableModules } from '../core/capabilities.js';
import { renderPythonToolRules, ToolRegistry } from '../core/registry.js';
import { createBuiltinTools } from '../core/builtins.js';
import { Session } from '../core/session.js';
import { ToolStore } from '../core/toolstore.js';
import { createPiBridgeTools, normalizePiToolValue, piBridgeContext } from './bridge.js';
import { decodeSessionState, encodeSessionState } from './state-codec.js';
import { CodeOutput, OUTPUT_PREVIEW_BYTES, readCodeOutput } from './output.js';
import { CodeCell, readCodeCell } from './execution.js';
const DEFAULT_TOOL_NAME = 'code';
/**
 * Labels of the gated-call approval dialog. pi's `ctx.ui.select` returns the
 * chosen label string, so these are load-bearing for routing the decision —
 * tests and RPC drivers should import them rather than re-typing the text.
 */
export const APPROVAL_CHOICES = {
    approve: 'Approve',
    deny: 'Deny',
    suspend: 'Decide later (suspends the script, resumable any time)',
};
const PythonParams = Type.Object({
    output: Type.Optional(Type.String({ description: 'Read saved output by id. Does not execute Python. Use offset for the next page.' })),
    offset: Type.Optional(Type.Integer({ minimum: 0, description: 'Byte offset returned by the previous output page.' })),
    limit: Type.Optional(Type.Integer({ minimum: 4, maximum: OUTPUT_PREVIEW_BYTES, description: 'Maximum saved output bytes to read.' })),
    wait: Type.Optional(Type.String({ description: 'Collect an existing running cell by id. Never reruns its code.' })),
    cancel: Type.Optional(Type.String({ description: 'Cancel a running cell by id and collect its result. Completed effects remain.' })),
    code: Type.Optional(Type.String({
        description: 'Python code to run. Required unless resume=true. The value of the last top-level expression is returned.',
    })),
    reset: Type.Optional(Type.Boolean({
        description: 'Discard all session state and reload saved tools before running.',
    })),
    resume: Type.Optional(Type.Boolean({
        description: 'Resume a paused snippet after handling new user input or approval. Work done before ' +
            'the suspension is not repeated; code is ignored and may be omitted.',
    })),
    abandon: Type.Optional(Type.Boolean({
        description: 'Discard a suspended snippet without resetting the rest of the session.',
    })),
});
export function createPythonExtension(options = {}) {
    return async (pi) => {
        const toolName = options.toolName ?? DEFAULT_TOOL_NAME;
        const root = options.root ?? process.cwd();
        const outputDirectory = options.outputDirectory ?? join(getAgentDir(), 'code-output', createHash('sha256').update(root).digest('hex').slice(0, 16));
        const cellDirectory = join(outputDirectory, 'cells');
        const liveCells = new Map();
        let pendingCellId;
        let sessionEpoch = 0;
        const importableModules = await probeImportableModules();
        // Bind only the current workspace for each operation, including restored frames.
        let makeMount;
        if (options.mountWorkspace ?? true) {
            try {
                if (!statSync(root).isDirectory())
                    throw new Error('not a directory');
                makeMount = () => new MountDir({ virtualPath: '/workspace', hostPath: root, mode: 'read-only' });
            }
            catch {
                // root missing/unreadable: degrade to the read_file tool rather than
                // failing the whole extension load
                makeMount = undefined;
            }
        }
        const bridge = options.bridgePiTools ?? true;
        const registry = new ToolRegistry(options.tools);
        const bridgeExecution = new AsyncLocalStorage();
        const bridgeTools = bridge ? createPiBridgeTools(root, {
            getContext: () => bridgeExecution.getStore(),
            exclude: toolName,
        }) : [];
        const bridgeNames = new Set(bridgeTools.map((tool) => tool.name));
        for (const tool of bridgeTools)
            registry.add(tool);
        if (!options.noBuiltins) {
            // the mount replaces read_file with plain open(); bridged ls replaces list_files
            for (const tool of createBuiltinTools({ root, readFile: !makeMount, listFiles: !bridge })) {
                registry.add(tool);
            }
        }
        const store = options.toolStore === false ? null : new ToolStore(options.toolStore ?? join(root, '.pi', 'code-tools'));
        if (store) {
            // saved code must work in a future session, not just this one: run it
            // in an isolated session (other saved tools loaded, current session's
            // imports/variables absent) before accepting it. The probe needs its
            // own MountDir — the suspended outer run still holds the shared one,
            // and monty rejects a mount attached to two runs at once.
            const validate = async (code) => {
                const probeMount = makeMount?.();
                const probe = await freshSession({ quiet: true, mount: probeMount });
                const result = await probe.run(code, { mount: probeMount });
                return result.status === 'ok' ? null : ((result.error ?? 'unknown error').split('\n')[0] ?? null);
            };
            for (const tool of store.hostTools((name) => registry.has(name), validate)) {
                registry.add(tool);
            }
        }
        const savedSummary = store ? await store.renderSummary() : '';
        const sessionOptions = { tools: registry, limits: options.limits, typeCheck: options.typeCheck };
        // null until first use: a fresh session loads saved tools as a prelude,
        // which is async, so creation happens lazily in execute().
        let session = null;
        let preludeNote = '';
        // Keep incompatible state byte-for-byte until an explicit reset.
        let blockedState = null;
        let restoredState = null;
        function savedState(current) {
            const serialized = current.dump();
            // Preserve the original plain/gzip representation while lazy import fails,
            // or when a control request leaves the restored state unchanged.
            return restoredState?.decoded === serialized ? restoredState.encoded : encodeSessionState(serialized);
        }
        async function freshSession(opts = {}) {
            const fresh = new Session(sessionOptions);
            if (!store)
                return fresh;
            const saved = await store.list();
            if (saved.length === 0)
                return fresh;
            const loadMount = opts.mount ?? makeMount?.();
            // Per-file loading, looping until the failed set stops shrinking: a
            // malformed file skips just that tool, and dependency chains load in
            // any order (monty resolves a function's globals only if they were
            // defined BEFORE it — retrying failures effectively topo-sorts, which
            // a single combined snippet cannot guarantee).
            let pending = saved;
            while (pending.length > 0) {
                const failed = [];
                for (const tool of pending) {
                    const loaded = await fresh.run(tool.code, { mount: loadMount });
                    if (loaded.status !== 'ok')
                        failed.push({ ...tool, error: (loaded.error ?? '').split('\n')[0] });
                }
                if (failed.length === pending.length) {
                    if (!opts.quiet) {
                        const skipped = failed.map((p) => `${p.name} (${p.error})`).join('; ');
                        preludeNote = `[note: skipped saved tool(s) that failed to load: ${skipped}]\n\n`;
                    }
                    break;
                }
                pending = failed;
            }
            return fresh;
        }
        // Rebuild session state from the last python tool result on the current
        // branch — `details` travels with the session file, so this survives
        // restores and branching.
        pi.on('session_start', (_event, ctx) => {
            sessionEpoch++;
            let state;
            pendingCellId = undefined;
            // Walking backwards avoids reading every historical state snapshot.
            // SessionManager can lazily load large tool-result details from disk.
            const branch = ctx.sessionManager.getBranch();
            for (let index = branch.length - 1; index >= 0; index--) {
                // Managed runtimes persist detached completion as its own typed entry.
                const entry = branch[index];
                const message = entry?.type === 'message' ? entry.message
                    : entry?.type === 'tool_completion' ? { toolName: entry.toolName, details: entry.result?.details }
                        : undefined;
                if (message?.toolName === toolName && message.details?.state) {
                    state = message.details.state;
                    if (message.details.cell?.status === 'running' || message.details.cell?.status === 'unknown') {
                        pendingCellId = message.details.cell.id;
                    }
                    break;
                }
            }
            blockedState = null;
            restoredState = null;
            try {
                const decoded = state ? decodeSessionState(state) : undefined;
                session = decoded === undefined ? null : Session.load(decoded, sessionOptions);
                if (state && decoded !== undefined)
                    restoredState = { encoded: state, decoded };
            }
            catch (error) {
                session = null;
                if (state) {
                    blockedState = {
                        state,
                        error: error instanceof Error ? error.message : String(error),
                    };
                }
            }
        });
        function prepareCellState(result) {
            const encoded = result.details.state;
            const decoded = decodeSessionState(encoded);
            return { session: Session.load(decoded, sessionOptions), restored: { encoded, decoded } };
        }
        // The older build SDK lacks this managed-runtime lifecycle event.
        const lifecycle = pi;
        lifecycle.on('agent_before_settle', async (_event, context) => {
            const epoch = sessionEpoch;
            const cell = pendingCellId ? liveCells.get(pendingCellId) : undefined;
            const publish = cell?.publishCompletion;
            if (!cell || !publish)
                return;
            const cancel = () => cell.cancel();
            context.signal?.addEventListener('abort', cancel, { once: true });
            if (context.signal?.aborted)
                cancel();
            let result;
            try {
                // Accepted steering releases this wait so a new user request can run.
                result = await cell.wait(context, context.signal);
            }
            finally {
                context.signal?.removeEventListener('abort', cancel);
            }
            if (!result || context.signal?.aborted || epoch !== sessionEpoch || pendingCellId !== cell.id)
                return;
            const loaded = prepareCellState(result);
            const completed = {
                ...result,
                isError: result.details.status === 'error',
                details: { ...result.details, cell: { id: cell.id, status: 'complete' } },
            };
            // Publishing is synchronous, durable and idempotent. A failure leaves the
            // pending handle owned here so an explicit wait can still collect it.
            publish(completed);
            if (epoch !== sessionEpoch || pendingCellId !== cell.id)
                return;
            session = loaded.session;
            restoredState = loaded.restored;
            blockedState = null;
            pendingCellId = undefined;
            liveCells.delete(cell.id);
        });
        function describe(visibleRegistry = registry, sessionBacked = false) {
            const gatedNames = options.autoApprove ? [] : visibleRegistry.list().filter((tool) => tool.requiresApproval).map((tool) => tool.name);
            const writeHelpers = ['write', 'edit'].filter((name) => visibleRegistry.has(name));
            return [
                'Run Python in a sandboxed interpreter with host tools available as plain',
                'functions. Variables and functions persist across calls in this session.',
                'Prefer this tool when you need to chain tool calls, loop, filter large',
                'results, or compute — keep large values in variables and print only the needed findings.',
                'Output previews keep the beginning and end. Read omitted output with output=<id> and byte offsets.',
                'New user input may return a running cell id. Use wait=<id> to collect it without rerunning.',
                'After a script pauses for that input, use resume=true to continue or abandon=true to discard its remaining steps.',
                '',
                'Python helper functions available inside this tool:',
                `- Call listed helpers as Python functions in the code passed to ${toolName}.`,
                ...(sessionBacked ? [
                    '- Pi-backed helpers mirror callable registered Pi tools and follow the session tool settings.',
                ] : []),
                `- Example: call ${toolName} with code like \`${helperExample(visibleRegistry)}\`.`,
                '',
                visibleRegistry.renderStubs(),
                ...(savedSummary
                    ? [
                        '',
                        'Saved functions (auto-loaded into new sessions — call them from your',
                        `code like any function, e.g. via ${toolName} with "result = name(...)"):`,
                        savedSummary,
                    ]
                    : []),
                '',
                'Rules:',
                renderPythonToolRules(importableModules),
                ...(gatedNames.length > 0
                    ? [
                        `- Calls to ${gatedNames.join('/')} pause the script for per-call user approval; a denial raises PermissionError (catch it or stop gracefully), and the user may suspend the script instead — resume later with {"resume": true}, or discard it with {"abandon": true}. Group related work so the user approves meaningful units.`,
                    ]
                    : []),
                ...(makeMount
                    ? [
                        `- The workspace is mounted READ-ONLY at /workspace: read files with open("/workspace/<path>") or pathlib. Helper-tool paths such as ls/find results are relative to the workspace root. Files are not iterable — use .read()/.readlines(); parse JSON with json.loads(text). Writes through the mount raise PermissionError.${writeHelpers.length ? ' Use the listed ' + writeHelpers.map((name) => name + '()').join('/') + ' helpers for derived file changes; use regular edit/write tools for authored content.' : ''}`,
                    ]
                    : []),
            ].join('\n');
        }
        // New Pi versions provide the callable loadout before each model request.
        // Defaults expose read/bash/edit/write. ls/find/grep appear only when callable;
        // this extension does not enable them or bypass an explicit tool restriction.
        // Older versions ignore this optional hook and keep the standalone stubs.
        const loadoutHooks = bridge ? {
            prepareLoadout(loadout) {
                const callable = new Set(loadout.callable.map((tool) => tool.name));
                const visible = new ToolRegistry(registry.list().filter((tool) => !bridgeNames.has(tool.name) || callable.has(tool.name)));
                return bridgeExecution.run({ tools: loadout.callable }, () => ({
                    descriptions: { [toolName]: describe(visible, true) },
                }));
            },
        } : {};
        pi.registerTool({
            name: toolName,
            label: 'Code',
            executionMode: 'sequential',
            description: describe(),
            ...loadoutHooks,
            promptSnippet: `${toolName}: run sandboxed Python; host tools are callable as functions; state persists`,
            promptGuidelines: [
                `Use ${toolName} for multi-step tool workflows: loop/filter/aggregate in code and print only the result, instead of issuing many separate tool calls.`,
                ...(bridge
                    ? [
                        `Route file changes by how the content is produced. DERIVED content — computed from data (manifests, indexes, conversions, extractions), the same mechanical transform across many files, or writes that must pass programmatic checks first — belongs inside ${toolName} via available write()/edit() helpers: code computes it exactly and verifies before writing${options.autoApprove ? '' : ', and each mutation is shown for approval'}. AUTHORED content — new code or prose you are composing, or a single judgment-driven edit — belongs in the regular edit/write tools.`,
                    ]
                    : []),
                ...(registry.list().length > 0
                    ? [
                        `Use only helper functions listed in the current ${toolName} tool description.`,
                    ]
                    : []),
                ...(store
                    ? [
                        `To create a reusable saved tool, call save_tool(name, code, description) inside ${toolName} — it validates the code. Do not write files into .pi/code-tools directly.`,
                    ]
                    : []),
            ],
            parameters: PythonParams,
            async execute(_toolCallId, params, signal, onUpdate, ctx) {
                // Optional managed-runtime hooks are absent from older Pi SDK declarations.
                const steering = (ctx ?? {});
                const takeNestedToolCalls = steering.takeNestedToolCalls?.bind(steering);
                const publishCompletion = steering.publishToolCompletion?.bind(steering);
                const controlDetails = (status) => ({
                    status,
                    state: blockedState?.state ?? (session ? savedState(session) : ''),
                    calls: [],
                    ...(pendingCellId ? { cell: { id: pendingCellId, status: 'running' } } : {}),
                });
                const invalid = (text) => ({
                    content: [{ type: 'text', text }],
                    details: controlDetails('error'),
                });
                const running = (cell) => ({
                    content: [{ type: 'text', text: '[running] Code cell ' + cell.id +
                                (cell.waitReason === 'aborted' ? ' stopped waiting.' : ' yielded for new user input.') +
                                ' Its current host call may still be running; later calls will pause. ' +
                                'Collect it with {"wait":"' + cell.id + '"}; do not rerun the code.' + cell.persistenceWarning }],
                    details: { ...controlDetails('running'),
                        ...(pendingCellId === cell.id ? { cell: { id: cell.id, status: 'running' } } : {}) },
                });
                const unknown = (id, cause) => ({
                    content: [{ type: 'text', text: '[unknown] Code cell ' + id +
                                ' has no confirmed completion after reload: ' + cause +
                                '. Host calls may have completed. ' +
                                (pendingCellId === id
                                    ? 'Inspect their effects, then use abandon=true or reset=true before new code. '
                                    : 'Inspect their effects in the original session. ') +
                                'This cell will not be replayed.' }],
                    details: { ...controlDetails('unknown'),
                        ...(pendingCellId === id ? { cell: { id, status: 'unknown' } } : {}) },
                });
                if (params.resume && params.abandon)
                    return invalid('(choose either resume=true or abandon=true, not both)');
                const controlModes = [params.output, params.wait, params.cancel].filter((value) => value !== undefined);
                if (controlModes.length > 1 || (controlModes.length > 0 &&
                    (params.code !== undefined || params.reset || params.resume || params.abandon))) {
                    return invalid('Choose output, wait, cancel, or Python execution parameters; do not combine them.');
                }
                if (!params.output && (params.offset !== undefined || params.limit !== undefined)) {
                    return invalid('offset and limit require output=<id>.');
                }
                if (params.output !== undefined) {
                    try {
                        const page = readCodeOutput(outputDirectory, params.output, params.offset, params.limit);
                        return {
                            content: [{ type: 'text', text: page.text }],
                            details: { ...controlDetails('ok'), output: page.output },
                        };
                    }
                    catch (error) {
                        return invalid('Could not read saved output: ' + (error instanceof Error ? error.message : String(error)));
                    }
                }
                const requestedCell = params.wait ?? params.cancel;
                if (requestedCell !== undefined) {
                    if (pendingCellId && pendingCellId !== requestedCell) {
                        return invalid('Collect the pending cell first with {"wait":"' + pendingCellId + '"}.');
                    }
                    const cell = liveCells.get(requestedCell);
                    let result;
                    let observation;
                    if (cell) {
                        if (params.cancel !== undefined)
                            cell.cancel();
                        const completed = await cell.wait(steering, signal);
                        if (!completed)
                            return running(cell);
                        result = completed;
                        observation = cell.observation;
                    }
                    else {
                        try {
                            const record = readCodeCell(cellDirectory, requestedCell);
                            if (record.status === 'running')
                                return unknown(requestedCell, 'the prior process left an unfinished record');
                            result = record.result;
                            observation = record.observation;
                        }
                        catch (error) {
                            if (pendingCellId === requestedCell) {
                                return unknown(requestedCell, error instanceof Error ? error.message : String(error));
                            }
                            return invalid('Could not read code cell: ' + (error instanceof Error ? error.message : String(error)));
                        }
                    }
                    if (pendingCellId === requestedCell) {
                        try {
                            const loaded = prepareCellState(result);
                            session = loaded.session;
                            restoredState = loaded.restored;
                            blockedState = null;
                        }
                        catch (error) {
                            return unknown(requestedCell, error instanceof Error ? error.message : String(error));
                        }
                        pendingCellId = undefined;
                        liveCells.delete(requestedCell);
                        return { ...result, details: { ...result.details, cell: { id: requestedCell, status: 'complete' } } };
                    }
                    liveCells.delete(requestedCell);
                    // An old handle is an observation. Never roll back a newer Python heap.
                    const status = result.details.status === 'suspended' ? 'paused'
                        : result.details.status === 'error' ? 'failed' : 'completed';
                    const savedOutput = observation ?? ('(The original output preview is unavailable.)' +
                        (result.details.output
                            ? '\nRead saved output with {"output":"' + result.details.output.id + '","offset":0}.'
                            : ''));
                    return {
                        content: [{ type: 'text', text: '[historical] Saved result for code cell ' + requestedCell +
                                    '. Recorded status: ' + status + '. This observation cannot control the current Python script. ' +
                                    'The current session state is unchanged.\n\n' + (savedOutput || '(No output was saved.)') }],
                        details: { ...controlDetails('ok'), historical: true, output: result.details.output,
                            cell: { id: requestedCell, status: 'complete' } },
                    };
                }
                let cellNote = '';
                if (pendingCellId) {
                    const cell = liveCells.get(pendingCellId);
                    if (cell && !cell.isComplete) {
                        return invalid('A code cell is still running. Use {"wait":"' + pendingCellId +
                            '"} or {"cancel":"' + pendingCellId + '"} before starting or resetting code.');
                    }
                    if (!params.abandon && !params.reset) {
                        return invalid('Collect the pending code cell with {"wait":"' + pendingCellId +
                            '"}. Use abandon=true only after checking any completed effects.');
                    }
                    cellNote = '[note: discarded the uncollected code cell; completed host effects remain]\n';
                    liveCells.delete(pendingCellId);
                    pendingCellId = undefined;
                    session?.abandon();
                }
                const inBridgeContext = (run, runSignal = signal) => bridgeExecution.run(piBridgeContext(ctx, runSignal), run);
                if (params.reset) {
                    session = await inBridgeContext(() => freshSession());
                    blockedState = null;
                    restoredState = null;
                }
                else if (blockedState) {
                    return {
                        content: [{ type: 'text', text: blockedState.error + '\nNo code ran. Use reset=true to discard the saved state explicitly.' }],
                        details: { status: 'error', state: blockedState.state, calls: [] },
                    };
                }
                else if (!session) {
                    session = await inBridgeContext(() => freshSession());
                }
                const current = session;
                const abandoned = params.abandon ? current.abandon() : false;
                if (params.abandon && params.code === undefined && !params.resume) {
                    return {
                        content: [{ type: 'text', text: cellNote ||
                                    (abandoned ? '(suspended script abandoned)' : '(nothing is suspended)') }],
                        details: { status: 'ok', state: savedState(current), calls: [] },
                    };
                }
                if (params.resume && !current.suspendedCode)
                    return invalid('(nothing is suspended; run code normally)');
                if (!params.resume && current.suspendedCode) {
                    return {
                        content: [{ type: 'text', text: '(a script is suspended — use {"resume": true}, ' +
                                    '{"abandon":true}, or reset=true; new code was not run)' }],
                        details: { status: 'suspended', state: savedState(current), calls: [] },
                    };
                }
                if (!params.resume && params.code === undefined)
                    return invalid('(code is required unless resume=true)');
                const onApproval = async (request) => {
                    if (options.autoApprove)
                        return true;
                    if (!ctx?.hasUI)
                        return false;
                    const choice = await ctx.ui.select(`Approve ${formatCall(request)}?`, [
                        APPROVAL_CHOICES.approve, APPROVAL_CHOICES.deny, APPROVAL_CHOICES.suspend,
                    ]);
                    if (choice === APPROVAL_CHOICES.approve)
                        return true;
                    if (choice === APPROVAL_CHOICES.suspend)
                        return 'suspend';
                    return false;
                };
                const capture = new CodeOutput(outputDirectory);
                capture.append(cellNote + (abandoned ? '[note: discarded the previously suspended script]\n' : '') + preludeNote);
                preludeNote = '';
                const cell = new CodeCell(cellDirectory, savedState(current), signal, async (execution) => {
                    let lastUpdate = -Infinity;
                    const emit = (force = false) => {
                        const now = performance.now();
                        if (!execution.foreground || (!force && now - lastUpdate < 100))
                            return;
                        lastUpdate = now;
                        onUpdate?.({
                            content: [{ type: 'text', text: capture.snapshot() }],
                            details: { status: 'ok', state: '', calls: [] },
                        });
                    };
                    const runOptions = {
                        signal: execution.controller.signal,
                        mount: makeMount?.(),
                        onApproval,
                        maxStdoutBytes: OUTPUT_PREVIEW_BYTES,
                        shouldYield: () => execution.yieldRequested || (steering.hasPendingUserSteering?.() ?? false),
                        onPrint: (text) => {
                            capture.append(text);
                            emit();
                        },
                    };
                    let result;
                    try {
                        result = await inBridgeContext(() => params.resume ? current.resume(runOptions) : current.run(params.code, runOptions), execution.controller.signal);
                    }
                    catch (error) {
                        result = {
                            status: 'error', output: undefined, stdout: '', stdoutTruncated: false, calls: [],
                            errorKind: 'runtime', error: error instanceof Error ? error.message : String(error),
                        };
                    }
                    emit(true);
                    const separate = () => {
                        const text = capture.snapshot();
                        if (text && !text.endsWith('\n'))
                            capture.append('\n');
                    };
                    let continuation = '';
                    if (result.status === 'ok') {
                        if (result.output !== null && result.output !== undefined) {
                            separate();
                            capture.append('=> ' + formatValue(result.output));
                        }
                        if (!capture.snapshot())
                            capture.append('(no output)');
                    }
                    else if (result.status === 'suspended') {
                        if (result.suspensionReason === 'steering') {
                            continuation = '[paused] New user input paused the script before ' +
                                formatCall(result.suspendedCall, 200) +
                                '. Completed work will not repeat. Address the new input, then use {"resume": true} ' +
                                'to continue or {"abandon":true} to discard the remaining steps.';
                        }
                        else {
                            continuation = '[suspended] The script is paused awaiting user approval of ' +
                                formatCall(result.suspendedCall, 200) +
                                '. Nothing after that call has run; completed work will not repeat. STOP and tell the user ' +
                                'what is pending. Wait for their decision, then use {"resume": true} or {"abandon":true}.';
                        }
                    }
                    else {
                        separate();
                        capture.append(result.error);
                    }
                    const output = capture.finish(toolName);
                    execution.observation = output.text;
                    const text = output.text + (continuation && output.text && !output.text.endsWith('\n') ? '\n' : '') + continuation;
                    const nested = takeNestedToolCalls?.();
                    return {
                        content: [{ type: 'text', text }],
                        ...(nested?.calls ? { nestedCalls: nested.calls } : {}),
                        ...(nested?.usage ? { usage: nested.usage } : {}),
                        details: {
                            status: result.status, state: savedState(current),
                            calls: result.calls.map((call) => call.tool),
                            ...(output.output ? { output: output.output } : {}),
                        },
                    };
                }, publishCompletion);
                liveCells.set(cell.id, cell);
                pendingCellId = cell.id;
                const result = await cell.wait(steering, signal);
                if (!result)
                    return running(cell);
                if (pendingCellId === cell.id)
                    pendingCellId = undefined;
                liveCells.delete(cell.id);
                return result;
            },
        });
    };
}
function helperExample(registry) {
    const examples = [
        ['ls', '"."'], ['read', '"file.txt"'], ['find', '"*.ts"'], ['grep', '"TODO"'],
    ];
    for (const [name, argument] of examples) {
        const helper = registry.get(name);
        if (helper?.params[0]?.type === 'str' && helper.params.slice(1).every((param) => param.optional)) {
            return `print(${name}(${argument}))`;
        }
    }
    return 'print(1 + 1)';
}
function formatValue(value) {
    try {
        return JSON.stringify(normalizePiToolValue(value)) ?? String(value);
    }
    catch {
        return String(value);
    }
}
function formatCall(request, maxLength = 400) {
    const parts = [
        ...request.args.map(formatValue),
        ...Object.entries(request.kwargs).map(([k, v]) => `${k}=${formatValue(v)}`),
    ];
    const rendered = `${request.tool}(${parts.join(', ')})`;
    return rendered.length > maxLength ? `${rendered.slice(0, maxLength)}…` : rendered;
}
// PiTTy runs the managed extension in trusted parent and headless child sessions.
// The explicit factory still supports approval for other callers.
export default createPythonExtension({ autoApprove: true });
