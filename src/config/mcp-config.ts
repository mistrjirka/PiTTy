import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export type McpScope = "project" | "global";
export type McpTransport = "stdio" | "http";
export type McpHttpAuthMode = "oauth" | "bearer" | "disabled";
export type McpConfigDocument = Record<string, unknown>;
export type McpServerDefinition = Record<string, unknown>;
export type McpServerForm = {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  authMode?: McpHttpAuthMode;
  bearerTokenEnv?: string;
};
export type McpConfigSnapshot = {
  scope: McpScope;
  filePath: string;
  exists: boolean;
  sourceFingerprint: string;
  document: McpConfigDocument;
  servers: Record<string, McpServerDefinition>;
  laterPrecedenceNames?: string[];
  readOnlyReason?: string;
};
export type McpMutation =
  | { kind: "upsert"; server: McpServerForm }
  | { kind: "delete"; name: string };
export type McpPreview = {
  snapshot: McpConfigSnapshot;
  mutation: McpMutation;
  before: McpServerDefinition | undefined;
  after: McpServerDefinition | undefined;
  document: McpConfigDocument;
  warnings: string[];
};
export type McpValidation = { valid: boolean; errors: string[]; warnings: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readServerNames(filePath: string): string[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return [];
    return Object.keys(parsed.mcpServers);
  } catch { return []; }
}
function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function laterNames(scope: McpScope, cwd: string, home: string, names: string[]): string[] {
  const candidates = scope === "global"
    ? [path.join(home, ".pi", "agent", "mcp.json"), path.join(cwd, ".mcp.json"), path.join(cwd, ".pi", "mcp.json")]
    : [path.join(cwd, ".pi", "mcp.json")];
  const later = new Set(candidates.flatMap(readServerNames));
  return names.filter((name) => later.has(name));
}

function fingerprint(stat: fs.Stats | undefined, content: string): string {
  const digest = crypto.createHash("sha256").update(content).digest("hex");
  return stat ? `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${digest}` : `missing:${digest}`;
}
export function mcpConfigPath(scope: McpScope, cwd = process.cwd(), home = os.homedir()): string {
  return scope === "project" ? path.join(cwd, ".mcp.json") : path.join(home, ".config", "mcp", "mcp.json");
}

export function validateMcpServerForm(form: McpServerForm): McpValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(form.name)) errors.push("Server name must be 1–128 letters, numbers, '.', '_' or '-'.");
  if (form.transport === "stdio") {
    if (!form.command?.trim()) errors.push("Command is required.");
    if (form.url || form.headers || form.bearerTokenEnv) errors.push("HTTP fields are not valid for stdio servers.");
    for (const arg of form.args ?? []) if (typeof arg !== "string") errors.push("Arguments must be strings.");
    for (const [key, value] of Object.entries(form.env ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) errors.push(`Invalid environment key: ${key}`);
      if (typeof value !== "string") { errors.push(`Environment value ${key} must be a string.`); continue; }
      if (/token|secret|password|api[ _-]?key|credential|authorization/i.test(key) && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$|^\$env:[A-Za-z_][A-Za-z0-9_]*$/.test(value)) errors.push(`Sensitive environment key ${key} requires an environment reference.`);
      else if (value && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$|^\$env:[A-Za-z_][A-Za-z0-9_]*$/.test(value)) warnings.push(`Environment value ${key} will be stored as plaintext.`);
    }
  } else {
    if (!/^https?:\/\/[^\s]+$/i.test(form.url ?? "")) errors.push("URL must be an HTTP or HTTPS URL.");
    if (form.command || form.args || form.env || form.cwd) errors.push("Stdio fields are not valid for HTTP servers.");
    if (form.authMode && !["oauth", "bearer", "disabled"].includes(form.authMode)) errors.push("HTTP auth mode must be oauth, bearer, or disabled.");
    if (form.bearerTokenEnv && form.authMode !== "bearer") errors.push("Bearer token environment requires bearer auth.");
    for (const [key, value] of Object.entries(form.headers ?? {})) {
      if (!key.trim() || !value.trim()) errors.push("HTTP header names and values must be non-empty.");
      if (typeof value !== "string") { errors.push(`HTTP header value ${key} must be a string.`); continue; }
      if (/authorization|token|secret|password|api[ _-]?key|credential/i.test(key) && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$|^\$env:[A-Za-z_][A-Za-z0-9_]*$/.test(value)) errors.push(`Sensitive header ${key} requires an environment reference.`);
      else if (value && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$|^\$env:[A-Za-z_][A-Za-z0-9_]*$/.test(value)) warnings.push(`Header ${key} will be stored as plaintext.`);
    }
    if (form.bearerTokenEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(form.bearerTokenEnv)) errors.push("Bearer token environment name is invalid.");
  }
  if (form.cwd !== undefined && !form.cwd.trim()) errors.push("Working directory cannot be empty.");
  return { valid: errors.length === 0, errors, warnings };
}

function definition(form: McpServerForm): McpServerDefinition {
  return form.transport === "stdio"
    ? { command: form.command!.trim(), ...(form.args?.length ? { args: [...form.args] } : {}), ...(form.env && Object.keys(form.env).length ? { env: { ...form.env } } : {}), ...(form.cwd?.trim() ? { cwd: form.cwd.trim() } : {}) }
    : { url: form.url!.trim(), ...(form.headers && Object.keys(form.headers).length ? { headers: { ...form.headers } } : {}), auth: form.authMode === "bearer" ? "bearer" : form.authMode === "oauth" ? "oauth" : false, ...(form.bearerTokenEnv ? { bearerTokenEnv: form.bearerTokenEnv } : {}) };
}

