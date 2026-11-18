import { describe, expect, test } from "bun:test";
import path from "node:path";
import { resolveDefaultPiExecutable, resolvePiCommand } from "../src/pi-command.ts";
import { resolveDisplayRpcLaunch, locateDisplayRpcLoader } from "../src/pi-display/command.ts";
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

  test("uses a process-local compact history adapter only for recognized Pi npm CLIs", () => {
    const loader = path.resolve("src/pi-display/loader.mjs");
    const root = path.resolve("node_modules/@earendil-works/pi-coding-agent");
    const cli = path.join(root, "dist", "bundle", "cli.js");
    const command = resolveDisplayRpcLaunch(cli, ["--mode", "rpc", "--no-extensions"], loader, {
      platform: "linux", nodeExecutable: "/bin/node",
    });
    expect(command).toBeDefined();
    expect(command?.executable).toBe("/bin/node");
    expect(command?.args).toEqual([`--import=${loader}`, path.join(root, "dist", "cli.js"), "--mode", "rpc", "--no-extensions"]);
    expect(command?.environment.PITTY_DISPLAY_RPC_MODE_PATH).toBe(path.join(root, "dist", "modes", "rpc", "rpc-mode.js"));
    expect(command?.piVersion).toBeTruthy();
    expect(resolveDisplayRpcLaunch(cli, [], loader, { platform: "win32" })).toBeUndefined();
    expect(resolveDisplayRpcLaunch("/does-not-exist/pi", [], loader, { platform: "linux" })).toBeUndefined();
    expect(locateDisplayRpcLoader(path.join(root, "dist"), process.cwd())).toBe(loader);
  });

  test("preserves native Pi commands", () => {
    expect(resolvePiCommand("pi", ["list"], "/node.exe")).toEqual({ executable: "pi", args: ["list"] });
  });
});
