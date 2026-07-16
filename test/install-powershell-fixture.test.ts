import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

const root = path.resolve(import.meta.dir, "..");
const fixtures: string[] = [];
const run = (args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; output: string }> => new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { env, encoding: "utf8" }, (error, stdout, stderr) => resolve({ code: error?.code === undefined ? 0 : Number(error.code), output: `${stdout}${stderr}` })));
afterEach(async () => { await Promise.all(fixtures.splice(0).map((item) => rm(item, { recursive: true, force: true }))); });

describe("PowerShell installer executable fixture", () => {
  test.skipIf(process.platform !== "win32")("runs isolated staging, plugin, checksum, and rollback paths", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "pitty-powershell-fixture-")); fixtures.push(base);
    const payload = path.join(base, "payload"); const fake = path.join(base, "fake"); const install = path.join(base, "install dir"); const bin = path.join(base, "bin dir");
    await mkdir(path.join(payload, "bin"), { recursive: true }); await mkdir(path.join(payload, "node_modules", "bun"), { recursive: true }); await mkdir(fake); await mkdir(install);
    await writeFile(path.join(payload, "bin", "pitty.mjs"), "#!/usr/bin/env node\n"); await writeFile(path.join(payload, "package.json"), "{}\n"); await writeFile(path.join(payload, "old-marker"), "old"); await writeFile(path.join(payload, "node_modules", "bun", "install.js"), "\n"); await writeFile(path.join(install, "old-marker"), "old");
    await writeFile(path.join(fake, "node.cmd"), "@echo off\r\nif \"%1\"==\"-p\" echo 22.19.0\r\nif \"%2\"==\"--help\" if defined PITTY_FIXTURE_SMOKE_FAIL echo %1| findstr /L \".new\" >nul\r\nif \"%2\"==\"--help\" if defined PITTY_FIXTURE_SMOKE_FAIL if errorlevel 1 exit /b 1\r\nexit /b 0\r\n");
    await writeFile(path.join(fake, "npm.cmd"), "@echo off\r\nif not exist node_modules\\.bin mkdir node_modules\\.bin\r\necho @echo off>node_modules\\.bin\\bun.exe\r\n");
    await writeFile(path.join(fake, "pi.cmd"), "@echo off\r\nif \"%1\"==\"list\" echo pi-subagents & echo @juicesharp/rpiv-todo\r\n");
    const archive = path.join(base, "pitty-1.2.3.zip");
    const archiveLiteral = archive.replace(/'/g, "''"); const scriptLiteral = path.join(root, "install.ps1").replace(/'/g, "''");
    const wrapper = path.join(base, "wrapper.ps1");
    expect((await run(["-Command", `Compress-Archive -Path '${payload.replace(/'/g, "''")}' -DestinationPath '${archiveLiteral}' -Force`], process.env)).code).toBe(0);
    const archiveHash = createHash("sha256").update(await readFile(archive)).digest("hex");
    await writeFile(wrapper, `function Invoke-WebRequest { param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing) if ($Uri -like '*SHA256SUMS') { if ($env:PITTY_MISSING_CHECKSUM -eq '1') { return [pscustomobject]@{ Content = 'deadbeef  other.zip' } }; if ($env:PITTY_FAIL_CHECKSUM -eq '1') { throw 'checksum unavailable' }; return [pscustomobject]@{ Content = '${archiveHash}  pitty-1.2.3.zip' } } if ($OutFile) { Copy-Item '${archiveLiteral}' $OutFile } else { [pscustomobject]@{ Content = '' } } }\n& '${scriptLiteral}' @args\n`);
    const env: NodeJS.ProcessEnv = { ...process.env };
    env.Path = `${fake};${process.env.Path ?? process.env.PATH ?? ""}`;
    env.PATHEXT = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
    env.PITTY_LOG_DIR = path.join(base, "logs");
    delete env.PATH;
    const staged = await run(["-File", wrapper, "-DeferApply", "-Version", "1.2.3", "-InstallDir", install, "-BinDir", bin, "-Repo", "example/repo"], env);
    expect(staged.code, staged.output).toBe(0);
    const expectedMetadata = JSON.stringify({ schemaVersion: 1, repository: "example/repo", installedVersion: "1.2.3", installDirectory: install, binDirectory: bin, pluginMode: "ask" }) + "\n";
    expect(await readFile(path.join(`${install}.pending`, "pitty-install.json"), "utf8")).toBe(expectedMetadata);
    expect(await readFile(path.join(install, "old-marker"), "utf8")).toBe("old");
    const direct = await run(["-File", wrapper, "-Version", "1.2.3", "-InstallDir", install, "-BinDir", bin, "-Repo", "example/repo"], env);
    expect(direct.code, direct.output).toBe(0); expect(direct.output).toContain("already installed"); expect(direct.output).not.toContain("pi install");
    const failed = await run(["-File", wrapper, "-Version", "1.2.3", "-InstallDir", install, "-BinDir", bin, "-Repo", "example/repo"], { ...env, PITTY_FIXTURE_SMOKE_FAIL: "1" });
    expect(failed.code).not.toBe(0); expect(await readFile(path.join(install, "old-marker"), "utf8")).toBe("old"); expect(await readFile(`${install}.backup`, "utf8").catch(() => "")).toBe(""); expect(failed.output).toContain("previous installation was restored");
    const missing = await run(["-File", wrapper, "-DeferApply", "-Version", "1.2.3", "-InstallDir", install, "-BinDir", bin], { ...env, PITTY_MISSING_CHECKSUM: "1" });
    expect(missing.code).not.toBe(0); expect(missing.output).toContain("did not contain");
    const unavailable = await run(["-File", wrapper, "-DeferApply", "-Version", "1.2.3", "-InstallDir", install, "-BinDir", bin], { ...env, PITTY_FAIL_CHECKSUM: "1" });
    expect(unavailable.code).not.toBe(0); expect(unavailable.output).toContain("checksum");
  });
});
