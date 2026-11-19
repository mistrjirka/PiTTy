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
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { MountDir } from '@pydantic/monty';
import { probeImportableModules } from '../core/capabilities.js';
import { renderPythonToolRules, ToolRegistry } from '../core/registry.js';
import { createBuiltinTools } from '../core/builtins.js';
import { Session } from '../core/session.js';
import { ToolStore } from '../core/toolstore.js';
import { createPiBridgeTools } from './bridge.js';
import { decodeSessionState, encodeSessionState } from './state-codec.js';
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
    code: Type.Optional(Type.String({
        description: 'Python code to run. Required unless resume=true. The value of the last top-level expression is returned.',
    })),
    reset: Type.Optional(Type.Boolean({
        description: 'Discard all session state and reload saved tools before running.',
    })),
    resume: Type.Optional(Type.Boolean({
        description: 'Resume the snippet that was suspended awaiting approval. Work done before ' +
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
        // One MountDir per run: monty rejects a mount shared with another live
        // run, and suspended runs stay live (they hold their mount) until GC'd.
        let makeMount;
        if (options.mountWorkspace ?? true) {
            try {
                if (!statSync(root).isDirectory())
                    throw new Error('not a directory');
                makeMount = () => new MountDir('/workspace', root, { mode: 'read-only' });
            }
            catch {
                // root missing/unreadable: degrade to the read_file tool rather than
                // failing the whole extension load
                makeMount = undefined;
            }
        }
        const bridge = options.bridgePiTools ?? true;
        const registry = new ToolRegistry(options.tools);
        if (bridge) {
            for (const tool of createPiBridgeTools(root))
                registry.add(tool);
        }
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
        const gatedNames = registry
            .list()
            .filter((t) => t.requiresApproval)
            .map((t) => t.name);
        const sessionOptions = { tools: registry, limits: options.limits, typeCheck: options.typeCheck };
        // null until first use: a fresh session loads saved tools as a prelude,
        // which is async, so creation happens lazily in execute().
        let session = null;
        let preludeNote = '';
        // set when state came from a previous conversation and hasn't run yet
        let restoredUnverified = false;
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
            let state;
            // Walking backwards avoids reading every historical state snapshot.
            // SessionManager can lazily load large tool-result details from disk.
            const branch = ctx.sessionManager.getBranch();
            for (let index = branch.length - 1; index >= 0; index--) {
                const entry = branch[index];
                if (entry?.type !== 'message')
                    continue;
                const message = entry.message;
                if (message.toolName === toolName && message.details?.state) {
                    state = message.details.state;
                    break;
                }
            }
            try {
                session = state ? Session.load(decodeSessionState(state), sessionOptions) : null;
            }
            catch {
                // unreadable state (e.g. written by an incompatible version): start
                // fresh rather than failing every session start
                session = null;
                state = undefined;
            }
            restoredUnverified = Boolean(state);
        });
        pi.registerTool({
            name: toolName,
            label: 'Code',
            description: [
                'Run Python in a sandboxed interpreter with host tools available as plain',
                'functions. Variables and functions persist across calls in this session.',
                'Prefer this tool when you need to chain tool calls, loop, filter large',
                'results, or compute — do the work in code and print only what you need.',
                '',
                'Python-only helper functions available INSIDE this tool:',
                `- These names are NOT standalone pi tools; they only exist in Python code passed to ${toolName}.`,
                `- Example: call ${toolName} with code like \`print(ls("."))\`; do not try to invoke \`ls\` as a separate pi tool.`,
                '',
                registry.renderStubs(),
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
                renderPythonToolRules(probeImportableModules()),
                ...(gatedNames.length > 0
                    ? [
                        `- Calls to ${gatedNames.join('/')} pause the script for per-call user approval; a denial raises PermissionError (catch it or stop gracefully), and the user may suspend the script instead — resume later with {"resume": true}, or discard it with {"abandon": true}. Group related work so the user approves meaningful units.`,
                    ]
                    : []),
                ...(makeMount
                    ? [
                        `- The workspace is mounted READ-ONLY at /workspace: read files with open("/workspace/<path>") or pathlib. Helper-tool paths such as ls/find results are relative to the workspace root. Files are not iterable — use .read()/.readlines(); parse JSON with json.loads(text). Writes raise PermissionError; change real files with the regular edit/write tools.`,
                    ]
                    : []),
            ].join('\n'),
            promptSnippet: `${toolName}: run sandboxed Python; host tools are callable as functions; state persists`,
            promptGuidelines: [
                `Use ${toolName} for multi-step tool workflows: loop/filter/aggregate in code and print only the result, instead of issuing many separate tool calls.`,
                ...(bridge
                    ? [
                        `Route file changes by how the content is produced. DERIVED content — computed from data (manifests, indexes, conversions, extractions), the same mechanical transform across many files, or writes that must pass programmatic checks first — belongs inside ${toolName} via write()/edit(): code computes it exactly, verifies before writing, and each mutation is shown for approval. AUTHORED content — new code or prose you are composing, or a single judgment-driven edit — belongs in the regular edit/write tools.`,
                    ]
                    : []),
                ...(registry.list().length > 0
                    ? [
                        `Names listed in the ${toolName} tool description are Python helper functions only, not top-level pi tools. If you need one (for example ${formatNameList(registry.list().slice(0, 6).map((t) => t.name))}), call ${toolName} and invoke it from Python code there.`,
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
                if (params.reset || !session) {
                    session = await freshSession();
                    restoredUnverified = false;
                }
                // gated calls freeze the script while the human decides in the TUI;
                // "decide later" suspends the run (resumable via resume=true, even
                // after a restart — the suspension rides in the session state);
                // headless runs deny unless autoApprove opts in
                const onApproval = async (request) => {
                    if (options.autoApprove)
                        return true;
                    if (!ctx?.hasUI)
                        return false;
                    const choice = await ctx.ui.select(`Approve ${formatCall(request)}?`, [
                        APPROVAL_CHOICES.approve,
                        APPROVAL_CHOICES.deny,
                        APPROVAL_CHOICES.suspend,
                    ]);
                    if (choice === APPROVAL_CHOICES.approve)
                        return true;
                    if (choice === APPROVAL_CHOICES.suspend)
                        return 'suspend';
                    return false;
                };
                if (params.resume && params.abandon) {
                    return {
                        content: [{ type: 'text', text: '(choose either resume=true or abandon=true, not both)' }],
                        details: { status: 'error', state: encodeSessionState(session.dump()), calls: [] },
                    };
                }
                const abandoned = params.abandon ? session.abandon() : false;
                if (params.abandon && params.code === undefined && !params.resume) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: abandoned ? '(suspended script abandoned)' : '(nothing is suspended)',
                            },
                        ],
                        details: { status: 'ok', state: encodeSessionState(session.dump()), calls: [] },
                    };
                }
                let streamed = '';
                const runOptions = {
                    signal,
                    mount: makeMount?.(),
                    onApproval,
                    onPrint: (text) => {
                        streamed += text;
                        onUpdate?.({
                            content: [{ type: 'text', text: streamed }],
                            details: { status: 'ok', state: '', calls: [] },
                        });
                    },
                };
                let result;
                if (params.resume) {
                    try {
                        result = await session.resume(runOptions);
                    }
                    catch {
                        return {
                            content: [{ type: 'text', text: '(nothing is suspended — run code normally)' }],
                            details: { status: 'error', state: encodeSessionState(session.dump()), calls: [] },
                        };
                    }
                }
                else {
                    if (session.suspendedCode) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: '(a script is suspended awaiting approval — call with {"resume": true}, ' +
                                        'discard it with {"abandon": true}, or reset=true; new code was not run)',
                                },
                            ],
                            details: { status: 'suspended', state: encodeSessionState(session.dump()), calls: [] },
                        };
                    }
                    if (params.code === undefined) {
                        return {
                            content: [{ type: 'text', text: '(code is required unless resume=true)' }],
                            details: { status: 'error', state: encodeSessionState(session.dump()), calls: [] },
                        };
                    }
                    result = await session.run(params.code, runOptions);
                }
                const abandonNote = abandoned
                    ? '[note: discarded the previously suspended script]\n'
                    : '';
                let text = abandonNote + preludeNote + result.stdout;
                preludeNote = '';
                if (result.status === 'ok') {
                    if (result.output !== null && result.output !== undefined) {
                        if (text && !text.endsWith('\n'))
                            text += '\n';
                        text += `=> ${formatValue(result.output)}`;
                    }
                    if (!text)
                        text = '(no output)';
                }
                else if (result.status === 'suspended') {
                    if (text && !text.endsWith('\n'))
                        text += '\n';
                    text += `[suspended] The script is paused awaiting user approval of ${formatCall(result.suspendedCall, 200)}. Nothing after that call has run; completed work will not repeat. STOP and tell the user what is pending — do NOT call this tool again until the user explicitly says they have decided. Then continue with {"resume": true} (works even in a later session), or discard it with {"abandon": true}.`;
                }
                else {
                    if (text && !text.endsWith('\n'))
                        text += '\n';
                    text += result.error;
                    if (restoredUnverified) {
                        text +=
                            '\n[note: session state was restored from an earlier conversation; if this error references older code, retry with reset=true]';
                    }
                }
                restoredUnverified = false;
                const truncation = truncateHead(text, {
                    maxLines: DEFAULT_MAX_LINES,
                    maxBytes: DEFAULT_MAX_BYTES,
                });
                let finalText = truncation.content;
                if (truncation.truncated)
                    finalText += '\n[output truncated]';
                // dump unconditionally: failed runs can still change session state
                // (consuming or abandoning a suspension), and enumerating which
                // outcomes mutate it here would duplicate Session's rollback rules
                return {
                    content: [{ type: 'text', text: finalText }],
                    details: {
                        status: result.status,
                        state: encodeSessionState(session.dump()),
                        calls: result.calls.map((c) => c.tool),
                    },
                };
            },
        });
    };
}
function formatNameList(names) {
    if (names.length === 0)
        return 'the listed functions';
    if (names.length === 1)
        return names[0];
    return `${names.slice(0, -1).join(', ')}, or ${names[names.length - 1]}`;
}
function formatValue(value) {
    try {
        return JSON.stringify(value) ?? String(value);
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
export default createPythonExtension();
