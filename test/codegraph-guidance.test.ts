import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compactCodegraphGuidance, prepareCodegraphGuidance } from "../scripts/codegraph-guidance.mjs";

const source = [
  "function extension(pi) {",
  '  pi.on("before_agent_start", async (event) => {',
  '    const guidance = [',
  '      "Use codegraph_explore for broad flows, codegraph_search for symbol names, codegraph_files for project structure, codegraph_node for known symbols, and codegraph_callers for call relationships.",',
  '      "Read known files directly; use native search for literal matches.",',
  '    ].join("\\n");',
  '    return { systemPrompt: event.systemPrompt + "\\n" + guidance };',
  '  });',
  '  for (const tool of [{name: "codegraph_search"}, {name: "codegraph_callers"}]) {',
  '    pi.registerTool({',
  '      name: tool.name,',
  '      promptGuidelines: [',
  '        `${tool.name} is available for structural code questions backed by the local CodeGraph index.`,',
  '      ],',
  '    });',
  '  }',
  '}',
].join("\n");

type Event = { systemPrompt: string };
type Hook = (event: Event) => Promise<{ systemPrompt: string } | undefined>;
type Definition = { name: string; promptGuidelines: string[] };
interface FixtureApi {
  on(name: string, hook: Hook): void;
  getActiveTools(): string[];
  registerTool(definition: Definition): void;
}

async function runPatched(active: string[]) {
  const patched = compactCodegraphGuidance(source);
  expect(patched.status).toBe("needed");
  const hooks: Hook[] = [];
  const tools: Definition[] = [];
  const api: FixtureApi = {
    on: (_name, hook) => { hooks.push(hook); },
    getActiveTools: () => active,
    registerTool: (tool) => { tools.push(tool); },
  };
  // Execute the fixture so unavailable-tool claims are tested as behavior.
  const register = new Function("pi", patched.source + "\nreturn extension(pi);");
  register(api);
  const hook = hooks[0];
  if (!hook) throw new Error("The extension did not register its prompt hook.");
  return { tools, result: await hook({ systemPrompt: "existing instructions" }) };
}

describe("installed CodeGraph prompt compatibility", () => {
  test("keeps routing and removes redundant per-tool availability rules", async () => {
    const { tools, result } = await runPatched(["read", "codegraph_search"]);
    expect(tools.map((tool) => tool.name)).toEqual(["codegraph_search", "codegraph_callers"]);
    expect(tools.every((tool) => tool.promptGuidelines.length === 0)).toBe(true);
    expect(result?.systemPrompt).toContain("existing instructions");
    expect(result?.systemPrompt).toContain("Read known files directly");
    expect(result?.systemPrompt).not.toContain("codegraph_callers");
  });
  test("omits CodeGraph routing when all of its tools are inactive", async () => {
    expect((await runPatched(["read", "bash"])).result).toBeUndefined();
  });
  test("is idempotent and preserves unfamiliar source", () => {
    const patched = compactCodegraphGuidance(source);
    expect(compactCodegraphGuidance(patched.source)).toEqual({ status: "current", source: patched.source });
    expect(compactCodegraphGuidance("custom extension")).toEqual({ status: "unrecognized", source: "custom extension" });
  });
  test("never removes a temporary file owned by another update", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pitty-codegraph-collision-"));
    try {
      mkdirSync(path.join(root, "extensions"));
      writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@vndv/pi-codegraph", version: "0.1.11" }));
      const file = path.join(root, "extensions/codegraph.ts");
      const temporary = file + ".pitty-" + process.pid + ".tmp";
      writeFileSync(file, source);
      writeFileSync(temporary, "another update");
      expect(() => prepareCodegraphGuidance(root)).toThrow();
      expect(readFileSync(temporary, "utf8")).toBe("another update");
      expect(readFileSync(file, "utf8")).toBe(source);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("dry-run does not write and installation preserves unrelated custom code", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pitty-codegraph-"));
    try {
      mkdirSync(path.join(root, "extensions"));
      writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@vndv/pi-codegraph", version: "0.1.11" }));
      const file = path.join(root, "extensions/codegraph.ts");
      writeFileSync(file, source + "\n// custom implementation remains\n");
      expect(prepareCodegraphGuidance(root, { dryRun: true })).toEqual({ status: "needed", changed: false });
      expect(readFileSync(file, "utf8")).toBe(source + "\n// custom implementation remains\n");
      expect(prepareCodegraphGuidance(root)).toEqual({ status: "updated", changed: true });
      expect(readFileSync(file, "utf8")).toContain("// custom implementation remains");
      expect(prepareCodegraphGuidance(root)).toEqual({ status: "current", changed: false });
      writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "other-package", version: "0.1.11" }));
      expect(prepareCodegraphGuidance(root).status).toBe("unrecognized");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
