import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { foundersCatalog } from "../scripts/founders-catalog.mjs";
import { packageReady } from "../scripts/founders-setup.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

test.each([
  ["skills", "0.1.0", false],
  ["skills", "0.2.0-rc.1", false],
  ["skills", "0.2.0", true],
  ["skills", "0.2.0+local", true],
  ["skills", "0.3.0", true],
  ["skills", "invalid", false],
  ["subagents", "0.5.25", false],
  ["subagents", "0.5.26", false],
  ["subagents", "0.5.27", false],
  ["subagents", "0.5.28", false],
  ["subagents", "0.5.29-rc.1", false],
  ["subagents", "0.5.29", true],
  ["subagents", "0.6.0", true],
] as const)("maintained %s package version %s", (id, version, expected) => {
  const entry = foundersCatalog().find((candidate) => candidate.id === id)!;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-package-readiness-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: entry.names[0], version }));
  for (const file of entry.files) fs.writeFileSync(path.join(root, file), "{}");
  expect(packageReady(entry, root)).toBe(expected);
  // Case and transport aliases identify the same maintained package.
  const repository = id === "skills" ? "PiTTy-Skills" : "pi-subagent";
  const source = "git:git@github.com:MISTRJIRKA/" + repository + ".git";
  expect(packageReady({ ...entry, source }, root)).toBe(expected);
  // A deliberate Git ref can retain its older compatible API and content.
  expect(packageReady({ ...entry, source: source + "@custom/older" }, root)).toBe(true);
});
