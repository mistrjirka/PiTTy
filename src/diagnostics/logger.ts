import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

export type DiagnosticLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type DiagnosticLoggerOptions = {
  enabled?: boolean;
  directory?: string;
  verboseRpc?: boolean;
  retentionFiles?: number;
};

export type DiagnosticRecord = {
  ts: string;
  monoMs: number;
  level: DiagnosticLevel;
  event: string;
  pid: number;
  data?: unknown;
};

const SECRET_KEY = /(api[-_]?key|authorization|cookie|credential|password|secret|token)/i;
const MAX_STRING = 8_000;

function timestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
}

export function defaultDiagnosticsDirectory(): string {
  const stateHome = process.env.XDG_STATE_HOME?.trim();
  if (stateHome) return path.join(stateHome, "pitty");
  return path.join(os.homedir(), ".local", "state", "pitty");
}

function truncate(value: string, limit = MAX_STRING): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}… <${value.length - limit} chars omitted>`;
}

function sanitize(value: unknown, key = "", depth = 0): unknown {
  if (SECRET_KEY.test(key)) return "<redacted>";
  if (depth > 6) return "<depth-limit>";
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return truncate(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(value.message),
      stack: value.stack ? truncate(value.stack, 32_000) : undefined,
      cause: value.cause ? sanitize(value.cause, "cause", depth + 1) : undefined,
    };
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => sanitize(entry, key, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
      output[childKey] = sanitize(childValue, childKey, depth + 1);
    }
    return output;
  }
  return String(value);
}

function stringFingerprint(value: string): { chars: number; sha256: string } {
  return { chars: value.length, sha256: createHash("sha256").update(value).digest("hex").slice(0, 16) };
}

function contentSummary(value: unknown): unknown {
  if (typeof value === "string") return stringFingerprint(value);
  if (Array.isArray(value)) return { items: value.length };
  if (value && typeof value === "object") return { keys: Object.keys(value as Record<string, unknown>).slice(0, 30) };
  return value;
}

export class DiagnosticLogger {
  readonly enabled: boolean;
  readonly directory: string;
  readonly logPath: string;
  readonly verboseRpc: boolean;
  private readonly startedAt = performance.now();
  private readonly fd: number | undefined;
  private closed = false;

  constructor(options: DiagnosticLoggerOptions = {}) {
    this.enabled = options.enabled !== false;
    this.directory = options.directory ?? defaultDiagnosticsDirectory();
    this.verboseRpc = options.verboseRpc === true;
    this.logPath = path.join(this.directory, `run-${timestampForFilename()}-${process.pid}.jsonl`);

    if (!this.enabled) {
      this.fd = undefined;
      return;
    }

    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.rotate(options.retentionFiles ?? 20);
    this.fd = fs.openSync(this.logPath, "a", 0o600);
    fs.writeFileSync(path.join(this.directory, "latest-log-path.txt"), `${this.logPath}\n`, { mode: 0o600 });
  }

  debug(event: string, data?: unknown): void { this.write("debug", event, data); }
  info(event: string, data?: unknown): void { this.write("info", event, data); }
  warn(event: string, data?: unknown): void { this.write("warn", event, data); }
  error(event: string, data?: unknown): void { this.write("error", event, data); }
  fatal(event: string, data?: unknown): void { this.write("fatal", event, data, true); }

  rpc(direction: "tx" | "rx" | "event", value: unknown, extra?: Record<string, unknown>): void {
    if (!this.enabled) return;
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const type = typeof record.type === "string" ? record.type : "unknown";
    const id = typeof record.id === "string" ? record.id : undefined;
    const base: Record<string, unknown> = { direction, type, ...(id ? { id } : {}), ...extra };

    if (this.verboseRpc) {
      base.payload = sanitize(value);
    } else {
      base.keys = Object.keys(record).slice(0, 40);
      for (const field of ["message", "text", "content", "output", "result", "partialResult", "args"]) {
        if (field in record) base[`${field}Summary`] = contentSummary(record[field]);
      }
      if (typeof record.success === "boolean") base.success = record.success;
      if (typeof record.error === "string") base.error = truncate(record.error, 4_000);
      if (typeof record.toolName === "string") base.toolName = record.toolName;
      if (typeof record.toolCallId === "string") base.toolCallId = record.toolCallId;
      if (typeof record.method === "string") base.method = record.method;
    }
    this.debug("rpc", base);
  }

  crash(error: unknown, origin: string): string | undefined {
    if (!this.enabled) return undefined;
    const crashPath = path.join(this.directory, `crash-${timestampForFilename()}-${process.pid}.json`);
    const report = {
      createdAt: new Date().toISOString(),
      origin,
      error: sanitize(error),
      process: {
        pid: process.pid,
        ppid: process.ppid,
        uptimeSeconds: process.uptime(),
        argv: sanitizeArgv(process.argv),
        execPath: process.execPath,
        cwd: process.cwd(),
        platform: process.platform,
        arch: process.arch,
        versions: process.versions,
        memoryUsage: process.memoryUsage(),
      },
      terminal: {
        term: process.env.TERM,
        colorterm: process.env.COLORTERM,
        tmux: Boolean(process.env.TMUX),
        ssh: Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY),
      },
      logPath: this.logPath,
    };
    try {
      fs.writeFileSync(crashPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      fs.writeFileSync(path.join(this.directory, "latest-crash-path.txt"), `${crashPath}\n`, { mode: 0o600 });
      this.fatal("process.crash", { origin, crashPath, error });
      return crashPath;
    } catch {
      return undefined;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.fd !== undefined) {
      try { fs.fsyncSync(this.fd); } catch {}
      try { fs.closeSync(this.fd); } catch {}
    }
  }

  private write(level: DiagnosticLevel, event: string, data?: unknown, sync = false): void {
    if (!this.enabled || this.closed || this.fd === undefined) return;
    const record: DiagnosticRecord = {
      ts: new Date().toISOString(),
      monoMs: Math.round(performance.now() - this.startedAt),
      level,
      event,
      pid: process.pid,
      ...(data === undefined ? {} : { data: sanitize(data) }),
    };
    try {
      fs.writeSync(this.fd, `${JSON.stringify(record)}\n`);
      if (sync) fs.fsyncSync(this.fd);
    } catch {
      // Diagnostics must never crash the UI.
    }
  }

  private rotate(retentionFiles: number): void {
    try {
      const candidates = fs.readdirSync(this.directory)
        .filter((name) => /^(run-.*\.jsonl|crash-.*\.json|diagnostics-.*\.tar\.gz)$/.test(name))
        .map((name) => {
          const target = path.join(this.directory, name);
          return { target, mtime: fs.statSync(target).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      for (const stale of candidates.slice(Math.max(5, retentionFiles))) {
        try { fs.rmSync(stale.target, { force: true }); } catch {}
      }
    } catch {}
  }
}

export function sanitizeArgv(argv: readonly string[]): string[] {
  const output: string[] = [];
  const safeValueFlags = new Set(["-C", "--cwd", "--pi", "--session", "-m", "--model", "--provider", "--thinking", "--log-dir"]);
  let preserveNext = false;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index] ?? "";
    if (index < 2) {
      output.push(truncate(value, 1_000));
      continue;
    }
    if (preserveNext) {
      output.push(truncate(value, 1_000));
      preserveNext = false;
      continue;
    }
    if (/--?(api[-_]?key|token|password|secret|authorization)$/i.test(value)) {
      output.push(value, "<redacted>");
      index += 1;
      continue;
    }
    if (value.startsWith("-")) {
      const equals = value.indexOf("=");
      if (equals >= 0) {
        const flag = value.slice(0, equals);
        const rawValue = value.slice(equals + 1);
        output.push(safeValueFlags.has(flag) ? `${flag}=${truncate(rawValue, 1_000)}` : `${flag}=<${stringFingerprint(rawValue).chars} chars:${stringFingerprint(rawValue).sha256}>`);
      } else {
        output.push(truncate(value, 1_000));
        preserveNext = safeValueFlags.has(value);
      }
      continue;
    }
    const fingerprint = stringFingerprint(value);
    output.push(`<positional ${fingerprint.chars} chars:${fingerprint.sha256}>`);
  }
  return output;
}

export function summarizePiArgs(argv: readonly string[]): { count: number; flags: string[]; positionals: Array<{ chars: number; sha256: string }> } {
  const flags: string[] = [];
  const positionals: Array<{ chars: number; sha256: string }> = [];
  const valueFlags = new Set(["-C", "--cwd", "--pi", "--session", "-m", "--model", "--provider", "--thinking"]);
  let skipValue = false;
  for (const value of argv) {
    if (skipValue) {
      skipValue = false;
      continue;
    }
    if (value.startsWith("-")) {
      flags.push(value.includes("=") ? value.slice(0, value.indexOf("=")) : value);
      skipValue = !value.includes("=") && valueFlags.has(value);
    } else {
      positionals.push(stringFingerprint(value));
    }
  }
  return { count: argv.length, flags, positionals };
}

export function installProcessDiagnostics(
  logger: DiagnosticLogger,
  onFatal?: (error: unknown, origin: string, crashPath?: string) => void,
): () => void {
  let fatalInProgress = false;
  const fatal = (error: unknown, origin: string) => {
    if (fatalInProgress) return;
    fatalInProgress = true;
    const crashPath = logger.crash(error, origin);
    try { onFatal?.(error, origin, crashPath); } catch {}
    setTimeout(() => process.exit(1), 40).unref?.();
  };
  const uncaught = (error: Error) => fatal(error, "uncaughtException");
  const rejection = (reason: unknown) => fatal(reason, "unhandledRejection");
  const warning = (value: Error) => logger.warn("process.warning", value);
  const beforeExit = (code: number) => logger.info("process.beforeExit", { code });
  const exit = (code: number) => {
    logger.info("process.exit", { code, memoryUsage: process.memoryUsage(), uptimeSeconds: process.uptime() });
    logger.close();
  };
  process.on("uncaughtException", uncaught);
  process.on("unhandledRejection", rejection);
  process.on("warning", warning);
  process.on("beforeExit", beforeExit);
  process.on("exit", exit);
  return () => {
    process.off("uncaughtException", uncaught);
    process.off("unhandledRejection", rejection);
    process.off("warning", warning);
    process.off("beforeExit", beforeExit);
    process.off("exit", exit);
  };
}
