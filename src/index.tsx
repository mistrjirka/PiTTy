#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { parseArgs } from "node:util";
import { App } from "./app.tsx";
import { DiagnosticLogger, installProcessDiagnostics, sanitizeArgv, summarizePiArgs } from "./diagnostics/logger.ts";
import { colors } from "./ui/theme.ts";
import { registerBundledParsers } from "./ui/parsers.ts";
import { detectOptionalIntegrations } from "./integrations/detect.ts";

registerBundledParsers();

const appVersion = "0.3.0";

const parsed = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    cwd: { type: "string", short: "C" },
    pi: { type: "string" },
    continue: { type: "boolean", short: "c" },
    session: { type: "string" },
    model: { type: "string", short: "m" },
    provider: { type: "string" },
    thinking: { type: "string" },
    "no-sidebar": { type: "boolean" },
    "log-dir": { type: "string" },
    "no-logs": { type: "boolean" },
    "verbose-rpc-logs": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (parsed.values.help) {
  process.stdout.write(`PiTTy ${appVersion}\n\nUsage: pitty [options] [-- extra Pi args]\n\n  -C, --cwd <dir>       Working directory\n  -c, --continue        Continue recent Pi session\n      --session <path>  Open a Pi session file\n  -m, --model <id>      Pi model id\n      --provider <id>   Pi provider\n      --thinking <lvl>  off|minimal|low|medium|high|xhigh\n      --pi <path>       Pi executable (default: pi)\n      --no-sidebar      Hide the right sidebar initially\n      --log-dir <dir>   Diagnostic log directory\n      --no-logs         Disable file diagnostics\n      --verbose-rpc-logs Include RPC contents (may contain source/prompts)\n`);
  process.exit(0);
}

const piArgs: string[] = [];
if (parsed.values.continue) piArgs.push("--continue");
if (typeof parsed.values.session === "string") piArgs.push("--session", parsed.values.session);
if (typeof parsed.values.model === "string") piArgs.push("--model", parsed.values.model);
if (typeof parsed.values.provider === "string") piArgs.push("--provider", parsed.values.provider);
if (typeof parsed.values.thinking === "string") piArgs.push("--thinking", parsed.values.thinking);
piArgs.push(...parsed.positionals);

const logger = new DiagnosticLogger({
  enabled: !parsed.values["no-logs"],
  ...(typeof parsed.values["log-dir"] === "string" ? { directory: parsed.values["log-dir"] } : {}),
  verboseRpc: parsed.values["verbose-rpc-logs"] === true,
});
let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
const removeProcessDiagnostics = installProcessDiagnostics(logger, (error, origin, crashPath) => {
  try { renderer?.destroy(); } catch {}
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  process.stderr.write(`\nPiTTy crashed (${origin}): ${detail}\n`);
  if (crashPath) process.stderr.write(`Crash report: ${crashPath}\n`);
  if (logger.enabled) process.stderr.write(`Run log: ${logger.logPath}\n`);
});

const integrationStatus = detectOptionalIntegrations({
  piExecutable: typeof parsed.values.pi === "string" ? parsed.values.pi : "pi",
  cwd: typeof parsed.values.cwd === "string" ? parsed.values.cwd : process.cwd(),
});

logger.info("app.start", {
  argv: sanitizeArgv(process.argv),
  cwd: typeof parsed.values.cwd === "string" ? parsed.values.cwd : process.cwd(),
  piArgs: summarizePiArgs(piArgs),
  sidebar: !parsed.values["no-sidebar"],
  verboseRpcLogs: logger.verboseRpc,
  versions: process.versions,
  platform: process.platform,
  arch: process.arch,
  integrations: integrationStatus,
});

try {
  renderer = await createCliRenderer({
    targetFps: 45,
    maxFps: 60,
    exitOnCtrlC: false,
    clearOnShutdown: true,
    useMouse: true,
    enableMouseMovement: true,
    autoFocus: true,
    useKittyKeyboard: {},
    screenMode: "alternate-screen",
    externalOutputMode: "passthrough",
    backgroundColor: colors.background,
    openConsoleOnError: false,
  });
  logger.info("renderer.created");

  const rendererDestroyed = new Promise<void>((resolve) => renderer!.once("destroy", resolve));
  await render(
    () => (
      <App
        cwd={typeof parsed.values.cwd === "string" ? parsed.values.cwd : process.cwd()}
        {...(typeof parsed.values.pi === "string" ? { piExecutable: parsed.values.pi } : {})}
        piArgs={piArgs}
        sidebar={!parsed.values["no-sidebar"]}
        logger={logger}
        integrations={integrationStatus}
      />
    ),
    renderer,
  );
  logger.info("renderer.mounted");
  await rendererDestroyed;
  logger.info("renderer.stopped");
} catch (error) {
  const crashPath = logger.crash(error, "topLevel");
  try { renderer?.destroy(); } catch {}
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  process.stderr.write(`\nPiTTy failed: ${detail}\n`);
  if (crashPath) process.stderr.write(`Crash report: ${crashPath}\n`);
  if (logger.enabled) process.stderr.write(`Run log: ${logger.logPath}\n`);
  process.exitCode = 1;
} finally {
  removeProcessDiagnostics();
  logger.close();
}
