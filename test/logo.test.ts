import { describe, expect, test } from "bun:test";
import { compactLogoLines, logoCellWidth, microLogo, wideLogoLines } from "../src/ui/logo.tsx";

const halfBlocks = /^[ █▀▄]+$/u;
function expectTerminalRaster(lines: readonly string[], expectedHeight: number, expectedWidth: number): void {
  expect(lines).toHaveLength(expectedHeight);
  expect(logoCellWidth(lines)).toBe(expectedWidth);
  expect(lines.every((line) => halfBlocks.test(line))).toBe(true);
  expect(lines.some((line) => line.includes("▀"))).toBe(true);
  expect(lines.some((line) => line.includes("▄"))).toBe(true);
  expect(lines.some((line) => line.includes("█"))).toBe(true);
}
describe("asymmetric bracket-pi terminal logo", () => {
  test("keeps the micro mark literal and evenly spaced", () => { expect(microLogo).toBe("[> π <]"); expect([...microLogo]).toHaveLength(7); });
  test("keeps compact raster cell-safe", () => { expectTerminalRaster(compactLogoLines, 8, 32); expect(compactLogoLines[5]).toContain("████▄"); });
  test("keeps wide raster cell-safe", () => { expectTerminalRaster(wideLogoLines, 12, 41); expect(wideLogoLines[8]).toContain("██ ▀███"); });
});
