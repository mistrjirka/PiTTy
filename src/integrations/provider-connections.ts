/** Provider login through Pi's existing credential store, never PiTTy config files. */
import { spawn } from "node:child_process";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AuthInteraction, AuthType } from "@earendil-works/pi-ai";

export type ConnectionMethod = AuthType;
export interface ProviderConnection {
  id: string;
  name: string;
  methods: ConnectionMethod[];
  status: "configured" | "not-configured" | "external";
  source?: string;
  stored: boolean;
  description?: string;
}

const featured = ["openai-codex", "claude-code", "opencode-go", "anthropic", "github-copilot", "openai", "opencode"];
export const CLAUDE_CODE_LOGIN_COMMAND = "claude auth login";

export function visibleMethods(provider: { id: string; auth: { oauth?: unknown; apiKey?: { login?: unknown } } }): ConnectionMethod[] {
  // Claude subscriptions belong to first-party Claude Code. In PiTTy, Anthropic
  // is offered only with its API key, not a third-party Claude.ai OAuth flow.
  const methods: ConnectionMethod[] = [];
  if (provider.auth.oauth && provider.id !== "anthropic") methods.push("oauth");
  if (provider.auth.apiKey?.login) methods.push("api_key");
  return methods;
}

export function browserLoginUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("Only secure HTTPS authentication links can be opened.");
  }
  return url.href;
}

/** The URL is supplied by Pi's provider. Never invoke a shell with it. */
export async function openBrowserUrl(rawUrl: string): Promise<void> {
  const url = browserLoginUrl(rawUrl);
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [url], { detached: true, stdio: "ignore", shell: false });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

/** Create this service on demand. It shares Pi's locked auth.json, not a token copy. */
export class ProviderConnectionService {
  private runtimePromise: Promise<ModelRuntime> | undefined;
  constructor(private readonly createRuntime: () => Promise<ModelRuntime> = () =>
    ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false })) {}

  private runtime(): Promise<ModelRuntime> {
    return this.runtimePromise ??= this.createRuntime().catch((error: unknown) => {
      this.runtimePromise = undefined;
      throw error;
    });
  }

  async list(): Promise<ProviderConnection[]> {
    const runtime = await this.runtime();
    const stored = new Map((await runtime.listCredentials()).map((credential) => [credential.providerId, credential.type]));
    const providers = runtime.getProviders().flatMap((provider): ProviderConnection[] => {
      const methods = visibleMethods(provider);
      if (!methods.length) return [];
      const status = runtime.getProviderAuthStatus(provider.id);
      return [{
        id: provider.id,
        name: provider.id === "openai-codex" ? "OpenAI Codex (ChatGPT plan)" : provider.name,
        methods,
        status: status.configured ? "configured" : "not-configured",
        ...(status.configured && status.label ? { source: status.label } : {}),
        stored: stored.has(provider.id),
        ...(provider.id === "anthropic" ? { description: "API key only. For Claude subscription use Claude Code." } : {}),
      }];
    });
    providers.push({
      id: "claude-code", name: "Claude Code (subscription)", methods: [], status: "external", stored: false,
      description: "Uses Claude Code authentication. Run claude auth login in your terminal.",
    });
    return providers.sort((a, b) => {
      const aIndex = featured.indexOf(a.id);
      const bIndex = featured.indexOf(b.id);
      return (aIndex < 0 ? featured.length : aIndex) - (bIndex < 0 ? featured.length : bIndex) || a.name.localeCompare(b.name);
    });
  }

  async login(id: string, method: ConnectionMethod, interaction: AuthInteraction): Promise<void> {
    const runtime = await this.runtime();
    const provider = runtime.getProvider(id);
    if (!provider || !visibleMethods(provider).includes(method)) throw new Error("Unsupported provider login method.");
    await runtime.login(id, method, interaction);
  }

  async logout(id: string): Promise<void> {
    const runtime = await this.runtime();
    if (!(await runtime.listCredentials()).some((credential) => credential.providerId === id))
      throw new Error("There is no stored credential to remove.");
    await runtime.logout(id);
  }
}
