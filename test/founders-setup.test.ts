import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { foundersCatalog, type FoundersPackage } from "../scripts/founders-catalog.mjs";
import { hash, localEquivalentSource, mergeFoundersPackages, planAgents, sourceIdentity } from "../scripts/founders-state.mjs";
import { parseFoundersArgs, setupFounders, type FoundersOptions } from "../scripts/founders-setup.mjs";
import { ensureFoundersRuntime } from "../scripts/founders-runtime.mjs";

// The private bootstrap itself does not run on unsupported native platforms.
const testManagedBootstrap = ["linux", "darwin"].includes(process.platform) ? test : test.skip;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const put = (file: string, value: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const putJson = (file: string, value: unknown) => put(file, JSON.stringify(value, null, 2) + "\n");

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-founders-"));
  roots.push(base);
  const agentDir = path.join(base, "agent dir");
  const bundle = path.join(base, "bundle");
  const settingsFile = path.join(agentDir, "settings.json");
  const profile = path.join(agentDir, "agents", "implementation-review.md");
  const catalog = foundersCatalog({ skills: bundle }).filter((entry) => ["memory", "skills", "code"].includes(entry.id));
  const settings = {
    defaultProvider: "keep-provider", defaultModel: "keep-model", thinkingLevel: "medium",
    unrelated: { untouched: true },
    subagentProfiles: { defaults: { model: "keep-agent-model" } },
    packages: [
      { source: "npm:pi-hermes-memory", extensions: [], note: "keep filter" },
      "npm:unrelated", "npm:pi-hermes-memory-other",
    ],
  };
  putJson(settingsFile, settings);
  put(path.join(agentDir, "auth.json"), "fixture credential, never parse or change\n");
  putJson(path.join(bundle, "package.json"), { name: "@mistrjirka/pitty-skills" });
  put(path.join(bundle, "skills", "general", "SKILL.md"), "---\nname: general\ndescription: Fixture\n---\nFixture skill.\n");
  const updateBundle = (body: string, extra = "") => {
    const content = "---\nname: implementation-review\ndescription: Review implementation\n" + extra + "---\n" + body + "\n";
    put(path.join(bundle, "agents", "implementation-review.md"), content);
    putJson(path.join(bundle, "manifest.json"), {
      schemaVersion: 1,
      skills: [{ name: "general", path: "skills/general" }],
      agents: [{ name: "implementation-review", path: "agents/implementation-review.md", sha256: hash(content) }],
    });
    return content;
  };
  const initialProfile = updateBundle("Review the actual behavior.");
  const installed = new Map<string, string>([[sourceIdentity(bundle)!, bundle]]);
  const installs: string[] = [];
  const logs: string[] = [];
  let beforeInstall: (source: string) => void = () => {};
  let runtimeCalls = 0;
  const manager = {
    getInstalledPath(source: string) { return installed.get(sourceIdentity(source, agentDir)!); },
    async install(source: string) {
      beforeInstall(source);
      installs.push(source);
      const entry = catalog.find((candidate) => sourceIdentity(candidate.source) === sourceIdentity(source));
      if (!entry) throw new Error("Unexpected fixture package " + source);
      const directory = path.join(base, "cache", entry.id);
      putJson(path.join(directory, "package.json"), { name: entry.names[0], version: entry.version ?? "1.0.0" });
      for (const file of entry.files) put(path.join(directory, file), "// fixture\n");
      installed.set(sourceIdentity(source)!, directory);
    },
  };
  const options: FoundersOptions = {
    agentDir, appRoot: path.join(base, "app"), catalog, platform: "linux",
    packageManager: manager, log: (line) => logs.push(line), runtimeReady: () => true,
    ensureRuntime: (_root, env) => {
      runtimeCalls++;
      expect(env.PI_CODING_AGENT_DIR).toBe(agentDir);
      return { status: "ready" };
    },
  };
  return {
    base, agentDir, bundle, settingsFile, profile, settings, catalog, installed, installs, logs, options,
    updateBundle, initialProfile, runtimeCalls: () => runtimeCalls,
    setBeforeInstall(callback: (source: string) => void) { beforeInstall = callback; },
  };
}

