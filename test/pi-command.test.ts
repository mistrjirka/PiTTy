import { describe, expect, test } from "bun:test";
import { resolvePiCommand } from "../src/pi-command.ts";

describe("Pi command resolution", () => {
  test("runs JavaScript entries with the selected Node executable", () => {
    expect(resolvePiCommand("/tmp/pi-entry.mjs", ["list"], "/node.exe")).toEqual({
      executable: "/node.exe",
      args: ["/tmp/pi-entry.mjs", "list"],
    });
  });

  test("defaults JavaScript entries to Node rather than Bun", () => {
    const command = resolvePiCommand("/tmp/pi-entry.mjs");
    expect(command.executable).toBe(process.env.PITTY_NODE_EXECUTABLE ?? "node");
  });

  test("preserves native Pi commands", () => {
    expect(resolvePiCommand("pi", ["list"], "/node.exe")).toEqual({ executable: "pi", args: ["list"] });
  });
});
