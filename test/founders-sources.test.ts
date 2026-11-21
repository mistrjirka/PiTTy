import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { foundersCatalog } from "../scripts/founders-catalog.mjs";
import { githubSourcePath, hash, sourceIdentity } from "../scripts/founders-state.mjs";
import { setupFounders, type FoundersOptions } from "../scripts/founders-setup.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const putJson = (file: string, value: unknown) => put(file, JSON.stringify(value, null, 2) + "\n");
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

function initializeCache(directory: string, origin = "https://github.com/mistrjirka/PiTTy-Skills.git", ignoredBuild = "") {
  const git = (args: string[]) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  put(path.join(directory, ".gitignore"), "node_modules/\nlocal-notes.txt\n" + ignoredBuild);
  git(["init", "-q", "-b", "main"]);
  git(["add", "--", "."]);
  const commit = () => git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "Fixture cache"]);
  commit();
  git(["remote", "add", "origin", origin]);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  git(["branch", "--set-upstream-to=origin/main", "main"]);
  return { git, commit };
}

function fixture(extraPackages: string[] = []) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-founder-sources-"));
  roots.push(base);
  const agentDir = path.join(base, "agent");
  const settingsFile = path.join(agentDir, "settings.json");
  const receiptFile = path.join(agentDir, "pitty-founders.json");
  const profileFile = path.join(agentDir, "agents", "implementation-review.md");
  const catalog = foundersCatalog().filter((entry) => entry.id === "skills" || entry.id === "btw" || extraPackages.includes(entry.id));
  const sourceFor = (id: string) => catalog.find((entry) => entry.id === id)!.source;
  const available = new Map<string, string>();
  const installed = new Map<string, string>();
  const installs: string[] = [];
  let beforeInstall = (_source: string) => {};
  const addPackage = (source: string, id: string, body = "Review implementation.", directory?: string) => {
    const root = directory ?? path.join(base, "packages", String(available.size));
    putJson(path.join(root, "package.json"), {
      name: catalog.find((entry) => entry.id === id)!.names[0],
      version: id === "skills" ? "0.2.0" : "0.1.0",
    });
    if (id === "btw") put(path.join(root, "index.ts"), "export default () => {};\n");
    else if (id === "skills") {
      const content = "---\nname: implementation-review\ndescription: Review changes\n---\n" + body + "\n";
      put(path.join(root, "agents", "implementation-review.md"), content);
      put(path.join(root, "skills", "general", "SKILL.md"), "---\nname: general\ndescription: General work\n---\nSkill.\n");
      putJson(path.join(root, "manifest.json"), {
        schemaVersion: 1, skills: [{ name: "general", path: "skills/general" }],
        agents: [{ name: "implementation-review", path: "agents/implementation-review.md", sha256: hash(content) }],
      });
    } else for (const file of catalog.find((entry) => entry.id === id)!.files)
      put(path.join(root, file), "// Compiled fixture.\n");
    available.set(sourceIdentity(source, agentDir)!, root);
    return root;
  };
  for (const entry of catalog) addPackage(entry.source, entry.id);
  putJson(settingsFile, {
    defaultModel: "keep-model",
    packages: [
      { source: sourceFor("skills"), skills: ["skills/general"], note: "keep filters" },
      sourceFor("btw"), "npm:pi-btw-unrelated",
    ],
  });
  const manager = {
    getInstalledPath(source: string) { return installed.get(sourceIdentity(source, agentDir)!); },
    async install(source: string) {
      beforeInstall(source);
      installs.push(source);
      const identity = sourceIdentity(source, agentDir)!;
      const root = available.get(identity);
      if (!root) throw new Error("Unavailable fixture package " + source);
      installed.set(identity, root);
    },
  };
  const options: FoundersOptions = {
    agentDir, appRoot: path.join(base, "app"), env: { PATH: "" }, catalog, platform: "linux",
    packageManager: manager, buildPackage: () => {}, runtimeReady: () => true, ensureRuntime: () => ({ status: "ready" }), log: () => {},
  };
  return {
    base, agentDir, settingsFile, receiptFile, profileFile, catalog, sourceFor, addPackage, installed, installs, options,
    setBeforeInstall(callback: (source: string) => void) { beforeInstall = callback; },
  };
}

