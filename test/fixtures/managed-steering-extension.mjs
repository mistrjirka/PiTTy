/** Offline request and tool gates for immediate-steering integration tests. */
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";

const directory = process.env.PITTY_STEERING_FIXTURE_DIR;
if (!directory) throw new Error("PITTY_STEERING_FIXTURE_DIR is required.");

async function gate(name, signal) {
  const deadline = Date.now() + 15_000;
  while (existsSync(path.join(directory, "hold-" + name))) {
    signal?.throwIfAborted();
    if (Date.now() > deadline) throw new Error("Fixture gate timed out: " + name);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  signal?.throwIfAborted();
}

export default function (pi) {
  let requests = 0;
  pi.registerProvider("pitty-steering-fixture", {
    baseUrl: "https://fixture.invalid",
    apiKey: "offline-never-sent",
    api: "pitty-steering-fixture-api",
    models: [{
      id: "fixture", name: "Offline steering fixture", reasoning: false,
      input: ["text"], contextWindow: 200_000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const request = ++requests;
      const responseFile = path.join(directory, "next-response.json");
      const next = existsSync(responseFile) ? JSON.parse(readFileSync(responseFile, "utf8")) : undefined;
      if (next) unlinkSync(responseFile);
      const message = {
        role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: next?.content ?? [{ type: "text", text: "Fixture completed." }],
        stopReason: next?.stopReason ?? "stop", timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      queueMicrotask(async () => {
        try {
          appendFileSync(path.join(directory, "contexts.jsonl"), JSON.stringify({ request, messages: context.messages }) + "\n");
          writeFileSync(path.join(directory, "request-" + request + "-started"), "");
          stream.push({ type: "start", partial: { ...message, content: [] } });
          await gate("request-" + request, options?.signal);
          stream.push({ type: "done", reason: message.stopReason, message });
        } catch (error) {
          const aborted = Boolean(options?.signal?.aborted);
          if (aborted) writeFileSync(path.join(directory, "request-" + request + "-aborted"), "");
          stream.push({ type: "error", reason: aborted ? "aborted" : "error",
            error: { ...message, content: [], stopReason: aborted ? "aborted" : "error",
              errorMessage: error instanceof Error ? error.message : String(error) } });
        }
      });
      return stream;
    },
  });
  for (const name of ["read", "write"]) {
    pi.registerTool({
      name, label: "Fixture " + name, description: "Offline gated " + name + ".",
      parameters: Type.Object({ path: Type.String(), ...(name === "write" ? { content: Type.String() } : {}) }),
      async execute(_id, params, signal) {
        const label = params.path;
        appendFileSync(path.join(directory, "calls.jsonl"), JSON.stringify({ label }) + "\n");
        writeFileSync(path.join(directory, "tool-" + label + "-started"), "");
        await gate("tool-" + label, signal);
        if (name === "write") writeFileSync(path.join(directory, label), params.content);
        writeFileSync(path.join(directory, "tool-" + label + "-completed"), "");
        return { content: [{ type: "text", text: "completed " + label }], details: {} };
      },
    });
  }
  pi.registerCommand("steering-fixture-notify", {
    async handler() {
      pi.sendMessage({ customType: "fixture-notification", content: "Background fixture completed.", display: false },
        { triggerTurn: true, deliverAs: "steer" });
    },
  });
  pi.on("input", (event) => event.text === "handled input" ? { action: "handled" } : undefined);
}
