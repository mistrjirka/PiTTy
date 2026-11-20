import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureFoundersRuntime } from "../scripts/founders-runtime.mjs";

// The managed runtime is supported only on Linux and macOS.
const testManagedBootstrap = ["linux", "darwin"].includes(process.platform) ? test : test.skip;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const version = JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, "../vendor/managed-fork-manifest.json"), "utf8")).pi.version as string;
const oldBase = { status: "unsupported", reason: "Installed Pi version differs from the verified fork version " + version };
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-founders-runtime-"));
  roots.push(root);
  return { root, appRoot: path.join(root, "app"), env: { PATH: "/fixture/bin", HOME: path.join(root, "home") } };
}

describe("founders private Pi bootstrap", () => {
  testManagedBootstrap("prepares exact manifest version for an older global Pi, validates through the managed builder, and removes the prefix", async () => {
    const f = fixture();
    let calls = 0;
    let prefix = "";
    const logs: string[] = [];
    const result = await ensureFoundersRuntime(f.appRoot, {
      ...f.env, NPM_TOKEN: "fixture-secret", NODE_AUTH_TOKEN: "other-secret",
      npm_config_registry: "https://private.invalid", NODE_OPTIONS: "--require=/unwanted.js",
      HTTPS_PROXY: "https://proxy.example",
    }, {
      log: (line) => logs.push(line),
      ensureRuntime: (appRoot, env) => {
        calls++;
        expect(appRoot).toBe(f.appRoot);
        if (calls === 1) {
          expect(env.PITTY_UPSTREAM_PI_ROOT).toBeUndefined();
          return oldBase;
        }
        expect(env.PITTY_UPSTREAM_PI_ROOT).toBe(path.join(prefix, "lib", "node_modules", "@earendil-works", "pi-coding-agent"));
        expect(fs.existsSync(env.PITTY_UPSTREAM_PI_ROOT!)).toBe(true);
        expect(env.PATH).toBe(f.env.PATH);
        return { status: "installed" };
      },
      runCommand: (command, args, options) => {
        expect(command).toBe("npm");
        prefix = options.cwd;
        expect(path.dirname(prefix)).toBe(f.appRoot);
        expect(path.basename(prefix)).toStartWith(".founders-pi-");
        expect(args).toContain("--prefix=" + prefix);
        expect(args).toContain("--global");
        expect(args).toContain("--ignore-scripts");
        expect(args).toContain("--registry=https://registry.npmjs.org/");
        expect(args.at(-1)).toBe("@earendil-works/pi-coding-agent@" + version);
        for (const flag of ["--userconfig=", "--globalconfig="]) {
          const file = args.find((arg) => arg.startsWith(flag))!.slice(flag.length);
          expect(path.dirname(file)).toBe(prefix);
          expect(fs.readFileSync(file, "utf8")).toBe("");
        }
        expect(options.env).toEqual({ ...f.env, HTTPS_PROXY: "https://proxy.example" });
        fs.mkdirSync(path.join(prefix, "lib", "node_modules", "@earendil-works", "pi-coding-agent"), { recursive: true });
        return { status: 0 };
      },
    });
    expect(result).toEqual({ status: "installed" });
    expect(calls).toBe(2);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("Global Pi stays unchanged");
    expect(fs.existsSync(prefix)).toBe(false);
    expect(fs.existsSync(f.env.HOME)).toBe(false);
    expect(f.env.PATH).toBe("/fixture/bin");
  });

  testManagedBootstrap("cleans temporary files after download or audited builder failure", async () => {
    const f = fixture();
    for (const failure of ["download", "validation"]) {
      let prefix = "";
      let calls = 0;
      await expect(ensureFoundersRuntime(f.appRoot, f.env, {
        log: () => {},
        ensureRuntime: () => {
          calls++;
          if (calls === 1) return oldBase;
          throw new Error("Audited startup rejected fixture");
        },
        runCommand: (_command, _args, options) => {
          prefix = options.cwd;
          return { status: failure === "download" ? 1 : 0 };
        },
      })).rejects.toThrow(failure === "download" ? "Cannot prepare private Pi " + version : "Audited startup rejected fixture");
      expect(fs.existsSync(prefix)).toBe(false);
      expect(calls).toBe(failure === "download" ? 1 : 2);
    }
  });

  test("does not bootstrap a ready runtime, explicit selections, or an unrelated missing dependency", async () => {
    const f = fixture();
    const cases = [
      { env: {}, result: { status: "ready" } },
      { env: {}, result: { status: "installed" } },
      { env: { PITTY_USE_UPSTREAM_PI: "1" }, result: { status: "skipped" } },
      { env: { PITTY_NO_MANAGED_PI: "1" }, result: { status: "skipped" } },
      { env: { PITTY_UPSTREAM_PI_ROOT: "/explicit/old-pi" }, result: oldBase },
      { env: { PITTY_UPSTREAM_PI_EXECUTABLE: "/explicit/old-pi/bin/pi" }, result: oldBase },
      { env: {}, result: { status: "unsupported", reason: "pi-code-tool is not installed" } },
    ];
    for (const entry of cases) {
      const result = await ensureFoundersRuntime(f.appRoot, { ...f.env, ...entry.env }, {
        ensureRuntime: () => entry.result,
        runCommand: () => { throw new Error("Unexpected npm bootstrap"); },
        log: () => { throw new Error("Unexpected bootstrap log"); },
      });
      expect(result).toEqual(entry.result);
      expect(fs.existsSync(f.appRoot)).toBe(false);
    }
  });
});
