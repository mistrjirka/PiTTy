#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { createDiagnosticBundle } from "./bundle.ts";

const parsed = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: {
    "log-dir": { type: "string" },
    output: { type: "string", short: "o" },
    help: { type: "boolean", short: "h" },
  },
});

if (parsed.values.help) {
  process.stdout.write("Usage: npm run diagnostics -- [--log-dir DIR] [-o DIR]\n");
  process.exit(0);
}

const archive = createDiagnosticBundle({
  ...(typeof parsed.values["log-dir"] === "string" ? { logDirectory: parsed.values["log-dir"] } : {}),
  ...(typeof parsed.values.output === "string" ? { outputDirectory: parsed.values.output } : {}),
});
process.stdout.write(`${archive}\n`);
