import { describe, expect, test } from "bun:test";
import { compactLogoLines, wideLogoLines } from "../src/ui/logo.tsx";

function cellWidth(line: string): number {
  return [...line].length;
}

function expectTerminalSafe(lines: readonly string[], maximumWidth: number): void {
  expect(lines[0]?.startsWith("■")).toBe(true);
  expect(lines.at(-1)?.startsWith("■")).toBe(true);
  expect(lines.some((line) => line.includes("═"))).toBe(true);
  expect(lines.some((line) => /[\u2800-\u28ff]/u.test(line))).toBe(true);
  for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(maximumWidth);
}

describe("PTY Tail terminal logo", () => {
  test("keeps the wide double-line and dotted mark cell-safe", () => {
    expectTerminalSafe(wideLogoLines, 27);
    expect(wideLogoLines).toHaveLength(12);
  });

  test("keeps the compact mark inside narrow dashboards", () => {
    expectTerminalSafe(compactLogoLines, 17);
    expect(compactLogoLines).toHaveLength(8);
  });
});
