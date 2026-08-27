const STATUS_KEY = "pitty.compaction.v1";
const VERSION = 1;

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const countMessages = (entries, firstKeptEntryId) => {
  if (typeof firstKeptEntryId !== "string") return undefined;
  const start = entries.findIndex(
    (entry) => isRecord(entry) && entry.id === firstKeptEntryId,
  );
  if (start < 0) return undefined;
  return entries
    .slice(start)
    .filter((entry) => isRecord(entry) && entry.type === "message").length;
};


const report = (ctx, payload) => {
  try {
    ctx.ui.setStatus(STATUS_KEY, JSON.stringify({ version: VERSION, ...payload }));
  } catch {
    // Telemetry is optional and must never affect native compaction.
  }
};

export default function compactionObserver(pi) {
  let attempt;
  let attemptNumber = 0;

  pi.on("session_before_compact", async (event, ctx) => {
    const preparation = event.preparation;
    const branchEntries = event.branchEntries;
    attemptNumber += 1;
    const startedAt = Date.now();
    attempt = {
      branchEntries,
      firstKeptEntryId: preparation.firstKeptEntryId,
      attempt: attemptNumber,
      startedAt,
    };
    const plannedRetainedContextMessages = countMessages(
      branchEntries,
      preparation.firstKeptEntryId,
    );
    const historyCount = Array.isArray(preparation.messagesToSummarize)
      ? preparation.messagesToSummarize.length
      : undefined;
    const prefixCount = Array.isArray(preparation.turnPrefixMessages)
      ? preparation.turnPrefixMessages.length
      : undefined;
    const summarizingContextMessages =
      historyCount === undefined && prefixCount === undefined
        ? undefined
        : (historyCount ?? 0) + (prefixCount ?? 0);
    report(ctx, {
      phase: "preparing",
      reason: event.reason,
      tokensBefore: preparation.tokensBefore,
      ...(summarizingContextMessages === undefined
        ? {}
        : { summarizingContextMessages }),
      ...(plannedRetainedContextMessages === undefined
        ? {}
        : { plannedRetainedContextMessages }),
      splitTurn: preparation.isSplitTurn,
      attempt: attemptNumber,
      startedAt,
    });
    return undefined;
  });

  pi.on("session_compact", async (event, ctx) => {
    const retainedContextMessages = attempt
      ? countMessages(
          attempt.branchEntries,
          event.compactionEntry.firstKeptEntryId,
        )
      : undefined;
    report(ctx, {
      phase: "complete",
      reason: event.reason,
      tokensBefore: event.compactionEntry.tokensBefore,
      attempt: attempt?.attempt,
      startedAt: attempt?.startedAt,
      ...(retainedContextMessages === undefined
        ? {}
        : { retainedContextMessages }),
    });
    attempt = undefined;
    return undefined;
  });

  pi.on("session_compact_failed", async (event, ctx) => {
    report(ctx, {
      phase: "failed",
      reason: event.reason,
      attempt: attempt?.attempt,
      startedAt: attempt?.startedAt,
    });
    attempt = undefined;
    return undefined;
  });
}