describe("founders source preferences", () => {
  test("refreshes an older maintained bundle once and reports it without writes in check mode", async () => {
    const f = fixture();
    await setupFounders(f.options);
    const source = f.sourceFor("skills");
    const cached = f.installed.get(sourceIdentity(source)!)!;
    putJson(path.join(cached, "package.json"), { name: "@mistrjirka/pitty-skills", version: "0.1.0" });
    initializeCache(cached);
    putJson(path.join(cached, "package-lock.json"), { lockfileVersion: 3 });
    put(path.join(cached, "node_modules", "fixture", "index.js"), "// Rebuilt by Pi.\n");
    const latest = f.addPackage(source, "skills");
    const settings = fs.readFileSync(f.settingsFile, "utf8");
    const receipt = fs.readFileSync(f.receiptFile, "utf8");
    f.installs.length = 0;
    expect((await setupFounders({ ...f.options, check: true })).exitCode).toBe(1);
    expect((await setupFounders({ ...f.options, dryRun: true })).exitCode).toBe(0);
    expect(f.installs).toEqual([]);
    expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(settings);
    expect(fs.readFileSync(f.receiptFile, "utf8")).toBe(receipt);
    expect((await setupFounders(f.options)).exitCode).toBe(0);
    expect(f.installs).toEqual([source]);
    expect(f.installed.get(sourceIdentity(source)!)).toBe(latest);
    f.installs.length = 0;
    expect(await setupFounders(f.options)).toEqual({ exitCode: 0, changed: false });
    expect((await setupFounders({ ...f.options, check: true })).exitCode).toBe(0);
    expect(f.installs).toEqual([]);
  });

  test.each(["tracked", "untracked", "ignored", "commit", "other-upstream"] as const)("preserves %s cache work before an automatic refresh", async (kind) => {
    const f = fixture();
    await setupFounders(f.options);
    const source = f.sourceFor("skills");
    const cached = f.installed.get(sourceIdentity(source)!)!;
    putJson(path.join(cached, "package.json"), { name: "@mistrjirka/pitty-skills", version: "0.1.0" });
    const { git, commit } = initializeCache(cached);
    f.addPackage(source, "skills");
    const relative = kind === "ignored" ? "local-notes.txt"
      : kind === "untracked" ? "custom-agent.md" : "agents/implementation-review.md";
    const edited = path.join(cached, relative);
    put(edited, "My changes must survive.\n");
    if (kind === "commit" || kind === "other-upstream") {
      git(["add", "--", relative]); commit();
      if (kind === "other-upstream") {
        git(["branch", "other"]);
        git(["branch", "--set-upstream-to=other", "main"]);
      }
    }
    const settings = fs.readFileSync(f.settingsFile, "utf8");
    const receipt = fs.readFileSync(f.receiptFile, "utf8");
    f.installs.length = 0;
    await expect(setupFounders(f.options)).rejects.toThrow("local changes or unpublished commits");
    expect(f.installs).toEqual([]);
    expect(fs.readFileSync(edited, "utf8")).toBe("My changes must survive.\n");
    expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(settings);
    expect(fs.readFileSync(f.receiptFile, "utf8")).toBe(receipt);
  });

  for (const id of ["compaction", "doppelclaude"] as const) {
    const missing = id === "compaction" ? "src/method-selection.ts" : "packages/doppelclaude/dist/account-usage.js";
    test.each(["tracked", "untracked", "ignored", "commit", "other-upstream"] as const)(
      "preserves " + id + " %s cache work when a newly required file is missing",
      async (kind) => {
        const f = fixture([id]);
        const entry = f.catalog.find((item) => item.id === id)!;
        delete entry.minimumVersion;
        await setupFounders(f.options);
        const cached = f.installed.get(sourceIdentity(entry.source)!)!;
        fs.unlinkSync(path.join(cached, missing));
        put(path.join(cached, "local-source.ts"), "Original source.\n");
        const { git, commit } = initializeCache(cached, "https://" + entry.source.slice(4),
          id === "doppelclaude" ? "packages/*/dist/\n" : "");
        f.addPackage(entry.source, id);
        const relative = kind === "ignored" ? "local-notes.txt" :
          kind === "untracked" ? "custom-agent.md" : "local-source.ts";
        const edited = path.join(cached, relative);
        put(edited, "My changes must survive.\n");
        if (kind === "commit" || kind === "other-upstream") {
          git(["add", "--", relative]); commit();
          if (kind === "other-upstream") {
            git(["branch", "other"]);
            git(["branch", "--set-upstream-to=other", "main"]);
          }
        }
        const settings = fs.readFileSync(f.settingsFile, "utf8");
        const receipt = fs.readFileSync(f.receiptFile, "utf8");
        const profile = fs.readFileSync(f.profileFile, "utf8");
        f.installs.length = 0;
        await expect(setupFounders(f.options)).rejects.toThrow("local changes or unpublished commits");
        expect(f.installs).toEqual([]);
        expect(fs.existsSync(path.join(cached, missing))).toBe(false);
        expect(fs.readFileSync(edited, "utf8")).toBe("My changes must survive.\n");
        expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(settings);
        expect(fs.readFileSync(f.receiptFile, "utf8")).toBe(receipt);
        expect(fs.readFileSync(f.profileFile, "utf8")).toBe(profile);
      },
    );

    test("updates clean " + id + " Git cache when a newly required file is missing", async () => {
      const f = fixture([id]);
      const entry = f.catalog.find((item) => item.id === id)!;
      delete entry.minimumVersion;
      await setupFounders(f.options);
      const cached = f.installed.get(sourceIdentity(entry.source)!)!;
      fs.unlinkSync(path.join(cached, missing));
      initializeCache(cached, "https://" + entry.source.slice(4),
        id === "doppelclaude" ? "packages/*/dist/\n" : "");
      const latest = f.addPackage(entry.source, id);
      f.installs.length = 0;
      expect((await setupFounders({ ...f.options, check: true })).exitCode).toBe(1);
      expect(f.installs).toEqual([]);
      expect((await setupFounders(f.options)).exitCode).toBe(0);
      expect(f.installs).toEqual([entry.source]);
      expect(f.installed.get(sourceIdentity(entry.source)!)).toBe(latest);
      expect(fs.existsSync(path.join(latest, missing))).toBe(true);
    });
  }

  test("accepts a clean detached cache when explicitly returning from a pin to the maintained source", async () => {
    const f = fixture();
    await setupFounders(f.options);
    const source = f.sourceFor("skills");
    const cached = f.installed.get(sourceIdentity(source)!)!;
    putJson(path.join(cached, "package.json"), { name: "@mistrjirka/pitty-skills", version: "0.1.0" });
    const { git } = initializeCache(cached);
    git(["checkout", "--detach", "-q"]);
    const settings = readJson(f.settingsFile);
    settings.packages[0].source = source + "@v0.1.0";
    putJson(f.settingsFile, settings);
    f.addPackage(source, "skills");
    f.installs.length = 0;
    expect((await setupFounders({ ...f.options, sources: { skills: source } })).exitCode).toBe(0);
    expect(f.installs).toEqual([source]);
    expect(readJson(f.settingsFile).packages[0].source).toBe(source);
  });

  test("keeps older versions selected through a fork, local checkout or canonical ref", async () => {
    for (const kind of ["fork", "local", "pin"] as const) {
      const f = fixture();
      const source = kind === "fork" ? "git:https://github.com/Example/Skill-Fork.git"
        : kind === "local" ? path.join(f.base, "editable skills")
        : "git:git@github.com:mistrjirka/PiTTy-Skills.git@custom/older";
      const root = f.addPackage(source, "skills");
      putJson(path.join(root, "package.json"), { name: "@mistrjirka/pitty-skills", version: "0.1.0" });
      expect((await setupFounders({ ...f.options, sources: { skills: source } })).exitCode).toBe(0);
      f.installs.length = 0;
      expect(await setupFounders(f.options)).toEqual({ exitCode: 0, changed: false });
      expect((await setupFounders({ ...f.options, check: true })).exitCode).toBe(0);
      expect(f.installs).toEqual([]);
      expect(readJson(f.settingsFile).packages[0].source).toBe(source);
      expect(readJson(path.join(root, "package.json")).version).toBe("0.1.0");
    }
  });
  test("reuses selected skills and BTW forks on later setup and check without installing defaults", async () => {
    const f = fixture();
    const choices = {
      skills: "git:https://github.com/Example/Skill-Fork.git",
      btw: "git:git@github.com:Example/BTW-Fork.git",
    };
    f.addPackage(choices.skills, "skills");
    f.addPackage(choices.btw, "btw");
    expect(await setupFounders({ ...f.options, sources: choices })).toEqual({ exitCode: 0, changed: true });
    expect(f.installs.sort()).toEqual(Object.values(choices).sort());
    const settings = readJson(f.settingsFile);
    expect(settings).toEqual({
      defaultModel: "keep-model",
      packages: [{ source: choices.skills, skills: ["skills/general"], note: "keep filters" }, choices.btw, "npm:pi-btw-unrelated"],
    });
    expect(readJson(f.receiptFile).sourcePreferences).toEqual(choices);
    const receipt = fs.readFileSync(f.receiptFile, "utf8");
    f.installs.length = 0;
    expect(await setupFounders(f.options)).toEqual({ exitCode: 0, changed: false });
    expect((await setupFounders({ ...f.options, check: true })).exitCode).toBe(0);
    expect(f.installs).toEqual([]);
    expect(readJson(f.settingsFile)).toEqual(settings);
    expect(fs.readFileSync(f.receiptFile, "utf8")).toBe(receipt);
  });

  test("switches the recorded source without duplicates or changes to custom agents and unrelated packages", async () => {
    const f = fixture();
    const first = path.join(f.base, "first editable checkout");
    const second = "git:https://github.com/Example/Second-Skills.git";
    const unrelated = "git:https://github.com/SomeoneElse/Second-Skills.git";
    f.addPackage(first, "skills", "First instructions.", first);
    f.addPackage(second, "skills", "Second instructions.");
    await setupFounders({ ...f.options, sources: { skills: first } });
    put(f.profileFile, "My locally edited agent.\n");
    const settings = readJson(f.settingsFile);
    settings.packages.push(unrelated);
    putJson(f.settingsFile, settings);
    expect((await setupFounders({ ...f.options, sources: { skills: second } })).exitCode).toBe(2);
    expect(readJson(f.settingsFile).packages).toEqual([
      { source: second, skills: ["skills/general"], note: "keep filters" },
      f.sourceFor("btw"), "npm:pi-btw-unrelated", unrelated,
    ]);
    expect(readJson(f.receiptFile).sourcePreferences.skills).toBe(second);
    expect(fs.readFileSync(f.profileFile, "utf8")).toBe("My locally edited agent.\n");
    f.installs.length = 0;
    expect((await setupFounders(f.options)).exitCode).toBe(2);
    expect(f.installs).toEqual([]);
    expect(readJson(f.settingsFile).packages).toHaveLength(4);
    expect(fs.readFileSync(f.profileFile, "utf8")).toBe("My locally edited agent.\n");
  });

  test("dry-run, check and failed preparation do not save a new source choice", async () => {
    const f = fixture();
    await setupFounders(f.options);
    const next = "git:https://github.com/Example/Next-Skills.git";
    f.addPackage(next, "skills", "New instructions.");
    const settings = fs.readFileSync(f.settingsFile, "utf8");
    const receipt = fs.readFileSync(f.receiptFile, "utf8");
    const profile = fs.readFileSync(f.profileFile, "utf8");
    f.installs.length = 0;
    const changedSource = { ...f.options, sources: { skills: next } };
    expect((await setupFounders({ ...changedSource, dryRun: true })).exitCode).toBe(0);
    expect((await setupFounders({ ...changedSource, check: true })).exitCode).toBe(1);
    expect(f.installs).toEqual([]);
    f.setBeforeInstall((source) => { if (source === next) throw new Error("Fixture download failed"); });
    await expect(setupFounders(changedSource)).rejects.toThrow("Fixture download failed");
    expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(settings);
    expect(fs.readFileSync(f.receiptFile, "utf8")).toBe(receipt);
    expect(fs.readFileSync(f.profileFile, "utf8")).toBe(profile);
  });

  test("preserves manual pins until an explicit same-repository source change reconciles the cache", async () => {
    const f = fixture();
    const source = "git:https://github.com/Example/Pinned-Skills.git";
    f.addPackage(source, "skills");
    await setupFounders({ ...f.options, sources: { skills: source + "@v1" } });
    initializeCache(f.installed.get(sourceIdentity(source)!)!);
    const settings = readJson(f.settingsFile);
    settings.packages[0].source = source + "@my-manual-pin";
    putJson(f.settingsFile, settings);
    f.installs.length = 0;
    await setupFounders(f.options);
    expect(readJson(f.settingsFile).packages[0].source).toBe(source + "@my-manual-pin");
    expect(f.installs).toEqual([]);
    await setupFounders({ ...f.options, sources: { skills: source + "@v2" } });
    expect(f.installs).toEqual([source + "@v2"]);
    expect(readJson(f.settingsFile).packages[0]).toEqual({
      source: source + "@v2", skills: ["skills/general"], note: "keep filters",
    });
    expect(readJson(f.receiptFile).sourcePreferences.skills).toBe(source + "@v2");
  });

  test("reads legacy receipts and replaces the old planned BTW identity without duplicate packages", async () => {
    const f = fixture();
    putJson(f.receiptFile, { schemaVersion: 1, agents: {}, keepMetadata: true });
    const oldSkills = "git:git@github.com:mistrjirka/pitty-skills.git@my-pin";
    putJson(f.settingsFile, { packages: [oldSkills, "git:git@github.com:mistrjirka/pi-btw.git"] });
    await setupFounders(f.options);
    expect(readJson(f.settingsFile).packages).toEqual([oldSkills, f.sourceFor("btw")]);
    expect(readJson(f.receiptFile)).toMatchObject({
      schemaVersion: 1, keepMetadata: true,
      sourcePreferences: { skills: oldSkills, btw: f.sourceFor("btw") },
    });
  });

  test("preserves a source preference changed by another setup while downloading", async () => {
    const f = fixture();
    await setupFounders(f.options);
    const next = "git:https://github.com/Example/Next-Skills.git";
    const concurrent = "git:https://github.com/Example/Concurrent-Skills.git";
    f.addPackage(next, "skills");
    const settings = fs.readFileSync(f.settingsFile, "utf8");
    f.setBeforeInstall(() => {
      const receipt = readJson(f.receiptFile);
      receipt.sourcePreferences.skills = concurrent;
      putJson(f.receiptFile, receipt);
    });
    await expect(setupFounders({ ...f.options, sources: { skills: next } })).rejects.toThrow("source preferences changed during setup");
    expect(readJson(f.receiptFile).sourcePreferences.skills).toBe(concurrent);
    expect(fs.readFileSync(f.settingsFile, "utf8")).toBe(settings);
  });
});

describe("founders case-sensitive cache lookup", () => {
  test("check finds public repository paths using the same case as Pi's actual package manager", async () => {
    const f = fixture();
    const manager = new DefaultPackageManager({
      cwd: f.agentDir, agentDir: f.agentDir, settingsManager: SettingsManager.inMemory({}),
    });
    for (const entry of f.catalog) {
      const directory = path.join(f.agentDir, "git", "github.com", "mistrjirka", entry.id === "skills" ? "PiTTy-Skills" : "PiTTy-BTW");
      f.addPackage(entry.source, entry.id as "skills" | "btw", "Review implementation.", directory);
      f.installed.set(sourceIdentity(entry.source)!, directory);
      expect(manager.getInstalledPath(entry.source, "user")).toBe(directory);
      expect(githubSourcePath(entry.source + "@v1")).toBe("github.com/mistrjirka/" + path.basename(directory));
    }
    await setupFounders(f.options);
    const readOnlyOptions = { ...f.options, check: true };
    delete readOnlyOptions.packageManager;
    expect(await setupFounders(readOnlyOptions)).toEqual({ exitCode: 0, changed: false });
  });
});
