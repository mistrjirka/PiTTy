/** Offline provider for the real managed-RPC integration test. */
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

const directory = process.env.PITTY_QUEUE_FIXTURE_DIR;
if (!directory) throw new Error("PITTY_QUEUE_FIXTURE_DIR is required.");

async function waitGate(name, signal) {
  const deadline = Date.now() + 20_000;
  while (existsSync(path.join(directory, `hold-${name}`))) {
    signal?.throwIfAborted();
    if (Date.now() > deadline) throw new Error(`Fixture gate ${name} timed out.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  signal?.throwIfAborted();
}

export default function (pi) {
  let foregroundLaunched = false;
  let responseCount = 0;
  pi.registerProvider("pitty-queue-fixture", {
    baseUrl: "https://fixture.invalid",
    apiKey: "fixture-key-never-sent",
    api: "pitty-queue-fixture-api",
    models: [{
      id: "fixture",
      name: "Offline queue fixture",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 1000,
    }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const inputTokens = process.env.PITTY_QUEUE_AUTOCOMPACT === "1" && responseCount++ === 0 ? 199_950 : 1;
      const message = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: "text", text: "fixture response" }],
        usage: {
          input: inputTokens, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: inputTokens + 1,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      if (process.env.PITTY_QUEUE_FOREGROUND_COMMAND && !foregroundLaunched) {
        foregroundLaunched = true;
        message.content = [{
          type: "toolCall", id: "fixture-bash-1", name: "bash",
          arguments: {
            command: process.env.PITTY_QUEUE_FOREGROUND_COMMAND,
            timeout: Number(process.env.PITTY_QUEUE_FOREGROUND_TIMEOUT_SECONDS ?? 60),
          },
        }];
        message.stopReason = "toolUse";
      }
      queueMicrotask(async () => {
        try {
          if (existsSync(path.join(directory, "fail-compaction"))) throw new Error("fixture compaction failure");
          appendFileSync(path.join(directory, "contexts.jsonl"), JSON.stringify(context.messages) + "\n");
          writeFileSync(path.join(directory, "response-started"), "");
          stream.push({ type: "start", partial: { ...message, content: [] } });
          await waitGate("response", options?.signal);
          stream.push({ type: "done", reason: message.stopReason, message });
        } catch (error) {
          stream.push({
            type: "error",
            reason: options?.signal?.aborted ? "aborted" : "error",
            error: {
              ...message,
              stopReason: options?.signal?.aborted ? "aborted" : "error",
              errorMessage: error instanceof Error ? error.message : String(error),
            },
          });
        }
      });
      return stream;
    },
  });

  pi.registerCommand("queue-fixture-notify", {
    handler: async () => {
      pi.sendMessage({
        customType: "fixture-subagent-result",
        content: "Fixture child finished",
        display: false,
        details: { source: "offline child notification" },
      }, { triggerTurn: true, deliverAs: "followUp" });
    },
  });

  pi.registerCommand("queue-fixture-steer-notify", {
    handler: async () => {
      pi.sendMessage({
        customType: "fixture-subagent-result",
        content: "Fixture background task finished",
        display: true,
      }, { triggerTurn: true, deliverAs: "steer" });
    },
  });

  pi.registerCommand("queue-fixture-snapshot", {
    handler: async () => {
      const registry = globalThis[Symbol.for("pi-bg-bash.registry")];
      const snapshot = {
        foreground: registry?.foreground?.size ?? 0,
        foregroundStartedAt: [...(registry?.foreground ?? [])].map((run) => run.startedAt),
        groups: [...(registry?.groups ?? [])],
        tasks: [...(registry?.tasks?.values() ?? [])].map((task) => ({
          id: task.id, pid: task.pid, state: task.state, toolCallId: task.toolCallId,
          startedAt: task.startedAt, deadline: task.deadline,
        })),
      };
      writeFileSync(path.join(directory, "background-snapshot.json"), JSON.stringify(snapshot));
    },
  });

  pi.on("input", async (event) => {
    if (event.text === "handled input") return { action: "handled" };
    if (event.text === "slow-first") {
      writeFileSync(path.join(directory, "input-started"), "");
      await waitGate("input");
    }
  });

  pi.on("session_before_compact", async (event) => {
    writeFileSync(path.join(directory, "compaction-started"), "");
    await waitGate("compaction", event.signal);
    if (existsSync(path.join(directory, "fail-compaction"))) return undefined;
    return {
      compaction: {
        summary: "Fixture summary",
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        details: { fixtureOwner: "primary" },
      },
    };
  });
}
