import {
  CliRenderEvents,
  type KeyEvent,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from "@opentui/core";
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { RpcExtensionUIRequest, RpcSessionState, SessionStats, SubagentRun, ToolItem, Toast } from "./types.ts";
import type { DiagnosticLogger } from "./diagnostics/logger.ts";
import { createDiagnosticBundle } from "./diagnostics/bundle.ts";
import { PiRpcClient } from "./rpc/pi-rpc-client.ts";
import { ConversationModel, initialItems } from "./state/conversation.ts";
import { PromptHistory, shouldRecoverPromptDraft } from "./state/prompt-history.ts";
import { listSubagentRuns } from "./subagents/artifacts.ts";
import { readSubagentConversation } from "./subagents/transcript.ts";
import { pauseSubagent, steerSubagent, stopSubagent } from "./subagents/control.ts";
import { ExtensionDialog } from "./ui/dialog.tsx";
import { MessageView } from "./ui/message.tsx";
import { PendingInputPanel, type LocalQueuedMessage } from "./ui/pending-input-panel.tsx";
import { ModelSelectorDialog, normalizeModelChoices, type ModelChoice } from "./ui/model-selector.tsx";
import { SessionSelector } from "./ui/session-selector.tsx";
import { EmptyDashboard } from "./ui/empty-dashboard.tsx";
import { discoverSessions, type SessionChoice, type SessionDiscoveryState } from "./sessions.ts";
import { PromptMapDialog, type PromptMapEntry } from "./ui/prompt-map.tsx";
import { Sidebar } from "./ui/sidebar.tsx";
import { SubagentInspector } from "./ui/subagent-inspector.tsx";
import { SubagentSelectorDialog } from "./ui/subagent-selector.tsx";
import { reconcileSubagentSelection, subagentTargets, targetsForTool, type SubagentTarget } from "./subagents/targets.ts";
import { colors } from "./ui/theme.ts";
import { CommandSuggestions, filterCommandChoices, selectCommandChoice, type CommandChoice } from "./ui/command-suggestions.tsx";
import { deriveTodos, type TodoViewItem } from "./ui/todos.tsx";
import { preserveEquivalentTodos, preserveReferencedList } from "./ui/list-stability.ts";
import type { OptionalIntegrationStatus } from "./integrations/detect.ts";
import { appVersion } from "./version.ts";
import { defaultUpdateCheckConfig, isUpdateCheckDisabled, checkForUpdates } from "./update/check.ts";
import {
  INITIAL_MESSAGE_WINDOW,
  MAX_LIVE_MESSAGE_WINDOW,
  MESSAGE_LOAD_BATCH,
  clampMessageWindowStart,
  initialMessageWindowStart,
  loadOlderMessageWindowStart,
  trimMessageWindowStart,
} from "./ui/message-window.ts";

export type AppOptions = {
  cwd: string;
  piExecutable?: string | undefined;
  piArgs: string[];
  sidebar: boolean;
  logger: DiagnosticLogger;
  integrations: OptionalIntegrationStatus;
  openSessionSelector?: boolean;
};

const spinnerFrames = ["◐", "◓", "◑", "◒"] as const;
const thinkingLevels = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

const LOGIN_GUIDANCE = "Sorry, login is not supported in PiTTy yet. Run `pi` and use /login there; your credentials will then be available to PiTTy.";

export type DetailToggleState = {
  toolsExpanded: boolean;
  thinkingExpanded: boolean;
  hasExpandedToolOverride?: boolean;
  hasExpandedThinkingOverride?: boolean;
};

export function nextDetailToggle(state: DetailToggleState): boolean {
  const hasVisibleDetails = state.toolsExpanded
    || state.thinkingExpanded
    || state.hasExpandedToolOverride === true
    || state.hasExpandedThinkingOverride === true;
  return !hasVisibleDetails;
}

const localCommandChoices: CommandChoice[] = [
  { name: "help", description: "Show UI commands", source: "ui" },
  { name: "login", description: "Use /login in the Pi CLI", source: "ui" },
  { name: "settings", description: "Show current UI and Pi settings", source: "ui" },
  { name: "status", description: "Show current UI and Pi settings", source: "ui" },
  { name: "commands", description: "List Pi extension, template, and skill commands", source: "ui" },
  { name: "sessions", description: "Browse and resume sessions", source: "ui" },
  { name: "resume", description: "Alias for /sessions", source: "ui" },
  { name: "model", description: "Show or change the current model", source: "ui" },
  { name: "models", description: "List available models", source: "ui" },
  { name: "thinking", description: "Show or change reasoning effort", source: "ui" },
  { name: "thoughts", description: "Expand or collapse thinking blocks", source: "ui" },
  { name: "prompts", description: "Open the request map", source: "ui" },
  { name: "map", description: "Open the request map", source: "ui" },
  { name: "compact", description: "Compact conversation context", source: "ui" },
  { name: "new", description: "Start a new Pi session", source: "ui" },
  { name: "name", description: "Set the session name", source: "ui" },
  { name: "tools", description: "Expand or collapse tool output", source: "ui" },
  { name: "sidebar", description: "Enable or disable the sidebar", source: "ui" },
  { name: "autocompact", description: "Enable or disable automatic compaction", source: "ui" },
  { name: "retry", description: "Enable or disable automatic retry", source: "ui" },
  { name: "steering-mode", description: "Set steering delivery mode", source: "ui" },
  { name: "followup-mode", description: "Set follow-up delivery mode", source: "ui" },
];

function mergeCommandChoices(remote: Array<{ name: string; description?: string; source: string }>): CommandChoice[] {
  const map = new Map<string, CommandChoice>();
  for (const command of [...localCommandChoices, ...remote]) {
    const name = command.name.replace(/^\/+/, "").trim();
    if (!name) continue;
    const previous = map.get(name);
    map.set(name, {
      name,
      description: command.description ?? previous?.description,
      source: command.source ?? previous?.source,
    });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function isEnterKey(event: KeyEvent): boolean {
  return event.name === "enter" || event.name === "return" || event.name === "kpenter" || event.name === "linefeed";
}

export function isUnmodifiedEnterKey(event: KeyEvent): boolean {
  return isEnterKey(event)
    && !event.ctrl
    && !event.meta
    && !event.shift
    && !event.option
    && !event.super
    && !hasAlt(event);
}

function parseOnOff(value: string | undefined): boolean | undefined {
  if (value === "on" || value === "true" || value === "enable" || value === "enabled") return true;
  if (value === "off" || value === "false" || value === "disable" || value === "disabled") return false;
  return undefined;
}

function isExtensionUiRequest(value: unknown): value is RpcExtensionUIRequest {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).type === "extension_ui_request");
}

function hasAlt(event: KeyEvent): boolean {
  return Boolean(event.meta || event.option);
}

function keyIs(event: KeyEvent, name: string, modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): boolean {
  return event.name === name
    && (modifiers.ctrl === undefined || Boolean(event.ctrl) === modifiers.ctrl)
    && (modifiers.shift === undefined || Boolean(event.shift) === modifiers.shift)
    && (modifiers.alt === undefined || hasAlt(event) === modifiers.alt);
}

function normalizedQueueText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function subagentLogSummary(run: SubagentRun): Record<string, unknown> {
  return {
    runId: run.runId,
    agent: run.agent,
    mode: run.mode,
    state: run.state,
    activityState: run.activityState,
    lastActivityAt: run.lastActivityAt,
    model: run.model,
    thinking: run.thinking,
    contextWindow: run.contextWindow,
    currentTool: run.currentTool,
    currentPath: run.currentPath,
    currentStep: run.currentStep,
    chainStepCount: run.chainStepCount,
    turnCount: run.turnCount,
    toolCount: run.toolCount,
    totalTokens: run.totalTokens,
    error: run.error,
    steps: run.steps.map((step) => ({
      index: step.index,
      agent: step.agent,
      status: step.status,
      activityState: step.activityState,
      lastActivityAt: step.lastActivityAt,
      model: step.model,
      thinking: step.thinking,
      contextWindow: step.contextWindow,
      currentTool: step.currentTool,
      currentPath: step.currentPath,
      turnCount: step.turnCount,
      toolCount: step.toolCount,
      tokens: step.tokens?.total,
      error: step.error,
    })),
  };
}

export function shouldShowEmptyDashboard(renderedItemCount: number): boolean {
  return renderedItemCount === 0;
}

export function App(props: AppOptions) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const client = new PiRpcClient({
    cwd: props.cwd,
    args: props.piArgs,
    ...(props.piExecutable ? { executable: props.piExecutable } : {}),
    logger: props.logger,
  });
  const conversation = new ConversationModel([], props.cwd);
  const promptHistory = new PromptHistory();
  const [revision, setRevision] = createSignal(0);
  const [messageWindowStart, setMessageWindowStart] = createSignal(0);
  const [sessionState, setSessionState] = createSignal<RpcSessionState>();
  const [sessionStats, setSessionStats] = createSignal<SessionStats>();
  const [runs, setRuns] = createSignal<SubagentRun[]>([]);
  const [selectedTargetKey, setSelectedTargetKey] = createSignal<string>();
  const [sidebarEnabled, setSidebarEnabled] = createSignal(props.sidebar);
  const [expandedTools, setExpandedTools] = createSignal(false);
  const [expandedToolIds, setExpandedToolIds] = createSignal<Set<string>>(new Set());
  const [expandedDiffIds, setExpandedDiffIds] = createSignal<Set<string>>(new Set());
  const [showJumpLatest, setShowJumpLatest] = createSignal(false);
  const [queuedFollowUps, setQueuedFollowUps] = createSignal<LocalQueuedMessage[]>([]);
  const [autoRetryEnabled, setAutoRetryEnabled] = createSignal(true);
  const [spinnerIndex, setSpinnerIndex] = createSignal(0);
  const [clockNow, setClockNow] = createSignal(Date.now());
  const [inspectSubagent, setInspectSubagent] = createSignal(false);
  const [subagentSelectorOpen, setSubagentSelectorOpen] = createSignal(false);
  const [dialog, setDialog] = createSignal<RpcExtensionUIRequest>();
  const [modelSelectorOpen, setModelSelectorOpen] = createSignal(false);
  const [modelOptions, setModelOptions] = createSignal<ModelChoice[]>([]);
  const [modelSelectorLoading, setModelSelectorLoading] = createSignal(false);
  const [sessionSelectorOpen, setSessionSelectorOpen] = createSignal(false);
  const [sessionDiscovery, setSessionDiscovery] = createSignal<SessionDiscoveryState>({ kind: "loading" });
  const [sessionSwitching, setSessionSwitching] = createSignal(false);
  const [pendingSession, setPendingSession] = createSignal<SessionChoice>();
  const [promptMapOpen, setPromptMapOpen] = createSignal(false);
  const [thinkingExpanded, setThinkingExpanded] = createSignal(true);
  const [thinkingExpansionOverrides, setThinkingExpansionOverrides] = createSignal<Map<string, boolean>>(new Map());
  const [promptText, setPromptText] = createSignal("");
  const [commandChoices, setCommandChoices] = createSignal<CommandChoice[]>(localCommandChoices);
  const [commandSuggestionIndex, setCommandSuggestionIndex] = createSignal(0);
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const [status, setStatus] = createSignal("starting Pi…");
  let prompt: TextareaRenderable | undefined;
  let scroll: ScrollBoxRenderable | undefined;
  let subagentScroll: ScrollBoxRenderable | undefined;
  let statsTimer: ReturnType<typeof setInterval> | undefined;
  let subagentsTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;
  let lastRunsDigest = "";
  let sessionDiscoveryGeneration = 0;
  let lastCtrlC = 0;
  let flushingQueuedFollowUp = false;

  const touch = () => setRevision((value) => value + 1);
  const visibleSidebar = createMemo(() => sidebarEnabled() && dimensions().width >= 104);
  const items = createMemo(() => {
    revision();
    // ConversationModel mutates its array in place. Return a new reference so
    // Solid propagates updates to <For>; otherwise resumed messages stay blank.
    return [...conversation.items];
  });
  const visibleItems = createMemo(() => {
    const all = items();
    const start = clampMessageWindowStart(all.length, messageWindowStart());
    return all.slice(start);
  });
  const hiddenMessageCount = createMemo(() =>
    clampMessageWindowStart(items().length, messageWindowStart()),
  );
  const visibleMessageIds = createMemo(() => visibleItems().map((item) => item.id));
  const promptMapEntries = createMemo<PromptMapEntry[]>(() =>
    items().flatMap((item) => item.kind === "user"
      ? [{ id: item.id, text: item.text, timestamp: item.timestamp }]
      : []),
  );
  const todos = createMemo<TodoViewItem[]>((previous) => preserveEquivalentTodos(previous, deriveTodos(items())));
  const subagentsAvailable = createMemo(() => props.integrations.subagents.installed || runs().length > 0);
  const todosAvailable = createMemo(() => props.integrations.todos.installed || todos().length > 0);
  const commandSuggestions = createMemo(() => filterCommandChoices(commandChoices(), promptText(), Math.max(1, Math.min(7, dimensions().height - 10))));
  const thinkingIsExpanded = (itemId: string): boolean => thinkingExpansionOverrides().get(itemId) ?? thinkingExpanded();
  const setAllThinkingExpanded = (expanded: boolean) => {
    setThinkingExpanded(expanded);
    setThinkingExpansionOverrides(new Map());
  };
  const toggleThinkingItem = (itemId: string) => {
    const next = !thinkingIsExpanded(itemId);
    setThinkingExpansionOverrides((current) => {
      const updated = new Map(current);
      updated.set(itemId, next);
      return updated;
    });
  };
  const streaming = createMemo(() => {
    revision();
    return conversation.isStreaming;
  });
  const showWorkingIndicator = createMemo(() => {
    if (!streaming()) return false;
    const last = items().at(-1);
    if (last?.kind === "assistant" && (last.thinking.trim() || last.text.trim())) return false;
    if (last?.kind === "tool" && (last.status === "streaming" || last.status === "pending")) return false;
    return true;
  });
  const subagentTools = createMemo<ToolItem[]>((previous) =>
    preserveReferencedList(previous, items().filter((item): item is ToolItem => item.kind === "tool")),
  );
  const availableSubagentTargets = createMemo(() => subagentTargets(runs(), subagentTools()));
  const selectedSubagentTarget = createMemo(() =>
    availableSubagentTargets().find((target) => target.key === selectedTargetKey()) ?? availableSubagentTargets()[0],
  );
  const selectedSubagent = createMemo(() => selectedSubagentTarget()?.run);
  const inspectedTranscript = createMemo(() => {
    const target = selectedSubagentTarget();
    return inspectSubagent() && target ? readSubagentConversation(target.run, 160, target.stepIndex) : [];
  });
  const recentlyRenderedUserTexts = () => {
    const cutoff = Date.now() - 120_000;
    return new Set(
      conversation.items
        .filter((item) => item.kind === "user" && item.timestamp >= cutoff)
        .map((item) => item.kind === "user" ? normalizedQueueText(item.text) : ""),
    );
  };
  const steeringQueue = createMemo(() => {
    revision();
    const rendered = recentlyRenderedUserTexts();
    return [...conversation.steering].filter((text) => !rendered.has(normalizedQueueText(text)));
  });
  const followUpQueue = createMemo(() => {
    revision();
    const rendered = recentlyRenderedUserTexts();
    return [...conversation.followUp].filter((text) => !rendered.has(normalizedQueueText(text)));
  });

  const toast = (text: string, tone: Toast["tone"] = "info", duration = 2800) => {
    const entry: Toast = { id: crypto.randomUUID(), text, tone, expiresAt: Date.now() + duration };
    setToasts((current) => [...current.slice(-2), entry]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== entry.id)), duration).unref?.();
  };

  const refreshState = async () => {
    try {
      const [state, stats] = await Promise.all([client.getState(), client.getSessionStats()]);
      setSessionState(state);
      setSessionStats(stats);
      setStatus(state.isStreaming ? "working" : "ready");
      const nextRuns = props.integrations.subagents.installed
        ? listSubagentRuns({ sessionId: state.sessionId, sessionFile: state.sessionFile })
        : [];
      const summaries = nextRuns.map(subagentLogSummary);
      const digest = JSON.stringify(summaries);
      if (digest !== lastRunsDigest) {
        lastRunsDigest = digest;
        setRuns(nextRuns);
        const nextTargets = subagentTargets(nextRuns, subagentTools());
        setSelectedTargetKey(reconcileSubagentSelection(selectedTargetKey(), availableSubagentTargets(), nextTargets));
        props.logger.info("subagents.changed", { runs: summaries });
      }
    } catch (error) {
      props.logger.error("ui.refresh_state_failed", error);
      setStatus("Pi disconnected");
      toast(error instanceof Error ? error.message : String(error), "error", 5000);
    }
  };

  const updateScrollPosition = () => {
    if (!scroll || inspectSubagent()) {
      setShowJumpLatest(false);
      return;
    }
    const viewportHeight = Math.max(1, scroll.height || dimensions().height - 8);
    const maxTop = Math.max(0, scroll.scrollHeight - viewportHeight);
    setShowJumpLatest(scroll.scrollTop < maxTop - 2);
  };

  const scrollToBottom = () => {
    scroll?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER });
    setShowJumpLatest(false);
  };

  const resetMessageWindow = (totalItems = conversation.items.length) => {
    setMessageWindowStart(initialMessageWindowStart(totalItems, INITIAL_MESSAGE_WINDOW));
  };

  const trimMessageWindowIfFollowingLatest = () => {
    if (showJumpLatest() || inspectSubagent()) return;
    setMessageWindowStart((current) =>
      trimMessageWindowStart(conversation.items.length, current, MAX_LIVE_MESSAGE_WINDOW),
    );
  };

  const loadOlderMessages = () => {
    const current = messageWindowStart();
    if (current <= 0) return;
    const oldHeight = scroll?.scrollHeight ?? 0;
    const oldTop = scroll?.scrollTop ?? 0;
    setMessageWindowStart(loadOlderMessageWindowStart(current, MESSAGE_LOAD_BATCH));
    // Keep the previously first visible message in place after prepending older
    // children. Two microtasks allow OpenTUI to finish the new layout first.
    queueMicrotask(() => queueMicrotask(() => {
      if (!scroll) return;
      const addedHeight = Math.max(0, scroll.scrollHeight - oldHeight);
      scroll.scrollTo({ x: 0, y: oldTop + addedHeight });
      updateScrollPosition();
    }));
  };

  const toolExpanded = (toolId: string): boolean => expandedTools() || expandedToolIds().has(toolId);
  const toggleTool = (toolId: string) => {
    setExpandedToolIds((current) => {
      const next = new Set(current);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  };

  const diffExpanded = (toolId: string): boolean => expandedDiffIds().has(toolId);
  const toggleDiff = (toolId: string) => {
    setExpandedDiffIds((current) => {
      const next = new Set(current);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  };

  const addSystem = (text: string, tone: "muted" | "info" | "warning" | "error" | "success" = "info") => {
    conversation.system(text, tone);
    trimMessageWindowIfFollowingLatest();
    touch();
    queueMicrotask(scrollToBottom);
  };

  const insertSuggestedCommand = (command: CommandChoice) => {
    const value = `/${command.name} `;
    prompt?.setText(value);
    setPromptText(value);
    setCommandSuggestionIndex(0);
    queueMicrotask(() => prompt?.focus());
  };

  const cycleThinkingEffort = async () => {
    try {
      const result = await client.cycleThinkingLevel();
      await refreshState();
      const level = result?.level ?? sessionState()?.thinkingLevel ?? "unknown";
      toast(`Thinking effort: ${level}`, "success", 1600);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const loadCurrentSession = async () => {
    const [state, messages] = await Promise.all([client.getState(), client.getMessages()]);
    const historyItems = initialItems(messages);
    conversation.items.splice(0, conversation.items.length, ...historyItems);
    conversation.isStreaming = state.isStreaming;
    conversation.steering = [];
    conversation.followUp = [];
    setSessionState(state);
    setQueuedFollowUps([]);
    resetMessageWindow(historyItems.length);
    touch();
    queueMicrotask(scrollToBottom);
    await refreshState();
  };

  const settingsSummary = () => {
    const state = sessionState();
    return [
      "Settings available in this RPC UI:",
      `  thinking blocks: ${thinkingExpanded() ? "expanded" : "collapsed"} by default (click each heading)`,
      `  tools: ${expandedTools() ? "expanded" : "collapsed"}`,
      `  sidebar: ${sidebarEnabled() ? "on" : "off"}`,
      `  auto compaction: ${state?.autoCompactionEnabled ? "on" : "off"}`,
      `  auto retry: ${autoRetryEnabled() ? "on" : "off"}`,
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
  };

  const handleSlashCommand = async (text: string): Promise<boolean> => {
    if (!text.startsWith("/")) return false;
    const [rawName = "", ...parts] = text.slice(1).trim().split(/\s+/);
    const name = rawName.toLowerCase();
    const argument = parts.join(" ").trim();

    switch (name) {
      case "login":
        addSystem(LOGIN_GUIDANCE, "warning");
        return true;
      case "help":
        addSystem([
          "UI commands:",
          "  /settings /status /commands /sessions /resume",
          "  /model [provider/model] /thinking [level]",
          "  /thoughts expanded|collapsed /prompts",
          "  /compact [instructions] /new /name <name>",
          "  /tools on|off /sidebar on|off",
          "  /autocompact on|off /retry on|off",
          "  /steering-mode all|one-at-a-time",
          "  /followup-mode all|one-at-a-time",
          "  Ctrl+T (or Shift+Tab) cycles thinking effort; click a Thinking heading to expand/collapse it.",
          "",
          "Unknown /commands are passed to Pi, so extension, prompt-template, and skill commands still work.",
          "Session browsing is available through /sessions and /resume.",
        ].join("\n"));
        return true;
      case "sessions":
      case "resume":
        openSessionSelector();
        return true;
      case "settings":
      case "status":
        addSystem(settingsSummary());
        return true;
      case "tools": {
        const value = parseOnOff(parts[0]);
        const next = value ?? !expandedTools();
        setExpandedTools(next);
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
        await client.setAutoCompaction(value);
        await refreshState();
        addSystem(`Automatic compaction ${value ? "enabled" : "disabled"}.`, "success");
        return true;
      }
      case "retry": {
        const value = parseOnOff(parts[0]);
        if (value === undefined) {
          addSystem("Usage: /retry on|off", "warning");
          return true;
        }
        await client.setAutoRetry(value);
        setAutoRetryEnabled(value);
        addSystem(`Automatic retry ${value ? "enabled" : "disabled"}.`, "success");
        return true;
      }
      case "steering-mode": {
        const mode = parts[0];
        if (mode !== "all" && mode !== "one-at-a-time") {
          addSystem("Usage: /steering-mode all|one-at-a-time", "warning");
          return true;
        }
        await client.setSteeringMode(mode);
        await refreshState();
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
        await client.setFollowUpMode(mode);
        await refreshState();
        addSystem(`Follow-up mode set to ${mode}.`, "success");
        return true;
      }
      case "thinking": {
        if (!argument) {
          addSystem(`Thinking level: ${sessionState()?.thinkingLevel ?? "unknown"}. Thinking text stays visible; click each Thinking heading to expand or collapse it.`);
          return true;
        }
        if (!thinkingLevels.has(argument)) {
          addSystem("Usage: /thinking minimal|low|medium|high|xhigh|max", "warning");
          return true;
        }
        await client.setThinkingLevel(argument as "minimal" | "low" | "medium" | "high" | "xhigh" | "max");
        await refreshState();
        addSystem(`Thinking level set to ${argument}.`, "success");
        return true;
      }
      case "model": {
        if (!argument) {
          const model = sessionState()?.model;
          addSystem(`Current model: ${model ? `${model.provider}/${model.id}` : "unknown"}. Press Ctrl+P to choose from a list, or use /model provider/model-id.`);
          return true;
        }
        const slash = argument.indexOf("/");
        if (slash <= 0 || slash === argument.length - 1) {
          addSystem("Usage: /model provider/model-id", "warning");
          return true;
        }
        await client.setModel(argument.slice(0, slash), argument.slice(slash + 1));
        await refreshState();
        addSystem(`Model set to ${argument}.`, "success");
        return true;
      }
      case "models": {
        const models = await client.getAvailableModels();
        const labels = models.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const record = value as Record<string, unknown>;
          return typeof record.provider === "string" && typeof record.id === "string" ? [`${record.provider}/${record.id}`] : [];
        });
        addSystem(`Available models (${labels.length}):\n${labels.slice(0, 80).join("\n")}${labels.length > 80 ? "\n…" : ""}`);
        return true;
      }
      case "compact":
        addSystem("Starting compaction…");
        await client.compact(argument || undefined);
        await refreshState();
        return true;
      case "new":
        await client.newSession();
        await loadCurrentSession();
        addSystem("Started a new session.", "success");
        return true;
      case "name":
        if (!argument) {
          addSystem("Usage: /name <session name>", "warning");
          return true;
        }
        await client.setSessionName(argument);
        await refreshState();
        addSystem(`Session named “${argument}”.`, "success");
        return true;
      case "commands": {
        const commands = await client.getCommands();
        const rows = commands.map((command) => `/${command.name}${command.description ? ` — ${command.description}` : ""}`);
        addSystem(rows.length ? `Pi extension/template/skill commands:\n${rows.join("\n")}` : "No extension, prompt-template, or skill commands were reported by Pi.");
        return true;
      }
      case "thoughts": {
        const mode = argument.toLowerCase();
        if (!mode || mode === "toggle") {
          setAllThinkingExpanded(!thinkingExpanded());
        } else if (mode === "expanded" || mode === "expand" || mode === "open") {
          setAllThinkingExpanded(true);
        } else if (mode === "collapsed" || mode === "collapse" || mode === "closed") {
          setAllThinkingExpanded(false);
        } else {
          addSystem("Usage: /thoughts expanded|collapsed|toggle", "warning");
          return true;
        }
        addSystem(`Thinking blocks ${thinkingExpanded() ? "expanded" : "collapsed"} by default. Individual blocks remain clickable.`, "success");
        return true;
      }
      case "prompts":
      case "map":
        if (!promptMapEntries().length) addSystem("No user requests in this session yet.", "warning");
        else setPromptMapOpen(true);
        return true;
      default:
        return false;
    }
  };

  const sendText = async (text: string) => {
    const wasStreaming = conversation.isStreaming;
    props.logger.info("ui.submit", { chars: text.length, streaming: wasStreaming });
    if (!wasStreaming) {
      conversation.optimisticUser(text);
      trimMessageWindowIfFollowingLatest();
      touch();
      scrollToBottom();
      await client.prompt(text);
      return;
    }
    // Match Pi's native Enter behavior while a turn is running. prompt(...,
    // {streamingBehavior:"steer"}) buffers or defers delivery, including
    // extension commands and prompt templates. Do not add an optimistic transcript item: Pi exposes
    // the pending text through queue_update and emits the user message once it
    // is actually consumed.
    await client.prompt(text, "steer");
  };

  const submit = async () => {
    if (dialog()) return;
    const text = prompt?.plainText.trim() ?? "";
    if (!text) return;
    promptHistory.recordSubmitted(text);
    prompt?.clear();
    setPromptText("");
    try {
      if (await handleSlashCommand(text)) return;
      await sendText(text);
    } catch (error) {
      props.logger.error("ui.submit_failed", error);
      addSystem(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const queueFollowUp = () => {
    if (dialog()) return;
    const text = prompt?.plainText.trim() ?? "";
    if (!text) return;
    if (!conversation.isStreaming) {
      void submit();
      return;
    }
    prompt?.clear();
    setPromptText("");
    setQueuedFollowUps((current) => [...current, { id: crypto.randomUUID(), text }]);
    props.logger.info("ui.followup_queued", { chars: text.length });
    toast("Follow-up queued. Alt+Up restores it for editing.", "success");
  };

  const editQueuedFollowUp = (messageId: string) => {
    const current = queuedFollowUps();
    const selected = current.find((item) => item.id === messageId);
    if (!selected) return;
    setQueuedFollowUps(current.filter((item) => item.id !== messageId));
    prompt?.setText(selected.text);
    setPromptText(selected.text);
    prompt?.focus();
    toast("Queued follow-up restored to editor.", "info");
  };

  const restoreQueuedFollowUp = () => {
    const current = queuedFollowUps();
    const last = current.at(-1);
    if (!last) {
      const sentCount = conversation.steering.length + conversation.followUp.length;
      toast(
        sentCount > 0
          ? "Those messages were already sent to Pi. Pi RPC cannot dequeue them; use Alt+Enter for an editable local follow-up."
          : "No editable local follow-up is queued.",
        "warning",
        5200,
      );
      return;
    }
    editQueuedFollowUp(last.id);
  };

  const flushQueuedFollowUp = async () => {
    if (flushingQueuedFollowUp || conversation.isStreaming) return;
    const next = queuedFollowUps()[0];
    if (!next) return;
    flushingQueuedFollowUp = true;
    setQueuedFollowUps((current) => current.filter((item) => item.id !== next.id));
    try {
      await sendText(next.text);
    } catch (error) {
      setQueuedFollowUps((current) => [next, ...current]);
      addSystem(`Failed to send queued follow-up: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      flushingQueuedFollowUp = false;
    }
  };

  const copySelection = (): boolean => {
    const selection = renderer.getSelection();
    const text = selection?.getSelectedText() ?? "";
    if (!text) return false;
    const copied = renderer.copyToClipboardOSC52(text);
    renderer.clearSelection();
    toast(copied ? "Copied selection" : "Terminal does not support OSC52 clipboard", copied ? "success" : "warning");
    return true;
  };

  const focusMainPrompt = () => {
    if (dialog() || modelSelectorOpen() || sessionSelectorOpen() || promptMapOpen() || subagentSelectorOpen() || inspectSubagent()) return;
    queueMicrotask(() => {
      if (!dialog() && !modelSelectorOpen() && !sessionSelectorOpen() && !promptMapOpen() && !subagentSelectorOpen() && !inspectSubagent()) prompt?.focus();
    });
  };

  const discoverCurrentSessions = async () => {
    const generation = ++sessionDiscoveryGeneration;
    setSessionDiscovery({ kind: "loading" });
    try {
      const choices = await discoverSessions(props.cwd, sessionState()?.sessionFile, (loaded, total) => {
        if (generation === sessionDiscoveryGeneration) setSessionDiscovery({ kind: "loading", progress: { loaded, total } });
      });
      if (generation !== sessionDiscoveryGeneration) return;
      setSessionDiscovery(choices.length ? { kind: "success", choices } : { kind: "empty", choices: [] });
    } catch (error) {
      if (generation !== sessionDiscoveryGeneration) return;
      setSessionDiscovery({ kind: "error", error: error instanceof Error ? error.message : String(error) });
    }
  };

  const openSessionSelector = () => {
    setSessionSelectorOpen(true);
    void discoverCurrentSessions();
  };

  const closeSessionSelector = () => {
    if (sessionSwitching()) return;
    setPendingSession(undefined);
    setSessionSelectorOpen(false);
    focusMainPrompt();
  };

  const switchToSession = async (choice: SessionChoice) => {
    if (sessionSwitching()) return;
    if (streaming() && !pendingSession()) {
      setPendingSession(choice);
      return;
    }
    setSessionSwitching(true);
    try {
      const result = await client.switchSession(choice.path);
      if (result.cancelled) {
        setPendingSession(undefined);
        toast("Session switch was cancelled by Pi", "warning");
        return;
      }
      await loadCurrentSession();
      setSessionSelectorOpen(false);
      setPendingSession(undefined);
      toast(`Resumed ${choice.name}`, "success");
    } catch (error) {
      setPendingSession(undefined);
      const message = error instanceof Error ? error.message : String(error);
      toast(message.includes("switch_session") ? "Session switching requires a Pi version with RPC switch_session support." : `Failed to switch session: ${message}`, "error");
    } finally {
      setSessionSwitching(false);
      focusMainPrompt();
    }
  };

  const closeModelSelector = () => {
    setModelSelectorOpen(false);
    focusMainPrompt();
  };

  const openModelSelector = async () => {
    if (modelSelectorLoading()) return;
    setModelSelectorLoading(true);
    try {
      const models = normalizeModelChoices(await client.getAvailableModels());
      if (!models.length) {
        toast("Pi returned no available models", "warning");
        return;
      }
      setModelOptions(models);
      setModelSelectorOpen(true);
    } catch (error) {
      toast(`Failed to load models: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setModelSelectorLoading(false);
    }
  };

  const selectModel = async (model: ModelChoice) => {
    setModelSelectorOpen(false);
    setStatus(`switching to ${model.provider}/${model.id}…`);
    try {
      await client.setModel(model.provider, model.id);
      await refreshState();
      toast(`Model set to ${model.provider}/${model.id}`, "success");
    } catch (error) {
      toast(`Failed to set model: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setStatus(streaming() ? "working" : "ready");
      focusMainPrompt();
    }
  };

  const closePromptMap = () => {
    setPromptMapOpen(false);
    queueMicrotask(() => prompt?.focus());
  };

  const openPromptMap = () => {
    if (!promptMapEntries().length) {
      toast("No user requests in this session yet", "warning");
      return;
    }
    setModelSelectorOpen(false);
    setPromptMapOpen(true);
  };

  const jumpToPrompt = (entry: PromptMapEntry) => {
    setPromptMapOpen(false);
    const targetIndex = items().findIndex((item) => item.id === entry.id);
    if (targetIndex >= 0 && targetIndex < messageWindowStart()) {
      setMessageWindowStart(targetIndex);
    }
    queueMicrotask(() => queueMicrotask(() => {
      scroll?.scrollChildIntoView(entry.id);
      updateScrollPosition();
      prompt?.focus();
    }));
  };

  const completeDialog = async (response: { value?: string; confirmed?: boolean; cancelled?: true }) => {
    const request = dialog();
    if (!request) return;
    props.logger.info("ui.extension_dialog_response", { method: request.method, cancelled: response.cancelled === true, confirmed: response.confirmed });
    setDialog(undefined);
    if (response.cancelled) await client.sendExtensionUiResponse({ type: "extension_ui_response", id: request.id, cancelled: true });
    else if (typeof response.confirmed === "boolean") await client.sendExtensionUiResponse({ type: "extension_ui_response", id: request.id, confirmed: response.confirmed });
    else await client.sendExtensionUiResponse({ type: "extension_ui_response", id: request.id, value: response.value ?? "" });
    prompt?.focus();
  };

  onMount(() => {
    props.logger.info("ui.mount", { cwd: props.cwd, sidebar: props.sidebar });
    if (!isUpdateCheckDisabled(process.env)) {
      void checkForUpdates(defaultUpdateCheckConfig(appVersion, process.env, props.logger, (version) => {
        toast(`A newer PiTTy release is available (${version}). Run \`pitty upgrade\`.`, "info", 7000);
      }));
    }
    const missingIntegrations = [
      !props.integrations.subagents.installed ? "pi-subagents (live subagent inspection and steering)" : undefined,
      !props.integrations.todos.installed ? "@juicesharp/rpiv-todo (Todo panel)" : undefined,
    ].filter((value): value is string => Boolean(value));
    if (missingIntegrations.length) {
      queueMicrotask(() => toast(`Optional Pi packages not detected: ${missingIntegrations.join(", ")}. PiTTy will continue without them.`, "info", 7000));
    }
    const unsubscribe = client.onEvent((event) => {
      if (isExtensionUiRequest(event)) {
        props.logger.debug("ui.extension_request", { method: event.method, id: event.id });
        if (event.method === "notify") {
          toast(event.message, event.notifyType === "error" ? "error" : event.notifyType === "warning" ? "warning" : "info");
          return;
        }
        if (event.method === "setStatus") {
          if (event.statusText) setStatus(event.statusText);
          return;
        }
        if (event.method === "setTitle") {
          renderer.setTerminalTitle(event.title);
          return;
        }
        if (event.method === "set_editor_text") {
          prompt?.setText(event.text);
          setPromptText(event.text);
          return;
        }
        if (event.method === "setWidget") return;
        setModelSelectorOpen(false);
        setPromptMapOpen(false);
        setDialog(event);
        return;
      }
      const previousItemCount = conversation.items.length;
      conversation.apply(event);
      if (conversation.items.length > previousItemCount) trimMessageWindowIfFollowingLatest();
      touch();
      if (event.type === "agent_start" || event.type === "agent_settled" || event.type === "agent_end" || event.type === "thinking_level_changed" || event.type === "session_info_changed") {
        void refreshState();
      }
      if (event.type === "agent_settled" || event.type === "agent_end") {
        queueMicrotask(() => void flushQueuedFollowUp());
      }
    });
    client.on("protocol-error", (error: Error) => {
      props.logger.error("ui.protocol_error", error);
      conversation.system(error.message, "error");
      touch();
    });
    client.on("stderr", (chunk: string) => {
      const line = chunk.trim().split("\n").at(-1);
      if (line) setStatus(line.slice(0, 120));
    });
    client.on("exit", (error: Error) => {
      props.logger.error("ui.pi_exit", error);
      conversation.system(error.message, "error");
      touch();
    });
    void (async () => {
      try {
        await client.start();
        props.logger.info("ui.pi_started");
        const [state, messages, remoteCommands] = await Promise.all([
          client.getState(),
          client.getMessages(),
          client.getCommands().catch((error) => {
            props.logger.warn("ui.commands_load_failed", error);
            return [];
          }),
        ]);
        setCommandChoices(mergeCommandChoices(remoteCommands));
        const historyItems = initialItems(messages);
        conversation.items.splice(0, conversation.items.length, ...historyItems);
        resetMessageWindow(historyItems.length);
        props.logger.info("ui.history_loaded", {
          rpcMessages: messages.length,
          renderedItems: historyItems.length,
          userItems: historyItems.filter((item) => item.kind === "user").length,
          assistantItems: historyItems.filter((item) => item.kind === "assistant").length,
          toolItems: historyItems.filter((item) => item.kind === "tool").length,
          textChars: historyItems.reduce((sum, item) => sum + ("text" in item ? item.text.length : item.kind === "tool" ? item.output.length : 0), 0),
        });
        setSessionState(state);
        conversation.isStreaming = state.isStreaming;
        touch();
        queueMicrotask(() => scroll?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER }));
        if (props.openSessionSelector) openSessionSelector();
        else prompt?.focus();
        if (!props.openSessionSelector) void discoverCurrentSessions();
        await refreshState();
      } catch (error) {
        props.logger.error("ui.start_failed", error);
        conversation.system(error instanceof Error ? error.message : String(error), "error");
        touch();
        setStatus("failed to start Pi");
      }
    })();
    statsTimer = setInterval(() => void refreshState(), 10_000);
    subagentsTimer = setInterval(() => {
      if (!props.integrations.subagents.installed) return;
      const state = sessionState();
      const next = listSubagentRuns(state ? { sessionId: state.sessionId, sessionFile: state.sessionFile } : undefined);
      const summaries = next.map(subagentLogSummary);
      const digest = JSON.stringify(summaries);
      if (digest !== lastRunsDigest) {
        lastRunsDigest = digest;
        setRuns(next);
        props.logger.info("subagents.changed", { runs: summaries });
        const nextTargets = subagentTargets(next, subagentTools());
        setSelectedTargetKey(reconcileSubagentSelection(selectedTargetKey(), availableSubagentTargets(), nextTargets));
      }
    }, 750);
    spinnerTimer = setInterval(() => {
      setSpinnerIndex((value) => (value + 1) % spinnerFrames.length);
      setClockNow(Date.now());
    }, 250);
    heartbeatTimer = setInterval(() => {
      props.logger.debug("ui.heartbeat", {
        status: status(),
        streaming: streaming(),
        messages: conversation.items.length,
        subagents: runs().length,
        memoryUsage: process.memoryUsage(),
      });
    }, 30_000);
    onCleanup(() => {
      unsubscribe();
      if (statsTimer) clearInterval(statsTimer);
      if (subagentsTimer) clearInterval(subagentsTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (spinnerTimer) clearInterval(spinnerTimer);
      props.logger.info("ui.cleanup");
      void client.stop();
    });
  });

  const closeSubagentInspector = () => {
    setSubagentSelectorOpen(false);
    setInspectSubagent(false);
    queueMicrotask(() => prompt?.focus());
  };

  const selectSubagentTarget = (target: SubagentTarget) => {
    setSelectedTargetKey(target.key);
    setSubagentSelectorOpen(false);
    setInspectSubagent(true);
    queueMicrotask(() => subagentScroll?.scrollTo(Number.MAX_SAFE_INTEGER));
  };

  const cycleSubagent = (direction: 1 | -1) => {
    const all = availableSubagentTargets();
    if (!all.length) return;
    const index = Math.max(0, all.findIndex((target) => target.key === selectedTargetKey()));
    const nextIndex = (index + direction + all.length) % all.length;
    setSelectedTargetKey(all[nextIndex]?.key);
    if (inspectSubagent()) queueMicrotask(() => subagentScroll?.scrollTo(Number.MAX_SAFE_INTEGER));
  };

  const sendSubagentSteer = (message: string) => {
    const target = selectedSubagentTarget();
    if (!target?.canSteer) {
      toast("This subagent is not currently steerable", "warning");
      return;
    }
    try {
      steerSubagent(target.run, message, target.stepIndex);
      props.logger.info("subagent.steer_requested", { runId: target.run.runId, index: target.stepIndex, agent: target.label });
      toast(`Steering sent to ${target.label}`, "success");
    } catch (error) {
      props.logger.error("subagent.steer_failed", { runId: target.run.runId, index: target.stepIndex, error });
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  useKeyboard((event) => {
    if (event.eventType === "release") return;
    if (subagentSelectorOpen()) {
      if (event.name === "escape") {
        event.preventDefault();
        event.stopPropagation();
        setSubagentSelectorOpen(false);
      }
      return;
    }
    if (sessionSelectorOpen() || modelSelectorOpen()) return;
    if (promptMapOpen()) {
      if (event.name === "escape") {
        event.preventDefault();
        event.stopPropagation();
        closePromptMap();
      }
      return;
    }
    if (dialog()) {
      if (event.name === "escape") {
        event.preventDefault();
        event.stopPropagation();
        void completeDialog({ cancelled: true });
      } else if (dialog()?.method === "confirm" && event.name === "enter") {
        event.preventDefault();
        event.stopPropagation();
        void completeDialog({ confirmed: true });
      }
      return;
    }
    const suggestions = commandSuggestions();
    if (suggestions.length && !inspectSubagent()) {
      if (event.name === "up" || event.name === "down") {
        event.preventDefault();
        event.stopPropagation();
        setCommandSuggestionIndex((current) => {
          const direction = event.name === "up" ? -1 : 1;
          return (current + direction + suggestions.length) % suggestions.length;
        });
        return;
      }
      if (event.name === "tab" && !event.shift) {
        event.preventDefault();
        event.stopPropagation();
        const command = selectCommandChoice(suggestions, commandSuggestionIndex());
        if (command) insertSuggestedCommand(command);
        return;
      }
      if (isUnmodifiedEnterKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        const command = selectCommandChoice(suggestions, commandSuggestionIndex());
        if (command) insertSuggestedCommand(command);
        return;
      }
    }
    if (!inspectSubagent() && hasAlt(event) && isEnterKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      queueFollowUp();
      return;
    }
    if (!inspectSubagent() && hasAlt(event) && event.name === "up") {
      event.preventDefault();
      event.stopPropagation();
      restoreQueuedFollowUp();
      return;
    }
    if (event.ctrl && event.name === "c") {
      event.preventDefault();
      event.stopPropagation();
      if (copySelection()) return;
      const draft = prompt?.plainText ?? "";
      if (prompt?.focused && shouldRecoverPromptDraft({ draft, hasCopyableSelection: false })) {
        promptHistory.recordDraft(draft);
        prompt?.clear();
        setPromptText("");
        focusMainPrompt();
        toast("Draft saved. Press Up to recover it.", "info");
        return;
      }
      if (streaming()) {
        void client.abort().then(() => toast("Aborting current Pi turn", "warning")).catch((error) => toast(String(error), "error"));
        return;
      }
      const now = Date.now();
      if (now - lastCtrlC < 800) renderer.destroy();
      else {
        lastCtrlC = now;
        toast("Press Ctrl+C again to exit", "info", 1000);
      }
      return;
    }
    if (!inspectSubagent() && (event.name === "up" || event.name === "down") && (prompt?.lineCount ?? 1) === 1) {
      const result = promptHistory.browse(prompt?.plainText ?? "", event.name === "up" ? "older" : "newer");
      if (result.handled) {
        event.preventDefault();
        event.stopPropagation();
        prompt?.setText(result.text ?? "");
        setPromptText(result.text ?? "");
        prompt?.focus();
        return;
      }
    }
    if (event.name === "pageup" || event.name === "pagedown") {
      event.preventDefault();
      event.stopPropagation();
      const page = Math.max(4, dimensions().height - 10);
      const target = inspectSubagent() ? subagentScroll : scroll;
      target?.scrollBy(event.name === "pageup" ? -page : page);
      queueMicrotask(updateScrollPosition);
      return;
    }
    if (keyIs(event, "home", { ctrl: true })) {
      event.preventDefault();
      event.stopPropagation();
      (inspectSubagent() ? subagentScroll : scroll)?.scrollTo(0);
      queueMicrotask(updateScrollPosition);
      return;
    }
    if (keyIs(event, "end", { ctrl: true })) {
      event.preventDefault();
      event.stopPropagation();
      (inspectSubagent() ? subagentScroll : scroll)?.scrollTo(Number.MAX_SAFE_INTEGER);
      queueMicrotask(updateScrollPosition);
      return;
    }
    if (keyIs(event, "p", { ctrl: true })) {
      event.preventDefault();
      event.stopPropagation();
      void openModelSelector();
      return;
    }
    if (keyIs(event, "r", { ctrl: true })) {
      event.preventDefault();
      event.stopPropagation();
      openPromptMap();
      return;
    }
    if (keyIs(event, "t", { ctrl: true })) {
      event.preventDefault();
      event.stopPropagation();
      void cycleThinkingEffort();
      return;
    }
    if (event.name === "tab" && event.shift) {
      event.preventDefault();
      event.stopPropagation();
      void cycleThinkingEffort();
      return;
    }
    if (keyIs(event, "s", { ctrl: true })) {
      event.preventDefault();
      setSidebarEnabled((value) => !value);
      return;
    }
    if (keyIs(event, "o", { ctrl: true })) {
      event.preventDefault();
      const next = nextDetailToggle({
        toolsExpanded: expandedTools(),
        thinkingExpanded: thinkingExpanded(),
        hasExpandedToolOverride: expandedToolIds().size > 0,
        hasExpandedThinkingOverride: [...thinkingExpansionOverrides().values()].some(Boolean),
      });
      setExpandedTools(next);
      setAllThinkingExpanded(next);
      setExpandedToolIds(new Set<string>());
      return;
    }
    if (keyIs(event, "l", { ctrl: true, shift: true })) {
      event.preventDefault();
      event.stopPropagation();
      try {
        const archive = createDiagnosticBundle({ logDirectory: props.logger.directory });
        const copied = renderer.copyToClipboardOSC52(archive);
        props.logger.info("diagnostics.bundle_created", { archive });
        toast(`Diagnostics saved: ${archive}${copied ? " (path copied)" : ""}`, "success", 7000);
      } catch (error) {
        props.logger.error("diagnostics.bundle_failed", error);
        toast(error instanceof Error ? error.message : String(error), "error", 7000);
      }
      return;
    }
    if (keyIs(event, "i", { ctrl: true })) {
      event.preventDefault();
      event.stopPropagation();
      if (inspectSubagent()) {
        closeSubagentInspector();
        return;
      }
      if (!subagentsAvailable()) return toast("Install pi-subagents to inspect and steer child agents", "info", 5000);
      if (!selectedSubagentTarget()) return toast("No subagent selected", "warning");
      setInspectSubagent(true);
      queueMicrotask(() => subagentScroll?.scrollTo(Number.MAX_SAFE_INTEGER));
      return;
    }
    if (keyIs(event, "a", { ctrl: true, shift: false })) {
      event.preventDefault();
      if (!subagentsAvailable()) return toast("Install pi-subagents to control child agents", "info", 5000);
      const run = selectedSubagent();
      if (!run || run.control === "foreground" || run.state !== "running") return toast("No running file-controlled subagent selected", "warning");
      try {
        pauseSubagent(run);
        props.logger.info("subagent.pause_requested", { runId: run.runId, agent: run.agent, pid: run.pid });
        toast(`Pause requested for ${run.agent ?? run.runId}`, "warning");
      } catch (error) {
        props.logger.error("subagent.pause_failed", { runId: run.runId, error });
        toast(error instanceof Error ? error.message : String(error), "error");
      }
      return;
    }
    if (keyIs(event, "a", { ctrl: true, shift: true })) {
      event.preventDefault();
      if (!subagentsAvailable()) return toast("Install pi-subagents to control child agents", "info", 5000);
      const run = selectedSubagent();
      if (!run || run.control === "foreground" || (run.state !== "running" && run.state !== "queued")) return toast("No active file-controlled subagent selected", "warning");
      try {
        stopSubagent(run);
        props.logger.info("subagent.stop_requested", { runId: run.runId, agent: run.agent, pid: run.pid });
        toast(`Stop requested for ${run.agent ?? run.runId}`, "warning");
      } catch (error) {
        props.logger.error("subagent.stop_failed", { runId: run.runId, error });
        toast(error instanceof Error ? error.message : String(error), "error");
      }
      return;
    }
    if (event.name === "f6") {
      event.preventDefault();
      event.stopPropagation();
      cycleSubagent(event.shift ? -1 : 1);
      return;
    }
    if (event.name === "escape" && inspectSubagent()) {
      event.preventDefault();
      event.stopPropagation();
      closeSubagentInspector();
      return;
    }
    if (event.name === "escape" && streaming()) {
      event.preventDefault();
      event.stopPropagation();
      void client.abort().catch((error) => toast(String(error), "error"));
    }
  });

  renderer.on(CliRenderEvents.SELECTION, () => {
    // Selection is intentionally retained until Ctrl+C or Escape.
  });

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={colors.background}>
      <box flexGrow={1} minHeight={1} flexDirection="row">
        <box flexGrow={1} minWidth={0} flexDirection="column">
          <Show
            when={!inspectSubagent() || !selectedSubagentTarget()}
            fallback={
              <SubagentInspector
                target={selectedSubagentTarget()!}
                items={inspectedTranscript()}
                now={clockNow()}
                scrollRef={(value) => { subagentScroll = value; }}
                onClose={closeSubagentInspector}
                onChooseTarget={() => setSubagentSelectorOpen(true)}
                onSteer={sendSubagentSteer}
                thinkingExpanded={thinkingIsExpanded}
                onToggleThinking={toggleThinkingItem}
                toolExpanded={toolExpanded}
                onToggleTool={toggleTool}
                diffExpanded={diffExpanded}
                onToggleDiff={toggleDiff}
              />
            }
          >
            <scrollbox
              ref={(value) => { scroll = value; }}
              flexGrow={1}
              minHeight={1}
              scrollY
              scrollX={false}
              stickyScroll
              stickyStart="bottom"
              viewportCulling={false}
              paddingLeft={2}
              paddingRight={2}
              verticalScrollbarOptions={{
                showArrows: false,
                trackOptions: { foregroundColor: colors.borderStrong, backgroundColor: colors.background },
              }}
              onMouseScroll={() => queueMicrotask(updateScrollPosition)}
              onMouseDown={() => focusMainPrompt()}
            >
              <Show when={shouldShowEmptyDashboard(items().length)}>
                <EmptyDashboard
                  sessionState={sessionDiscovery()}
                  width={dimensions().width}
                  height={dimensions().height}
                  onSelectSession={(choice) => {
                    if (conversation.isStreaming) setSessionSelectorOpen(true);
                    void switchToSession(choice);
                  }}
                />
              </Show>
              <Show when={hiddenMessageCount() > 0}>
                <box
                  id="load-older-messages"
                  height={2}
                  minHeight={2}
                  flexShrink={0}
                  justifyContent="center"
                  alignItems="center"
                  marginBottom={1}
                  backgroundColor={colors.panelSoft}
                  border={["bottom"]}
                  borderColor={colors.borderStrong}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    loadOlderMessages();
                  }}
                >
                  <text fg={colors.cyan} attributes={1} wrapMode="none">
                    ↑ Load older messages · {hiddenMessageCount()} hidden
                  </text>
                </box>
              </Show>
              <For each={visibleMessageIds()}>
                {(itemId) => {
                  const item = createMemo(() => visibleItems().find((candidate) => candidate.id === itemId));
                  const tool = createMemo(() => {
                    const candidate = item();
                    return candidate?.kind === "tool" ? candidate : undefined;
                  });
                  const subagentTargetsForItem = createMemo(() => {
                    const candidate = item();
                    return candidate?.kind === "tool" ? targetsForTool(candidate, availableSubagentTargets()) : [];
                  });
                  const initialItem = item();
                  if (!initialItem) return null;
                  const itemSource = () => item() ?? initialItem;
                  return (
                    <MessageView
                            item={() => itemSource()}
                            showThinking
                            thinkingExpanded={thinkingIsExpanded(itemId)}
                            onToggleThinking={() => toggleThinkingItem(itemId)}
                            toolExpanded={tool() !== undefined && toolExpanded(itemId)}
                            onToggleTool={toggleTool}
                            diffExpanded={tool() !== undefined && diffExpanded(itemId)}
                            onToggleDiff={toggleDiff}
                            subagentTargets={subagentTargetsForItem()}
                            onInspectSubagentTarget={(targetKey) => {
                              setSelectedTargetKey(targetKey);
                              setInspectSubagent(true);
                              queueMicrotask(() => subagentScroll?.scrollTo(Number.MAX_SAFE_INTEGER));
                            }}
                            now={tool()?.status === "streaming" || tool()?.status === "pending" || subagentTargetsForItem().some((target) => target.active)
                              ? clockNow()
                              : tool()?.endedAt ?? tool()?.startedAt ?? tool()?.timestamp ?? 0}
                          />
                  );
                }}
              </For>
              <Show when={showWorkingIndicator()}>
                <box paddingLeft={1} paddingTop={1} paddingBottom={1} marginBottom={1} border={["left"]} borderColor={colors.green}>
                  <text fg={colors.green} attributes={1}>{spinnerFrames[spinnerIndex()] ?? "◐"} Working…</text>
                </box>
              </Show>
            </scrollbox>
          </Show>
          {/* Keep a fixed one-row slot so showing/hiding the jump control does
              not resize the transcript and leave stale terminal cells. */}
          <box height={1} minHeight={1} flexDirection="row" justifyContent="flex-end" paddingRight={2}>
            <Show when={showJumpLatest() && !inspectSubagent()}>
              <text
                fg={colors.cyan}
                attributes={1}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  scrollToBottom();
                }}
              >
                ↓ Latest message
              </text>
            </Show>
          </box>
          <Show when={!inspectSubagent() && (queuedFollowUps().length || steeringQueue().length || followUpQueue().length)}>
            <PendingInputPanel
              queuedFollowUps={queuedFollowUps()}
              steering={steeringQueue()}
              followUps={followUpQueue()}
              onEditQueuedFollowUp={editQueuedFollowUp}
            />
          </Show>
          <Show when={commandSuggestions().length && !inspectSubagent()}>
            <CommandSuggestions
              commands={commandSuggestions}
              selectedIndex={() => Math.min(commandSuggestionIndex(), Math.max(0, commandSuggestions().length - 1))}
              onSelect={insertSuggestedCommand}
            />
          </Show>
          <Show when={!inspectSubagent()}>
            <box
              border={["top"]}
              borderColor={streaming() ? colors.green : colors.borderStrong}
            backgroundColor={colors.panel}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            minHeight={4}
            maxHeight={12}
          >
            <textarea
              ref={(value) => { prompt = value; }}
              focused={!dialog() && !modelSelectorOpen() && !sessionSelectorOpen() && !promptMapOpen() && !subagentSelectorOpen()}
              placeholder={streaming() ? "Enter sends steering immediately · Alt+Enter queues editable follow-up" : "Ask Pi anything… (/help for commands)"}
              wrapMode="word"
              backgroundColor={colors.panel}
              focusedBackgroundColor={colors.panel}
              textColor={colors.textBright}
              focusedTextColor={colors.textBright}
              placeholderColor={colors.muted}
              selectionBg={colors.selection}
              keyBindings={[
                { name: "return", action: "submit" },
                { name: "enter", action: "submit" },
                { name: "kpenter", action: "submit" },
                { name: "linefeed", action: "submit" },
                { name: "return", shift: true, action: "newline" },
                { name: "enter", shift: true, action: "newline" },
                { name: "kpenter", shift: true, action: "newline" },
                { name: "linefeed", shift: true, action: "newline" },
              ]}
              minHeight={2}
              maxHeight={10}
              onContentChange={() => {
                const text = prompt?.plainText ?? "";
                promptHistory.noteEditorChange(text);
                setPromptText(text);
                setCommandSuggestionIndex(0);
              }}
              onSubmit={() => void submit()}
              />
            </box>
          </Show>
        </box>
        <Show when={visibleSidebar()}>
          <Sidebar
            state={sessionState()}
            stats={sessionStats()}
            runs={runs()}
            tools={subagentTools()}
            selectedTargetKey={selectedTargetKey()}
            now={clockNow()}
            onSelectTarget={setSelectedTargetKey}
            todos={todos()}
            subagentsAvailable={subagentsAvailable()}
            todosAvailable={todosAvailable()}
            height={dimensions().height - 1}
            onInspectTarget={(targetKey) => {
              setSelectedTargetKey(targetKey);
              setInspectSubagent(true);
              queueMicrotask(() => subagentScroll?.scrollTo(Number.MAX_SAFE_INTEGER));
            }}
          />
        </Show>
      </box>
      <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1} backgroundColor={colors.background}>
        <text fg={streaming() ? colors.green : colors.muted}>● {status()}</text>
        <box flexGrow={1} />
        <text fg={colors.subtle}>{inspectSubagent() ? "f6 next subagent  click agent name to choose  esc main chat" : "ctrl+p models  ctrl+r requests  ctrl+t effort  ctrl+i inspect  f6 next subagent  alt+enter queue  ctrl+o details"}</text>
      </box>
      <For each={toasts()}>
        {(entry, index) => (
          <box
            position="absolute"
            right={2}
            bottom={3 + index() * 3}
            maxWidth="55%"
            backgroundColor={colors.panelRaised}
            border
            borderColor={entry.tone === "error" ? colors.red : entry.tone === "warning" ? colors.yellow : entry.tone === "success" ? colors.green : colors.borderStrong}
            paddingLeft={1}
            paddingRight={1}
            zIndex={200}
          >
            <text fg={colors.text} wrapMode="word">{entry.text}</text>
          </box>
        )}
      </For>
      <Show when={sessionSelectorOpen()}>
        <SessionSelector
          state={sessionDiscovery()}
          switching={sessionSwitching()}
          streaming={streaming()}
          pending={pendingSession()}
          onSelect={(choice) => void switchToSession(choice)}
          onConfirm={() => {
            const choice = pendingSession();
            if (choice) void switchToSession(choice);
          }}
          onDecline={() => setPendingSession(undefined)}
          onCancel={closeSessionSelector}
          onRetry={() => void discoverCurrentSessions()}
        />
      </Show>
      <Show when={modelSelectorOpen()}>
        <ModelSelectorDialog
          models={modelOptions()}
          currentProvider={sessionState()?.model?.provider}
          currentModelId={sessionState()?.model?.id}
          onSelect={(model) => void selectModel(model)}
          onCancel={closeModelSelector}
        />
      </Show>
      <Show when={promptMapOpen()}>
        <PromptMapDialog
          entries={promptMapEntries()}
          onSelect={jumpToPrompt}
          onCancel={closePromptMap}
        />
      </Show>
      <Show when={subagentSelectorOpen()}>
        <SubagentSelectorDialog
          targets={availableSubagentTargets()}
          selectedKey={selectedTargetKey()}
          onSelect={selectSubagentTarget}
          onCancel={() => setSubagentSelectorOpen(false)}
        />
      </Show>
      <Show when={dialog()}>
        {(request) => (
          <ExtensionDialog
            request={request()}
            onValue={(value) => void completeDialog({ value })}
            onConfirm={(confirmed) => void completeDialog({ confirmed })}
            onCancel={() => void completeDialog({ cancelled: true })}
          />
        )}
      </Show>
    </box>
  );
}
