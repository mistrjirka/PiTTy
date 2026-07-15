import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createDiagnosticBundle } from "../src/diagnostics/bundle.ts";
import { DiagnosticLogger } from "../src/diagnostics/logger.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-oc-diag-test-"));
  roots.push(root);
  return root;
}

describe("diagnostics", () => {
  test("records RPC metadata without prompt contents by default", () => {
    const root = tempRoot();
    const logger = new DiagnosticLogger({ directory: root });
    logger.rpc("tx", { type: "prompt", id: "1", message: "TOP SECRET SOURCE CODE" });
    logger.close();
    const text = fs.readFileSync(logger.logPath, "utf8");
    expect(text).toContain("messageSummary");
    expect(text).not.toContain("TOP SECRET SOURCE CODE");
  });

  test("writes crash reports and creates a support bundle", () => {
    const root = tempRoot();
    const logger = new DiagnosticLogger({ directory: root });
    const crash = logger.crash(new Error("synthetic crash"), "test");
    logger.close();
    expect(crash).toBeTruthy();
    expect(fs.existsSync(crash!)).toBe(true);
    const bundle = createDiagnosticBundle({ logDirectory: root, outputDirectory: root });
    expect(fs.existsSync(bundle)).toBe(true);
    const listing = spawnSync("tar", ["-tzf", bundle], { encoding: "utf8" });
    expect(listing.status).toBe(0);
    expect(listing.stdout).toContain("system.json");
    expect(listing.stdout).toContain("logs/");
  });
});
