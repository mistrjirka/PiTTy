import { describe, expect, test } from "bun:test";
import { ensureUpgradeVersionAllowed, installerCommand, parseUpgradeArgs, metadataForUpgrade } from "../src/upgrade.ts";
import { legacyInstallMetadata, isInstallMetadata } from "../src/update/metadata.ts";
import { fetchLatestStableRelease } from "../src/update/check.ts";

describe("upgrade contracts", () => {
  test("parses check and explicit stable versions", () => {
    expect(parseUpgradeArgs(["--check"]).check).toBe(true);
    expect(parseUpgradeArgs(["--version", "v1.2.3"]).version).toBe("v1.2.3");
    expect(() => parseUpgradeArgs(["--version", "1.2"])).toThrow();
    expect(() => parseUpgradeArgs(["--unknown"])).toThrow();
    expect(() => parseUpgradeArgs(["--check", "--version", "1.2.3"])).toThrow();
  });
  test("selects PowerShell on Windows without mutating process.platform", () => {
    const metadata = legacyInstallMetadata("C:\\Program Files\\PiTTy", "1.2.3", "repo", { PITTY_BIN_DIR: "C:\\Tools" });
    expect(installerCommand("win32", "C:\\Program Files\\PiTTy\\install.ps1", "1.2.4", metadata)).toEqual({ command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\Program Files\\PiTTy\\install.ps1", "-DeferApply", "-Version", "1.2.4", "-InstallDir", "C:\\Program Files\\PiTTy", "-BinDir", "C:\\Tools", "-Repo", "repo"] });
    expect(installerCommand("linux", "/tmp/install.sh", "1.2.4", metadata)).toEqual({ command: "sh", args: ["/tmp/install.sh", "--defer-apply", "--version", "1.2.4", "--install-dir", "C:\\Program Files\\PiTTy", "--bin-dir", "C:\\Tools", "--repo", "repo"] });
  });
  test("allows same and newer versions but rejects downgrades", () => {
    expect(() => ensureUpgradeVersionAllowed("1.2.2", "1.2.3")).toThrow("Requested version 1.2.2 is older than installed version 1.2.3");
    expect(() => ensureUpgradeVersionAllowed("1.2.3", "1.2.3")).not.toThrow();
    expect(() => ensureUpgradeVersionAllowed("1.2.4", "1.2.3")).not.toThrow();
  });
  test("derives safe legacy metadata and validates persisted metadata", () => {
    const metadata = legacyInstallMetadata("/tmp/pitty", "0.3.3");
    expect(metadata.pluginMode).toBe("ask");
    expect(metadataForUpgrade(undefined, "/tmp/pitty").installDirectory).toBe("/tmp/pitty");
    expect(legacyInstallMetadata("/tmp/pitty", "0.3.3", "repo", { HOME: "/home/test" }).binDirectory).toBe("/home/test/.local/bin");
    expect(legacyInstallMetadata("/tmp/pitty", "0.3.3", "repo", { PITTY_BIN_DIR: "/custom/bin", HOME: "/home/test" }).binDirectory).toBe("/custom/bin");
    expect(isInstallMetadata(metadata)).toBe(true);
    expect(isInstallMetadata({ ...metadata, schemaVersion: 2 })).toBe(false);
  });
  test("bounds latest-release fetches and clears timeout", async () => {
    await expect(fetchLatestStableRelease("repo", async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }), 1)).rejects.toThrow("aborted");
    await expect(fetchLatestStableRelease("repo", async () => { throw new Error("network"); }, 10)).rejects.toThrow("network");
  });
});
