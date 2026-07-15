import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

describe("public installers", () => {
  test("POSIX installer exposes optional integrations and readable diagnostics", () => {
    const script = fs.readFileSync(path.join(root, "install.sh"), "utf8");
    expect(script).toContain("--with-plugins");
    expect(script).toContain("--without-plugins");
    expect(script).toContain("npm:pi-subagents");
    expect(script).toContain("npm:@juicesharp/rpiv-todo");
    expect(script).toContain("exit code:");
    expect(script).toContain("log:");
    expect(script).toContain("/dev/tty");
  });

  test("Windows installer exposes the same optional integrations", () => {
    const script = fs.readFileSync(path.join(root, "install.ps1"), "utf8");
    expect(script).toContain("[switch]$WithPlugins");
    expect(script).toContain("[switch]$WithoutPlugins");
    expect(script).toContain("npm:pi-subagents");
    expect(script).toContain("npm:@juicesharp/rpiv-todo");
    expect(script).toContain("exit code:");
    expect(script).toContain("log:");
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
