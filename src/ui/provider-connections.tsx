/** Provider connections for PiTTy. Pi's model runtime owns credentials. */
import { createSignal, onCleanup } from "solid-js";
import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import {
  CLAUDE_CODE_LOGIN_COMMAND,
  ProviderConnectionService,
  openBrowserUrl,
  type ProviderConnection,
  type ConnectionMethod,
} from "../integrations/provider-connections.ts";
import { colors } from "./theme.ts";

const mainProviders = new Set(["openai-codex", "claude-code", "opencode-go", "anthropic", "github-copilot", "openai", "opencode"]);
type PendingPrompt = {
  prompt: AuthPrompt;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  dispose: () => void;
};
function ClickText(props: { label: string; onClick: () => void; disabled?: boolean }) {
  return <text fg={props.disabled ? colors.muted : colors.cyan} onMouseDown={(event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!props.disabled) props.onClick();
  }}>[{props.label}]</text>;
}

export function ProviderConnections(props: {
  onBack: () => void;
  onUpdated: (id: string) => Promise<void>;
  service?: ProviderConnectionService;
}) {
  const service = props.service ?? new ProviderConnectionService();
  const [providers, setProviders] = createSignal<ProviderConnection[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [notice, setNotice] = createSignal("Loading providers…");
  const [error, setError] = createSignal("");
  const [expand, setExpand] = createSignal(false);
  const [authUrl, setAuthUrl] = createSignal("");
  const [code, setCode] = createSignal("");
  const [input, setInput] = createSignal("");
  const [selected, setSelected] = createSignal("");
  const [pending, setPending] = createSignal<PendingPrompt>();
  let abort: AbortController | undefined;
  let mounted = true;
  const refresh = async () => {
    try {
      const data = await service.list();
      if (mounted) {
        setProviders(data);
        setNotice("");
      }
    } catch {
      if (mounted) setError("Could not load Pi providers. Check that Pi is installed.");
    }
  };
  void refresh();
  const answer = (value: string) => {
    const waiting = pending();
    if (!waiting) return;
    setPending(undefined);
    setInput("");
    waiting.dispose();
    waiting.resolve(value);
  };
  const cancel = () => {
    abort?.abort();
    const waiting = pending();
    if (waiting) {
      waiting.dispose();
      waiting.reject(new Error("Sign-in cancelled"));
      setPending(undefined);
    }
    setBusy(false);
    setSelected("");
    setAuthUrl("");
    setCode("");
  };
  onCleanup(() => { mounted = false; cancel(); });
  const ask: AuthInteraction["prompt"] = (prompt) => new Promise<string>((resolve, reject) => {
    if (abort?.signal.aborted || !mounted) { reject(new Error("Sign-in cancelled")); return; }
    if (prompt.type === "secret") {
      // OpenTUI's input widget has no secure masking. Never show keys on screen.
      reject(new Error("Use Pi /login to enter API keys securely in a terminal."));
      return;
    }
    const onAbort = () => {
      const state = pending();
      if (state?.prompt === prompt) setPending(undefined);
      reject(new Error("Sign-in cancelled"));
    };
    prompt.signal?.addEventListener("abort", onAbort, { once: true });
    abort?.signal.addEventListener("abort", onAbort, { once: true });
    const dispose = () => {
      prompt.signal?.removeEventListener("abort", onAbort);
      abort?.signal.removeEventListener("abort", onAbort);
    };
    setInput("");
    setPending({ prompt, resolve, reject, dispose });
  });
  const notify = (event: AuthEvent) => {
    if (!mounted) return;
    if (event.type === "auth_url") {
      setAuthUrl(event.url);
      setNotice(event.instructions ?? "Open the sign-in link, then return to PiTTy.");
    } else if (event.type === "device_code") {
      setAuthUrl(event.verificationUri);
      setCode(event.userCode);
      setNotice("Open the sign-in link and enter the displayed device code.");
    } else if (event.type === "progress" || event.type === "info") setNotice(event.message);
  };
  const start = (provider: ProviderConnection, method: ConnectionMethod) => {
    if (busy()) return;
    setError("");
    setSelected(provider.id);
    if (method === "api_key") {
      setNotice(`For ${provider.name}, run pi and select /login ${provider.id}. Keys are not entered in PiTTy because its input is not masked.`);
      return;
    }
    abort = new AbortController();
    setBusy(true);
    setNotice(`Connecting to ${provider.name}…`);
    setAuthUrl("");
    setCode("");
    void service.login(provider.id, method, { signal: abort.signal, prompt: ask, notify }).then(async () => {
      if (!mounted || abort?.signal.aborted) return;
      setNotice(`${provider.name} connected.`);
      await refresh();
      try { await props.onUpdated(provider.id); }
      catch { setNotice(`${provider.name} connected. Restart this tab to load its models.`); }
    }).catch(() => {
      if (mounted && !abort?.signal.aborted)
        setError("Sign-in did not complete. Retry or use Pi's /login in a terminal.");
    }).finally(() => { if (mounted) { setBusy(false); setPending(undefined); } });
  };
  const disconnect = (provider: ProviderConnection) => {
    if (busy()) return;
    setBusy(true);
    setError("");
    void service.logout(provider.id).then(async () => {
      if (!mounted) return;
      await refresh();
      try { await props.onUpdated(provider.id); }
      catch { setNotice("Disconnected. Restart this tab to update its model list."); }
    }).catch(() => { if (mounted) setError("Could not disconnect. Check permissions on Pi's auth.json."); })
      .finally(() => { if (mounted) setBusy(false); });
  };
  const visible = () => providers().filter((provider) => expand() || mainProviders.has(provider.id));
  return <box position="absolute" left="12%" right="12%" top="8%" bottom={3} zIndex={155}
    padding={1} border borderColor={colors.borderStrong} backgroundColor={colors.panelRaised}
    flexDirection="column" gap={1} onKeyDown={(event) => {
      if (event.name === "escape") { event.preventDefault(); event.stopPropagation(); if (busy()) cancel(); else props.onBack(); }
    }}>
    <box flexDirection="row" height={1} minHeight={1}><text fg={colors.textBright} attributes={1}>Provider connections</text><box flexGrow={1} />
      <ClickText label="Settings" onClick={() => { cancel(); props.onBack(); }} /></box>
    <text fg={colors.subtle}>Use an account or API key supported by Pi. Connections are shared with Pi.</text>
    <scrollbox flexGrow={1} minHeight={1} scrollY viewportCulling={true}>
      {visible().map((provider) => <box flexDirection="column" gap={0} marginBottom={1}>
        <box flexDirection="row"><text fg={colors.textBright}>{provider.name}</text><box flexGrow={1}/>
          <text fg={provider.status === "configured" ? colors.green : colors.muted}>{provider.status === "configured" ? "Connected" : provider.status === "external" ? "Claude Code" : "Not connected"}</text></box>
        <box flexDirection="row" gap={2}>
          {provider.methods.includes("oauth") ? <ClickText label="Sign in" disabled={busy()} onClick={() => start(provider, "oauth")}/> : null}
          {provider.methods.includes("api_key") ? <ClickText label="API key" disabled={busy()} onClick={() => start(provider, "api_key")}/> : null}
          {provider.stored ? <ClickText label="Disconnect" disabled={busy()} onClick={() => disconnect(provider)} /> : null}
          {provider.id === "claude-code" ? <text fg={colors.muted}>Run: {CLAUDE_CODE_LOGIN_COMMAND}</text> : null}
          {provider.description && provider.id !== "claude-code" ? <text fg={colors.subtle}>{provider.description}</text> : null}
        </box>
      </box>)}
      <ClickText label={expand() ? "Fewer providers" : "Other Pi providers"} onClick={() => setExpand(!expand())}/>
      {authUrl() ? <box flexDirection="column" gap={1}>
        <text fg={colors.textBright}>Authentication link</text>
        <ClickText label="Open sign-in page" onClick={() => void openBrowserUrl(authUrl()).catch(() => setError("Browser could not open. Copy the displayed URL into a browser."))}/>
        <text fg={colors.subtle} wrapMode="word">{authUrl()}</text>
        {code() ? <text fg={colors.textBright}>Device code: {code()}</text> : null}
      </box> : null}
      {pending() ? <box flexDirection="column" gap={1}>
        <text fg={colors.textBright} wrapMode="word">{pending()!.prompt.message}</text>
        {pending()!.prompt.type === "select" ? (pending()!.prompt as Extract<AuthPrompt, {type: "select"}>).options.map((item) =>
          <ClickText label={item.label} onClick={() => answer(item.id)} />) : null}
        {pending()!.prompt.type === "text" || pending()!.prompt.type === "manual_code" ? <input
          focused placeholder="Enter code or response" value={input()} onInput={setInput} onSubmit={answer}
          backgroundColor={colors.panel} focusedBackgroundColor={colors.panel} textColor={colors.textBright} /> : null}
        {pending()!.prompt.type !== "select" ? <ClickText label="Submit" onClick={() => answer(input())}/> : null}
      </box> : null}
      {notice() ? <text fg={colors.muted} wrapMode="word">{notice()}</text> : null}
      {error() ? <text fg={colors.red} wrapMode="word">{error()}</text> : null}
      {busy() ? <ClickText label="Cancel sign-in" onClick={cancel} /> : null}
    </scrollbox>
  </box>;
}