describe("founders setup", () => {
  test("installs missing packages and agents once while preserving credentials, defaults, filters and unrelated packages", async () => {
    const f = fixture();
    const credentials = fs.readFileSync(path.join(f.agentDir, "auth.json"), "utf8");
    expect(await setupFounders(f.options)).toEqual({ exitCode: 0, changed: true });
    expect(f.installs).toEqual(["git:github.com/mistrjirka/pi-eigen-memory", "npm:pi-code-tool@0.6.2"]);
    const current = JSON.parse(fs.readFileSync(f.settingsFile, "utf8"));
    expect(current).toEqual({
      ...f.settings,
      packages: [
        { source: "git:github.com/mistrjirka/pi-eigen-memory", extensions: [], note: "keep filter" },
        "npm:unrelated", "npm:pi-hermes-memory-other", f.bundle, "npm:pi-code-tool@0.6.2",
      ],
    });
    expect(fs.readFileSync(f.profile, "utf8")).toBe(f.initialProfile);
    expect(fs.readFileSync(path.join(f.agentDir, "auth.json"), "utf8")).toBe(credentials);
    expect(f.logs.some((line) => line.includes("provider configuration"))).toBe(true);
    expect(f.logs.some((line) => line.includes("model overrides are preserved"))).toBe(true);
    const firstSettings = fs.readFileSync(f.settingsFile, "utf8");
    const firstModified = fs.statSync(f.profile, { bigint: true }).mtimeNs;
    f.installs.length = 0;
    expect(await setupFounders(f.options)).toEqual({ exitCode: 0, changed: false });
    expect(f.installs).toEqual([]);
    expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(firstSettings);
    expect(fs.statSync(f.profile, { bigint: true }).mtimeNs).toBe(firstModified);
    expect((await setupFounders({ ...f.options, check: true })).exitCode).toBe(0);
  });

  test("dry-run and check never install, build, write profiles or prepare a runtime", async () => {
    const f = fixture();
    const before = fs.readFileSync(f.settingsFile, "utf8");
    expect((await setupFounders({ ...f.options, check: true })).exitCode).toBe(1);
    expect((await setupFounders({ ...f.options, dryRun: true })).exitCode).toBe(0);
    expect(f.installs).toEqual([]);
    expect(f.runtimeCalls()).toBe(0);
    expect(fs.existsSync(f.profile)).toBe(false);
    expect(fs.existsSync(path.join(f.agentDir, "pitty-founders.json"))).toBe(false);
    expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(before);
  });

  test("a required package failure leaves previous configuration and agents intact", async () => {
    const f = fixture();
    const before = fs.readFileSync(f.settingsFile, "utf8");
    f.setBeforeInstall((source) => { if (source.startsWith("npm:pi-code-tool")) throw new Error("fixture network failure"); });
    await expect(setupFounders(f.options)).rejects.toThrow("fixture network failure");
    expect(f.installs).toEqual(["git:github.com/mistrjirka/pi-eigen-memory"]);
    expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(before);
    expect(fs.existsSync(f.profile)).toBe(false);
    expect(f.runtimeCalls()).toBe(0);
  });

  test("a required build failure and unsupported runtime leave settings and profiles unchanged", async () => {
    const f = fixture();
    const before = fs.readFileSync(f.settingsFile, "utf8");
    const memory = f.catalog.find((entry) => entry.id === "memory")!;
    memory.build = "fixture";
    await expect(setupFounders({
      ...f.options, buildPackage: () => { throw new Error("fixture build failure"); },
    })).rejects.toThrow("fixture build failure");
    expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(before);
    expect(fs.existsSync(f.profile)).toBe(false);
    delete memory.build;
    await expect(setupFounders({
      ...f.options, ensureRuntime: () => ({ status: "unsupported", reason: "Pi version mismatch" }),
    })).rejects.toThrow("Pi version mismatch");
    expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(before);
    expect(fs.existsSync(f.profile)).toBe(false);
    await expect(setupFounders({
      ...f.options, runtimeReady: () => false,
    })).rejects.toThrow("required side-question protocol");
    expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(before);
    expect(fs.existsSync(f.profile)).toBe(false);
  });

  testManagedBootstrap("activates setup after an isolated Pi bootstrap succeeds for an older global Pi", async () => {
    const f = fixture();
    const version = JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, "../vendor/managed-fork-manifest.json"), "utf8")).pi.version;
    let bootstrapCalls = 0;
    expect((await setupFounders({
      ...f.options, env: { PATH: "/fixture/bin" },
      ensureRuntime: (root, env) => ensureFoundersRuntime(root, env, {
        log: () => {},
        ensureRuntime: (_root, runtimeEnv) => runtimeEnv.PITTY_UPSTREAM_PI_ROOT
          ? { status: "installed" }
          : { status: "unsupported", reason: "Installed Pi version differs from the verified fork version " + version },
        runCommand: () => { bootstrapCalls++; return { status: 0 }; },
      }),
    })).exitCode).toBe(0);
    expect(bootstrapCalls).toBe(1);
    expect(fs.readFileSync(f.profile, "utf8")).toBe(f.initialProfile);
    expect(JSON.parse(fs.readFileSync(f.settingsFile, "utf8")).packages).toContain(f.bundle);
    expect(fs.readdirSync(f.options.appRoot!)).toEqual([]);
  });

  testManagedBootstrap("a private Pi download failure preserves settings, agent files and saved source choices", async () => {
    const f = fixture();
    await setupFounders(f.options);
    const receiptFile = path.join(f.agentDir, "pitty-founders.json");
    const settings = fs.readFileSync(f.settingsFile, "utf8");
    const receipt = fs.readFileSync(receiptFile, "utf8");
    const profile = fs.readFileSync(f.profile, "utf8");
    f.updateBundle("Instructions waiting for a compatible runtime.");
    const version = JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, "../vendor/managed-fork-manifest.json"), "utf8")).pi.version;
    await expect(setupFounders({
      ...f.options, env: { PATH: "/fixture/bin" },
      ensureRuntime: (root, env) => ensureFoundersRuntime(root, env, {
        log: () => {},
        ensureRuntime: () => ({ status: "unsupported", reason: "Installed Pi version differs from the verified fork version " + version }),
        runCommand: () => ({ status: 1 }),
      }),
    })).rejects.toThrow("Cannot prepare private Pi");
    expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(settings);
    expect(fs.readFileSync(receiptFile, "utf8")).toBe(receipt);
    expect(fs.readFileSync(f.profile, "utf8")).toBe(profile);
    expect(fs.readdirSync(f.options.appRoot!)).toEqual([]);
  });

  test("preserves custom profile collisions and reports incomplete curated installation", async () => {
    const f = fixture();
    put(f.profile, "---\nname: implementation-review\nmodel: custom-model\n---\nMy custom review.\n");
    const custom = fs.readFileSync(f.profile, "utf8");
    expect((await setupFounders(f.options)).exitCode).toBe(2);
    expect(fs.readFileSync(f.profile, "utf8")).toBe(custom);
    expect(f.logs.some((line) => line.includes("Missing curated agent: implementation-review"))).toBe(true);
    expect((await setupFounders({ ...f.options, check: true })).exitCode).toBe(1);
  });

  test("updates unchanged managed profiles but preserves later local edits", async () => {
    const f = fixture();
    await setupFounders(f.options);
    const updated = f.updateBundle("New review instructions.");
    expect((await setupFounders(f.options)).exitCode).toBe(0);
    expect(fs.readFileSync(f.profile, "utf8")).toBe(updated);
    put(f.profile, updated + "Local customization.\n");
    f.updateBundle("Third review instructions.");
    expect((await setupFounders(f.options)).exitCode).toBe(2);
    expect(fs.readFileSync(f.profile, "utf8")).toBe(updated + "Local customization.\n");
  });

  test("rejects corrupt hashes, pinned exported models and inconsistent agent names before activation", async () => {
    const f = fixture();
    const before = fs.readFileSync(f.settingsFile, "utf8");
    put(path.join(f.bundle, "agents", "implementation-review.md"), f.initialProfile + "Tampered.\n");
    await expect(setupFounders(f.options)).rejects.toThrow("checksum mismatch");
    expect(f.installs).toEqual([]);
    f.updateBundle("Body.", "model: pinned\n");
    expect(() => planAgents(f.bundle, f.agentDir)).toThrow("model and provider unset");
    f.updateBundle("Body.");
    const manifest = JSON.parse(fs.readFileSync(path.join(f.bundle, "manifest.json"), "utf8"));
    manifest.agents[0].name = "different-name";
    putJson(path.join(f.bundle, "manifest.json"), manifest);
    expect(() => planAgents(f.bundle, f.agentDir)).toThrow("name differs");
    expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(before);
  });

  test("preserves unrelated settings changed during download", async () => {
    const f = fixture();
    f.setBeforeInstall(() => putJson(f.settingsFile, { ...f.settings, defaultModel: "new user selection" }));
    await setupFounders(f.options);
    expect(JSON.parse(fs.readFileSync(f.settingsFile, "utf8")).defaultModel).toBe("new user selection");
  });

  test("rejects malformed existing settings and unsupported platforms without starting downloads", async () => {
    const f = fixture();
    put(f.settingsFile, "{broken");
    await expect(setupFounders(f.options)).rejects.toThrow("Cannot parse");
    expect(f.installs).toEqual([]);
    putJson(f.settingsFile, f.settings);
    await expect(setupFounders({ ...f.options, platform: "win32" })).rejects.toThrow("not supported on this platform");
    expect(f.installs).toEqual([]);
    expect(fs.existsSync(f.profile)).toBe(false);
  });
});

