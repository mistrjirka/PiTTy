#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bunName = process.platform === "win32" ? "bun.exe" : "bun";
const candidates = [
  path.join(root, "node_modules", ".bin", bunName),
  path.join(root, "node_modules", "bun", "bin", "bun.exe"),
];
const bun = candidates.find((candidate) => fs.existsSync(candidate));
if (!bun) {
  console.error("PiTTy could not find its bundled Bun runtime.");
  console.error(`Expected one of:\n${candidates.map((value) => `  ${value}`).join("\n")}`);
  console.error("Re-run the installer, or run: npm ci --ignore-scripts && node node_modules/bun/install.js");
  process.exit(1);
}

const child = spawn(bun, ["run", path.join(root, "src", "index.tsx"), ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});
child.on("error", (error) => {
  console.error(`PiTTy failed to start: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
