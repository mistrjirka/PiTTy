import { describe, expect, test } from "bun:test";
import type { DiagnosticLogger } from "../src/diagnostics/logger.ts";
import { InputController, type InputRuntime } from "../src/tabs/input-controller.ts";

function fixture() {
  const prompts: Array<[string, string | undefined]> = [];
  const notices: string[] = [];
  const events: string[] = [];
  let failNextPrompt = false;
  const transport = {
    async prompt(text: string, behavior?: "steer" | "followUp") {
      prompts.push([text, behavior]);
      if (failNextPrompt) { failNextPrompt = false; throw new Error("network failure"); }
    },
    async abort() { events.push("abort"); },
  };
  let lastOptimisticId = "";
  const runtime: InputRuntime = {
    id: "one",
    client: transport,
    conversation: {
      isStreaming: false,
      isCompacting: false,
      optimisticUser(text) {
        events.push("optimistic:" + text);
        return (lastOptimisticId = "user-1");
      },
      removeItem(id) { events.push("remove:" + id); return true; },
      system(text) { events.push("error:" + text); },
    },
    queuedFollowUps: [],
    dispatchGate: { inFlight: false, suppressNextSettled: false },
    onConversationChange() { events.push("notify"); },
  };
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as DiagnosticLogger;
  const controller = new InputController<InputRuntime>(logger, {
    onChange() { events.push("change"); },
    onOptimisticSubmit() { events.push("optimistic-ready"); },
    onQueuedPromptSent(_runtime, text) { events.push("queued-sent:" + text); },
    notify(message) { notices.push(message); },
    isActive() { return true; },
  });
  return { runtime, controller, prompts, notices, events, failOnce() { failNextPrompt = true; } };
}

describe("input dispatch controller", () => {
  test("sends a normal prompt with an optimistic user item", async () => {
    const f = fixture();
    expect(await f.controller.sendText("hello", f.runtime)).toBe("sent");
    expect(f.prompts).toEqual([["hello", undefined]]);
    expect(f.events).toEqual(["optimistic:hello", "optimistic-ready"]);
  });

  test("steers a running model without duplicating the transcript", async () => {
    const f = fixture();
    f.runtime.conversation.isStreaming = true;
    expect(await f.controller.sendText("continue", f.runtime)).toBe("sent");
    expect(f.prompts).toEqual([["continue", "steer"]]);
    expect(f.events).toEqual([]);
  });

  test("queues during compaction then dispatches once when idle", async () => {
    const f = fixture();
    f.runtime.conversation.isCompacting = true;
    expect(await f.controller.sendText("queued", f.runtime)).toBe("queued");
    expect(f.prompts).toEqual([]);
    expect(f.runtime.queuedFollowUps).toHaveLength(1);
    f.runtime.conversation.isCompacting = false;
    await f.controller.flushQueuedFollowUp(f.runtime);
    expect(f.prompts).toEqual([["queued", undefined]]);
    expect(f.runtime.queuedFollowUps).toHaveLength(0);
    expect(f.events).toContain("queued-sent:queued");
    expect(f.runtime.dispatchGate.inFlight).toBe(false);
  });

  test("restores an unsent follow-up after an RPC failure", async () => {
    const f = fixture();
    f.controller.queueFollowUp(f.runtime, "message");
    f.failOnce();
    await f.controller.flushQueuedFollowUp(f.runtime);
    expect(f.runtime.queuedFollowUps).toHaveLength(1);
    expect(f.events.some((event) => event.includes("network failure"))).toBe(true);
    expect(f.runtime.dispatchGate.inFlight).toBe(false);
  });

  test("suppressed abort settles once without dispatching", async () => {
    const f = fixture();
    f.controller.queueFollowUp(f.runtime, "do not send yet");
    f.controller.abort(f.runtime);
    await f.runtime.abortInFlight;
    expect(f.runtime.dispatchGate.suppressNextSettled).toBe(true);
    await f.controller.flushQueuedFollowUp(f.runtime);
    expect(f.prompts).toEqual([]);
    expect(f.runtime.queuedFollowUps).toHaveLength(1);
    expect(f.runtime.dispatchGate.suppressNextSettled).toBe(false);
    expect(f.events).toContain("abort");
  });
});
