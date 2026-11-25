/** Offline model shared by the real parent and its real Pi subagent process. */
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";

const directory = process.env.PITTY_SUBAGENT_FIXTURE_DIR;
if (!directory) throw new Error("PITTY_SUBAGENT_FIXTURE_DIR is required.");
const childId = process.env.PI_SUBAGENT_AGENT_ID;
const child = Boolean(childId);
const codeChild = process.env.PITTY_SUBAGENT_CODE_CHILD === "1";

function text(message) {
  return typeof message.content === "string" ? message.content
    : message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
}
function append(name, value) {
  appendFileSync(path.join(directory, name), JSON.stringify(value) + "\n");
}
async function waitForRelease(signal) {
  const deadline = Date.now() + 40_000;
  while (!existsSync(path.join(directory, "child-release"))) {
    signal?.throwIfAborted();
    if (Date.now() > deadline) throw new Error("Child fixture gate timed out.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  signal?.throwIfAborted();
}

export default function (pi) {
  let parentStage = 0;
  let childStage = 0;
  if (child) {
    append("child-launches.jsonl", { pid: process.pid, agentId: childId });
    process.once("exit", () => writeFileSync(path.join(directory, "child-exited"), String(process.pid)));
  }
  pi.registerProvider("pitty-subagent-fixture", {
    baseUrl: "https://fixture.invalid",
    apiKey: "fixture-key-never-sent",
    api: "pitty-subagent-fixture-api",
    models: [{
      id: "fixture", name: "Offline subagent wait fixture", reasoning: false,
      input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000, maxTokens: 1000,
    }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const message = {
        role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: [{ type: "text", text: child ? "Original child completed" : "Parent received the input" }],
        usage: {
          input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop", timestamp: Date.now(),
      };
      let call;
      if (child && codeChild && childStage++ === 0) {
        call = { type: "toolCall", id: "child-code", name: "code", arguments: {
          code: 'written = write("late-edit.txt", "written exactly once")\nread("must-not-run.txt")\nprint(written)',
        } };
      } else if (!child && parentStage === 0) {
        parentStage++;
        call = { type: "toolCall", id: "fixture-spawn-1", name: "agent_spawn", arguments: {
          agent: "fixture-child", prompt: "Wait for the fixture gate", run_in_background: true,
        } };
      } else if (!child && parentStage === 1) {
        parentStage++;
        const spawned = context.messages.find((item) => item.role === "toolResult" && item.toolCallId === "fixture-spawn-1");
        const agentId = spawned?.details?.agentId ?? (spawned && text(spawned).match(/background agent @([^ .]+)/)?.[1]);
        if (!agentId) throw new Error("Real agent_spawn did not return a child id: " + JSON.stringify(spawned));
        call = { type: "toolCall", id: "fixture-wait-1", name: "agent_wait", arguments: {
          agent_id: agentId, timeout_seconds: 30,
        } };
      } else if (!child && existsSync(path.join(directory, "next-action.json"))) {
        call = JSON.parse(readFileSync(path.join(directory, "next-action.json"), "utf8"));
        unlinkSync(path.join(directory, "next-action.json"));
      } else if (!child && existsSync(path.join(directory, "next-wait.json"))) {
        const request = JSON.parse(readFileSync(path.join(directory, "next-wait.json"), "utf8"));
        unlinkSync(path.join(directory, "next-wait.json"));
        call = { type: "toolCall", id: "fixture-wait-2", name: "agent_wait", arguments: {
          agent_id: request.agentId, timeout_seconds: 30,
        } };
      }
      if (call) {
        message.content = [call];
        message.stopReason = "toolUse";
      }
      queueMicrotask(async () => {
        try {
          append(child ? "child-contexts.jsonl" : "parent-contexts.jsonl", context.messages);
          stream.push({ type: "start", partial: { ...message, content: [] } });
          if (child) {
            writeFileSync(path.join(directory, "child-started.json"), JSON.stringify({ pid: process.pid, agentId: childId }));
            if (!codeChild) {
              await waitForRelease(options?.signal);
              writeFileSync(path.join(directory, "child-completed"), String(process.pid));
            } else if (!call) {
              writeFileSync(path.join(directory, "child-correction-answered"), String(process.pid));
            }
          }
          options?.signal?.throwIfAborted();
          stream.push({ type: "done", reason: message.stopReason, message });
        } catch (error) {
          stream.push({ type: "error", reason: options?.signal?.aborted ? "aborted" : "error", error: {
            ...message, stopReason: options?.signal?.aborted ? "aborted" : "error",
            errorMessage: error instanceof Error ? error.message : String(error),
          } });
        }
      });
      return stream;
    },
  });

  if (child && codeChild) {
    pi.registerTool({
      name: "write", label: "Fixture write", description: "Gated fixture file write",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      async execute(_id, params, signal) {
        writeFileSync(path.join(directory, "child-host-started"), String(process.pid));
        await waitForRelease(signal);
        writeFileSync(path.join(directory, params.path), params.content);
        writeFileSync(path.join(directory, "child-host-completed"), String(process.pid));
        return { content: [{ type: "text", text: "Wrote " + params.path }], details: {} };
      },
    });
    pi.registerTool({
      name: "read", label: "Fixture read", description: "Must pause before this call",
      parameters: Type.Object({ path: Type.String() }),
      async execute() {
        writeFileSync(path.join(directory, "unexpected-resume"), "");
        throw new Error("The paused script must not resume automatically.");
      },
    });
    pi.on("session_start", (_event, ctx) => {
      const file = ctx.sessionManager.getSessionFile();
      if (file) writeFileSync(path.join(directory, "child-session-path"), file);
    });
  }

  pi.on("input", (event) => {
    if (event.text === "handled input") return { action: "handled" };
  });
  pi.on("input_queued", (event) => {
    if (!child) append("accepted-inputs.jsonl", event);
  });
}
