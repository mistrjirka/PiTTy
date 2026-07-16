import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { checkForUpdates, compareStableVersions, isUpdateCheckDisabled, type UpdateCheckConfig } from "../src/update/check.ts";

let directory = "";
let cachePath = "";
const logger = { info: () => {}, warn: () => {} };

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "pitty-update-"));
  cachePath = path.join(directory, "update.json");
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

function config(overrides: Partial<UpdateCheckConfig> = {}): UpdateCheckConfig {
  return {
    fetch: async () => new Response(JSON.stringify({ tag_name: "v0.3.3" }), { status: 200 }),
    now: () => 2_000,
    cachePath,
    repository: "mistrjirka/PiTTy",
    localVersion: "0.3.2",
    environment: {},
    logger,
    onNewerRelease: () => {},
    ...overrides,
  };
}

describe("stable version comparison", () => {
  test("compares numeric patch versions", () => {
    expect(compareStableVersions("0.3.2", "0.3.3")).toBe(-1);
    expect(compareStableVersions("0.3.10", "0.3.9")).toBe(1);
    expect(compareStableVersions("v1.2.3", "1.2.3")).toBe(0);
  });
  test("rejects malformed and prerelease versions", () => {
    expect(() => compareStableVersions("0.3", "0.3.1")).toThrow();
    expect(() => compareStableVersions("v0.3.3-beta", "0.3.4")).toThrow();
    expect(() => compareStableVersions("01.2.3", "1.2.3")).toThrow();
  });
});

describe("update checks", () => {
  test("does nothing when explicitly disabled", async () => {
    let calls = 0;
    await checkForUpdates(config({ environment: { PITTY_NO_UPDATE_CHECK: "1" }, fetch: async () => { calls++; throw new Error("network"); } }));
    expect(calls).toBe(0);
    expect(await fs.stat(cachePath).catch(() => undefined)).toBeUndefined();
    expect(isUpdateCheckDisabled({ PITTY_NO_UPDATE_CHECK: "1" })).toBe(true);
  });
  test("revalidates a fresh legacy success cache and persists its local version", async () => {
    await fs.writeFile(cachePath, JSON.stringify({ checkedAt: 1_000, outcome: "success", version: "0.3.3" }));
    let calls = 0;
    let announced = "";
    const localConfig = config({ localVersion: "0.3.4", fetch: async () => { calls++; return new Response(JSON.stringify({ tag_name: "v0.4.2" }), { status: 200 }); }, onNewerRelease: (version) => { announced = version; } });
    await checkForUpdates(localConfig);
    expect(calls).toBe(1);
    expect(announced).toBe("v0.4.2");
    expect(JSON.parse(await fs.readFile(cachePath, "utf8")).checkedForVersion).toBe("0.3.4");
    announced = "";
    await checkForUpdates(localConfig);
    expect(calls).toBe(1);
    expect(announced).toBe("v0.4.2");
  });
  test("notifies from a fresh newer cache checked for another local version", async () => {
    await fs.writeFile(cachePath, JSON.stringify({ checkedAt: 1_000, outcome: "success", version: "v0.4.2", checkedForVersion: "0.3.1" }));
    let announced = "";
    await checkForUpdates(config({ fetch: async () => { throw new Error("network"); }, onNewerRelease: (version) => { announced = version; } }));
    expect(announced).toBe("v0.4.2");
  });
  test("suppresses a same-local current cache and fresh failures", async () => {
    await fs.writeFile(cachePath, JSON.stringify({ checkedAt: 2_000, outcome: "success", version: "0.3.2", checkedForVersion: "0.3.2" }));
    let calls = 0;
    await checkForUpdates(config({ fetch: async () => { calls++; throw new Error("network"); } }));
    expect(calls).toBe(0);
    await fs.writeFile(cachePath, JSON.stringify({ checkedAt: 2_000, outcome: "success", version: "0.3.1", checkedForVersion: "0.3.2" }));
    await checkForUpdates(config({ fetch: async () => { calls++; throw new Error("network"); } }));
    expect(calls).toBe(0);
    await fs.writeFile(cachePath, JSON.stringify({ checkedAt: 2_000, outcome: "failure" }));
    await checkForUpdates(config({ fetch: async () => { calls++; throw new Error("network"); } }));
    expect(calls).toBe(0);
  });
  test("refetches malformed cached versions", async () => {
    let calls = 0;
    await fs.writeFile(cachePath, JSON.stringify({ checkedAt: 1_000, outcome: "success", version: "not-a-version", checkedForVersion: "0.3.2" }));
    await checkForUpdates(config({ fetch: async () => { calls++; return new Response(JSON.stringify({ tag_name: "0.3.2" }), { status: 200 }); } }));
    await fs.writeFile(cachePath, JSON.stringify({ checkedAt: 1_000, outcome: "success", version: "0.3.3", checkedForVersion: "bad" }));
    await checkForUpdates(config({ fetch: async () => { calls++; return new Response(JSON.stringify({ tag_name: "0.3.2" }), { status: 200 }); } }));
    expect(calls).toBe(2);
  });
  test("fetches stale release and announces newer versions", async () => {
    let announced = "";
    await checkForUpdates(config({ now: () => 24 * 60 * 60 * 1000 + 1_001, onNewerRelease: (version) => { announced = version; } }));
    expect(announced).toBe("v0.3.3");
    expect(JSON.parse(await fs.readFile(cachePath, "utf8")).outcome).toBe("success");
  });
  test("does not announce a current release", async () => {
    let announced = false;
    await checkForUpdates(config({ localVersion: "0.3.3", onNewerRelease: () => { announced = true; } }));
    expect(announced).toBe(false);
    expect(JSON.parse(await fs.readFile(cachePath, "utf8")).outcome).toBe("success");
  });
  test("does not accept prereleases or malformed payloads", async () => {
    let calls = 0;
    await checkForUpdates(config({ fetch: async () => { calls++; return new Response(JSON.stringify({ tag_name: "v0.4.0-rc.1", prerelease: true }), { status: 200 }); } }));
    expect(calls).toBe(1);
    expect(JSON.parse(await fs.readFile(cachePath, "utf8")).outcome).toBe("failure");
    await fs.rm(cachePath);
    await checkForUpdates(config({ fetch: async () => new Response(JSON.stringify({ tag_name: "not-a-version" }), { status: 200 }) }));
    expect(JSON.parse(await fs.readFile(cachePath, "utf8")).outcome).toBe("failure");
  });
  test("caches timeout and network errors", async () => {
    await checkForUpdates(config({ fetch: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    }), timeoutMs: 1 }));
    expect(JSON.parse(await fs.readFile(cachePath, "utf8")).outcome).toBe("failure");
  });
});
