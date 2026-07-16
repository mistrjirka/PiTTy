import * as fs from "node:fs/promises";
import * as path from "node:path";
import { defaultDiagnosticsDirectory } from "../diagnostics/logger.ts";

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REPOSITORY = "mistrjirka/PiTTy";
const DEFAULT_TIMEOUT_MS = 5_000;

export type UpdateEnvironment = Readonly<Record<string, string | undefined>>;
export type UpdateLogger = Pick<Console, "info" | "warn">;
export type UpdateFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type UpdateCheckConfig = {
  fetch: UpdateFetch;
  now: () => number;
  cachePath: string;
  repository: string;
  localVersion: string;
  environment: UpdateEnvironment;
  timeoutMs?: number;
  logger: UpdateLogger;
  onNewerRelease: (version: string) => void;
};

type UpdateCache = {
  checkedAt: number;
  outcome: "success" | "failure";
  version?: string;
};

type ReleasePayload = {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
};

export type StableRelease = { version: string; tag: string };

export async function fetchLatestStableRelease(repository = DEFAULT_REPOSITORY, fetcher: UpdateFetch = fetch, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<StableRelease> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`https://api.github.com/repos/${repository}/releases/latest`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "PiTTy upgrade" }, signal: controller.signal });
    if (!response.ok) throw new Error(`GitHub responded with HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!isReleasePayload(payload) || payload.draft === true || payload.prerelease === true) throw new Error("GitHub returned an invalid stable release payload");
    compareStableVersions(payload.tag_name, payload.tag_name);
    return { version: payload.tag_name.replace(/^v/, ""), tag: payload.tag_name };
  } finally { clearTimeout(timeout); }
}

export function compareStableVersions(left: string, right: string): -1 | 0 | 1 {
  const parse = (value: string): [number, number, number] => {
    const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
    if (!match) throw new Error(`Malformed stable version: ${value}`);
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const a = parse(left);
  const b = parse(right);
  for (const [leftPart, rightPart] of [[a[0], b[0]], [a[1], b[1]], [a[2], b[2]]] as const) {
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

export function isUpdateCheckDisabled(environment: UpdateEnvironment): boolean {
  return environment.PITTY_NO_UPDATE_CHECK === "1";
}

function isUpdateCache(value: unknown): value is UpdateCache {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.checkedAt === "number"
    && Number.isFinite(record.checkedAt)
    && (record.outcome === "success" || record.outcome === "failure")
    && (record.version === undefined || typeof record.version === "string");
}

function isReleasePayload(value: unknown): value is ReleasePayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.tag_name === "string"
    && record.tag_name.length > 0
    && (record.draft === undefined || typeof record.draft === "boolean")
    && (record.prerelease === undefined || typeof record.prerelease === "boolean");
}

async function readCache(cachePath: string): Promise<UpdateCache | undefined> {
  let text: string;
  try {
    text = await fs.readFile(cachePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isUpdateCache(parsed) ? parsed : undefined;
}

async function writeCache(cachePath: string, cache: UpdateCache): Promise<void> {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(cachePath, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
  } catch {
    // Cache persistence is optional and must not affect startup.
  }
}

export async function checkForUpdates(config: UpdateCheckConfig): Promise<void> {
  if (isUpdateCheckDisabled(config.environment)) return;
  const now = config.now();
  const cached = await readCache(config.cachePath);
  if (cached && now >= cached.checkedAt && now - cached.checkedAt < CACHE_MAX_AGE_MS) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const endpoint = `https://api.github.com/repos/${config.repository}/releases/latest`;
  try {
    const response = await config.fetch(endpoint, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "PiTTy update check" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub responded with HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!isReleasePayload(payload) || payload.draft === true || payload.prerelease === true) {
      throw new Error("GitHub returned an invalid stable release payload");
    }
    compareStableVersions(config.localVersion, payload.tag_name);
    await writeCache(config.cachePath, { checkedAt: now, outcome: "success", version: payload.tag_name });
    config.logger.info("update_check.release", { localVersion: config.localVersion, remoteVersion: payload.tag_name });
    if (compareStableVersions(config.localVersion, payload.tag_name) < 0) config.onNewerRelease(payload.tag_name);
  } catch (error) {
    await writeCache(config.cachePath, { checkedAt: now, outcome: "failure" });
    config.logger.warn("update_check.failed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timeout);
  }
}

export function defaultUpdateCheckConfig(localVersion: string, environment: UpdateEnvironment, logger: UpdateLogger, onNewerRelease: (version: string) => void): UpdateCheckConfig {
  return {
    fetch,
    now: Date.now,
    cachePath: path.join(defaultDiagnosticsDirectory(), "update-check.json"),
    repository: DEFAULT_REPOSITORY,
    localVersion,
    environment,
    logger,
    onNewerRelease,
  };
}
