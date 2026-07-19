import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commitMcpMutation, loadMcpConfig, mcpConfigPath, previewMcpMutation, validateMcpServerForm, type McpFileOperations } from "../src/config/mcp-config.ts";

describe("MCP standard config boundary", () => {
  test("resolves explicit project and global paths", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pitty-mcp-"));
    expect(mcpConfigPath("project", cwd, "/home/test")).toBe(path.join(cwd, ".mcp.json"));
    expect(mcpConfigPath("global", cwd, "/home/test")).toBe(path.join("/home/test", ".config", "mcp", "mcp.json"));
  });
  test("preserves unknown root and server values through atomic mutation", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pitty-mcp-"));
    const file = path.join(cwd, ".mcp.json");
    await writeFile(file, JSON.stringify({ imports: ["x"], settings: { keep: true }, mcpServers: { old: { command: "old", advanced: 4 } } }));
    const snapshot = loadMcpConfig("project", cwd, "/unused");
    const preview = previewMcpMutation(snapshot, { kind: "upsert", server: { name: "new", transport: "stdio", command: "echo", args: ["hi"] } });
    await commitMcpMutation(preview);
    const result = JSON.parse(await readFile(file, "utf8"));
    expect(result.imports).toEqual(["x"]); expect(result.settings).toEqual({ keep: true }); expect(result.mcpServers.old.advanced).toBe(4); expect(result.mcpServers.new.args).toEqual(["hi"]);
  });
  test("rejects unsafe roots and sensitive literals", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pitty-mcp-"));
    await writeFile(path.join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: [] }));
    expect(loadMcpConfig("project", cwd, "/unused").readOnlyReason).toBeTruthy();
    expect(validateMcpServerForm({ name: "x", transport: "stdio", command: "run", env: { API_TOKEN: "literal" } }).valid).toBe(false);
  });
  test("validates HTTP auth and sensitive policy", () => {
    const bearer = { name: "http", transport: "http" as const, url: "https://example.test", authMode: "bearer" as const, bearerTokenEnv: "TOKEN_NAME", headers: { Authorization: "${TOKEN_NAME}" } };
    expect(validateMcpServerForm(bearer).valid).toBe(true);
    const preview = previewMcpMutation({ scope: "project", filePath: "/tmp/mcp.json", exists: false, sourceFingerprint: "missing", document: { mcpServers: {} }, servers: {} }, { kind: "upsert", server: bearer }, true);
    expect(preview.after).toEqual({ url: "https://example.test", headers: { Authorization: "${TOKEN_NAME}" }, auth: "bearer", bearerTokenEnv: "TOKEN_NAME" });
    expect(validateMcpServerForm({ name: "http", transport: "http", url: "ftp://example.test", authMode: "bearer", bearerTokenEnv: "literal-token" }).valid).toBe(false);
    expect(validateMcpServerForm({ name: "stdio", transport: "stdio", command: "run", env: { "API KEY": "literal" } }).valid).toBe(false);
  });
  test("cleans the exclusive temporary file when atomic replacement fails", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pitty-mcp-"));
    const file = path.join(cwd, ".mcp.json"); await writeFile(file, JSON.stringify({ mcpServers: {} }));
    const preview = previewMcpMutation(loadMcpConfig("project", cwd, "/unused"), { kind: "delete", name: "gone" });
    let cleaned = false;
    const operations: McpFileOperations = {
      mkdir: async (directory, options) => fsp.mkdir(directory, options),
      readFile: async (filePath, encoding) => fsp.readFile(filePath, encoding),
      stat: async (filePath) => fsp.stat(filePath),
      writeFile: async (filePath, content, options) => { await fsp.writeFile(filePath, content, options); },
      rename: async () => { throw new Error("rename failed"); },
      unlink: async () => { cleaned = true; },
    };
    await expect(commitMcpMutation(preview, operations)).rejects.toThrow("rename failed");
    expect(cleaned).toBe(true);
  });
  test("warns only when later-precedence sources contain the same name", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pitty-mcp-"));
    await writeFile(path.join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { managed: { command: "x" } } }));
    await import("node:fs/promises").then((fs) => fs.mkdir(path.join(cwd, ".pi"), { recursive: true }));
    await writeFile(path.join(cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { managed: { command: "later" }, other: { command: "y" } } }));
    const snapshot = loadMcpConfig("project", cwd, "/unused");
    expect(snapshot.laterPrecedenceNames).toEqual(["managed"]);
  });
  test("requires preview source to remain unchanged", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pitty-mcp-"));
    const file = path.join(cwd, ".mcp.json"); await writeFile(file, JSON.stringify({ mcpServers: {} }));
    const preview = previewMcpMutation(loadMcpConfig("project", cwd, "/unused"), { kind: "delete", name: "gone" });
    await writeFile(file, JSON.stringify({ mcpServers: { changed: { command: "x" } } }));
    await expect(commitMcpMutation(preview)).rejects.toThrow("changed after preview");
  });
});
