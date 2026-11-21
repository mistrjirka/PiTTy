/** Synthetic native provider. It never makes network or model requests. */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const directory = process.env.PITTY_BTW_FIXTURE_DIR;
if (!directory) throw new Error("PITTY_BTW_FIXTURE_DIR is required.");
let asideCount = 0;
let mainCount = 0;

async function gate(name, signal) {
  const deadline = Date.now() + 20_000;
  while (existsSync(path.join(directory, "hold-" + name))) {
    signal?.throwIfAborted();
    if (Date.now() > deadline) throw new Error("Fixture gate timed out: " + name);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  signal?.throwIfAborted();
}

const model = {
  id: "fixture", name: "Offline BTW fixture", api: "pitty-btw-fixture-api",
  provider: "pitty-btw-fixture", baseUrl: "https://fixture.invalid",
  reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000, maxTokens: 1000,
};

function request(kind, model, context, options) {
  const stream = createAssistantMessageEventStream();
  const number = kind === "aside" ? ++asideCount : ++mainCount;
  const toolTurn = process.env.PITTY_EXPIRY_FIXTURE === "1" && kind === "main" && number === 2;
  const message = {
    role: "assistant", api: model.api, provider: model.provider, model: model.id,
    content: [{ type: "text", text: kind === "aside" ? "SIDE ANSWER " + number : "Main answer" }],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  };
  if (toolTurn) {
    message.content = [{ type: "toolCall", id: "expiry-pending-tool", name: "offline_wait", arguments: {} }];
    message.stopReason = "toolUse";
  }
  queueMicrotask(async () => {
    stream.push({ type: "start", partial: { ...message, content: [] } });
    try {
      appendFileSync(path.join(directory, "requests.jsonl"), JSON.stringify({
        kind, number, messages: context.messages, sessionId: options?.sessionId,
        disableContinuation: options?.disableContinuation,
      }) + "\n");
      writeFileSync(path.join(directory, kind + "-started"), String(number));
      await gate(kind, options?.signal);
      if (toolTurn) {
        await options?.onProviderStreamEvent?.({ type: "prompt_cache_timing", ttlMs: 11_000 }, model);
        stream.push({ type: "done", reason: "toolUse", message });
        stream.end(message);
        return;
      }
      stream.push({ type: "text_start", contentIndex: 0, partial: message });
      stream.push({ type: "text_delta", contentIndex: 0, delta: message.content[0].text, partial: message });
      stream.push({ type: "text_end", contentIndex: 0, content: message.content[0].text, partial: message });
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
    } catch (error) {
      const reason = options?.signal?.aborted ? "aborted" : "error";
      if (reason === "aborted") writeFileSync(path.join(directory, kind + "-aborted"), "");
      const failure = { ...message, content: [], stopReason: reason,
        errorMessage: error instanceof Error ? error.message : String(error) };
      stream.push({ type: "error", reason, error: failure });
      stream.end(failure);
    }
  });
  return stream;
}

export default function (pi) {
  if (process.env.PITTY_EXPIRY_FIXTURE === "1") {
    pi.registerTool({
      name: "offline_wait", label: "Offline pending command", description: "Wait for the test to release a command",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_id, _args, signal) => {
        writeFileSync(path.join(directory, "tool-started"), "");
        try { await gate("tool", signal); }
        catch (error) { writeFileSync(path.join(directory, "tool-aborted"), ""); throw error; }
        return { content: [{ type: "text", text: "saved pending command result" }], details: {} };
      },
    });
  }
  if (process.env.PITTY_USAGE_EXTENSION === "1") {
    pi.registerCommand("one-round-compaction", { description: "Offline loaded-extension fixture", handler: async () => {} });
  }
  pi.on("provider_usage", async (event) => {
    if (event.provider !== model.provider) return;
    const usage = JSON.parse(readFileSync(path.join(directory, "usage.json"), "utf8"));
    if (usage.fail) throw new Error("fixture-secret must never enter a public usage error");
    const profile = process.env.PITTY_USAGE_PROFILE;
    return {
      provider: model.provider, status: usage.unavailable ? "unavailable" : "ok",
      accountId: "fixture:" + profile, accountLabel: profile, profileSource: "synthetic",
      observedAt: usage.unavailable ? null : Date.now(), source: "offline-fixture",
      limits: usage.unavailable ? [] : [
        { kind: "five_hour", label: "5h", percent: usage.fiveHour, resetAt: usage.resetAt },
        { kind: "seven_day", label: "Weekly", percent: usage.weekly, resetAt: usage.resetAt },
      ],
    };
  });

  const main = (model, context, options) => request("main", model, context, options);
  pi.registerProvider({
    id: model.provider, name: "Offline BTW fixture", baseUrl: model.baseUrl,
    auth: { apiKey: {
      name: "Synthetic local fixture",
      check: async () => ({ type: "api_key", source: "fixture" }),
      resolve: async () => ({ auth: { apiKey: "fixture-never-sent" }, source: "fixture" }),
    } },
    getModels: () => [model],
    refreshModels: async () => {},
    filterModels: (models) => models,
    stream: main,
    streamSimple: main,
    streamSideQuestion: (model, context, options) => request("aside", model, context, options),
  });
  pi.on("session_before_compact", async (event) => {
    writeFileSync(path.join(directory, "compaction-started"), "");
    await gate("compaction", event.signal);
    return { compaction: {
      summary: "Synthetic main-conversation summary",
      firstKeptEntryId: event.preparation.firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore,
      details: {},
    } };
  });
}
