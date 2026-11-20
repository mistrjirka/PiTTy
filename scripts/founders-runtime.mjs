/** Prepare the verified Pi base for opt-in founders setup without replacing global Pi. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureManagedPi } from "./ensure-managed-pi.mjs";

const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function ensureFoundersRuntime(appRoot, env = process.env, options = {}) {
  const ensureRuntime = options.ensureRuntime ?? ensureManagedPi;
  const existing = await ensureRuntime(appRoot, env);
  if (existing.status !== "unsupported" ||
      env.PITTY_UPSTREAM_PI_ROOT || env.PITTY_UPSTREAM_PI_EXECUTABLE ||
      env.PITTY_USE_UPSTREAM_PI === "1" || env.PITTY_NO_MANAGED_PI === "1" ||
      !["linux", "darwin"].includes(process.platform)) return existing;

  const manifest = JSON.parse(fs.readFileSync(path.join(releaseRoot, "vendor", "managed-fork-manifest.json"), "utf8"));
  const version = manifest.pi?.version;
  const baseUnavailable = [
    "Cannot locate a matching installed Pi package",
    "Installed Pi version differs from the verified fork version " + version,
    "Upstream modules do not match the audited fork patch bases",
  ].includes(existing.reason);
  if (!baseUnavailable) return existing;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[a-z\d.-]+)?$/i.test(version))
    throw new Error("The founders runtime manifest has no exact Pi version.");

  fs.mkdirSync(appRoot, { recursive: true });
  const prefix = fs.mkdtempSync(path.join(appRoot, ".founders-pi-"));
  try {
    (options.log ?? console.log)("Preparing Pi " + version + " in a temporary private directory for founders setup. Global Pi stays unchanged.");
    const userConfig = path.join(prefix, "npm-user-config");
    const globalConfig = path.join(prefix, "npm-global-config");
    fs.writeFileSync(userConfig, "");
    fs.writeFileSync(globalConfig, "");
    // Public registry downloads need only transport settings. Do not forward
    // tokens, npm configuration overrides, or executable Node preload options.
    const allowed = [
      "PATH", "HOME", "LANG", "LC_ALL", "TMPDIR",
      "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
      "NODE_EXTRA_CA_CERTS",
    ];
    const installEnv = Object.fromEntries(allowed.flatMap((name) =>
      typeof env[name] === "string" ? [[name, env[name]]] : [],
    ));
    const result = (options.runCommand ?? spawnSync)("npm", [
      "install", "--global", "--prefix=" + prefix,
      "--ignore-scripts", "--omit=dev", "--include=optional", "--no-audit", "--no-fund",
      "--workspaces=false", "--registry=https://registry.npmjs.org/",
      "--userconfig=" + userConfig, "--globalconfig=" + globalConfig,
      "--cache=" + path.join(prefix, "npm-cache"), "--logs-max=0",
      "--loglevel=error", "--update-notifier=false", "--fetch-retries=1", "--fetch-timeout=30000",
      "@earendil-works/pi-coding-agent@" + version,
    ], { cwd: prefix, env: installEnv, encoding: "utf8", timeout: 240_000, maxBuffer: 256 * 1024 });
    if (result.status !== 0) {
      const reason = result.error?.code === "ENOENT" ? "npm is unavailable"
        : result.error?.code === "ETIMEDOUT" ? "download timed out"
        : "npm exited " + (result.status ?? "without a status");
      // Registry/proxy diagnostics can contain credentials. Report only status.
      throw new Error("Cannot prepare private Pi " + version + ": " + reason +
        ". No settings or agents were changed.");
    }
    // A global-layout prefix keeps Pi's dependencies under its package root,
    // which the existing audited runtime builder copies into fork-runtime.
    return await ensureRuntime(appRoot, {
      ...env, PITTY_UPSTREAM_PI_ROOT: path.join(prefix, "lib", "node_modules", "@earendil-works", "pi-coding-agent"),
    });
  } finally {
    fs.rmSync(prefix, { recursive: true, force: true });
  }
}
