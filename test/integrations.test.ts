import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectOptionalIntegrations } from "../src/integrations/detect.ts";

describe("optional integration detection", () => {
  test("never throws when Pi is missing", () => {
    expect(() => detectOptionalIntegrations({ piExecutable: "definitely-not-a-real-pi-binary", cwd: os.tmpdir() })).not.toThrow();
  });

  test("runs JavaScript Pi entries through Node for package detection", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-integrations-js-"));
    const entry = path.join(cwd, "pi-entry.mjs");
    try {
      fs.writeFileSync(entry, "process.stdout.write('pi-subagents\\n@juicesharp/rpiv-todo\\n');\n");
      const result = detectOptionalIntegrations({ piExecutable: entry, cwd });
      expect(result.subagents.installed).toBe(true);
      expect(result.todos.installed).toBe(true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("detects project-local package settings", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-integrations-"));
    try {
      fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
      fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:pi-subagents", "npm:@juicesharp/rpiv-todo"] }));
      const result = detectOptionalIntegrations({ piExecutable: "definitely-not-a-real-pi-binary", cwd });
      expect(result.subagents.installed).toBe(true);
      expect(result.todos.installed).toBe(true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