export function loadMcpConfig(scope: McpScope, cwd = process.cwd(), home = os.homedir()): McpConfigSnapshot {
  const filePath = mcpConfigPath(scope, cwd, home);
  let content = "";
  let stat: fs.Stats | undefined;
  try { content = fs.readFileSync(filePath, "utf8"); stat = fs.statSync(filePath); } catch (error) {
    if (!isMissingFileError(error)) return { scope, filePath, exists: true, sourceFingerprint: "unreadable", document: {}, servers: {}, readOnlyReason: error instanceof Error ? error.message : String(error) };
  }
  if (!content) return { scope, filePath, exists: false, sourceFingerprint: fingerprint(undefined, ""), document: { mcpServers: {} }, servers: {} };
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return { scope, filePath, exists: true, sourceFingerprint: fingerprint(stat, content), document: {}, servers: {}, readOnlyReason: "MCP configuration is malformed JSON." }; }
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return { scope, filePath, exists: true, sourceFingerprint: fingerprint(stat, content), document: {}, servers: {}, readOnlyReason: "MCP configuration root or mcpServers must be an object." };
  const document: McpConfigDocument = parsed;
  const serverValues = parsed.mcpServers;
  const invalidServer = Object.values(serverValues).some((value) => !isRecord(value));
  if (invalidServer) return { scope, filePath, exists: true, sourceFingerprint: fingerprint(stat, content), document, servers: {}, readOnlyReason: "MCP server definitions must be objects." };
  const servers: Record<string, McpServerDefinition> = {};
  for (const [name, value] of Object.entries(serverValues)) {
    if (isRecord(value)) servers[name] = value;
  }
  return { scope, filePath, exists: true, sourceFingerprint: fingerprint(stat, content), document, servers, laterPrecedenceNames: laterNames(scope, cwd, home, Object.keys(servers)) };
}

export function previewMcpMutation(snapshot: McpConfigSnapshot, mutation: McpMutation, confirmPlaintext = false, confirmDuplicate = false): McpPreview {
  if (snapshot.readOnlyReason) throw new Error(snapshot.readOnlyReason);
  const warnings: string[] = [];
  const document: McpConfigDocument = structuredClone(snapshot.document);
  const servers = isRecord(document.mcpServers) ? document.mcpServers as Record<string, McpServerDefinition> : {};
  const before = mutation.kind === "upsert" ? servers[mutation.server.name] : servers[mutation.name];
  if (mutation.kind === "upsert") {
    if (before !== undefined && !confirmDuplicate) throw new Error(`Server ${mutation.server.name} already exists; replacement confirmation required.`);
    const validation = validateMcpServerForm(mutation.server);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    if (validation.warnings.length && !confirmPlaintext) throw new Error(`${validation.warnings.join(" ")} Confirmation required.`);
    warnings.push(...validation.warnings, ...(mutation.server.transport === "stdio" ? ["Configured command executes with the user's permissions."] : []));
    servers[mutation.server.name] = definition(mutation.server);
  } else delete servers[mutation.name];
  document.mcpServers = servers;
  return { snapshot, mutation, before, after: mutation.kind === "upsert" ? servers[mutation.server.name] : undefined, document, warnings };
}

export type McpFileOperations = {
  mkdir: (directory: string, options: { recursive: true }) => Promise<string | undefined>;
  readFile: (filePath: string, encoding: "utf8") => Promise<string>;
  stat: (filePath: string) => Promise<fs.Stats>;
  writeFile: (filePath: string, content: string, options: { mode: number; flag: "wx" }) => Promise<void>;
  rename: (temporary: string, target: string) => Promise<void>;
  unlink: (filePath: string) => Promise<void>;
};
const defaultMcpFileOperations: McpFileOperations = {
  mkdir: async (directory, options) => fsp.mkdir(directory, options),
  readFile: async (filePath, encoding) => fsp.readFile(filePath, encoding),
  stat: async (filePath) => fsp.stat(filePath),
  writeFile: async (filePath, content, options) => { await fsp.writeFile(filePath, content, options); },
  rename: async (temporary, target) => { await fsp.rename(temporary, target); },
  unlink: async (filePath) => { await fsp.unlink(filePath); },
};

export async function commitMcpMutation(preview: McpPreview, operations: McpFileOperations = defaultMcpFileOperations): Promise<void> {
  let content = "";
  let stat: fs.Stats | undefined;
  try { content = await operations.readFile(preview.snapshot.filePath, "utf8"); stat = await operations.stat(preview.snapshot.filePath); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  if (fingerprint(stat, content) !== preview.snapshot.sourceFingerprint) throw new Error("MCP configuration changed after preview; refresh before writing.");
  const dir = path.dirname(preview.snapshot.filePath);
  await operations.mkdir(dir, { recursive: true });
  const temporary = path.join(dir, `.${path.basename(preview.snapshot.filePath)}.${process.pid}.${Date.now()}.tmp`);
  try { await operations.writeFile(temporary, `${JSON.stringify(preview.document, null, 2)}\n`, { mode: 0o600, flag: "wx" }); await operations.rename(temporary, preview.snapshot.filePath); }
  catch (error) { try { await operations.unlink(temporary); } catch { /* cleanup is best effort */ } throw error; }
}
