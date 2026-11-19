import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MontySyntaxError } from '@pydantic/monty/node';
import { checkCode } from './runtime.js';
import { arg, requireString } from './args.js';
import { HostToolError } from './types.js';
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;
/**
 * Stores agent-built "ephemeral tools" as plain Python files in a directory
 * (one `<name>.py` per tool, first line `# <description>`). User-inspectable
 * and -editable. `hostTools()` exposes save/delete/list/read to the sandbox
 * so the agent grows its own toolbox; saved code is fed into new sessions as
 * a prelude.
 */
export class ToolStore {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    async list() {
        let files;
        try {
            files = await readdir(this.dir);
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return [];
            throw e;
        }
        const tools = [];
        for (const file of files.filter((f) => f.endsWith('.py')).sort()) {
            const name = file.slice(0, -3);
            if (!IDENTIFIER.test(name))
                continue;
            tools.push(parseToolFile(name, await readFile(join(this.dir, file), 'utf8')));
        }
        return tools;
    }
    async get(name) {
        if (!IDENTIFIER.test(name))
            return undefined;
        try {
            return parseToolFile(name, await readFile(join(this.dir, `${name}.py`), 'utf8'));
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return undefined;
            throw e;
        }
    }
    /** Validates and writes a tool; overwriting an existing tool is allowed. */
    async save(name, code, description) {
        if (!IDENTIFIER.test(name)) {
            throw new HostToolError(`'${name}' is not a valid Python identifier`, 'ValueError');
        }
        try {
            await checkCode(code, { scriptName: `${name}.py` });
        }
        catch (e) {
            if (e instanceof MontySyntaxError) {
                throw new HostToolError(`code has a syntax error: ${e.display('msg')}`, 'ValueError');
            }
            throw e;
        }
        if (!new RegExp(`(^|\\n)def\\s+${name}\\s*\\(`).test(code)) {
            throw new HostToolError(`code must define a function named '${name}'`, 'ValueError');
        }
        await mkdir(this.dir, { recursive: true });
        const header = `# ${description.replace(/\s*\n\s*/g, ' ').trim()}\n`;
        await writeFile(join(this.dir, `${name}.py`), header + code.replace(/\n*$/, '\n'));
    }
    async delete(name) {
        if (!IDENTIFIER.test(name))
            return false;
        try {
            await rm(join(this.dir, `${name}.py`));
            return true;
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return false;
            throw e;
        }
    }
    /**
     * Concatenated saved-tool code, to run as a new session's first snippet.
     * Caveats: one malformed file fails the whole snippet, and monty resolves a
     * function's globals only if defined before it, so cross-tool calls break
     * unless alphabetical order happens to match dependency order. Prefer
     * loading tools one at a time with retry (see the pi extension).
     */
    async prelude() {
        return (await this.list()).map((t) => t.code.trim()).join('\n\n');
    }
    /** One line per saved tool, for the prompt's "Saved tools" section. */
    async renderSummary() {
        return (await this.list())
            .map((t) => `- ${t.name}: ${t.description}`)
            .join('\n');
    }
    /**
     * Host tools that let the sandboxed code manage the store.
     * `isReserved` guards against shadowing real host tools. `validate` runs
     * the candidate code in isolation (e.g. a fresh session) and returns an
     * error string when it can't stand alone — catching code that leans on
     * session-local imports or variables that won't exist next session.
     */
    hostTools(isReserved, validate) {
        const saveTool = {
            name: 'save_tool',
            description: 'Save a Python function as a reusable tool for future sessions. The code must ' +
                'define a function with the given name. Saved tools are auto-loaded into new ' +
                'sessions (and into this one after running with reset=true); to use the function ' +
                'right now, also define it normally. Overwrites any existing tool with that name.',
            params: [
                { name: 'name', type: 'str', description: 'Tool name (Python identifier).' },
                { name: 'code', type: 'str', description: 'Python source defining the function.' },
                { name: 'description', type: 'str', description: 'One line: what it does, args, returns.' },
            ],
            returns: 'str',
            returnsDescription: 'confirmation string naming the saved tool',
            execute: async (args, kwargs) => {
                const name = requireString(arg(args, kwargs, 0, 'name'), 'name');
                const code = requireString(arg(args, kwargs, 1, 'code'), 'code');
                const description = requireString(arg(args, kwargs, 2, 'description'), 'description');
                if (isReserved(name)) {
                    throw new HostToolError(`'${name}' is a built-in tool name and cannot be replaced`, 'ValueError');
                }
                if (validate) {
                    const problem = await validate(code);
                    if (problem !== null) {
                        throw new HostToolError(`the code does not work in a fresh session (${problem}); make it ` +
                            'self-contained — include any imports it needs inside the code', 'ValueError');
                    }
                }
                await this.save(name, code, description);
                return `Saved tool '${name}'. It loads automatically in new sessions.`;
            },
        };
        const deleteTool = {
            name: 'delete_tool',
            description: 'Delete a previously saved tool.',
            params: [{ name: 'name', type: 'str' }],
            returns: 'str',
            returnsDescription: 'confirmation string naming the deleted tool',
            execute: async (args, kwargs) => {
                const name = requireString(arg(args, kwargs, 0, 'name'), 'name');
                if (!(await this.delete(name))) {
                    throw new HostToolError(`no saved tool named '${name}'`, 'KeyError');
                }
                return `Deleted tool '${name}'.`;
            },
        };
        const listTools = {
            name: 'list_saved_tools',
            description: 'List saved tools.',
            params: [],
            returns: 'list[dict]',
            returnsDescription: 'dicts with keys "name" and "description"',
            execute: async () => (await this.list()).map((t) => ({ name: t.name, description: t.description })),
        };
        const readTool = {
            name: 'read_tool',
            description: 'Read the source code of a saved tool.',
            params: [{ name: 'name', type: 'str' }],
            returns: 'str',
            returnsDescription: 'Python source code for the saved tool, excluding the description header',
            execute: async (args, kwargs) => {
                const name = requireString(arg(args, kwargs, 0, 'name'), 'name');
                const tool = await this.get(name);
                if (!tool)
                    throw new HostToolError(`no saved tool named '${name}'`, 'KeyError');
                return tool.code;
            },
        };
        return [saveTool, deleteTool, listTools, readTool];
    }
}
function parseToolFile(name, content) {
    const firstLine = content.split('\n', 1)[0];
    const hasHeader = firstLine.startsWith('# ');
    return {
        name,
        description: hasHeader ? firstLine.slice(2).trim() : '',
        code: hasHeader ? content.slice(firstLine.length + 1) : content,
    };
}
