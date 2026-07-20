import { createMemo, createSignal, type Accessor } from "solid-js";
import type { TextareaRenderable } from "@opentui/core";
import stripAnsi from "strip-ansi";
import { colors } from "./theme.ts";
import type { McpConfigSnapshot, McpHttpAuthMode, McpMutation, McpPreview, McpScope, McpServerForm } from "../config/mcp-config.ts";

export type McpInstallState = "missing" | "installing" | "install-failed" | "ready";
export type McpConfigState = "empty" | "loaded" | "malformed-readonly" | "mutation-preview" | "saved-active" | "saved-pending-busy" | "saved-inactive-retry";
export type McpFormConfirmations = { confirmDuplicate?: boolean; confirmPlaintext?: boolean };
export type McpSettingsView = "list" | "form";
type McpActionProps = { label: string; onPress: () => void };
type McpServerRowSummary = { transport: "stdio" | "HTTP" | "unknown"; definition: string };

function clipMcpDefinition(value: string, limit = 52): string {
  const singleLine = stripAnsi(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return singleLine.length > limit ? `${singleLine.slice(0, limit - 1)}…` : singleLine;
}

function mcpServerRowSummary(definition: Record<string, unknown>): McpServerRowSummary {
  if (typeof definition.command === "string") {
    const args = Array.isArray(definition.args) ? definition.args.filter((item): item is string => typeof item === "string") : [];
    return { transport: "stdio", definition: clipMcpDefinition([definition.command, ...args].join(" ")) };
  }
  if (typeof definition.url === "string") return { transport: "HTTP", definition: clipMcpDefinition(definition.url) };
  return { transport: "unknown", definition: "Unsupported server definition" };
}
function McpAction(props: McpActionProps) {
  const press = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    props.onPress();
  };
  return <text id={`mcp-action-${props.label.toLowerCase().replaceAll(" ", "-")}`} fg={colors.cyan} onMouseDown={press}>[{props.label}]</text>;
}

export type McpSettingsProps = {
  adapterState: Accessor<McpInstallState>;
  configState: Accessor<McpConfigState>;
  scope: Accessor<McpScope>;
  snapshot: Accessor<McpConfigSnapshot | undefined>;
  preview: Accessor<McpPreview | undefined>;
  error: Accessor<string | undefined>;
  onInstall: () => void;
  onScope: (scope: McpScope) => void;
  onAdd: (form: McpServerForm, confirmations?: McpFormConfirmations) => void;
  onDelete: (name: string) => void;
  onConfirmPreview: () => void;
  onCancelPreview: () => void;
  onRetryActivation: () => void;
  view: Accessor<McpSettingsView>;
  onViewChange: (view: McpSettingsView) => void;
  onBack: () => void;
};

