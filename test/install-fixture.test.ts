import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

const root = path.resolve(import.meta.dir, "..");
const fixtures: string[] = [];
function shell(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => execFile(command, args, { env, encoding: "utf8" }, (error, stdout, stderr) => resolve({ code: error?.code === undefined ? 0 : Number(error.code), output: `${stdout}${stderr}` })));
}
afterEach(async () => { await Promise.all(fixtures.splice(0).map((item) => rm(item, { recursive: true, force: true }))); });

describe("POSIX installer executable fixture", () => {
  test.skipIf(process.platform === "win32")("stages into a spaced path, writes exact metadata, and skips installed plugin prompt", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "pitty-install-fixture-")); fixtures.push(base);
    const archiveRoot = path.join(base, "payload");
    await mkdir(path.join(archiveRoot, "bin", "node_modules"), { recursive: true });
    await mkdir(path.join(archiveRoot, "node_modules", "bun"), { recursive: true });
    await writeFile(path.join(archiveRoot, "bin", "pitty.mjs"), "#!/usr/bin/env node\n");
    await writeFile(path.join(archiveRoot, "package.json"), "{}\n");
    await writeFile(path.join(archiveRoot, "old-marker"), "old");
    await writeFile(path.join(archiveRoot, "node_modules", "bun", "install.js"), "\n");
    const archive = path.join(base, "pitty-1.2.3.tar.gz");
    const tar = await shell("tar", ["-czf", archive, "-C", base, "payload"], process.env);
    expect(tar.code).toBe(0);
    const fake = path.join(base, "fake"); await mkdir(fake);
    await writeFile(path.join(fake, "curl"), `#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; out="$1"; fi; shift; done\nif [ "\${PITTY_FAIL_CHECKSUM:-}" = 1 ] && printf '%s' "$out" | grep SHA256SUMS >/dev/null; then exit 1; fi
if [ "\${PITTY_MISSING_CHECKSUM:-}" = 1 ] && printf '%s' "$out" | grep SHA256SUMS >/dev/null; then printf 'deadbeef  other.tar.gz\\n' > "$out"; exit 0; fi\ncase "$out" in *release.json) printf '{"tag_name":"v1.2.3"}' > "$out" ;; *SHA256SUMS) sha256sum "$PITTY_FIXTURE_ARCHIVE" | sed 's#  .*#  pitty-1.2.3.tar.gz#' > "$out" ;; *) cp "$PITTY_FIXTURE_ARCHIVE" "$out" ;; esac\n`);
    await writeFile(path.join(fake, "npm"), "#!/bin/sh\nmkdir -p node_modules/.bin; printf '#!/bin/sh\n' > node_modules/.bin/bun; chmod +x node_modules/.bin/bun\n");
    await writeFile(path.join(fake, "pi"), "#!/bin/sh\nif [ \"$1\" = list ]; then printf 'pi-subagents\\n@juicesharp/rpiv-todo\\n'; fi\n");
    for (const command of ["curl", "npm", "pi"]) await chmod(path.join(fake, command), 0o755);
    const install = path.join(base, "install dir"); const bin = path.join(base, "bin dir");
    await mkdir(install, { recursive: true }); await writeFile(path.join(install, "old-marker"), "old");
    const result = await shell("sh", [path.join(root, "install.sh"), "--defer-apply", "--version", "1.2.3", "--install-dir", install, "--bin-dir", bin, "--repo", "example/repo"], { ...process.env, PATH: `${fake}:${process.env.PATH}`, PITTY_FIXTURE_ARCHIVE: archive });
    expect(result.code).toBe(0);
    expect(await readFile(path.join(`${install}.pending`, "pitty-install.json"), "utf8")).toBe(JSON.stringify({ schemaVersion: 1, repository: "example/repo", installedVersion: "1.2.3", installDirectory: install, binDirectory: bin, pluginMode: "ask" }) + "\n");
    expect(await readFile(path.join(install, "old-marker"), "utf8")).toBe("old");
    expect(result.output).toContain("staged");
    const direct = await shell("sh", [path.join(root, "install.sh"), "--version", "1.2.3", "--install-dir", install, "--bin-dir", bin, "--repo", "example/repo"], { ...process.env, PATH: `${fake}:${process.env.PATH}`, PITTY_FIXTURE_ARCHIVE: archive });
    expect(direct.code).toBe(0);
    expect(direct.output).toContain("skipping plugin prompt");
    expect(direct.output).not.toContain("pi install");

    const badRoot = path.join(base, "bad-payload");
    await mkdir(path.join(badRoot, "bin"), { recursive: true });
    await mkdir(path.join(badRoot, "node_modules", "bun"), { recursive: true });
    await writeFile(path.join(badRoot, "bin", "pitty.mjs"), "#!/usr/bin/env node\nthrow new Error('fixture smoke failure');\n");
    await writeFile(path.join(badRoot, "package.json"), "{}\n");
    await writeFile(path.join(badRoot, "node_modules", "bun", "install.js"), "\n");
    const badArchive = path.join(base, "bad.tar.gz");
    expect((await shell("tar", ["-czf", badArchive, "-C", base, "bad-payload"], process.env)).code).toBe(0);
    const failed = await shell("sh", [path.join(root, "install.sh"), "--version", "1.2.3", "--install-dir", install, "--bin-dir", bin, "--repo", "example/repo"], { ...process.env, PATH: `${fake}:${process.env.PATH}`, PITTY_FIXTURE_ARCHIVE: badArchive, PITTY_WITHOUT_PLUGINS: "1" });
    expect(failed.code).not.toBe(0);
    expect(await readFile(path.join(install, "old-marker"), "utf8")).toBe("old");
    expect(await readFile(`${install}.backup`, "utf8").catch(() => "")).toBe("");
    expect(failed.output).toContain("previous installation was restored");
    const checksumFailure = await shell("sh", [path.join(root, "install.sh"), "--defer-apply", "--version", "1.2.3", "--install-dir", install, "--bin-dir", bin, "--repo", "example/repo"], { ...process.env, PATH: `${fake}:${process.env.PATH}`, PITTY_FIXTURE_ARCHIVE: archive, PITTY_FAIL_CHECKSUM: "1" });
    expect(checksumFailure.code).not.toBe(0);
    expect(checksumFailure.output).toContain("checksums were unavailable");
    const missingEntry = await shell("sh", [path.join(root, "install.sh"), "--defer-apply", "--version", "1.2.3", "--install-dir", install, "--bin-dir", bin, "--repo", "example/repo"], { ...process.env, PATH: `${fake}:${process.env.PATH}`, PITTY_FIXTURE_ARCHIVE: archive, PITTY_MISSING_CHECKSUM: "1" });
    expect(missingEntry.code).not.toBe(0);
    expect(missingEntry.output).toContain("did not contain");
  });
});
