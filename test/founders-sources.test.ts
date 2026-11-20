import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { foundersCatalog } from "../scripts/founders-catalog.mjs";
import { githubSourcePath, hash, sourceIdentity } from "../scripts/founders-state.mjs";
import { setupFounders, type FoundersOptions } from "../scripts/founders-setup.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const putJson = (file: string, value: unknown) => put(file, JSON.stringify(value, null, 2) + "\n");
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-founder-sources-"));
  roots.push(base);
  const agentDir = path.join(base, "agent");
  const settingsFile = path.join(agentDir, "settings.json");
  const receiptFile = path.join(agentDir, "pitty-founders.json");
  const profileFile = path.join(agentDir, "agents", "implementation-review.md");
  const catalog = foundersCatalog().filter((entry) => entry.id === "skills" || entry.id === "btw");
  const sourceFor = (id: string) => catalog.find((entry) => entry.id === id)!.source;
  const available = new Map<string, string>();
  const installed = new Map<string, string>();
  const installs: string[] = [];
  let beforeInstall = (_source: string) => {};
  const addPackage = (source: string, id: "skills" | "btw", body = "Review implementation.", directory?: string) => {
    const root = directory ?? path.join(base, "packages", String(available.size));
    putJson(path.join(root, "package.json"), { name: id === "skills" ? "@mistrjirka/pitty-skills" : "@mistrjirka/pi-btw" });
    if (id === "btw") put(path.join(root, "index.ts"), "export default () => {};\n");
    else {
      const content = "---\nname: implementation-review\ndescription: Review changes\n---\n" + body + "\n";
      put(path.join(root, "agents", "implementation-review.md"), content);
      put(path.join(root, "skills", "general", "SKILL.md"), "---\nname: general\ndescription: General work\n---\nSkill.\n");
      putJson(path.join(root, "manifest.json"), {
        schemaVersion: 1, skills: [{ name: "general", path: "skills/general" }],
        agents: [{ name: "implementation-review", path: "agents/implementation-review.md", sha256: hash(content) }],
      });
    }
    available.set(sourceIdentity(source, agentDir)!, root);
    return root;
  };
  for (const entry of catalog) addPackage(entry.source, entry.id as "skills" | "btw");
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
    packageManager: manager, runtimeReady: () => true, ensureRuntime: () => ({ status: "ready" }), log: () => {},
  };
  return {
    base, agentDir, settingsFile, receiptFile, profileFile, catalog, sourceFor, addPackage, installed, installs, options,
    setBeforeInstall(callback: (source: string) => void) { beforeInstall = callback; },
  };
}

describe("founders source preferences", () => {
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
