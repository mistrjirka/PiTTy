import { afterEach, describe, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

const launcher = path.resolve(import.meta.dir, "../bin/pitty.mjs");
const temporary: string[] = [];
async function runNode(file: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ code: number; output: string }> {
  return await new Promise((resolve) => execFile("node", [file, ...args], { encoding: "utf8", env }, (error, stdout, stderr) => resolve({ code: error?.code === undefined ? 0 : Number(error.code), output: `${stdout}${stderr}` })));
}
async function installRoot(base: string, name: string, marker: string, valid: boolean): Promise<string> {
  const root = path.join(base, name);
  await mkdir(path.join(root, "bin"), { recursive: true });
  await mkdir(path.join(root, "node_modules", ".bin"), { recursive: true });
  await cp(launcher, path.join(root, "bin", "pitty.mjs"));
  await writeFile(path.join(root, "marker"), marker);
  if (valid) {
    const bun = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "bun.exe" : "bun");
    await cp(process.execPath, bun);
    if (process.platform !== "win32") await chmod(bun, 0o755);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.tsx"), "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.PITTY_FIXTURE_MARKER!, 'new');\n");
  }
  return root;
}
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("launcher pending activation fixture", () => {
  test("promotes pending and runs Bun from the new root", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "pitty-launcher-")); temporary.push(base);
    const root = await installRoot(base, "app", "old", true);
    const pending = await installRoot(base, "pending", "new", true);
    await cp(pending, `${root}.pending`, { recursive: true });
    await rm(pending, { recursive: true, force: true });
    const marker = path.join(base, "ran");
    const result = await runNode(path.join(root, "bin", "pitty.mjs"), [], { ...process.env, PITTY_FIXTURE_MARKER: marker });
    expect(result.code).toBe(0);
    expect(await readFile(marker, "utf8")).toBe("new");
    expect(await readFile(`${root}/marker`, "utf8")).toBe("new");
  });

  test("rejects invalid pending and preserves the old root", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "pitty-launcher-")); temporary.push(base);
    const root = await installRoot(base, "app", "old", true);
    const pending = await installRoot(base, "pending", "new", false);
    await rm(`${root}.pending`, { recursive: true, force: true }).catch(() => undefined);
    await cp(pending, `${root}.pending`, { recursive: true });
    await rm(pending, { recursive: true, force: true });
    const result = await runNode(path.join(root, "bin", "pitty.mjs"), []);
    expect(result.code).not.toBe(0);
    expect(await readFile(path.join(root, "marker"), "utf8")).toBe("old");
  });
});
