#!/usr/bin/env node
/** Offline account/usage/policy fixture. It never starts a provider or reads credentials. */
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

if (!process.argv.includes("--mode")) { process.stdout.write("Offline Pi fixture\n"); process.exit(0); }
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME, ".claude");
const account = path.basename(configDir).startsWith("1-") ? "work" : "home";
const sessionId = "fixture-" + process.pid;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const record = (value) => {
  if (process.env.MOCK_POLICY_LOG)
    fs.appendFileSync(process.env.MOCK_POLICY_LOG, JSON.stringify({ pid: process.pid, account, ...value }) + "\n");
};
record({ type: "launch", configDir });
const history = [];
const state = {
  sessionId, sessionFile: path.join(process.env.HOME, sessionId + ".jsonl"),
  sessionName: "Offline " + account, thinkingLevel: "high", isStreaming: false,
  isCompacting: false, autoCompactionEnabled: true, pendingMessageCount: 0, messageCount: 0,
  compactionMethod: "cache-aware", cacheMaintenance: "compact",
  compactionMethods: [
    { id: "cache-aware", available: true }, { id: "extension", available: true },
  ],
  model: { id: "claude-fixture", name: "Claude fixture", provider: "doppelclaude",
    api: "anthropic-messages", contextWindow: 200000, maxTokens: 8192 },
};
function control() {
  try { return JSON.parse(fs.readFileSync(process.env.MOCK_POLICY_CONTROL, "utf8")); }
  catch { return {}; }
}
function usage() {
  const current = control()[account] || {};
  const observedAt = current.observedAt ?? Date.now();
  const status = current.status || "ok";
  return {
    provider: "doppelclaude", sessionId, status, accountId: account, accountLabel: account,
    profileSource: "fixture", configDir, observedAt, source: "fixture-query",
    limits: status === "error" ? [] : [
      { kind: "session", label: "5h", percent: "percent" in current ? current.percent : account === "work" ? 89 : 0,
        resetAt: "resetAt" in current ? current.resetAt : Date.now() + 3600000, active: true },
      { kind: "weekly_all", label: "7d", percent: account === "work" ? 11 : 51,
        resetAt: Date.now() + 3 * 86400000, active: false },
    ],
  };
}
let pushSequence = control().pushSequence;
const pushTimer = setInterval(() => {
  const next = control().pushSequence;
  if (next === pushSequence) return;
  pushSequence = next;
  send({ type: "extension_ui_request", method: "setStatus", statusKey: "doppelclaude.usage.v1", statusText: JSON.stringify(usage()) });
}, 100);
pushTimer.unref();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  let command;
  try { command = JSON.parse(line); } catch { return; }
  record({ type: command.type, ...(command.method ? { method: command.method } : {}),
    ...(command.mode ? { mode: command.mode } : {}),
    ...(typeof command.active === "boolean" ? { active: command.active } : {}) });
  const response = (data) => send({ type: "response", id: command.id, command: command.type, success: true,
    ...(data === undefined ? {} : { data }) });
  switch (command.type) {
    case "get_state": response(state); break;
    case "get_messages": response({ messages: history }); break;
    case "get_fork_messages": response({ messages: [] }); break;
    case "get_provider_usage": response(usage()); break;
    case "get_commands": response({ commands: [{ name: "one-round-compaction", description: "Offline fixture", source: "extension" }] }); break;
    case "get_available_models": response({ models: [state.model] }); break;
    case "get_session_stats": response({ sessionId, sessionFile: state.sessionFile,
      userMessages: history.length / 2, assistantMessages: history.length / 2, toolCalls: 0, toolResults: 0,
      totalMessages: history.length, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
      contextUsage: { tokens: 0, contextWindow: 200000, percent: 0 } }); break;
    case "set_compaction_method": state.compactionMethod = command.method; response({ method: command.method }); break;
    case "set_cache_maintenance":
      state.cacheMaintenance = command.mode;
      state.cacheMaintenanceStatus = command.mode === "keep-warm"
        ? { state: "inactive", action: "warm", reason: "This provider does not support safe cache warming" }
        : { state: "inactive", action: "compact" };
      response({ mode: command.mode }); break;
    case "set_input_active": response(); break;
    case "set_thinking_level": state.thinkingLevel = command.level; response(); break;
    case "set_model": state.model = { ...state.model, provider: command.provider, id: command.modelId }; response(state.model); break;
    case "abort": response(); send({ type: "agent_settled" }); break;
    case "compact": response({}); break;
    case "prompt": {
      response();
      send({ type: "agent_start" });
      const messages = [
        { role: "user", content: [{ type: "text", text: command.message }], timestamp: Date.now() },
        { role: "assistant", content: [{ type: "text", text: "Offline response" }], timestamp: Date.now() + 1 },
      ];
      for (const message of messages) { history.push(message); send({ type: "message_end", message }); }
      state.messageCount = history.length;
      send({ type: "agent_settled" });
      break;
    }
    default: send({ type: "response", id: command.id, command: command.type, success: false, error: "Unsupported fixture command: " + command.type });
  }
});
