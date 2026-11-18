/** Local UI slash commands. Unknown names remain Pi extension commands. */
import type { ThinkingLevel } from "../rpc/pi-rpc-client.ts";
import type { SystemItem } from "../types.ts";
import type { ModelChoice } from "../ui/model-selector.tsx";
import type { CommandChoice } from "../ui/command-suggestions.tsx";
import { THINKING_LEVELS } from "../ui/thinking-selector.tsx";
import type { PiRpcClient } from "../rpc/pi-rpc-client.ts";

/** Only the typed data used by built-in slash commands, not the entire tab. */
export type SlashRuntime = {
  client: Pick<PiRpcClient,
    "setAutoCompaction" | "setAutoRetry" | "setSteeringMode" | "setFollowUpMode" |
    "setThinkingLevel" | "setModel" | "getCommands" | "compact" |
    "newSession" | "setSessionName">;
  conversation: { isCompacting: boolean };
  sessionState?: {
    model?: { provider: string; id: string } | null;
    thinkingLevel?: string;
    autoCompactionEnabled?: boolean;
    steeringMode?: string;
    followUpMode?: string;
  } | undefined;
};

const LOGIN_GUIDANCE = "Sorry, login is not supported in PiTTy yet. Run `pi` and use /login there; your credentials will then be available to PiTTy.";

export function parseOnOff(value: string | undefined): boolean | undefined {
  if (value === "on" || value === "true" || value === "enable" || value === "enabled") return true;
  if (value === "off" || value === "false" || value === "disable" || value === "disabled") return false;
  return undefined;
}

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_LEVELS.some((level) => level === value);
}

/** Typed view callbacks. Only a controller owns the Pi session. */
export type SlashCommandPorts<T extends SlashRuntime> = {
  addSystem(runtime: T, message: string, tone?: SystemItem["tone"]): void;
  openSessionSelector(): void;
  openSettings(): void;
  expandedTools(): boolean;
  setExpandedTools(value: boolean): void;
  setExpandedToolIds(ids: Set<string>): void;
  sidebarEnabled(): boolean;
  setSidebarEnabled(value: boolean): void;
  refreshState(runtime: T): Promise<boolean>;
  refreshCommands(runtime: T): Promise<readonly CommandChoice[]>;
  autoRetryEnabled(): boolean;
  setAutoRetryEnabled(value: boolean): void;
  rememberThinkingLevel(runtime: T, level?: ThinkingLevel): void;
  applyRememberedThinkingLevel(runtime: T, provider: string, modelId: string): Promise<void>;
  fetchAvailableModels(): Promise<ModelChoice[]>;
  loadCurrentSession(runtime: T): Promise<void>;
  setSkillSelectorOpen(value: boolean): void;
  setAllThinkingExpanded(value: boolean): void;
  thinkingExpanded(): boolean;
  promptMapCount(): number;
  setPromptMapOpen(value: boolean): void;
  openMemoryBrowser(): void;
};

/** Routes only built-in UI commands. Pi processes unknown /commands itself. */
export class SlashCommandController<T extends SlashRuntime> {
  constructor(private readonly ports: SlashCommandPorts<T>) {}

