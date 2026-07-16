import { describe, expect, test } from "bun:test";
import {
  compactLogoLines,
  logoCellWidth,
  microLogo,
  wideLogoLines,
} from "../src/ui/logo.tsx";

const halfBlocks = /^[ █▀▄]+$/u;

function expectTerminalRaster(
  lines: readonly string[],
  expectedHeight: number,
  expectedWidth: number,
): void {
  expect(lines).toHaveLength(expectedHeight);
  expect(logoCellWidth(lines)).toBe(expectedWidth);
  expect(lines.every((line) => halfBlocks.test(line))).toBe(true);
  expect(lines.some((line) => line.includes("▀"))).toBe(true);
  expect(lines.some((line) => line.includes("▄"))).toBe(true);
  expect(lines.some((line) => line.includes("█"))).toBe(true);
}

describe("bracket-pi terminal logo", () => {
  test("keeps the micro mark literal and evenly spaced", () => {
    expect(microLogo).toBe("[> π <]");
    expect([...microLogo]).toHaveLength(7);
  });

  test("keeps the compact font raster cell-safe", () => {
    expectTerminalRaster(compactLogoLines, 10, 85);
  });

  test("keeps the wide font raster cell-safe", () => {
    expectTerminalRaster(wideLogoLines, 14, 118);
  });
});
