import { describe, expect, test } from "bun:test";
import path from "node:path";
import { resolveDefaultPiExecutable, resolvePiCommand } from "../src/pi-command.ts";
import { resolveBundledPiExtensionPath } from "../src/runtime-paths.ts";

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

  test("preserves an explicit Pi executable override", () => {
    expect(resolveDefaultPiExecutable({ PI_BIN: "/custom/pi" })).toBe("/custom/pi");
    expect(resolveDefaultPiExecutable({})).toBe("pi");
  });

  test("resolves bundled Pi extensions from the install root", () => {
    expect(resolveBundledPiExtensionPath("/opt/pitty", "/opt/pitty/dist")).toBe(
      path.join("/opt/pitty", "src", "pi-extensions", "compaction-observer.mjs"),
    );
    expect(resolveBundledPiExtensionPath(undefined, "/opt/pitty/src")).toBe(
      path.join("/opt/pitty", "src", "pi-extensions", "compaction-observer.mjs"),
    );
  });

  test("preserves native Pi commands", () => {
    expect(resolvePiCommand("pi", ["list"], "/node.exe")).toEqual({ executable: "pi", args: ["list"] });
  });
});
