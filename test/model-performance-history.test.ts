import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatModelPerformanceStats,
  loadModelPerformanceHistory,
  modelPerformanceStats,
  recordModelPerformanceSample,
  saveModelPerformanceHistory,
} from "../src/tabs/model-performance-history.ts";

describe("model performance history", () => {
  test("records medians and persists safely", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-model-metrics-"));
    const file = path.join(directory, "history.json");
    const now = Date.now();
    let history = recordModelPerformanceSample({}, "openai", "gpt", { ttftMs: 100, generationMs: 1000, outputTokens: 20 }, now - 1_000);
    history = recordModelPerformanceSample(history, "openai", "gpt", { ttftMs: 300, generationMs: 2000, outputTokens: 20 }, now);
    saveModelPerformanceHistory(history, file);
    const loaded = loadModelPerformanceHistory(file);
    expect(modelPerformanceStats(loaded, "openai", "gpt")).toEqual({ medianTtftMs: 200, medianOutputTokensPerSecond: 15 });
    expect(formatModelPerformanceStats(modelPerformanceStats(loaded, "openai", "gpt"))).toBe("{15 tok/s · 200ms TTFT}");
  });

  test("prunes samples older than 31 days and ignores malformed history", () => {
    const old = Date.now() - 32 * 24 * 60 * 60 * 1000;
    const history = recordModelPerformanceSample({ "openai\u0000gpt": [{ timestamp: old, ttftMs: 1, outputTokensPerSecond: 1 }] }, "openai", "gpt", { ttftMs: 50, generationMs: 1000, outputTokens: 10 }, Date.now());
    expect(history["openai\u0000gpt"]).toHaveLength(1);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-model-metrics-"));
    const file = path.join(directory, "bad.json");
    fs.writeFileSync(file, "not json");
    expect(loadModelPerformanceHistory(file)).toEqual({});
  });

  test("keeps only the latest bounded samples per model", () => {
    const now = Date.now();
    const history = recordModelPerformanceSample(
      {
        "openai\u0000gpt": Array.from({ length: 1_001 }, (_, index) => ({
          timestamp: now - (1_000 - index),
          ttftMs: index + 1,
          outputTokensPerSecond: index + 1,
        })),
      },
      "openai",
      "gpt",
      { ttftMs: 10, generationMs: 1_000, outputTokens: 10 },
      now,
    );
    expect(history["openai\u0000gpt"]).toHaveLength(1_000);
    expect(history["openai\u0000gpt"]?.[0]?.timestamp).toBe(now - 998);
  });

  test("keeps valid history before invalid future entries", () => {
    const now = Date.now();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-model-metrics-"));
    const file = path.join(directory, "future-tail.json");
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({
          "openai\u0000gpt": [
            { timestamp: now - 1_000, ttftMs: 100, outputTokensPerSecond: 20 },
            ...Array.from({ length: 1_000 }, (_, index) => ({
              timestamp: now + index + 1,
              ttftMs: 100,
              outputTokensPerSecond: 20,
            })),
          ],
        }),
      );
      expect(loadModelPerformanceHistory(file, now)["openai\u0000gpt"]).toEqual([
        { timestamp: now - 1_000, ttftMs: 100, outputTokensPerSecond: 20 },
      ]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
