import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { appVersion } from "./version.ts";
import { compareStableVersions, fetchLatestStableRelease } from "./update/check.ts";
import { legacyInstallMetadata, readInstallMetadata, type InstallMetadata } from "./update/metadata.ts";

export type UpgradeOptions = { check: boolean; version?: string; help: boolean };
export type InstallerCommand = { command: string; args: string[] };
export function installerCommand(platform: NodeJS.Platform, script: string, version: string, metadata: InstallMetadata): InstallerCommand {
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-DeferApply", "-Version", version, "-InstallDir", metadata.installDirectory, "-BinDir", metadata.binDirectory, "-Repo", metadata.repository],
    };
  }
  return { command: "sh", args: [script, "--defer-apply", "--version", version, "--install-dir", metadata.installDirectory, "--bin-dir", metadata.binDirectory, "--repo", metadata.repository] };
}
export function ensureUpgradeVersionAllowed(requestedVersion: string, installedVersion: string): void {
  const comparison = compareStableVersions(requestedVersion, installedVersion);
  if (comparison < 0) throw new Error(`Requested version ${requestedVersion} is older than installed version ${installedVersion}`);
}
export function parseUpgradeArgs(args: readonly string[]): UpgradeOptions {
  let check = false; let version: string | undefined; let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") check = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--version") {
      version = args[++index];
      if (!version) throw new Error("--version needs a value");
    } else throw new Error(`unknown option: ${arg}`);
  }
  if (check && version) throw new Error("--check cannot be combined with --version");
  if (version) compareStableVersions(version, version);
  return version === undefined ? { check, help } : { check, version, help };
}
export function metadataForUpgrade(metadata: InstallMetadata | undefined, installDirectory: string): InstallMetadata {
  return metadata ?? legacyInstallMetadata(installDirectory, appVersion, "mistrjirka/PiTTy", process.env);
}
export async function runUpgrade(args: readonly string[], environment: NodeJS.ProcessEnv = process.env): Promise<number> {
  const options = parseUpgradeArgs(args);
  if (options.help) { console.log("Usage: pitty upgrade [--check] [--version X.Y.Z]"); return 0; }
  const installDirectory = environment.PITTY_INSTALL_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const storedMetadata = await readInstallMetadata(installDirectory);
  const metadata = storedMetadata ?? legacyInstallMetadata(installDirectory, appVersion, "mistrjirka/PiTTy", environment);
  if (!storedMetadata) console.warn("No install metadata found; using the current install and environment defaults.");
  if (options.check) {
    const release = await fetchLatestStableRelease(metadata.repository);
    const available = compareStableVersions(metadata.installedVersion, release.version) < 0;
    console.log(available ? `Update available: ${release.version}` : `PiTTy ${metadata.installedVersion} is up to date.`);
    return 0;
  }
  const version = options.version ?? (await fetchLatestStableRelease(metadata.repository)).version;
  ensureUpgradeVersionAllowed(version, metadata.installedVersion);
  const script = path.join(installDirectory, process.platform === "win32" ? "install.ps1" : "install.sh");
  const command = installerCommand(process.platform, script, version, metadata);
  const result = await new Promise<number>((resolve, reject) => {
    const child = spawn(command.command, command.args, { stdio: "inherit", env: { ...environment, PITTY_PLUGIN_MODE: metadata.pluginMode } });
    child.on("error", reject); child.on("exit", (code) => resolve(code ?? 1));
  });
  return result;
}

if (import.meta.main) runUpgrade(process.argv.slice(2)).then((code) => process.exit(code)).catch((error: unknown) => { console.error(`pitty upgrade failed: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
