#!/usr/bin/env node
/** Opt-in setup. Package downloads/builds finish before settings or profiles change. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { foundersCatalog } from "./founders-catalog.mjs";
import { managedPiIsCurrent } from "./ensure-managed-pi.mjs";
import { ensureFoundersRuntime } from "./founders-runtime.mjs";
import { atomicWrite, githubSourcePath, githubSourceRef, installAgents, localEquivalentSource, mergeFoundersPackages, planAgents, readFoundersReceipt, readSettings, sourceIdentity } from "./founders-state.mjs";

const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PREFERENCE_IDS = ["skills", "btw"];
const HELP = `Usage: pitty founders-setup [options]

Install our Pi plugins, the recommended tools, and curated skills and agents.
Existing credentials, model defaults, unrelated packages and custom agents stay in place.

  --check                 Report missing setup; exit 1 when changes are needed
  --dry-run               Show the plan without installing or changing files
  --agent-dir <path>       Pi agent directory (default: PI_CODING_AGENT_DIR or ~/.pi/agent)
  --skills-source <path>   Remember a curated package source; local path or Pi git source
  --btw-source <path>      Remember a BTW package source; local path or Pi git source
  -h, --help              Show this help

The defaults are the public PiTTy-Skills and PiTTy-BTW repositories.
Source choices are saved per Pi agent directory and reused on later runs.
Pass a source flag again to switch repositories or return to the public default.
Private forks can use git:git@github.com:<owner>/<repository>.git.
Setup never reads or changes credentials.
`;

function localSource(value, cwd) {
  return /^(npm:|git:|https?:\/\/|ssh:\/\/)/.test(value)
    ? value : path.resolve(cwd, value.replace(/^~(?=$|[/\\])/, os.homedir()));
}

export function parseFoundersArgs(args, cwd = process.cwd()) {
  const options = { check: false, dryRun: false, help: false, sources: {} };
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === "--check") options.check = true;
    else if (option === "--dry-run") options.dryRun = true;
    else if (option === "--help" || option === "-h") options.help = true;
    else if (["--agent-dir", "--skills-source", "--btw-source"].includes(option)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(option + " needs a value.");
      if (option === "--agent-dir") options.agentDir = path.resolve(cwd, value.replace(/^~(?=$|[/\\])/, os.homedir()));
      else options.sources[option === "--skills-source" ? "skills" : "btw"] = localSource(value, cwd);
    } else throw new Error("Unknown founders-setup option: " + option);
  }
  return options;
}

function piPackageRoot(entrypoint) {
  let directory;
  try { directory = path.dirname(fs.realpathSync(entrypoint)); } catch { return undefined; }
  for (let count = 0; count < 8; count++) {
    try {
      if (JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8")).name === "@earendil-works/pi-coding-agent")
        return directory;
    } catch {}
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}

function piPackageRoots(appRoot, env) {
  const roots = [];
  if (fs.existsSync(path.join(appRoot, "fork-runtime", "pitty-fork-runtime.json")))
    roots.push(path.join(appRoot, "fork-runtime", "pi"));
  if (env.PITTY_UPSTREAM_PI_ROOT) roots.push(env.PITTY_UPSTREAM_PI_ROOT);
  const executable = env.PI_BIN || env.PITTY_UPSTREAM_PI_EXECUTABLE || "pi";
  if (executable.includes("/") || executable.includes("\\")) roots.push(piPackageRoot(executable));
  else for (const directory of (env.PATH || "").split(path.delimiter)) {
    for (const suffix of process.platform === "win32" ? [".cmd", ".exe", ""] : [""])
      roots.push(piPackageRoot(path.join(directory, executable + suffix)));
  }
  roots.push(path.join(appRoot, "node_modules", "@earendil-works", "pi-coding-agent"));
  return roots.filter(Boolean);
}

function readOnlyPackageIndex(appRoot, agentDir, env) {
  const npmRoots = piPackageRoots(appRoot, env).map((root) => path.resolve(root, "../.."));
  return {
    getInstalledPath(source) {
      const identity = sourceIdentity(source, agentDir);
      const paths = identity?.startsWith("npm:")
        ? [path.join(agentDir, "npm", "node_modules", identity.slice(4)), ...npmRoots.map((root) => path.join(root, identity.slice(4)))]
        : identity?.startsWith("git:")
          ? [path.join(agentDir, "git", githubSourcePath(source))]
          : identity?.startsWith("local:") ? [identity.slice(6)] : [];
      return paths.find((candidate) => fs.existsSync(candidate));
    },
  };
}

async function loadPackageManager(appRoot, agentDir, settings, env) {
  const root = piPackageRoots(appRoot, env).find((candidate) => fs.existsSync(path.join(candidate, "dist", "index.js")));
  if (!root) throw new Error("Cannot find Pi's package manager. Install Pi and PiTTy's dependencies first.");
  const { DefaultPackageManager, SettingsManager } = await import(pathToFileURL(path.join(root, "dist", "index.js")).href);
  // Use Pi's downloader without its settings writer. Also suppress automatic
  // host peer copies when a previous supported Pi package manager is selected.
  const inMemory = SettingsManager.inMemory({
    ...settings,
    npmCommand: settings.npmCommand ?? ["npm", "--legacy-peer-deps", "--omit=dev"],
  }, { cwd: agentDir });
  return new DefaultPackageManager({ cwd: agentDir, agentDir, settingsManager: inMemory });
}

function command(executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd, stdio: "inherit", windowsHide: true, timeout: 240_000,
    shell: process.platform === "win32" && executable === "npm",
  });
  if (result.error || result.status !== 0)
    throw new Error(executable + " " + args.join(" ") + " failed" +
      (result.error ? ": " + result.error.message : " (exit " + result.status + ")."));
}

function buildPackage(entry, directory) {
  if (entry.build !== "doppelclaude") return;
  command("npm", ["install", "--include=dev", "--legacy-peer-deps", "--no-audit", "--no-fund"], directory);
  const compiler = path.join(directory, "node_modules", "typescript", "bin", "tsc");
  command(process.execPath, [compiler, "-p", "packages/doppelclaude"], directory);
  command(process.execPath, [compiler, "-p", "packages/pi-doppelclaude"], directory);
  // Do not prune after a failed build. The installed provider does not need
  // physical copies of Pi's development packages at runtime.
  command("npm", ["prune", "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund"], directory);
}

// The catalog requires stable minimum versions. A prerelease of that exact
// version is older, while a later major/minor/patch still meets the minimum.
function meetsMinimumVersion(actual, minimum) {
  const found = typeof actual === "string" && actual.match(/^(\d+)\.(\d+)\.(\d+)(-[^+]+)?(?:\+.+)?$/);
  const required = minimum.split(".").map(Number);
  if (!found) return false;
  for (let index = 0; index < 3; index++) {
    const difference = Number(found[index + 1]) - required[index];
    if (difference !== 0) return difference > 0;
  }
  return !found[4];
}

function maintainedMinimum(entry) {
  const minimum = entry.minimumVersion;
  return minimum && sourceIdentity(entry.source) === sourceIdentity(minimum.source) &&
    !githubSourceRef(entry.source) ? minimum.version : undefined;
}

// Pi refreshes Git packages with reset --hard and clean -fdx. Check before an
// automatic refresh so direct cache edits and unpublished commits survive.
function assertAutomaticUpdateSafe(entry, directory) {
  if (!directory || !maintainedMinimum(entry)) return;
  const runGit = (args) => spawnSync("git", args, { cwd: directory, encoding: "utf8", timeout: 10_000 });
  const status = runGit(["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignored=matching"]);
  // Match Pi's update target. A detached checkout or a branch tracking another
  // remote returns to origin's default branch when the user removes its pin.
  const upstream = runGit(["rev-parse", "--abbrev-ref", "@{upstream}"]);
  const target = upstream.status === 0 && upstream.stdout.trim().startsWith("origin/")
    ? "@{upstream}" : "origin/HEAD";
  const ahead = runGit(["rev-list", "--count", target + "..HEAD"]);
  if (status.error || status.status !== 0 || ahead.error || ahead.status !== 0)
    throw new Error("Cannot verify the cached Git checkout before updating " + entry.source +
      " at " + directory + ". No settings or agents were changed.");
  // Pi's npm install creates these disposable files. Tracked changes to them
  // remain protected, as do every other untracked or ignored file.
  const changes = status.stdout.split("\0").filter(Boolean).filter((line) =>
    !/^(?:\?\?|!!) (?:node_modules\/|package-lock\.json)$/.test(line));
  if (changes.length || Number(ahead.stdout.trim()) > 0)
    throw new Error("Cannot automatically update " + entry.source + ": the cached checkout at " +
      directory + " has local changes or unpublished commits. Preserve them in an editable checkout or fork first." +
      " No settings or agents were changed.");
}

export function packageReady(entry, directory) {
  if (!directory) return false;
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    const minimum = maintainedMinimum(entry);
    return entry.names.includes(metadata.name) &&
      (!entry.version || metadata.version === entry.version) &&
      (!minimum || meetsMinimumVersion(metadata.version, minimum)) &&
      entry.files.every((file) => fs.existsSync(path.join(directory, file)));
  } catch { return false; }
}

export function managedRuntimeReady(appRoot) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(releaseRoot, "vendor", "managed-fork-manifest.json"), "utf8"));
    return manifest.pi?.sideQuestionProtocolVersion === 1 && managedPiIsCurrent(appRoot);
  } catch { return false; }
}

function providerStatus(settings, log) {
  const provider = settings.doppelclaude?.provider;
  const replacements = provider?.systemPromptReplacements;
  const nonblank = (value) => typeof value === "string" && value.trim().length > 0;
  const configured = provider?.systemPromptMode === "claude-code" ||
    (["pi", "append", undefined].includes(provider?.systemPromptMode) &&
      nonblank(replacements?.identity) && nonblank(replacements?.toolNameNote) &&
      nonblank(replacements?.documentation?.heading) &&
      Array.isArray(replacements?.documentation?.instructions) &&
      replacements.documentation.instructions.length > 0 &&
      replacements.documentation.instructions.every(nonblank));
  log(configured
    ? "DoppelClaude: provider configuration found. Claude authentication was not checked."
    : "DoppelClaude: package setup does not configure the provider. Complete its documented provider configuration and Claude sign-in before using its models.");
  const hasModel = (value) => value && typeof value === "object" &&
    Object.entries(value).some(([key, item]) => (key === "model" && typeof item === "string" && item.trim()) || hasModel(item));
  if (hasModel(settings.subagentProfiles))
    log("Existing subagentProfiles model overrides are preserved. They can pin models even though curated agents leave model unset.");
}

export async function setupFounders(options = {}) {
  const env = options.env ?? process.env;
  const appRoot = path.resolve(options.appRoot ?? env.PITTY_APP_ROOT ?? releaseRoot);
  const agentDir = path.resolve(options.agentDir ?? env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent"));
  const { receipt } = readFoundersReceipt(agentDir);
  const settingsFile = path.join(agentDir, "settings.json");
  const original = readSettings(settingsFile);
  const catalog = (options.catalog ?? foundersCatalog()).map((entry) => {
    const previous = SOURCE_PREFERENCE_IDS.includes(entry.id) ? receipt.sourcePreferences?.[entry.id] : undefined;
    // An explicit flag wins, then a remembered choice, then a local checkout
    // already in settings. Without the last, a fork read as "missing".
    const local = options.sources?.[entry.id] ?? previous ? undefined : localEquivalentSource(original.value, entry, agentDir);
    const selected = options.sources?.[entry.id] ?? previous ?? local;
    return {
      ...entry, ...(selected ? { source: selected } : {}),
      replaces: [...entry.replaces, entry.source, ...(previous ? [previous] : [])],
      explicitSource: Boolean(options.sources?.[entry.id]) || entry.explicitSource,
      // Found in settings, not chosen through setup: the user's own checkout.
      detectedLocal: local !== undefined,
    };
  });
  const log = options.log ?? console.log;
  const plan = mergeFoundersPackages(original.value, catalog, agentDir);
  const readOnly = options.check || options.dryRun;
  const manager = options.packageManager ?? (readOnly
    ? readOnlyPackageIndex(appRoot, agentDir, env)
    : await loadPackageManager(appRoot, agentDir, original.value, env));
  const getPath = (entry) => manager.getInstalledPath(entry.source, "user");
  const runtimeReady = options.runtimeReady ?? managedRuntimeReady;
  // A changed explicit Git ref uses the same cache directory. Reconcile it
  // through Pi even when an older checkout already has the expected files.
  const needsInstall = (entry) => !packageReady(entry, getPath(entry)) ||
    (entry.explicitSource && !entry.configured && /^(git:|https?:\/\/|ssh:\/\/)/.test(entry.source));
  // A checkout found in settings belongs to the user: setup never builds or
  // rewrites it. One that lacks required files is reported and skipped.
  // Sources chosen through setup (`--skills-source` etc.) install as before.
  const isLocal = (entry) => entry.detectedLocal === true;
  log("Pi agent directory: " + agentDir);
  for (const entry of plan.packages) {
    const ready = !needsInstall(entry);
    const action = !ready ? (isLocal(entry) ? "Outdated" : "Install") : !entry.configured ? "Configure" : "Present";
    log(action + ": " + entry.source);
    for (const previous of entry.oldSources.filter((source) => source !== entry.source))
      log("  Replace equivalent package: " + previous);
  }
  const skillsEntry = plan.packages.find((entry) => entry.id === "skills");
  const bundleRoot = skillsEntry && getPath(skillsEntry);
  let agents = bundleRoot && packageReady(skillsEntry, bundleRoot) ? planAgents(bundleRoot, agentDir) : undefined;
  if (agents) for (const agent of agents.agents)
    log("Agent " + agent.name + ": " + agent.action + (agent.action === "preserve" ? " custom file; curated version is not installed" : ""));
  else log("Curated agents: read the bundle manifest after downloading the skills package.");
  providerStatus(original.value, log);
  if (readOnly) {
    const missing = plan.packages.some((entry) => !entry.configured || !packageReady(entry, getPath(entry))) ||
      !runtimeReady(appRoot) || !agents || agents.agents.some((agent) => agent.action !== "present");
    log("Managed Pi runtime: " + (runtimeReady(appRoot) ? "present" : "setup required"));
    log(options.dryRun ? "Dry run. No files were changed." : missing ? "Founders setup is incomplete." : "Founders packages and curated agents are installed.");
    return { exitCode: options.dryRun ? 0 : missing ? 1 : 0, changed: false };
  }
  if ((options.platform ?? process.platform) !== "linux" && (options.platform ?? process.platform) !== "darwin")
    throw new Error("The managed Pi fork is not supported on this platform. No settings or agents were changed.");
  const major = Number(process.versions.node.split(".")[0]);
  if (catalog.some((entry) => entry.nodeMajor > major))
    throw new Error("Founders plugins require Node.js 24 or newer. No settings or agents were changed.");
  for (const entry of plan.packages) {
    if (!needsInstall(entry)) continue;
    if (isLocal(entry)) {
      log("Skipped outdated local checkout " + entry.source + ": update it to get the missing files.");
      continue;
    }
    assertAutomaticUpdateSafe(entry, getPath(entry));
    await manager.install(entry.source);
    const directory = getPath(entry);
    if (!directory) throw new Error("Pi did not install " + entry.source + ". No settings or agents were changed.");
    if (entry.build) await (options.buildPackage ?? buildPackage)(entry, directory);
    if (!packageReady(entry, directory))
      throw new Error("Package validation failed for " + entry.source + ". No settings or agents were changed.");
  }
  const code = plan.packages.find((entry) => entry.id === "code");
  const runtimeEnv = {
    ...env, PI_CODING_AGENT_DIR: agentDir,
    ...(code ? { PITTY_UPSTREAM_CODE_TOOL_ROOT: getPath(code) } : {}),
  };
  const managed = options.ensureRuntime
    ? await options.ensureRuntime(appRoot, runtimeEnv)
    : await ensureFoundersRuntime(appRoot, runtimeEnv, { log });
  if (!["ready", "installed"].includes(managed.status))
    throw new Error("Managed Pi unavailable: " + (managed.reason ?? managed.status) + ". No settings or agents were changed.");
  if (!runtimeReady(appRoot))
    throw new Error("Managed Pi lacks the required side-question protocol. No settings or agents were changed.");
  if (!skillsEntry) throw new Error("The founders catalog has no curated skills package.");
  agents = planAgents(getPath(skillsEntry), agentDir);
  if (SOURCE_PREFERENCE_IDS.some((id) => agents.receipt.sourcePreferences?.[id] !== receipt.sourcePreferences?.[id]))
    throw new Error("Founders source preferences changed during setup. Prepared packages are cached; run setup again.");
  // Re-read settings after downloads. Preserve unrelated concurrent edits.
  const current = readSettings(settingsFile);
  if (JSON.stringify(current.value.packages) !== JSON.stringify(original.value.packages))
    throw new Error("Pi package settings changed during setup. Prepared packages are cached; run setup again.");
  const next = mergeFoundersPackages(current.value, catalog, agentDir).settings;
  const sourcePreferences = { ...agents.receipt.sourcePreferences };
  for (const entry of plan.packages)
    if (SOURCE_PREFERENCE_IDS.includes(entry.id)) sourcePreferences[entry.id] = entry.source;
  const receiptChanged = installAgents(agents, sourcePreferences);
  const changed = JSON.stringify(next) !== JSON.stringify(current.value);
  if (changed) atomicWrite(settingsFile, JSON.stringify(next, null, 2) + "\n");
  const preserved = agents.agents.filter((agent) => agent.action === "preserve");
  log("Configured " + catalog.length + " packages and " + agents.skillCount + " curated skills.");
  log("Curated agents: " + (agents.agents.length - preserved.length) + " installed, " + preserved.length + " custom files preserved.");
  for (const agent of preserved)
    log("Missing curated agent: " + agent.name + ". Existing custom file kept at " + agent.destination);
  log("Restart PiTTy to load the setup. Model defaults and credentials were not changed.");
  return { exitCode: preserved.length ? 2 : 0, changed: changed || receiptChanged || agents.agents.some((agent) => ["install", "update"].includes(agent.action)) };
}

export async function main(args = process.argv.slice(2), options = {}) {
  try {
    const parsed = parseFoundersArgs(args);
    if (parsed.help) { console.log(HELP); return 0; }
    return (await setupFounders({ ...options, ...parsed })).exitCode;
  } catch (error) {
    console.error("PiTTy founders setup failed: " + (error instanceof Error ? error.message : String(error)));
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main();
