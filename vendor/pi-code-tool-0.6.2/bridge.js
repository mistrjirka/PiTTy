/**
 * Bridges pi's tools into Python helpers. In an AgentSession, calls go through
 * the session's registered tools and their validation, hooks, and cancellation.
 * Standalone and older Pi callers retain the built-in tool fallback.
 */
import { createBashTool, createEditTool, createFindTool, createGrepTool, createLsTool, createReadTool, createWriteTool, } from '@earendil-works/pi-coding-agent';
import { HostToolError } from '../core/types.js';
/** Capture the current session dispatcher, or explicitly use the older-Pi fallback. */
export function piBridgeContext(ctx, signal) {
    if (ctx && typeof ctx === 'object' && 'executeTool' in ctx && typeof ctx.executeTool === 'function') {
        const current = ctx;
        return {
            get tools() { return current.tools ?? []; },
            executeTool: (name, args, options) => current.executeTool(name, args, options),
            signal,
        };
    }
    return { signal };
}
/**
 * Mutating helpers keep per-call approval. Registered schemas are read in the
 * active execution so overrides and changed loadouts do not use stale stubs.
 */
export function createPiBridgeTools(cwd, options = {}) {
    const gate = options.gateMutating ?? true;
    const readOnly = [createReadTool, createGrepTool, createFindTool, createLsTool];
    const mutating = [createBashTool, createEditTool, createWriteTool];
    return [
        ...readOnly.map((factory) => wrapPiTool(factory(cwd), false, options)),
        ...mutating.map((factory) => wrapPiTool(factory(cwd), gate, options)),
    ].filter((tool) => tool.name !== options.exclude);
}
function wrapPiTool(tool, requiresApproval, options) {
    const currentTool = () => options.getContext?.()?.tools?.find((entry) => entry.name === tool.name) ?? tool;
    let counter = 0;
    return {
        name: tool.name,
        get description() { return firstSentences(currentTool().description); },
        get params() { return schemaToParams(currentTool().parameters); },
        returns: 'str',
        returnsDescription: piToolReturnsDescription(tool.name),
        requiresApproval,
        async execute(args, kwargs) {
            const context = options.getContext?.();
            const registered = context?.tools?.find((entry) => entry.name === tool.name);
            if (context?.executeTool && !registered) {
                throw new HostToolError(`Tool '${tool.name}' is not callable in this session`, 'PermissionError');
            }
            const positional = schemaToParams((registered ?? tool).parameters).map((param) => param.name);
            const input = {};
            args.forEach((value, index) => {
                const name = positional[index];
                if (!name)
                    throw new HostToolError(`${tool.name} takes at most ${positional.length} arguments`, 'TypeError');
                Object.defineProperty(input, name, { value: normalizePiToolValue(value), enumerable: true, writable: true, configurable: true });
            });
            for (const [key, value] of Object.entries(kwargs)) {
                if (Object.hasOwn(input, key))
                    throw new HostToolError(`got multiple values for argument '${key}'`, 'TypeError');
                Object.defineProperty(input, key, { value: normalizePiToolValue(value), enumerable: true, writable: true, configurable: true });
            }
            let result;
            try {
                if (context?.executeTool) {
                    const outcome = await context.executeTool(tool.name, input, { signal: context.signal });
                    if (outcome.isError)
                        throw new HostToolError(resultText(outcome.result), 'RuntimeError');
                    result = outcome.result;
                }
                else {
                    // No session dispatcher exists in older Pi or standalone bridge use.
                    result = await tool.execute(`bridge-${tool.name}-${counter++}`, input, context?.signal);
                }
            }
            catch (error) {
                if (error instanceof HostToolError)
                    throw error;
                throw new HostToolError(error instanceof Error ? error.message : String(error), 'RuntimeError');
            }
            return resultText(result);
        },
    };
}
function resultText(result) {
    return result.content
        .map((block) => (block.type === 'text' ? String(block.text ?? '') : `[${block.type}]`))
        .join('\n');
}
/** Monty returns Python dictionaries as Maps, while Pi validates JSON objects. */
export function normalizePiToolValue(value) {
    if (value instanceof Map) {
        const entries = [];
        for (const [key, item] of value) {
            if (typeof key !== 'string') {
                throw new HostToolError('Tool dictionaries require string keys', 'TypeError');
            }
            entries.push([key, normalizePiToolValue(item)]);
        }
        return Object.fromEntries(entries);
    }
    if (Array.isArray(value))
        return value.map(normalizePiToolValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizePiToolValue(item)]));
    }
    return value;
}
const PI_TOOL_RETURN_DESCRIPTIONS = {
    read: 'file contents as text, with pi truncation markers for large text files; non-text blocks are represented as markers like [image]',
    grep: 'newline-delimited matching lines with file paths and line numbers, plus pi truncation/no-match messages when applicable',
    find: 'newline-delimited matching file paths relative to the search directory, with pi truncation messages when applicable',
    ls: 'newline-delimited directory entries sorted alphabetically; directories end with "/"',
    bash: 'combined stdout/stderr text and command status/truncation messages from pi',
    edit: 'human-readable edit success or failure summary from pi',
    write: 'human-readable write success or failure summary from pi',
};
function piToolReturnsDescription(name) {
    return PI_TOOL_RETURN_DESCRIPTIONS[name] ?? `text output from pi's ${name} tool; inspect it before parsing if uncertain`;
}
function schemaToParams(schema) {
    const required = new Set(schema.required ?? []);
    return Object.entries(schema.properties ?? {}).map(([name, prop]) => ({
        name,
        type: pythonType(prop),
        description: prop.description,
        optional: !required.has(name),
    }));
}
function pythonType(schema) {
    if (schema.anyOf) {
        const parts = [...new Set(schema.anyOf.map(pythonType))];
        return parts.join(' | ');
    }
    switch (schema.type) {
        case 'string':
            return 'str';
        case 'integer':
            return 'int';
        case 'number':
            return 'float';
        case 'boolean':
            return 'bool';
        case 'array':
            return 'list';
        case 'object':
            return 'dict';
        default:
            return 'object';
    }
}
/** Tool descriptions can be long LLM prompts; keep stub docstrings compact. */
function firstSentences(text, maxLength = 200) {
    const flattened = text.replace(/\s+/g, ' ').trim();
    if (flattened.length <= maxLength)
        return flattened;
    const cut = flattened.slice(0, maxLength);
    const lastStop = cut.lastIndexOf('. ');
    return lastStop > 40 ? cut.slice(0, lastStop + 1) : `${cut}…`;
}
