import { describe, expect, test } from "bun:test";
import { parseUpgradeArgs, metadataForUpgrade } from "../src/upgrade.ts";
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
