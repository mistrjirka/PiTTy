import { describe, expect, test } from "bun:test";
import { compactLogoLines, wideLogoLines } from "../src/ui/logo.tsx";

function cellWidth(line: string): number {
  return [...line].length;
}

function expectTerminalSafe(lines: readonly string[], maximumWidth: number): void {
  expect(lines[0]?.startsWith("■")).toBe(true);
  expect(lines.at(-1)?.startsWith("■")).toBe(true);
  expect(lines.some((line) => line.includes("│"))).toBe(true);
  expect(lines.some((line) => line.includes("╭") && line.includes("╯"))).toBe(true);
  for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(maximumWidth);
}

describe("PTY Tail terminal logo", () => {
  test("keeps the wide mark cell-safe and recognizable", () => {
    expectTerminalSafe(wideLogoLines, 15);
    expect(wideLogoLines).toHaveLength(7);
  });

  test("keeps the compact mark inside narrow dashboards", () => {
    expectTerminalSafe(compactLogoLines, 10);
    expect(compactLogoLines).toHaveLength(6);
  });
});
