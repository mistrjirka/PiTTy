import * as fs from "node:fs/promises";
import * as path from "node:path";

export const INSTALL_METADATA_FILENAME = "pitty-install.json";
export type PluginMode = "yes" | "no" | "ask";
export type InstallMetadata = {
  schemaVersion: 1;
  repository: string;
  installedVersion: string;
  installDirectory: string;
  binDirectory: string;
  pluginMode: PluginMode;
};

function isPluginMode(value: unknown): value is PluginMode {
  return value === "yes" || value === "no" || value === "ask";
}
export function isInstallMetadata(value: unknown): value is InstallMetadata {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && typeof record.repository === "string" &&
    typeof record.installedVersion === "string" && typeof record.installDirectory === "string" &&
    typeof record.binDirectory === "string" && isPluginMode(record.pluginMode);
}
export async function readInstallMetadata(installDirectory: string): Promise<InstallMetadata | undefined> {
  let text: string;
  try { text = await fs.readFile(path.join(installDirectory, INSTALL_METADATA_FILENAME), "utf8"); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  return isInstallMetadata(value) ? value : undefined;
}
export function legacyInstallMetadata(installDirectory: string, version: string, repository = "mistrjirka/PiTTy", environment: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform): InstallMetadata {
  const binDirectory = environment.PITTY_BIN_DIR || (platform === "win32"
    ? path.win32.join(path.win32.dirname(installDirectory), "bin")
    : path.join(environment.XDG_BIN_HOME || path.join(environment.HOME || "", ".local"), "bin"));
  return { schemaVersion: 1, repository, installedVersion: version, installDirectory, binDirectory, pluginMode: "ask" };
}
