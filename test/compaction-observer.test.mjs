import { describe, expect, test } from "bun:test";
import compactionObserver from "../src/pi-extensions/compaction-observer.mjs";

function setupObserver() {
  const handlers = new Map();
  const statuses = [];
  compactionObserver({
    on(name, handler) {
      handlers.set(name, handler);
    },
  });
  const ctx = {
    ui: {
      setStatus(key, statusText) {
        statuses.push({ key, statusText });
      },
    },
  };
  return { handlers, statuses, ctx };
}

function decode(statuses, index = statuses.length - 1) {
  return JSON.parse(statuses[index].statusText);
}

describe("bundled compaction observer", () => {
  test("reports planned and authoritative context-message counts without replacing compaction", async () => {
    const { handlers, statuses, ctx } = setupObserver();
    const branchEntries = [
      { id: "before", type: "message" },
      { id: "keep", type: "message" },
      { id: "old-compaction", type: "compaction" },
      { id: "tool", type: "toolResult" },
      { id: "after", type: "message" },
    ];
    const before = await handlers.get("session_before_compact")(
      {
        preparation: {
          firstKeptEntryId: "keep",
          messagesToSummarize: [{ role: "user" }, { role: "assistant" }],
          turnPrefixMessages: [{ role: "tool" }],
          tokensBefore: 150_000,
          isSplitTurn: true,
        },
        branchEntries,
        reason: "threshold",
      },
      ctx,
    );

    expect(before).toBeUndefined();
    expect(decode(statuses)).toMatchObject({
      version: 1,
      phase: "preparing",
      attempt: 1,
      reason: "threshold",
      tokensBefore: 150_000,
      summarizingContextMessages: 3,
      plannedRetainedContextMessages: 2,
      splitTurn: true,
    });

    const complete = await handlers.get("session_compact")(
      {
        compactionEntry: { firstKeptEntryId: "keep", tokensBefore: 150_000 },
        reason: "threshold",
      },
      ctx,
    );

    expect(complete).toBeUndefined();
    expect(decode(statuses)).toMatchObject({
      version: 1,
      phase: "complete",
      attempt: 1,
      reason: "threshold",
      tokensBefore: 150_000,
      retainedContextMessages: 2,
    });
  });

  test("tolerates omitted preparation arrays", async () => {
    const { handlers, statuses, ctx } = setupObserver();
    const result = await handlers.get("session_before_compact")(
      {
        preparation: {
          firstKeptEntryId: "keep",
          tokensBefore: 12,
          isSplitTurn: false,
        },
        branchEntries: [{ id: "keep", type: "message" }],
        reason: "overflow",
      },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(decode(statuses)).toMatchObject({
      version: 1,
      phase: "preparing",
      attempt: 1,
      reason: "overflow",
      tokensBefore: 12,
      plannedRetainedContextMessages: 1,
    });
    expect(decode(statuses).summarizingContextMessages).toBeUndefined();
  });

  test("reports failures and clears the in-memory attempt", async () => {
    const { handlers, statuses, ctx } = setupObserver();
    const preparation = {
      firstKeptEntryId: "keep",
      messagesToSummarize: [],
      turnPrefixMessages: [],
      tokensBefore: 10,
      isSplitTurn: false,
    };
    await handlers.get("session_before_compact")(
      {
        preparation,
        branchEntries: [{ id: "keep", type: "message" }],
        reason: "manual",
      },
      ctx,
    );
    await handlers.get("session_compact_failed")(
      { reason: "manual", aborted: false },
      ctx,
    );
    expect(decode(statuses)).toMatchObject({
      version: 1,
      phase: "failed",
      reason: "manual",
    });

    await handlers.get("session_compact")(
      {
        compactionEntry: { firstKeptEntryId: "keep", tokensBefore: 10 },
        reason: "manual",
      },
      ctx,
    );
    expect(decode(statuses).retainedContextMessages).toBeUndefined();
  });
});
