import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { refreshInstalledFounders, refreshableFoundersPackages, parseFoundersArgs } from "../scripts/founders-setup.mjs";
import { foundersCatalog } from "../scripts/founders-catalog.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

test("refresh selects exact maintained sources, not pins, forks, duplicates or local packages", () => {
  const settings = { packages: [
    "git:github.com/mistrjirka/pi-subagent@release",
    "git:https://github.com/mistrjirka/PiTTy-BTW.git",
    { source: "npm:pi-web-access", extensions: [] },
    "npm:pi-diet-semble@1.2.3",
    "npm:pi-bg-bash", "npm:pi-bg-bash",
    "npm:pi-code-tool",
    "git:github.com/other/pi-eigen-memory",
    "/local/checkout",
  ] };
  expect(refreshableFoundersPackages(settings).map(entry => entry.id)).toEqual(["btw", "web"]);
  expect(parseFoundersArgs(["--refresh-installed", "--dry-run"]).refreshInstalled).toBe(true);
  expect(() => parseFoundersArgs(["--refresh-installed", "--check"])).toThrow();
});

test("refresh updates only installed unpinned entries and leaves settings unchanged", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-refresh-"));
  roots.push(root);
  const settings = { packages: [{ source: "npm:pi-web-access", extensions: [] }, "npm:pi-bg-bash", "npm:pi-diet-semble@1.2.3"] };
  const original = JSON.stringify(settings);
  fs.writeFileSync(path.join(root, "settings.json"), original);
  const dir = path.join(root, "web");
  fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "pi-web-access", version: "1.0.0" }));
  const calls: string[] = [];
  const result = await refreshInstalledFounders({
    agentDir: root, catalog: foundersCatalog(), log: () => {},
    packageManager: {
      getInstalledPath: (source) => source === "npm:pi-web-access" ? dir : undefined,
      install: async (source) => { calls.push(source); },
    },
  });
  expect(result).toEqual({ exitCode: 0, changed: true });
  expect(calls).toEqual(["npm:pi-web-access"]);
  expect(fs.readFileSync(path.join(root, "settings.json"), "utf8")).toBe(original);
});

test("refresh permits npm-only lockfile bookkeeping but protects dependency and staged changes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-lock-refresh-"));
  roots.push(root);
  const entry = foundersCatalog().find(candidate => candidate.id === "memory")!;
  const directory = path.join(root, "cache");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ packages: [entry.source] }));
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: entry.names[0], version: entry.minimumVersion?.version ?? entry.version ?? "1.0.0" }));
  for (const file of entry.files) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), "");
  }
  const original = { lockfileVersion: 3, packages: { "": { name: entry.names[0] }, "node_modules/dependency": { version: "1.0.0", integrity: "sha512-original", hasShrinkwrap: true } } };
  const lock = path.join(directory, "package-lock.json");
  const write = (value: unknown) => fs.writeFileSync(lock, JSON.stringify(value));
  write(original);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "Initial cache");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  const calls: string[] = [];
  const refresh = () => refreshInstalledFounders({
    agentDir: root, catalog: [entry], log: () => {},
    packageManager: {
      getInstalledPath: () => directory,
      install: async source => { calls.push(source); },
    },
  });
  const generated = { ...original, packages: { ...original.packages, "node_modules/dependency": { version: "1.0.0", integrity: "sha512-original", dev: true, devOptional: true } } };
  write(generated);
  expect((await refresh()).exitCode).toBe(0);
  expect(calls).toEqual([entry.source]);
  git("add", "package-lock.json");
  expect((await refresh()).exitCode).toBe(1);
  git("reset", "-q", "HEAD", "package-lock.json");
  write({ ...generated, packages: { ...generated.packages, "node_modules/dependency": { ...generated.packages["node_modules/dependency"], integrity: "sha512-changed" } } });
  expect((await refresh()).exitCode).toBe(1);
  write({ ...generated, packages: { ...generated.packages, "node_modules/dependency": { ...generated.packages["node_modules/dependency"], version: "2.0.0" } } });
  expect((await refresh()).exitCode).toBe(1);
  expect(calls).toEqual([entry.source]);
});


test("explicit optional-only refresh previews, applies and preserves settings without a downloader", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-optional-refresh-"));
  roots.push(root);
  const settings = JSON.stringify({ packages: ["npm:@vndv/pi-codegraph"] });
  fs.writeFileSync(path.join(root, "settings.json"), settings);
  const directory = path.join(root, "npm", "node_modules", "@vndv", "pi-codegraph");
  fs.mkdirSync(path.join(directory, "extensions"), { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "@vndv/pi-codegraph", version: "0.1.11" }));
  const file = path.join(directory, "extensions", "codegraph.ts");
  const source = [
    '  pi.on("before_agent_start", async (event) => {',
    '      "Use codegraph_explore for broad flows, codegraph_search for symbol names, codegraph_files for project structure, codegraph_node for known symbols, and codegraph_callers for call relationships.",',
    '  });',
    '      promptGuidelines: [',
    '        `${tool.name} is available for structural code questions backed by the local CodeGraph index.`,',
    '      ],',
  ].join("\n");
  fs.writeFileSync(file, source);
  const logs: string[] = [];
  const options = { agentDir: root, appRoot: path.join(root, "absent-app"), catalog: [], env: {PATH: ""}, log: (line: string) => logs.push(line) };
  expect(await refreshInstalledFounders({ ...options, dryRun: true })).toEqual({ exitCode: 0, changed: false });
  expect(fs.readFileSync(file, "utf8")).toBe(source);
  expect(logs).toContain("Would compact CodeGraph prompt guidance.");
  expect(await refreshInstalledFounders(options)).toEqual({ exitCode: 0, changed: true });
  expect(fs.readFileSync(file, "utf8")).toContain("PiTTy: describe only tools active");
  expect(fs.readFileSync(path.join(root, "settings.json"), "utf8")).toBe(settings);
  fs.writeFileSync(path.join(directory, "package.json"), "{broken");
  expect(await refreshInstalledFounders(options)).toEqual({ exitCode: 0, changed: false });
  expect(logs.some(line => line.includes("Skipped optional CodeGraph prompt update:"))).toBe(true);
});
