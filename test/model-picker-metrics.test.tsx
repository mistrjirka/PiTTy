import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { TestRendererSetup } from "@opentui/core/testing";
import { createSignal } from "solid-js";
import { ModelSelectorDialog } from "../src/ui/model-selector.tsx";
import { modelPerformanceKey, type ModelPerformanceHistory } from "../src/tabs/model-performance-history.ts";

const active: TestRendererSetup[] = [];
afterEach(() => { for (const renderer of active.splice(0)) renderer.renderer.destroy(); });

describe("live model picker metrics", () => {
  test("refreshes medians for the right model without extra tool-timing clutter", async () => {
    const now = Date.now();
    const [history, setHistory] = createSignal<ModelPerformanceHistory>({});
    const [timing, setTiming] = createSignal<readonly []>([]);
    const render = await testRender(() => <ModelSelectorDialog
      models={[
        { provider: "openai-codex", id: "gpt", contextWindow: 160000 },
        { provider: "opencode-go", id: "other", contextWindow: 80000 },
      ]}
      performanceHistory={history} timingHistory={timing}
      onCancel={() => {}} onSelect={() => {}} />, { width: 112, height: 32 });
    active.push(render);
    await render.flush();
    expect(render.captureCharFrame()).not.toContain("median 50 tok/s");
    setHistory({ [modelPerformanceKey("openai-codex", "gpt")]: [
      { timestamp: now, ttftMs: 200, outputTokensPerSecond: 50, version: 3 },
    ] });
    setTiming([]);
    await render.flush();
    const updated = render.captureCharFrame();
    expect(updated).toContain("median 50 tok/s");
    expect(updated).toContain("first token 200ms");
    expect(updated).not.toContain("Tool 0");
    expect(updated).not.toContain("Other ·");
  });
});
