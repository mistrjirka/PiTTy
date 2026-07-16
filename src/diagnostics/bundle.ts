import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { defaultDiagnosticsDirectory, sanitizeArgv } from "./logger.ts";
import { resolveDefaultPiExecutable, resolvePiCommand } from "../pi-command.ts";

export type DiagnosticBundleOptions = {
  logDirectory?: string;
  outputDirectory?: string;
  maxFiles?: number;
};

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
}

function commandVersion(command: string, args = ["--version"]): string | undefined {
  try {
    const resolved = resolvePiCommand(command, args);
    const result = spawnSync(resolved.executable, resolved.args, { encoding: "utf8", timeout: 5_000 });
    const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    return text ? text.slice(0, 2_000) : undefined;
  } catch {
    return undefined;
  }
}

export function createDiagnosticBundle(options: DiagnosticBundleOptions = {}): string {
  const logDirectory = options.logDirectory ?? defaultDiagnosticsDirectory();
  const outputDirectory = options.outputDirectory ?? logDirectory;
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const name = `diagnostics-${stamp()}-${process.pid}`;
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const archive = path.join(outputDirectory, `${name}.tar.gz`);

  try {
    const files = (() => {
      try {
        return fs.readdirSync(logDirectory)
          .filter((entry) => /^(run-.*\.jsonl|crash-.*\.json|latest-.*\.txt)$/.test(entry))
          .map((entry) => ({ entry, mtime: fs.statSync(path.join(logDirectory, entry)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, options.maxFiles ?? 12);
      } catch {
        return [];
      }
    })();

    const logsDir = path.join(staging, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    for (const file of files) {
      fs.copyFileSync(path.join(logDirectory, file.entry), path.join(logsDir, file.entry));
    }

    const system = {
      createdAt: new Date().toISOString(),
      process: {
        argv: sanitizeArgv(process.argv),
        cwd: process.cwd(),
        execPath: process.execPath,
        pid: process.pid,
        platform: process.platform,
        arch: process.arch,
        versions: process.versions,
        uptimeSeconds: process.uptime(),
        memoryUsage: process.memoryUsage(),
      },
      os: {
        type: os.type(),
        release: os.release(),
        version: os.version(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
      },
      terminal: {
        term: process.env.TERM,
        colorterm: process.env.COLORTERM,
        tmux: Boolean(process.env.TMUX),
        screen: Boolean(process.env.STY),
        ssh: Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY),
        wayland: Boolean(process.env.WAYLAND_DISPLAY),
        x11: Boolean(process.env.DISPLAY),
      },
      versions: {
        pi: commandVersion(resolveDefaultPiExecutable()),
        bun: commandVersion("bun"),
        node: commandVersion("node"),
      },
      notes: [
        "RPC prompt/tool contents are omitted from normal logs.",
        "Absolute paths and usernames may still appear in errors and system metadata; review before sharing.",
      ],
    };
    fs.writeFileSync(path.join(staging, "system.json"), `${JSON.stringify(system, null, 2)}\n`, { mode: 0o600 });

    const readme = [
      "PiTTy diagnostics bundle",
      "",
      "This bundle intentionally excludes ~/.pi/agent/auth.json, session transcripts, source files, and environment variables.",
      "Normal RPC logs store event metadata and content lengths/hashes, not prompt or tool contents.",
      "Absolute paths and usernames can still occur in stack traces. Review before sharing.",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(staging, "README.txt"), readme, { mode: 0o600 });

    const tar = spawnSync("tar", ["-czf", archive, "-C", staging, "."], { encoding: "utf8" });
    if (tar.status !== 0) throw new Error(`tar failed: ${(tar.stderr || tar.stdout || "unknown error").trim()}`);
    fs.chmodSync(archive, 0o600);
    return archive;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