describe("founders source matching and command boundary", () => {
  test("matches exact npm/Git identities including SSH, preserving pins and avoiding substring matches", () => {
    expect(sourceIdentity("git:git@github.com:mistrjirka/pitty-skills.git")).toBe(sourceIdentity("git:github.com/mistrjirka/pitty-skills"));
    expect(sourceIdentity("https://github.com/mistrjirka/pi-subagent.git@abc123")).toBe("git:github.com/mistrjirka/pi-subagent");
    expect(sourceIdentity("npm:@juicesharp/rpiv-todo@2.15.0")).toBe("npm:@juicesharp/rpiv-todo");
    expect(sourceIdentity("git@github.com:mistrjirka/pitty-skills.git")?.startsWith("local:")).toBe(true);
    const catalog = foundersCatalog().filter((entry) => entry.id === "subagents");
    const planned = mergeFoundersPackages({ packages: [
      "npm:pi-subagents", "npm:pi-subagents-other",
      { source: "git:github.com/mistrjirka/pi-subagent@my-pin", extensions: [] },
    ] }, catalog);
    expect(planned.settings.packages).toEqual([
      { source: "git:github.com/mistrjirka/pi-subagent@my-pin", extensions: [] },
      "npm:pi-subagents-other",
    ]);
  });

  test("catalog uses real owned memory and public sources plus a pinned managed code-tool base", () => {
    const catalog = foundersCatalog();
    expect(catalog.find((entry) => entry.id === "memory")?.source).toBe("git:github.com/mistrjirka/pi-eigen-memory");
    expect(catalog.find((entry) => entry.id === "skills")?.source).toBe("git:https://github.com/mistrjirka/PiTTy-Skills.git");
    expect(catalog.find((entry) => entry.id === "btw")?.source).toBe("git:https://github.com/mistrjirka/PiTTy-BTW.git");
    expect(catalog.find((entry) => entry.id === "background")?.source).toBe("npm:pi-bg-bash");
    expect(catalog.find((entry) => entry.id === "code")?.source).toBe("npm:pi-code-tool@0.6.2");
    const doppel = catalog.find((entry) => entry.id === "doppelclaude");
    expect(doppel?.files).toContain("packages/pi-doppelclaude/dist/pi-side-question.js");
    const cwd = path.join(os.tmpdir(), "founders-args");
    const args = parseFoundersArgs(["--dry-run", "--agent-dir", "test agent", "--skills-source", "./skills"], cwd);
    expect(args.agentDir).toBe(path.join(cwd, "test agent"));
    expect(args.sources.skills).toBe(path.join(cwd, "skills"));
    expect(() => parseFoundersArgs(["--unknown"])).toThrow("Unknown");
  });

  test("launcher handles founders help without starting Pi, Bun or writing the agent directory", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-founders-help-"));
    roots.push(base);
    const agentDir = path.join(base, "unused-agent");
    const output = execFileSync("node", [path.resolve(import.meta.dir, "../bin/pitty.mjs"), "founders-setup", "--help"], {
      cwd: base, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, encoding: "utf8",
    });
    expect(output).toContain("--dry-run");
    expect(output).toContain("--agent-dir");
    expect(fs.existsSync(agentDir)).toBe(false);
  });
});

describe("local checkouts in settings", () => {
  test("a local checkout with the package's name stands in for the maintained source", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-local-equivalent-"));
    try {
      const fork = path.join(base, "my-doppelclaude-fork");
      fs.mkdirSync(fork);
      fs.writeFileSync(path.join(fork, "package.json"), JSON.stringify({ name: "pi-doppelclaude-workspace" }));
      const other = path.join(base, "other");
      fs.mkdirSync(other);
      fs.writeFileSync(path.join(other, "package.json"), JSON.stringify({ name: "something-else" }));
      const entry = foundersCatalog().find((item) => item.id === "doppelclaude")!;
      expect(localEquivalentSource({ packages: [other, { source: fork }] }, entry, base)).toBe(fork);
      // Remote sources and unrelated checkouts never match by name.
      expect(localEquivalentSource({ packages: ["npm:pi-doppelclaude", other] }, entry, base)).toBeUndefined();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("todo is no longer part of the recommended set", () => {
    expect(foundersCatalog().map((entry) => entry.id)).not.toContain("todo");
  });
});
