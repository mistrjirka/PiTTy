import { describe, expect, test } from "bun:test";
import {
  clampMessageWindowStart,
  initialMessageWindowStart,
  loadOlderMessageWindowStart,
  trimMessageWindowStart,
} from "../src/ui/message-window.ts";

describe("message window", () => {
  test("starts with only the newest bounded history", () => {
    expect(initialMessageWindowStart(80, 120)).toBe(0);
    expect(initialMessageWindowStart(500, 120)).toBe(380);
  });

  test("loads older history in batches without crossing zero", () => {
    expect(loadOlderMessageWindowStart(380, 100)).toBe(280);
    expect(loadOlderMessageWindowStart(40, 100)).toBe(0);
  });

  test("trims a growing live window only from the old edge", () => {
    expect(trimMessageWindowStart(500, 380, 180)).toBe(380);
    expect(trimMessageWindowStart(700, 380, 180)).toBe(520);
    expect(trimMessageWindowStart(100, 0, 180)).toBe(0);
  });

  test("clamps stale window positions after a session reset", () => {
    expect(clampMessageWindowStart(20, 400)).toBe(20);
    expect(clampMessageWindowStart(20, -5)).toBe(0);
  });
});
