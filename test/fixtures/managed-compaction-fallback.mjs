/** A second compactor must not replace a result already owned by another extension. */
import { writeFileSync } from "node:fs";
import path from "node:path";

export default function (pi) {
  pi.on("session_before_compact", async (event) => {
    if (event.signal.aborted) return { cancel: true };
    writeFileSync(path.join(process.env.PITTY_QUEUE_FIXTURE_DIR, "fallback-compaction-called"), "");
    return {
      compaction: {
        summary: "Fallback fixture summary",
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        details: { fixtureOwner: "fallback" },
      },
    };
  });
}
