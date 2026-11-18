import { randomUUID } from "node:crypto";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import {
  abortFailed, markAbort, restoreQueue, settledDispatchDecision, snapshotQueue,
} from "../state/input-continuity.ts";
import type { DispatchGate, LocalQueuedMessage } from "../state/input-continuity.ts";

/** Minimal typed port. Tests do not need a fake whole ConversationTabRuntime. */
export type InputRuntime = {
  id: string;
  client: { prompt(message: string, behavior?: "steer" | "followUp"): Promise<void>; abort(): Promise<void> };
  conversation: {
    isStreaming: boolean;
    isCompacting: boolean;
    optimisticUser(text: string): string;
    removeItem(id: string): boolean | void;
    system(text: string, tone: "error"): void;
  };
  queuedFollowUps: LocalQueuedMessage[];
  dispatchGate: DispatchGate;
  abortInFlight?: Promise<void>;
  onConversationChange(): void;
};

export type InputControllerHooks<T extends InputRuntime> = {
  onChange(runtime: T): void;
  onOptimisticSubmit(runtime: T): void;
  onQueuedPromptSent(runtime: T, prompt: string): void;
  notify(message: string, tone: "info" | "warning" | "success" | "error"): void;
  isActive(runtimeId: string): boolean;
};

/** Owns prompt delivery and queue state. UI-only effects remain in hooks. */
export class InputController<T extends InputRuntime> {
  constructor(
    private readonly logger: DiagnosticLogger,
    private readonly hooks: InputControllerHooks<T>,
  ) {}

  async sendText(text: string, runtime: T): Promise<"sent" | "queued"> {
    const wasStreaming = runtime.conversation.isStreaming;
    this.logger.info("ui.submit", {
      chars: text.length,
      streaming: wasStreaming,
      compacting: runtime.conversation.isCompacting,
    });
    if (runtime.conversation.isCompacting) {
      this.queueFollowUp(runtime, text);
      this.logger.info("ui.followup_queued_for_compaction", { chars: text.length });
      this.hooks.notify("Compacting context… message queued until it finishes.", "info");
      return "queued";
    }
    if (!wasStreaming) {
      const optimisticId = runtime.conversation.optimisticUser(text);
      if (this.hooks.isActive(runtime.id)) this.hooks.onOptimisticSubmit(runtime);
      try {
        await runtime.client.prompt(text);
      } catch (error) {
        runtime.conversation.removeItem(optimisticId);
        if (this.hooks.isActive(runtime.id)) this.hooks.onChange(runtime);
        throw error;
      }
      return "sent";
    }
    // Pi handles steering and queues the user message for its next model step.
    await runtime.client.prompt(text, "steer");
    return "sent";
  }

  queueFollowUp(runtime: T, text: string): void {
    runtime.queuedFollowUps = [...runtime.queuedFollowUps, { id: randomUUID(), text }];
    this.hooks.onChange(runtime);
  }

  async flushQueuedFollowUp(runtime: T): Promise<void> {
    const decision = settledDispatchDecision(
      runtime.dispatchGate,
      runtime.queuedFollowUps.length > 0,
      runtime.conversation.isStreaming,
    );
    if (decision === "busy" || decision === "empty") return;
    if (decision === "suppressed") {
      runtime.dispatchGate = { ...runtime.dispatchGate, suppressNextSettled: false };
      return;
    }
    const snapshot = snapshotQueue(runtime.queuedFollowUps);
    runtime.dispatchGate = { ...runtime.dispatchGate, inFlight: true };
    runtime.queuedFollowUps = runtime.queuedFollowUps.filter(
      (item) => !snapshot.items.some((queued) => queued.id === item.id),
    );
    this.hooks.onChange(runtime);
    try {
      const result = await this.sendText(snapshot.prompt, runtime);
      if (result === "sent") this.hooks.onQueuedPromptSent(runtime, snapshot.prompt);
    } catch (error) {
      runtime.queuedFollowUps = restoreQueue(snapshot.items, runtime.queuedFollowUps);
      this.hooks.onChange(runtime);
      runtime.conversation.system(
        `Failed to send queued follow-ups: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      runtime.onConversationChange();
    } finally {
      runtime.dispatchGate = { ...runtime.dispatchGate, inFlight: false };
    }
  }

  abort(runtime: T): void {
    if (runtime.abortInFlight) return;
    runtime.dispatchGate = markAbort(runtime.dispatchGate);
    runtime.abortInFlight = runtime.client
      .abort()
      .then(() => this.hooks.notify("Aborting current Pi turn", "warning"))
      .catch((error) => {
        runtime.dispatchGate = abortFailed(runtime.dispatchGate);
        this.hooks.notify(String(error), "error");
      })
      .finally(() => { delete runtime.abortInFlight; });
  }
}
