import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
