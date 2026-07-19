import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dir, "..");

describe("public installers", () => {
  test("POSIX installer exposes optional integrations and readable diagnostics", () => {
    const script = fs.readFileSync(path.join(root, "install.sh"), "utf8");
    expect(script).toContain("--with-plugins");
    expect(script).toContain("--without-plugins");
    expect(script).toContain("npm:pi-subagents");
    expect(script).toContain("npm:@juicesharp/rpiv-todo");
    expect(script).toContain("npm:pi-mcp-adapter");
    expect(script).toContain("pi-mcp-adapter");
    expect(script).toContain("exit code:");
    expect(script).toContain("log:");
    expect(script).toContain("/dev/tty");
    expect(script).toContain("pitty-resume");
    const uninstall = fs.readFileSync(path.join(root, "uninstall.sh"), "utf8");
    expect(uninstall).toContain('"$BIN_DIR/pitty-resume"');
  });

  test("Windows installer exposes the same optional integrations", () => {
    const script = fs.readFileSync(path.join(root, "install.ps1"), "utf8");
    expect(script).toContain("[switch]$WithPlugins");
    expect(script).toContain("[switch]$WithoutPlugins");
    expect(script).toContain("npm:pi-subagents");
    expect(script).toContain("npm:@juicesharp/rpiv-todo");
    expect(script).toContain("npm:pi-mcp-adapter");
    expect(script).toContain("pi-mcp-adapter");
    expect(script).toContain("exit code:");
    expect(script).toContain("log:");
    expect(script).toContain("pitty-resume");
    const uninstall = fs.readFileSync(path.join(root, "uninstall.ps1"), "utf8");
    expect(uninstall).toContain("pitty-resume.cmd");
  });

  test("pitty launcher resolves preload from an external cwd", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-launcher-"));
    try {
      const output = execFileSync("node", [path.join(root, "bin/pitty.mjs"), "--help"], { cwd, encoding: "utf8", timeout: 10_000 });
      expect(output).toContain("PiTTy v");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("pitty-resume exposes executable help", () => {
    const output = execFileSync("node", [path.join(root, "bin/pitty-resume.mjs"), "--help"], { encoding: "utf8" });
    expect(output).toContain("--session-picker");
  });

  test("OpenSpec project and capability specs are present", () => {
    for (const file of [
      "openspec/project.md",
      "openspec/specs/core-rpc-ui/spec.md",
      "openspec/specs/optional-integrations/spec.md",
      "openspec/specs/installers/spec.md",
      "openspec/specs/plugin-compatibility/spec.md",
    ]) expect(fs.existsSync(path.join(root, file))).toBe(true);
  });
});