export function McpSettings(props: McpSettingsProps) {
  const [name, setName] = createSignal("");
  const [transport, setTransport] = createSignal<"stdio" | "http">("stdio");
  const [command, setCommand] = createSignal("");
  const [args, setArgs] = createSignal("");
  const [env, setEnv] = createSignal("");
  const [cwd, setCwd] = createSignal("");
  const [url, setUrl] = createSignal("");
  const [headers, setHeaders] = createSignal("");
  const [authMode, setAuthMode] = createSignal<McpHttpAuthMode>("disabled");
  const [bearerTokenEnv, setBearerTokenEnv] = createSignal("");
  let argsInput: TextareaRenderable | undefined;
  let envInput: TextareaRenderable | undefined;
  let headersInput: TextareaRenderable | undefined;
  const [editing, setEditing] = createSignal(false);
  const view = () => props.view();
  const [confirmDuplicate, setConfirmDuplicate] = createSignal(false);
  const [confirmPlaintext, setConfirmPlaintext] = createSignal(false);
  const [executionConfirmed, setExecutionConfirmed] = createSignal(false);
  const [executionError, setExecutionError] = createSignal<string>();
  const snapshot = createMemo(() => props.snapshot());
  const names = createMemo(() => Object.keys(snapshot()?.servers ?? {}));
  const pathText = createMemo(() => snapshot()?.filePath ?? "Select a scope to inspect MCP configuration.");
  const state = createMemo(() => props.configState());
  const parseMap = (raw: string): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const line of raw.split("\n")) { const separator = line.indexOf("="); if (separator > 0) result[line.slice(0, separator).trim()] = line.slice(separator + 1); }
    return result;
  };
  const resetForm = () => { setName(""); setTransport("stdio"); setCommand(""); setArgs(""); setEnv(""); setCwd(""); setUrl(""); setHeaders(""); setAuthMode("disabled"); setBearerTokenEnv(""); setEditing(false); setConfirmDuplicate(false); setConfirmPlaintext(false); setExecutionConfirmed(false); setExecutionError(undefined); };
  const closeForm = () => { resetForm(); props.onViewChange("list"); };
  const openAddForm = () => { resetForm(); props.onViewChange("form"); };
  const editServer = (serverName: string) => {
    const value = snapshot()?.servers[serverName];
    if (!value) return;
    setName(serverName); setEditing(true);
    if (typeof value.command === "string") { setTransport("stdio"); setCommand(value.command); setArgs(Array.isArray(value.args) ? value.args.filter((item): item is string => typeof item === "string").join("\n") : ""); setEnv(typeof value.env === "object" && value.env !== null ? Object.entries(value.env).map(([key, item]) => `${key}=${String(item)}`).join("\n") : ""); setCwd(typeof value.cwd === "string" ? value.cwd : ""); }
    else { setTransport("http"); setUrl(typeof value.url === "string" ? value.url : ""); setHeaders(typeof value.headers === "object" && value.headers !== null ? Object.entries(value.headers).map(([key, item]) => `${key}=${String(item)}`).join("\n") : ""); setAuthMode(value.auth === "oauth" || value.auth === "bearer" ? value.auth : "disabled"); setBearerTokenEnv(typeof value.bearerTokenEnv === "string" ? value.bearerTokenEnv : ""); }
    props.onViewChange("form");
  };
  const submit = () => {
    if (transport() === "stdio" && !executionConfirmed()) { setExecutionError("Confirm command execution with your user permissions before preview."); return; }
    setExecutionError(undefined);
    const form: McpServerForm = transport() === "stdio"
      ? { name: name().trim(), transport: "stdio", command: command(), args: args().split("\n").filter((item) => item.length > 0), env: parseMap(env()), ...(cwd() ? { cwd: cwd() } : {}) }
      : { name: name().trim(), transport: "http", url: url(), headers: parseMap(headers()), authMode: authMode(), ...(bearerTokenEnv() ? { bearerTokenEnv: bearerTokenEnv() } : {}) };
    props.onAdd(form, { confirmDuplicate: confirmDuplicate(), confirmPlaintext: confirmPlaintext() });
  };
  return (
    <box position="absolute" left="12%" right="12%" top={1} bottom={2} flexDirection="column" padding={1} backgroundColor={colors.panelRaised} border borderColor={colors.borderStrong} zIndex={150} onKeyDown={(event) => {
      if (event.name !== "escape" || view() !== "form") return;
      event.preventDefault();
      event.stopPropagation();
      closeForm();
    }}>
      <box height={1} minHeight={1} flexShrink={0} flexDirection="row"><text fg={colors.textBright} attributes={1}>MCP servers</text><box flexGrow={1} /><text fg={colors.cyan} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); if (view() === "form") closeForm(); else props.onBack(); }}>← {view() === "form" ? "Servers" : "Settings"}</text></box>
      <text fg={colors.subtle}>Standard config only; PiTTy never invokes /mcp or /mcp setup.</text>
      <scrollbox flexGrow={1} minHeight={1} scrollY viewportCulling={true}>
      {props.adapterState() === "missing" ? <text fg={colors.yellow}>pi-mcp-adapter is missing. Configured commands execute with your user permissions.</text> : null}
      {props.adapterState() === "installing" ? <text fg={colors.muted}>Installing pi-mcp-adapter…</text> : null}
      {props.adapterState() === "install-failed" ? <text fg={colors.red}>Install failed; PiTTy remains usable. Check the retained install log and retry.</text> : null}
      {props.adapterState() === "missing" ? <McpAction label="Install adapter" onPress={props.onInstall} /> : null}
      <box flexDirection="row"><McpAction label="Project scope" onPress={() => { closeForm(); props.onScope("project"); }} /><McpAction label="Global scope" onPress={() => { closeForm(); props.onScope("global"); }} /></box>
      <text fg={colors.muted}>Scope: {props.scope()} · Path: {pathText()}</text>
      {props.scope() === "global" ? <text fg={colors.yellow}>Global changes affect other MCP hosts.</text> : null}
      {(snapshot()?.laterPrecedenceNames ?? []).length ? <text fg={colors.yellow}>Later-precedence sources may shadow: {(snapshot()?.laterPrecedenceNames ?? []).join(", ")}</text> : null}
      {state() === "malformed-readonly" ? <text fg={colors.red}>Malformed or unsafe config: read-only; no rewrite is possible.</text> : null}
      {state() === "saved-active" ? <text fg={colors.green}>Saved; same-session restart completed.</text> : null}
      {state() === "saved-pending-busy" ? <text fg={colors.yellow}>Saved; activation waits for the current agent to settle.</text> : null}
      {state() === "saved-inactive-retry" ? <text fg={colors.red}>Saved but inactive because restart failed.</text> : null}
      {state() === "saved-inactive-retry" ? <McpAction label="Retry activation" onPress={props.onRetryActivation} /> : null}
      {view() === "list" ? <>
        {names().length ? <box flexDirection="column">
          {names().map((serverName) => {
            const summary = mcpServerRowSummary(snapshot()?.servers[serverName] ?? {});
            const shadowed = snapshot()?.laterPrecedenceNames?.includes(serverName) ?? false;
            return <box flexDirection="column">
              <box flexDirection="row"><text fg={colors.textBright}>{serverName}</text><text fg={colors.muted}> · {summary.transport}</text><box flexGrow={1} /><McpAction label="Edit" onPress={() => editServer(serverName)} /><McpAction label="Delete confirmation" onPress={() => props.onDelete(serverName)} /></box>
              <text fg={colors.muted}>  {summary.definition}</text>
              <text fg={colors.subtle}>  Configured in {props.scope()} scope</text>
              {shadowed ? <text fg={colors.yellow}>  Later source may override fields</text> : null}
            </box>;
          })}
        </box> : <text fg={colors.text}>No servers in selected scope.</text>}
        <McpAction label="Add server" onPress={openAddForm} />
      </> : <box flexDirection="column">
        <text fg={colors.textBright}>{editing() ? "Edit server" : "Add server"}</text>
        <input placeholder="Name" value={name()} onInput={(event) => setName(event)} />
        <select options={[{ name: "stdio", description: "Command process", value: "stdio" }, { name: "HTTP", description: "HTTP endpoint", value: "http" }]} selectedIndex={transport() === "stdio" ? 0 : 1} onSelect={(index) => setTransport(index === 0 ? "stdio" : "http")} />
        {transport() === "stdio" ? <>
          <input placeholder="Command (required)" value={command()} onInput={(event) => setCommand(event)} />
          <textarea ref={(value) => { argsInput = value; }} placeholder="Ordered args, one per line" onContentChange={() => setArgs(argsInput?.plainText ?? "")} />
          <textarea ref={(value) => { envInput = value; }} placeholder="Environment KEY=value, one per line" onContentChange={() => setEnv(envInput?.plainText ?? "")} />
          <input placeholder="Working directory (optional)" value={cwd()} onInput={(event) => setCwd(event)} />
          <text fg={colors.yellow}>Exact command and arguments execute with your user permissions.</text><McpAction label="Confirm command execution" onPress={() => { setExecutionConfirmed(true); setExecutionError(undefined); }} />{executionError() ? <text fg={colors.red}>{executionError()}</text> : null}
        </> : <>
          <input placeholder="http(s) URL (required)" value={url()} onInput={(event) => setUrl(event)} />
          <textarea ref={(value) => { headersInput = value; }} placeholder="Headers KEY=value, one per line" onContentChange={() => setHeaders(headersInput?.plainText ?? "")} />
          <select options={[{ name: "Auth disabled", description: "No auth", value: "disabled" }, { name: "Bearer", description: "Environment token reference", value: "bearer" }, { name: "OAuth", description: "Adapter OAuth", value: "oauth" }]} selectedIndex={authMode() === "disabled" ? 0 : authMode() === "bearer" ? 1 : 2} onSelect={(index) => setAuthMode(index === 0 ? "disabled" : index === 1 ? "bearer" : "oauth")} />
          {authMode() === "bearer" ? <input placeholder="Bearer token environment name" value={bearerTokenEnv()} onInput={(event) => setBearerTokenEnv(event)} /> : null}
        </>}
        <box flexDirection="row"><McpAction label={`Preview ${editing() ? "edit" : "add"}`} onPress={submit} /><McpAction label="Cancel" onPress={closeForm} /></box>
        <box flexDirection="row"><input placeholder="Confirm duplicate replacement: type yes" value={confirmDuplicate() ? "yes" : ""} onInput={(event) => setConfirmDuplicate(event.toLowerCase() === "yes")} /><input placeholder="Confirm plaintext storage: type yes" value={confirmPlaintext() ? "yes" : ""} onInput={(event) => setConfirmPlaintext(event.toLowerCase() === "yes")} /></box>
      </box>}
      {state() === "mutation-preview" && props.preview() ? <box flexDirection="column"><text fg={colors.yellow}>Before/after preview — confirm to write.</text><text>Scope: {props.scope()} · Path: {pathText()}</text><text>{JSON.stringify(props.preview()?.before ?? null)} → {JSON.stringify(props.preview()?.after ?? null)}</text>{props.preview()?.warnings.map((warning) => <text fg={colors.yellow}>{warning}</text>)}<text>Cancel leaves the selected file unchanged.</text><McpAction label="Confirm atomic write" onPress={props.onConfirmPreview} /><McpAction label="Cancel preview" onPress={props.onCancelPreview} /></box> : null}
      {props.error() ? <text fg={colors.red}>{props.error()}</text> : null}
      </scrollbox>
    </box>
  );
}

export type McpMutationAction = { mutation: McpMutation; requiresConfirmation: boolean };
