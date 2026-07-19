import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { isThemeColorToken, isThemePresetName, type ThemeOverrides, type ThemePalette, type ThemePresetName } from "../theme/contracts.ts";

export const THEME_CONFIG_VERSION = 1 as const;
export type ThemeConfigDocument = {
  version: typeof THEME_CONFIG_VERSION;
  theme: {
    preset: ThemePresetName;
    overrides: ThemeOverrides;
  };
};
export type ThemeConfigLoadResult = {
  document: ThemeConfigDocument;
  warning?: string;
};
export type ThemePathOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
};
export type ThemeConfigFileSystem = {
  readText: (path: string) => Promise<string>;
  makeDirectory: (path: string) => Promise<void>;
  writeExclusive: (path: string, content: string) => Promise<void>;
  replace: (source: string, target: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
};

export const nodeThemeConfigFileSystem: ThemeConfigFileSystem = {
  readText: (path) => readFile(path, "utf8"),
  makeDirectory: async (path) => { await mkdir(path, { recursive: true, mode: 0o700 }); },
  writeExclusive: async (path, content) => { await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" }); },
  replace: async (source, target) => { await rename(source, target); },
  remove: async (path) => { await rm(path, { force: true }); },
};

export function themeConfigPath(options: ThemePathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  if (platform === "win32") {
    return win32.join(env.APPDATA ?? win32.join(home, "AppData", "Roaming"), "PiTTy", "settings.json");
  }
  if (platform === "darwin" && !env.XDG_CONFIG_HOME) {
    return posix.join(home, "Library", "Application Support", "PiTTy", "settings.json");
  }
  return posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, ".config"), "pitty", "settings.json");
}

function isHex(value: unknown): value is ThemePalette[keyof ThemePalette] {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function parseThemeConfig(value: unknown): ThemeConfigDocument | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const root = value as Record<string, unknown>;
  if (
    Object.keys(root).length !== 2
    || root.version !== THEME_CONFIG_VERSION
    || typeof root.theme !== "object"
    || root.theme === null
    || Array.isArray(root.theme)
  ) return undefined;

  const theme = root.theme as Record<string, unknown>;
  if (
    Object.keys(theme).length !== 2
    || Object.keys(theme).some((key) => key !== "preset" && key !== "overrides")
    || typeof theme.preset !== "string"
    || !isThemePresetName(theme.preset)
    || typeof theme.overrides !== "object"
    || theme.overrides === null
    || Array.isArray(theme.overrides)
  ) return undefined;

  const overrides: ThemeOverrides = {};
  for (const [key, color] of Object.entries(theme.overrides)) {
    if (!isThemeColorToken(key) || !isHex(color)) return undefined;
    overrides[key] = color.toUpperCase();
  }
  return { version: THEME_CONFIG_VERSION, theme: { preset: theme.preset, overrides } };
}

export async function loadThemeConfig(
  path = themeConfigPath(),
  fileSystem: ThemeConfigFileSystem = nodeThemeConfigFileSystem,
): Promise<ThemeConfigLoadResult> {
  let raw: string;
  try {
    raw = await fileSystem.readText(path);
  } catch (error) {
    if (isMissing(error)) return { document: defaultThemeConfig() };
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { document: defaultThemeConfig(), warning: `PiTTy theme settings are malformed; repair ${path}` };
  }
  const document = parseThemeConfig(parsed);
  return document
    ? { document }
    : { document: defaultThemeConfig(), warning: `PiTTy theme settings are invalid; repair ${path}` };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function defaultThemeConfig(): ThemeConfigDocument {
  return { version: THEME_CONFIG_VERSION, theme: { preset: "PiTTy Midnight", overrides: {} } };
}

export async function writeThemeConfig(
  document: ThemeConfigDocument,
  path = themeConfigPath(),
  fileSystem: ThemeConfigFileSystem = nodeThemeConfigFileSystem,
): Promise<void> {
  const directory = dirname(path);
  await fileSystem.makeDirectory(directory);
  const temporary = join(directory, `.settings.${process.pid}.${randomUUID()}.tmp`);
  try {
    await fileSystem.writeExclusive(temporary, `${JSON.stringify(document)}\n`);
    await fileSystem.replace(temporary, path);
  } catch (error) {
    try {
      await fileSystem.remove(temporary);
    } catch {
      // Preserve the original write failure; stale temp cleanup is best-effort.
    }
    throw error;
  }
}
