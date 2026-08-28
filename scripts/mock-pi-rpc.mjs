#!/usr/bin/env node
import { createInterface } from "node:readline";
import fs from "node:fs";

const restartFailureFile = process.env.MOCK_RESTART_FAILURE_FILE;
if (restartFailureFile) {
  if (fs.existsSync(restartFailureFile)) process.exit(23);
  fs.writeFileSync(restartFailureFile, "started");
}
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const sessionArgumentIndex = process.argv.indexOf("--session");
const initialSessionFile = sessionArgumentIndex >= 0 ? process.argv[sessionArgumentIndex + 1] : "/tmp/mock-session.jsonl";
const state = {
  sessionFile: initialSessionFile,
  thinkingLevel: "high",
  isStreaming: false,
  isCompacting: false,
  steeringMode: "all",
  followUpMode: "all",
  sessionId: "mock-session",
  sessionName: process.env.MOCK_SCREENSHOT_SCENARIO === "empty" ? "New session" : "Mock Pi Session",
  autoCompactionEnabled: true,
  pendingMessageCount: 0,
  model: { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "openai-codex", api: "openai-responses", contextWindow: 400000, maxTokens: 128000 },
};

const history = process.env.MOCK_SCREENSHOT_SCENARIO === "empty" ? [] : [
  { role: "user", content: [{ type: "text", text: "Existing user message" }], timestamp: 1 },
  { role: "assistant", content: [{ type: "text", text: "Existing assistant answer" }], timestamp: 2 },
];

if (process.env.MOCK_SCREENSHOT_RICH === "1" && process.env.MOCK_SCREENSHOT_SCENARIO !== "empty") {
  history.push(
    { role: "user", content: [{ type: "text", text: "Review the release workflow and summarize the risks." }], timestamp: 3 },
    { role: "assistant", content: [{ type: "thinking", thinking: "I will inspect the workflow and verify the release path." }, { type: "text", text: "The workflow is ready. I found one portability edge case and corrected it." }, { type: "toolCall", id: "bash-1", toolCallId: "bash-1", name: "bash", arguments: { command: "bun run typecheck" } }], timestamp: 4, stopReason: "toolUse", usage: { input: 1200, output: 240, cacheRead: 0, cacheWrite: 0, totalTokens: 1440, cost: 0 } },
    { role: "toolResult", toolCallId: "bash-1", content: [{ type: "text", text: "typecheck passed" }], timestamp: 5 },
    { role: "assistant", content: [{ type: "toolCall", id: "edit-1", toolCallId: "edit-1", name: "edit", arguments: { path: "src/app.tsx" } }, { type: "text", text: "I also checked the sidebar state and tab ownership." }], timestamp: 6, stopReason: "toolUse", usage: { input: 1400, output: 180, cacheRead: 0, cacheWrite: 0, totalTokens: 1580, cost: 0 } },
    { role: "toolResult", toolCallId: "edit-1", content: [{ type: "text", text: "Updated src/app.tsx\n@@ -1 +1 @@\n- stale\n+ reactive" }], timestamp: 7 },
    { role: "assistant", content: [{ type: "toolCall", id: "subagent-1", toolCallId: "subagent-1", name: "subagent", arguments: { agent: "reviewer", model: "gpt-5.6", mode: "background", task: "Check tab state." } }], timestamp: 8, stopReason: "toolUse", usage: { input: 900, output: 120, cacheRead: 0, cacheWrite: 0, totalTokens: 1020, cost: 0 } },
    { role: "toolResult", toolCallId: "subagent-1", content: [{ type: "text", text: "Review complete: tab state remains isolated and reactive." }], timestamp: 9 },
    { role: "custom", customType: "supervisor", content: [{ type: "text", text: `Supervisor: release review complete; no blockers. SCREENSHOT-${process.env.MOCK_SCREENSHOT_SCENARIO ?? "rich"}` }], timestamp: 10 }
  );
}

if (process.env.MOCK_SCREENSHOT_SCENARIO === "long-diff") {
  const lines = Array.from({ length: 28 }, (_, index) => `${index % 2 === 0 ? "+" : "-"} wrapped transcript diff line ${index + 1} with enough deterministic text to exercise the scroll viewport`);
  history.push(
    { role: "user", content: [{ type: "text", text: "Long wrapped diff" }], timestamp: 11 },
    { role: "assistant", content: [{ type: "toolCall", id: "long-diff-1", toolCallId: "long-diff-1", name: "edit", arguments: { path: "src/large-file.ts" } }], timestamp: 12, stopReason: "toolUse" },
    { role: "toolResult", toolCallId: "long-diff-1", content: [{ type: "text", text: "Applied edit" }], details: { path: "src/large-file.ts", diffData: { entries: lines } }, timestamp: 13 },
  );
}
const userMessageCount = history.filter((message) => message.role === "user").length;
const assistantMessageCount = history.filter((message) => message.role === "assistant").length;
const toolCallCount = history.reduce(
  (count, message) => count + (Array.isArray(message.content) ? message.content.filter((block) => block && block.type === "toolCall").length : 0),
  0,
);
const toolResultCount = history.filter((message) => message.role === "toolResult" || message.role === "tool").length;
state.messageCount = history.length;

