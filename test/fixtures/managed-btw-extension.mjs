/** Synthetic native provider. It never makes network or model requests. */
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const directory = process.env.PITTY_BTW_FIXTURE_DIR;
if (!directory) throw new Error("PITTY_BTW_FIXTURE_DIR is required.");
let asideCount = 0;

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
  const number = kind === "aside" ? ++asideCount : 0;
  const message = {
    role: "assistant", api: model.api, provider: model.provider, model: model.id,
    content: [{ type: "text", text: kind === "aside" ? "SIDE ANSWER " + number : "Main answer" }],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  };
  queueMicrotask(async () => {
    stream.push({ type: "start", partial: { ...message, content: [] } });
    try {
      appendFileSync(path.join(directory, "requests.jsonl"), JSON.stringify({
        kind, number, messages: context.messages, sessionId: options?.sessionId,
        disableContinuation: options?.disableContinuation,
      }) + "\n");
      writeFileSync(path.join(directory, kind + "-started"), String(number));
      await gate(kind, options?.signal);
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
