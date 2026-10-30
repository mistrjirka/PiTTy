import { describe, expect, test } from "bun:test";
import { CacheMissWatch } from "../src/tabs/cache-miss-watch.ts";

const message = (read: number, write: number, input = 1000, model = "claude-opus-5-5", provider = "doppelclaude") => ({
  role: "assistant", provider, model, usage: { input, cacheRead: read, cacheWrite: write },
});
const now = Date.parse("2026-10-30T13:18:00Z");

describe("cache miss heuristic", () => {
  test("identifies the observed 193k->46k read, 153k rewrite pattern", () => {
    const watch = new CacheMissWatch();
    expect(watch.observe(message(193000, 3000), now)).toBeUndefined();
    expect(watch.observe(message(46000, 153000), now + 300000)).toEqual({
      provider: "doppelclaude", model: "claude-opus-5-5",
      previousRead: 193000, currentRead: 46000, currentWrite: 153000,
    });
  });
  test("no warning on cold start, new context, normal cache reuse, or model switch", () => {
    const watch = new CacheMissWatch();
    expect(watch.observe(message(0, 136000), now)).toBeUndefined();
    expect(watch.observe(message(136000, 1000), now + 1000)).toBeUndefined();
    expect(watch.observe(message(137000, 2000), now + 2000)).toBeUndefined();
    expect(watch.observe(message(0, 137000, 500, "claude-sonnet-5-5"), now + 3000)).toBeUndefined();
  });
  test("no warning when huge new prompt text was added or context compacted", () => {
    const watch = new CacheMissWatch();
    watch.observe(message(193000, 3000), now);
    expect(watch.observe(message(46000, 153000, 250000), now + 1000)).toBeUndefined();
    watch.observe(message(193000, 3000), now + 2000);
    expect(watch.observe(message(5000, 15000), now + 3000)).toBeUndefined();
  });
  test("warning throttled and non-Claude messages reset reference", () => {
    const watch = new CacheMissWatch();
    watch.observe(message(193000, 1000), now);
    expect(watch.observe(message(46000, 153000), now + 1000)).toBeDefined();
    watch.observe(message(193000, 1000), now + 2000);
    expect(watch.observe(message(46000, 153000), now + 3000)).toBeUndefined();
    watch.observe(message(0, 0, 500, "gpt-6", "openai"), now + 600000);
    expect(watch.observe(message(46000, 153000), now + 601000)).toBeUndefined();
  });
});
