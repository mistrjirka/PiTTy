import type { PiRpcClient } from "../rpc/pi-rpc-client.ts";
import type { CommandChoice } from "../ui/command-suggestions.tsx";

export type CommandClient = Pick<PiRpcClient, "getCommands">;
export type RemoteCommand = Awaited<ReturnType<CommandClient["getCommands"]>>[number];

export const localCommandChoices: CommandChoice[] = [
	{ name: "help", description: "Show UI commands", source: "ui" },
	{ name: "login", description: "Use /login in the Pi CLI", source: "ui" },
	{
		name: "settings",
		description: "Show current UI and Pi settings",
		source: "ui",
	},
	{
		name: "status",
		description: "Show current UI and Pi settings",
		source: "ui",
	},
	{
		name: "commands",
		description: "List Pi extension, template, and skill commands",
		source: "ui",
	},
	{
		name: "skills",
		description: "Browse and send skill commands",
		source: "ui",
	},
	{ name: "sessions", description: "Browse and resume sessions", source: "ui" },
	{ name: "resume", description: "Alias for /sessions", source: "ui" },
	{
		name: "model",
		description: "Show or change the current model",
		source: "ui",
	},
	{ name: "models", description: "List available models", source: "ui" },
	{
		name: "thinking",
		description: "Show or change reasoning effort",
		source: "ui",
	},
	{
		name: "thoughts",
		description: "Expand or collapse thinking blocks",
		source: "ui",
	},
	{ name: "prompts", description: "Open the request map", source: "ui" },
	{
		name: "memory",
		description: "Browse, search, and remove persistent memory",
		source: "ui",
	},
	{ name: "map", description: "Open the request map", source: "ui" },
	{
		name: "compact",
		description: "Compact conversation context",
		source: "ui",
	},
	{ name: "new", description: "Start a new Pi session", source: "ui" },
	{ name: "name", description: "Set the session name", source: "ui" },
	{
		name: "tools",
		description: "Expand or collapse tool output",
		source: "ui",
	},
	{
		name: "sidebar",
		description: "Enable or disable the sidebar",
		source: "ui",
	},
	{
		name: "autocompact",
		description: "Enable or disable automatic compaction",
		source: "ui",
	},
	{
		name: "retry",
		description: "Enable or disable automatic retry",
		source: "ui",
	},
	{
		name: "steering-mode",
		description: "Set steering delivery mode",
		source: "ui",
	},
	{
		name: "followup-mode",
		description: "Set follow-up delivery mode",
		source: "ui",
	},
];

export function mergeCommandChoices(remote: readonly RemoteCommand[]): CommandChoice[] {
  const commands = new Map<string, CommandChoice>();
  // Pi dispatches extension commands before templates/skills. Preserve that
  // first-wins precedence within the remote inventory. Built-in PiTTy UI
  // commands always win, because PiTTy handles those before forwarding RPC.
  for (const value of remote) {
    if (!value || typeof value.name !== "string") continue;
    const name = value.name.replace(/^\/+/, "").trim();
    if (!name || name.length > 160 || /\s/.test(name)) continue;
    const key = name.toLowerCase();
    if (commands.has(key)) continue;
    const description = typeof value.description === "string" ? value.description : undefined;
    const source = typeof value.source === "string" ? value.source : undefined;
    const location = typeof value.location === "string" && value.location.trim()
      ? value.location : undefined;
    commands.set(key, { name, description, source, location });
  }
  for (const local of localCommandChoices) commands.set(local.name.toLowerCase(), local);
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Syncs Pi's actual command registry while keeping UI-only commands visible.
 * Per-client caching avoids leaking another Pi tab's extension set.
 * Failed refreshes keep the last successful snapshot and back off automatically.
 */
export class CommandCatalogService {
  private readonly clients = new WeakMap<CommandClient, {
    choices: CommandChoice[];
    lastAttemptAt: number;
    inFlight?: Promise<CommandChoice[]>;
  }>();

  constructor(private readonly refreshIntervalMs = 30_000, private readonly onError?: (error: unknown) => void) {}

  snapshot(client: CommandClient): CommandChoice[] {
    return this.clients.get(client)?.choices ?? localCommandChoices;
  }

  invalidate(client: CommandClient): void {
    const previous = this.clients.get(client);
    if (previous) previous.lastAttemptAt = Number.NEGATIVE_INFINITY;
  }

  async refresh(client: CommandClient, options: { force?: boolean; now?: number } = {}): Promise<CommandChoice[]> {
    const now = options.now ?? Date.now();
    let entry = this.clients.get(client);
    if (!entry) {
      entry = { choices: localCommandChoices, lastAttemptAt: Number.NEGATIVE_INFINITY };
      this.clients.set(client, entry);
    }
    if (entry.inFlight) return entry.inFlight;
    if (!options.force && now - entry.lastAttemptAt < this.refreshIntervalMs) return entry.choices;
    entry.lastAttemptAt = now;
    const target = entry;
    const request = client.getCommands().then((remote) => {
      target.choices = mergeCommandChoices(remote);
      return target.choices;
    }).catch((error: unknown) => {
      this.onError?.(error);
      return target.choices;
    }).finally(() => {
      if (target.inFlight === request) delete target.inFlight;
    });
    target.inFlight = request;
    return request;
  }
}