  async handle(text: string, runtime: T): Promise<boolean> {
    const {
      openSessionSelector, openSettings,
      expandedTools, setExpandedTools, setExpandedToolIds,
      sidebarEnabled, setSidebarEnabled, refreshState, refreshCommands, setAutoRetryEnabled,
      rememberThinkingLevel, applyRememberedThinkingLevel,
      fetchAvailableModels, loadCurrentSession, setSkillSelectorOpen,
      setAllThinkingExpanded, thinkingExpanded, setPromptMapOpen, openMemoryBrowser,
    } = this.ports;
    const addSystem = (message: string, tone: SystemItem["tone"] = "info"): void =>
      this.ports.addSystem(runtime, message, tone);

		if (!text.startsWith("/")) return false;
		const [rawName = "", ...parts] = text.slice(1).trim().split(/\s+/);
		const name = rawName.toLowerCase();
		const argument = parts.join(" ").trim();

		switch (name) {
			case "login":
				addSystem(LOGIN_GUIDANCE, "warning");
				return true;
			case "help":
				addSystem(
					[
						"UI commands:",
						"  /settings /status /commands [search] /sessions /resume",
						"  /model [provider/model] /thinking [level]",
						"  /thoughts expanded|collapsed /prompts",
						"  /compact [instructions] /new /name <name>",
						"  /memory (Ctrl+M, or Settings > Memory) browse/search/remove persistent memory",
						"  /tools on|off /sidebar on|off",
						"  /autocompact on|off /retry on|off",
						"  /steering-mode all|one-at-a-time",
						"  /followup-mode all|one-at-a-time",
						"  Ctrl+T (or Shift+Tab) cycles thinking effort; click a Thinking heading to expand/collapse it.",
						"",
						"Unknown /commands are passed to Pi, so extension, prompt-template, and skill commands still work.",
						"Session browsing is available through /sessions and /resume.",
					].join("\n"),
				);
				return true;
			case "sessions":
			case "resume":
				openSessionSelector();
				return true;
			case "settings":
				openSettings();
				return true;
			case "status":
				addSystem(this.settingsSummary(runtime));
				return true;
			case "tools": {
				const value = parseOnOff(parts[0]);
				const next = value ?? !expandedTools();
				setExpandedTools(next);
				if (!next) setExpandedToolIds(new Set());
				addSystem(`Tool output ${next ? "expanded" : "collapsed"}.`, "success");
				return true;
			}
			case "sidebar": {
				const value = parseOnOff(parts[0]);
				const next = value ?? !sidebarEnabled();
				setSidebarEnabled(next);
				addSystem(`Sidebar ${next ? "enabled" : "disabled"}.`, "success");
				return true;
			}
			case "autocompact": {
				const value = parseOnOff(parts[0]);
				if (value === undefined) {
					addSystem("Usage: /autocompact on|off", "warning");
					return true;
				}
				await runtime.client.setAutoCompaction(value);
				await refreshState(runtime);
				addSystem(
					`Automatic compaction ${value ? "enabled" : "disabled"}.`,
					"success",
				);
				return true;
			}
			case "retry": {
				const value = parseOnOff(parts[0]);
				if (value === undefined) {
					addSystem("Usage: /retry on|off", "warning");
					return true;
				}
				await runtime.client.setAutoRetry(value);
				setAutoRetryEnabled(value);
				addSystem(
					`Automatic retry ${value ? "enabled" : "disabled"}.`,
					"success",
				);
				return true;
			}
			case "steering-mode": {
				const mode = parts[0];
				if (mode !== "all" && mode !== "one-at-a-time") {
					addSystem("Usage: /steering-mode all|one-at-a-time", "warning");
					return true;
				}
				await runtime.client.setSteeringMode(mode);
				await refreshState(runtime);
				addSystem(`Steering mode set to ${mode}.`, "success");
				return true;
			}
			case "followup-mode":
			case "follow-up-mode": {
				const mode = parts[0];
				if (mode !== "all" && mode !== "one-at-a-time") {
					addSystem("Usage: /followup-mode all|one-at-a-time", "warning");
					return true;
				}
				await runtime.client.setFollowUpMode(mode);
				await refreshState(runtime);
				addSystem(`Follow-up mode set to ${mode}.`, "success");
				return true;
			}
			case "thinking": {
				if (!argument) {
					addSystem(
						`Thinking level: ${runtime.sessionState?.thinkingLevel ?? "unknown"}. Thinking text stays visible; click each Thinking heading to expand or collapse it.`,
					);
					return true;
				}
				if (!isThinkingLevel(argument)) {
					addSystem(
						"Usage: /thinking minimal|low|medium|high|xhigh|max",
						"warning",
					);
					return true;
				}
				await runtime.client.setThinkingLevel(argument);
				await refreshState(runtime);
				rememberThinkingLevel(runtime, argument);
				addSystem(`Thinking level set to ${argument}.`, "success");
				return true;
			}
			case "model": {
				if (!argument) {
					const model = runtime.sessionState?.model;
					addSystem(
						`Current model: ${model ? `${model.provider}/${model.id}` : "unknown"}. Press Ctrl+P to choose from a list, or use /model provider/model-id.`,
					);
					return true;
				}
				const slash = argument.indexOf("/");
				if (slash <= 0 || slash === argument.length - 1) {
					addSystem("Usage: /model provider/model-id", "warning");
					return true;
				}
				rememberThinkingLevel(runtime);
				const provider = argument.slice(0, slash);
				const modelId = argument.slice(slash + 1);
				await runtime.client.setModel(provider, modelId);
				await applyRememberedThinkingLevel(runtime, provider, modelId);
				await refreshState(runtime);
				addSystem(`Model set to ${argument}.`, "success");
				return true;
			}
			case "models": {
				const models = await fetchAvailableModels();
				const labels = models.map((value) => `${value.provider}/${value.id}`);
				addSystem(
					`Available models (${labels.length}):\n${labels.slice(0, 80).join("\n")}${labels.length > 80 ? "\n…" : ""}`,
				);
				return true;
			}
			case "compact":
				if (runtime.conversation.isCompacting) {
					addSystem("Compaction is already running.", "warning");
					return true;
				}
				addSystem("Starting compaction…");
				await runtime.client.compact(argument || undefined);
				await refreshState(runtime);
				return true;
			case "new":
				await runtime.client.newSession();
				await loadCurrentSession(runtime);
				addSystem("Started a new session.", "success");
				return true;
			case "name":
				if (!argument) {
					addSystem("Usage: /name <session name>", "warning");
					return true;
				}
				await runtime.client.setSessionName(argument);
				await refreshState(runtime);
				addSystem(`Session named “${argument}”.`, "success");
				return true;
			case "skills":
				// Show cached skills immediately. Refresh in the background so an
				// overloaded Pi RPC process cannot block opening the picker.
				setSkillSelectorOpen(true);
				void refreshCommands(runtime).catch(() => {});
				return true;
			case "commands": {
				const choices = await refreshCommands(runtime);
				const query = argument.toLowerCase();
				const matches = query
					? choices.filter((command) => command.name.toLowerCase().includes(query) ||
						command.description?.toLowerCase().includes(query))
					: choices;
				const rows = matches.slice(0, 100).map((command) =>
					`/${command.name}${command.description ? ` — ${command.description}` : ""}`,
				);
				addSystem(
					matches.length > 0
						? `Available commands (${matches.length}${query ? ` matching ${argument}` : ""}):\n${rows.join("\n")}${matches.length > rows.length ? "\n… refine with /commands <search>" : ""}`
						: `No commands match ${JSON.stringify(argument)}.`,
				);
				return true;
			}
			case "thoughts": {
				const mode = argument.toLowerCase();
				if (!mode || mode === "toggle") {
					setAllThinkingExpanded(!thinkingExpanded());
				} else if (
					mode === "expanded" ||
					mode === "expand" ||
					mode === "open"
				) {
					setAllThinkingExpanded(true);
				} else if (
					mode === "collapsed" ||
					mode === "collapse" ||
					mode === "closed"
				) {
					setAllThinkingExpanded(false);
				} else {
					addSystem("Usage: /thoughts expanded|collapsed|toggle", "warning");
					return true;
				}
				addSystem(
					`Thinking blocks ${thinkingExpanded() ? "expanded" : "collapsed"} by default. Individual blocks remain clickable.`,
					"success",
				);
				return true;
			}
			case "prompts":
			case "map":
				if (!this.ports.promptMapCount())
					addSystem("No user requests in this session yet.", "warning");
				else setPromptMapOpen(true);
				return true;
			case "memory":
				openMemoryBrowser();
				return true;
			default:
				return false;
		}
  }
	private settingsSummary(runtime: T): string {
		const state = runtime.sessionState;
		return [
			"Settings available in this RPC UI:",
			`  thinking blocks: ${this.ports.thinkingExpanded() ? "expanded" : "collapsed"} by default (click each heading)`,
			`  tools: ${this.ports.expandedTools() ? "expanded" : "collapsed"}`,
			`  sidebar: ${this.ports.sidebarEnabled() ? "on" : "off"}`,
			`  auto compaction: ${state?.autoCompactionEnabled ? "on" : "off"}`,
			`  auto retry: ${this.ports.autoRetryEnabled() ? "on" : "off"}`,
			`  steering mode: ${state?.steeringMode ?? "unknown"}`,
			`  follow-up mode: ${state?.followUpMode ?? "unknown"}`,
			"",
			"Change them with:",
			"  /tools on|off       /sidebar on|off",
			"  /autocompact on|off /retry on|off",
			"  /steering-mode all|one-at-a-time",
			"  /followup-mode all|one-at-a-time",
			"  /thinking minimal|low|medium|high|xhigh|max",
			"  /thoughts expanded|collapsed",
			"  /model provider/model-id  /prompts",
		].join("\n");
	}


}
