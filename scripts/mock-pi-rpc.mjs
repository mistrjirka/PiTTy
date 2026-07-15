#!/usr/bin/env node
import { createInterface } from "node:readline";

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const state = {
  thinkingLevel: "high",
  isStreaming: false,
  isCompacting: false,
  steeringMode: "all",
  followUpMode: "all",
  sessionId: "mock-session",
  sessionName: "Mock Pi Session",
  autoCompactionEnabled: true,
  messageCount: 2,
  pendingMessageCount: 0,
  model: { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "openai-codex", api: "openai-responses", contextWindow: 400000, maxTokens: 128000 },
};

const history = [
  { role: "user", content: [{ type: "text", text: "Existing user message" }], timestamp: 1 },
  { role: "assistant", content: [{ type: "text", text: "Existing assistant answer" }], timestamp: 2 },
];

const stats = {
  sessionFile: "/tmp/mock-session.jsonl",
  sessionId: "mock-session",
  userMessages: 1,
  assistantMessages: 1,
  toolCalls: 0,
  toolResults: 0,
  totalMessages: 2,
  tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
  cost: 0,
  contextUsage: { tokens: 33000, contextWindow: 400000, percent: 8.25 },
};

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  let command;
  try { command = JSON.parse(line); } catch { return; }
  if (command.type === "extension_ui_response") return;
  const response = (data) => send({ type: "response", id: command.id, command: command.type, success: true, ...(data === undefined ? {} : { data }) });
  switch (command.type) {
    case "get_state": response(state); break;
    case "get_messages": response({ messages: history }); break;
    case "get_session_stats": response(stats); break;
    case "cycle_model": response({ model: state.model, thinkingLevel: state.thinkingLevel, isScoped: false }); break;
    case "cycle_thinking_level": response({ level: state.thinkingLevel }); break;
    case "prompt":
    case "steer":
    case "follow_up": {
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