const stats = {
  sessionFile: initialSessionFile,
  sessionId: "mock-session",
  userMessages: userMessageCount,
  assistantMessages: assistantMessageCount,
  toolCalls: toolCallCount,
  toolResults: toolResultCount,
  totalMessages: history.length,
  tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
  cost: 0,
  contextUsage: { tokens: 33000, contextWindow: 400000, percent: 8.25 },
};

const startupDelayMs = Number(process.env.MOCK_STARTUP_DELAY_MS ?? 0);
const startupReadyAt = Date.now() + startupDelayMs;
const promptCompactionDelayMs = Number(process.env.MOCK_PROMPT_COMPACTION_DELAY_MS ?? 0);
const dropPromptAfterCompaction = process.env.MOCK_DROP_PROMPT_AFTER_COMPACTION === "1";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  let command;
  try { command = JSON.parse(line); } catch { return; }
  const startupWaitMs = startupReadyAt - Date.now();
  if (startupWaitMs > 0 && (command.type === "get_state" || command.type === "get_messages"))
    await new Promise((resolve) => setTimeout(resolve, startupWaitMs));
  if (command.type === "extension_ui_response") return;
  const response = (data) => send({ type: "response", id: command.id, command: command.type, success: true, ...(data === undefined ? {} : { data }) });
  switch (command.type) {
    case "get_state": response(state); break;
    case "get_messages": response({ messages: history }); break;
    case "get_fork_messages": response({ messages: [] }); break;
    case "get_session_stats": response(stats); break;
    case "cycle_model": response({ model: state.model, thinkingLevel: state.thinkingLevel, isScoped: false }); break;
    case "get_available_models": response({ models: [state.model] }); break;
    case "set_model":
      if (command.modelId === "failed") send({ type: "response", id: command.id, command: command.type, success: false, error: "Model unavailable" });
      else { state.model = { ...state.model, provider: command.provider, id: command.modelId }; response(state.model); }
      break;
    case "set_thinking_level":
      if (command.level === "xhigh") send({ type: "response", id: command.id, command: command.type, success: false, error: "Thinking level unavailable" });
      else { state.thinkingLevel = command.level; response(); }
      break;
    case "set_session_name":
      if (command.name === "failed") send({ type: "response", id: command.id, command: command.type, success: false, error: "Rename rejected" });
      else { state.sessionName = command.name; response(); }
      break;
    case "switch_session": {
      if (command.sessionPath === "unsupported") {
        send({ type: "response", id: command.id, command: command.type, success: false, error: "Unknown command: switch_session" });
      } else if (command.sessionPath === "failed") {
        send({ type: "response", id: command.id, command: command.type, success: false, error: "Session file not found" });
      } else if (command.sessionPath === "cancel") response({ cancelled: true });
      else { state.sessionFile = command.sessionPath; response({ cancelled: false }); }
      break;
    }
    case "cycle_thinking_level": response({ level: state.thinkingLevel }); break;
    case "prompt":
    case "steer":
    case "follow_up": {
      if (command.type === "prompt" && promptCompactionDelayMs > 0) {
        send({ type: "compaction_start" });
        await new Promise((resolve) => setTimeout(resolve, promptCompactionDelayMs));
        send({ type: "compaction_end" });
      }
      if (command.type === "prompt" && dropPromptAfterCompaction) break;
      response();
      const text = typeof command.message === "string" ? command.message : "";
      send({ type: "agent_start" });
      send({ type: "message_end", message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() } });
      const assistantTimestamp = Date.now();
      send({ type: "message_start", message: { role: "assistant", content: [], timestamp: assistantTimestamp } });
      send({ type: "message_update", message: { role: "assistant", content: [], timestamp: assistantTimestamp }, assistantMessageEvent: { type: "thinking_delta", delta: "Mock thinking" } });
      send({ type: "message_update", message: { role: "assistant", content: [], timestamp: assistantTimestamp }, assistantMessageEvent: { type: "text_delta", delta: `Echo: ${text}` } });
      send({ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "Mock thinking" }, { type: "text", text: `Echo: ${text}` }], timestamp: assistantTimestamp } });
      send({ type: "agent_settled" });
      break;
    }
    case "abort": response(); send({ type: "agent_settled" }); break;
    case "compact": response({}); break;
    case "new_session": response({ cancelled: false }); break;
    default: send({ type: "response", id: command.id, command: command.type, success: false, error: `Unsupported mock command: ${command.type}` });
  }
});
