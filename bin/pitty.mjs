#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

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
  const childEnv = { ...process.env, PITTY_NODE_EXECUTABLE: process.execPath, PITTY_APP_ROOT: root };
  const upgradeEntry = fs.existsSync(path.join(root, "dist", "upgrade.js"))
    ? path.join(root, "dist", "upgrade.js")
    : path.join(root, "src", "upgrade.ts");
  const child = spawn(bundledBun, ["run", upgradeEntry, ...process.argv.slice(3)], { cwd: process.cwd(), stdio: "inherit", env: childEnv });
  child.on("error", (error) => { console.error(`PiTTy upgrade failed: ${error.message}`); process.exit(1); });
  child.on("exit", (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exit(code ?? 1); });
} else {
  try { activatePending(); root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
  // Older installed launchers can stage the new PiTTy release without knowing
  // about our fork. Build it automatically on the first launch after activation.
  // This is optional and never modifies the global Pi or the Pi agent directory.
  const managedInstaller = path.join(root, "scripts", "ensure-managed-pi.mjs");
  const managedMarker = path.join(root, "fork-runtime", "pitty-fork-runtime.json");
  if (fs.existsSync(managedInstaller) && !fs.existsSync(managedMarker) &&
      process.env.PITTY_USE_UPSTREAM_PI !== "1" && !process.env.PI_BIN) {
    const installed = spawnSync(process.execPath, [managedInstaller, "--install-root", root], {
      cwd: root, env: process.env, encoding: "utf8", timeout: 120000,
    });
    if (installed.status !== 0 && installed.status !== 2) {
      const detail = (installed.stderr || installed.stdout || installed.error?.message || "no details").trim();
      console.warn(`PiTTy: managed Pi unavailable; using the existing global Pi. ${detail.slice(-600)}`);
    }
  }
  const builtEntry = path.join(root, "dist", "index.js");
  const builtPreload = path.join(root, "dist", "preload.js");
  const builtMarker = path.join(root, "dist", ".pitty-runtime-build-v1");
  const useBuiltRuntime =
    fs.existsSync(builtEntry) &&
    fs.existsSync(builtPreload) &&
    fs.existsSync(builtMarker);
  const entry = useBuiltRuntime ? builtEntry : path.join(root, "src", "index.tsx");
  const preload = useBuiltRuntime ? builtPreload : path.join(root, "src", "preload.ts");
  const childEnv = { ...process.env, PITTY_NODE_EXECUTABLE: process.execPath, PITTY_APP_ROOT: root };
  const bun = findBundledBun(root);
  if (!bun) {
    console.error("PiTTy could not find its bundled Bun runtime.");
    console.error(`Expected a bundled Bun under ${path.join(root, "node_modules")}`);
    console.error("Re-run the installer, or run: npm ci --ignore-scripts && node node_modules/bun/install.js");
    process.exit(1);
  }
  const child = spawn(bun, ["run", `--preload=${preload}`, entry, ...process.argv.slice(2)], { cwd: process.cwd(), stdio: "inherit", env: childEnv });
  child.on("error", (error) => { console.error(`PiTTy failed to start: ${error.message}`); process.exit(1); });
  child.on("exit", (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exit(code ?? 1); });
}
