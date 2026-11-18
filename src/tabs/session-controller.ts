import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import { initialItems } from "../state/conversation.ts";
import { refreshRuntimeEntries, type ConversationTabRuntime } from "./runtime.ts";

/** Owns history loading and Pi session transitions, not dialog or focus state. */
export class SessionController {
  constructor(private readonly logger: DiagnosticLogger) {}

  async loadHistory(runtime: ConversationTabRuntime, timeoutMs: number): Promise<boolean> {
    const before = [...runtime.conversation.items];
    const messages = await runtime.client.getMessages(timeoutMs);
    const changed = runtime.conversation.items.length !== before.length ||
      runtime.conversation.items.some((item, index) => item !== before[index]);
    if (changed) {
      this.logger.warn("tabs.history_load_raced_live_events", { runtimeId: runtime.id });
      return false;
    }
    runtime.conversation.replaceItems(initialItems(messages));
    await refreshRuntimeEntries(runtime).catch((error) =>
      this.logger.warn("tabs.entry_refresh_failed", error));
    return true;
  }

  async loadCurrent(runtime: ConversationTabRuntime, timeoutMs: number): Promise<number> {
    const [state, messages] = await Promise.all([
      runtime.client.getState(timeoutMs), runtime.client.getMessages(timeoutMs),
    ]);
    const history = initialItems(messages);
    runtime.conversation.replaceItems(history);
    runtime.conversation.isStreaming = state.isStreaming;
    runtime.conversation.steering = [];
    runtime.conversation.followUp = [];
    runtime.sessionState = state;
    runtime.queuedFollowUps = [];
    return history.length;
  }

  async switchAndLoad(runtime: ConversationTabRuntime, path: string, timeoutMs: number):
    Promise<{ cancelled: true } | { cancelled: false; historyLength: number }> {
    const result = await runtime.client.switchSession(path);
    if (result.cancelled) return { cancelled: true };
    return { cancelled: false, historyLength: await this.loadCurrent(runtime, timeoutMs) };
  }
}
