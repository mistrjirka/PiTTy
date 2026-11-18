import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { TestRendererSetup } from "@opentui/core/testing";
import { CompactionPanel, CompactedSummary, compactionLaneRowBudget, compactionSummaryRowBudget } from "../src/ui/compaction-panel.tsx";

const active: TestRendererSetup[] = [];
afterEach(() => {
  for (const setup of active.splice(0)) setup.renderer.destroy();
});
async function mount(node: Parameters<typeof testRender>[0], width: number, height: number) {
  const setup = await testRender(node, { width, height, useMouse: true, enableMouseMovement: true });
  active.push(setup);
  await setup.flush();
  await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 60 });
  return setup;
}
const progress = {
  v: 2 as const, runId: "overflow-repro", seq: 4, phase: "streaming" as const,
  reason: "manual" as const, elapsedMs: 5_000, retainedTurns: 1,
  estimatedRetainedTokens: 15_000, keepRecentTokens: 20_000,
  targetPostCompactTokens: 20_000, effectiveRecentTokenBudget: 12_000,
  boundaryMode: "whole-turn" as const,
  lanes: {
    audit: { role: "audit" as const, state: "streaming" as const, chars: 15_000 },
    execution: { role: "execution" as const, state: "streaming" as const, chars: 13_000 },
  },
};
test("height budgets keep collapsed, expanded and summary displays within a short terminal", () => {
  expect(compactionLaneRowBudget(16, false)).toBe(1);
  expect(compactionLaneRowBudget(16, true)).toBe(1);
  expect(compactionLaneRowBudget(40, false)).toBe(6);
  expect(compactionLaneRowBudget(40, true)).toBe(7);
  expect(compactionSummaryRowBudget(16)).toBe(5);
  expect(compactionSummaryRowBudget(80)).toBe(12);
});

const many = (prefix: string) => Array.from({ length: 30 }, (_, i) => prefix + " " + String(i).padStart(2, "0")).join("\n");

test("long streamed compaction at 16-row terminal leaves following content visible", async () => {
  const setup = await mount(
    () => <box flexDirection="column" width="100%" height="100%">
      <CompactionPanel
        viewportHeight={16}
        telemetry={{ version: 1, phase: "preparing", startedAt: 1_000 }}
        now={8_000} spinner="◐" frame={2} expanded={() => true}
        oneRoundProgress={progress}
        laneTexts={{ runId: "overflow-repro", intent: "", audit: many("AUDIT"),
          execution: many("EXEC") }}
      />
      <text>AFTER_COMPACT_PANEL_VISIBLE</text>
    </box>,
    40, 16,
  );
  const frame = setup.captureCharFrame();
  expect(frame).toContain("AFTER_COMPACT_PANEL_VISIBLE");
  expect(frame).toContain("EXEC 29");
});

test("long uninterrupted streamed line never occupies sibling column", async () => {
  const setup = await mount(
    () => <box width="100%" height="100%" flexDirection="row">
      <box width={33} flexShrink={0} overflow="hidden">
        <CompactionPanel viewportHeight={22} telemetry={{ version: 1, phase: "preparing", startedAt: 1_000 }}
          now={8_000} spinner="◐" frame={1} oneRoundProgress={progress}
          laneTexts={{ runId: "overflow-repro", intent: "", audit: "A".repeat(150) + "\nTAIL_AUDIT",
            execution: "B".repeat(150) + "\nTAIL_EXEC" }} />
      </box>
      <box flexGrow={1} backgroundColor="#334455"><text>RIGHT_COLUMN_SENTINEL</text></box>
    </box>,
    75, 22,
  );
  const frame = setup.captureCharFrame();
  expect(frame).toContain("RIGHT_COLUMN_SENTINEL");
  expect(frame).toContain("TAIL_EXEC");
});

test("expanded completed summary stays in a bounded scrollbox", async () => {
  const setup = await mount(
    () => <box flexDirection="column" width="100%" height="100%">
      <CompactedSummary
        completion={{ reason: "manual", durationMs: 400, summary: Array.from({ length: 90 }, (_, i) => "Summary paragraph " + i).join("\n\n") }}
        expanded={() => true} onToggle={() => {}} viewportHeight={16}
      />
      <text>AFTER_SUMMARY_VISIBLE</text>
    </box>,
    44, 16,
  );
  expect(setup.captureCharFrame()).toContain("AFTER_SUMMARY_VISIBLE");
});
