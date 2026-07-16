#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function findBundledBun(directory) {
  const bunName = process.platform === "win32" ? "bun.exe" : "bun";
  const candidates = [path.join(directory, "node_modules", ".bin", bunName), path.join(directory, "node_modules", "bun", "bin", "bun.exe")];
  return candidates.find((candidate) => fs.existsSync(candidate));
}
function validateInstall(directory) {
  const launcher = path.join(directory, "bin", "pitty.mjs");
  const runtime = path.join(directory, "node_modules", ".bin", process.platform === "win32" ? "bun.exe" : "bun");
  if (!fs.existsSync(launcher)) throw new Error(`staged install is missing ${launcher}`);
  if (!fs.existsSync(runtime)) throw new Error(`staged install is missing bundled Bun at ${runtime}`);
}
function activatePending() {
  const pending = `${root}.pending`;
  if (!fs.existsSync(pending)) return;
  const backup = `${root}.backup`;
  let moved = false;
  try {
    validateInstall(pending);
    fs.rmSync(backup, { recursive: true, force: true });
    if (fs.existsSync(root)) fs.renameSync(root, backup);
    moved = true;
    fs.renameSync(pending, root);
    validateInstall(root);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    try {
      if (fs.existsSync(root) && moved) fs.rmSync(root, { recursive: true, force: true });
      if (moved && fs.existsSync(backup)) fs.renameSync(backup, root);
    } catch (restoreError) {
      throw new Error(`upgrade activation failed and recovery failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
    throw new Error(`upgrade activation failed; previous installation was restored: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const isUpgrade = process.argv[2] === "upgrade";
const bundledBun = findBundledBun(root);
if (isUpgrade) {
  if (!bundledBun) { console.error("PiTTy could not find its bundled Bun runtime for upgrade."); process.exit(1); }
  const childEnv = { ...process.env, PITTY_NODE_EXECUTABLE: process.execPath };
  const child = spawn(bundledBun, ["run", path.join(root, "src", "upgrade.ts"), ...process.argv.slice(3)], { cwd: process.cwd(), stdio: "inherit", env: childEnv });
  child.on("error", (error) => { console.error(`PiTTy upgrade failed: ${error.message}`); process.exit(1); });
  child.on("exit", (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exit(code ?? 1); });
} else {
  try { activatePending(); root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
  const preload = path.join(root, "src", "preload.ts");
  const childEnv = { ...process.env, PITTY_NODE_EXECUTABLE: process.execPath };
  if (process.platform === "win32") {
    const bundledPi = path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    if (!childEnv.PI_BIN && fs.existsSync(bundledPi)) childEnv.PI_BIN = bundledPi;
  }
  const bun = findBundledBun(root);
  if (!bun) {
    console.error("PiTTy could not find its bundled Bun runtime.");
    console.error(`Expected a bundled Bun under ${path.join(root, "node_modules")}`);
    console.error("Re-run the installer, or run: npm ci --ignore-scripts && node node_modules/bun/install.js");
    process.exit(1);
  }
  const child = spawn(bun, ["run", `--preload=${preload}`, path.join(root, "src", "index.tsx"), ...process.argv.slice(2)], { cwd: process.cwd(), stdio: "inherit", env: childEnv });
  child.on("error", (error) => { console.error(`PiTTy failed to start: ${error.message}`); process.exit(1); });
  child.on("exit", (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exit(code ?? 1); });
}
