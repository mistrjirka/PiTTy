import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatModelPerformanceStats,
  loadModelPerformanceHistory,
  modelPerformanceStats,
  readModelPerformanceHistory,
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

  test("records version 2 samples and prefers them over legacy samples", () => {
    const now = Date.now();
    const key = "openai\u0000gpt";
    const recorded = recordModelPerformanceSample({}, "openai", "gpt", { ttftMs: 100, generationMs: 1000, outputTokens: 20 }, now);
    expect(recorded[key]?.[0]?.version).toBe(2);
    const legacy = { timestamp: now - 1_000, ttftMs: 5, outputTokensPerSecond: 5_000 };
    expect(modelPerformanceStats({ [key]: [legacy] }, "openai", "gpt")).toEqual({ medianTtftMs: 5, medianOutputTokensPerSecond: 5_000 });
    expect(modelPerformanceStats({ [key]: [legacy, ...recorded[key]!] }, "openai", "gpt")).toEqual({ medianTtftMs: 100, medianOutputTokensPerSecond: 20 });
  });

  test("readModelPerformanceHistory caches by file stat and re-reads after a write", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-model-metrics-"));
    const file = path.join(directory, "history.json");
    try {
      expect(readModelPerformanceHistory(file)).toEqual({});
      // Both timestamps are in the past: a sample stamped Date.now()+1 would make
      // the re-read reject it whenever the read lands in the same millisecond.
      const now = Date.now() - 60_000;
      saveModelPerformanceHistory(recordModelPerformanceSample({}, "openai", "gpt", { ttftMs: 100, generationMs: 1000, outputTokens: 20 }, now), file);
      const first = readModelPerformanceHistory(file);
      expect(first["openai\u0000gpt"]).toHaveLength(1);
      expect(readModelPerformanceHistory(file)).toBe(first);
      saveModelPerformanceHistory(recordModelPerformanceSample(first, "openai", "gpt", { ttftMs: 200, generationMs: 1000, outputTokens: 20 }, now + 1), file);
      const second = readModelPerformanceHistory(file);
      expect(second).not.toBe(first);
      expect(second["openai\u0000gpt"]).toHaveLength(2);
      // Writers replace the file by rename (a new inode), so even a rewrite of the
      // same byte length must invalidate the cache.
      const replacement = `${file}.tmp`;
      fs.writeFileSync(replacement, JSON.stringify(second).replace('"ttftMs":200', '"ttftMs":300'));
      fs.renameSync(replacement, file);
      expect(readModelPerformanceHistory(file)["openai\u0000gpt"]?.[1]?.ttftMs).toBe(300);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
