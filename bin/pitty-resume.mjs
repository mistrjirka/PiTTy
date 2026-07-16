#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcher = path.join(root, "bin", "pitty.mjs");
const child = spawn(process.execPath, [launcher, "--session-picker", ...process.argv.slice(2)], { cwd: process.cwd(), stdio: "inherit", env: process.env });
child.on("error", (error) => { console.error(`PiTTy failed to start: ${error.message}`); process.exit(1); });
child.on("exit", (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exit(code ?? 1); });
