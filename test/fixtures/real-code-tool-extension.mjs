/** Offline provider and observations for the real Python bridge regression. */
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

const directory = process.env.PITTY_CODE_FIXTURE_DIR;
if (!directory) throw new Error("PITTY_CODE_FIXTURE_DIR is required.");

export default function (pi) {
  let codeLaunched = false;
  pi.registerProvider("pitty-code-fixture", {
    baseUrl: "https://fixture.invalid",
    apiKey: "fixture-key-never-sent",
    api: "pitty-code-fixture-api",
    models: [{
      id: "fixture", name: "Offline Python bridge fixture", reasoning: false,
      input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000, maxTokens: 1000,
    }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const message = {
        role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: [{ type: "text", text: "fixture response" }],
        usage: {
          input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop", timestamp: Date.now(),
      };
      if (!codeLaunched) {
        codeLaunched = true;
        message.content = [{
          type: "toolCall", id: "fixture-code-1", name: "code",
          arguments: { code: process.env.PITTY_CODE_FIXTURE_CODE, reset: true },
        }];
        message.stopReason = "toolUse";
      }
      queueMicrotask(() => {
        if (options?.signal?.aborted) {
          stream.push({ type: "error", reason: "aborted", error: {
            ...message, stopReason: "aborted", errorMessage: "Fixture aborted",
          } });
          return;
        }
        appendFileSync(path.join(directory, "contexts.jsonl"), JSON.stringify(context.messages) + "\n");
        stream.push({ type: "start", partial: { ...message, content: [] } });
        stream.push({ type: "done", reason: message.stopReason, message });
      });
      return stream;
    },
  });

  pi.on("tool_call", (event) => {
    appendFileSync(path.join(directory, "tool-calls.jsonl"), JSON.stringify(event) + "\n");
    if (process.env.PITTY_CODE_FIXTURE_BLOCK_EDIT === "1" && event.toolName === "edit") {
      return { block: true, reason: "fixture denied nested edit" };
    }
  });
  pi.on("input_queued", (event) => {
    writeFileSync(path.join(directory, "accepted-input.json"), JSON.stringify(event));
  });
  pi.registerCommand("code-fixture-snapshot", {
    handler: async () => {
      const registry = globalThis[Symbol.for("pi-bg-bash.registry")];
      writeFileSync(path.join(directory, "background-snapshot.json"), JSON.stringify({
        foreground: registry?.foreground?.size ?? 0,
        foregroundStartedAt: [...(registry?.foreground ?? [])].map((run) => run.startedAt),
        groups: [...(registry?.groups ?? [])],
        tasks: [...(registry?.tasks?.values() ?? [])].map((task) => ({
          id: task.id, pid: task.pid, state: task.state, toolCallId: task.toolCallId,
          startedAt: task.startedAt, deadline: task.deadline, logPath: task.logPath,
        })),
      }));
    },
  });
}
