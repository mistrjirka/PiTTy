import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultThemeConfig,
  loadThemeConfig,
  nodeThemeConfigFileSystem,
  parseThemeConfig,
  themeConfigPath,
  writeThemeConfig,
  type ThemeConfigDocument,
  type ThemeConfigFileSystem,
} from "../src/config/theme-config.ts";
import { contrastRatio, contrastWarnings } from "../src/ui/theme-contrast.ts";
import { themeColorTokens, themePresetNames, themePresets } from "../src/ui/theme-presets.ts";
import { createThemeController, effectiveTheme } from "../src/ui/theme.ts";
import { commitThemeDocument } from "../src/ui/theme-transaction.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pitty-theme-"));
  temporaryDirectories.push(directory);
  return directory;
}

function config(preset: ThemeConfigDocument["theme"]["preset"], overrides: ThemeConfigDocument["theme"]["overrides"] = {}): ThemeConfigDocument {
  return { version: 1, theme: { preset, overrides } };
}

describe("PiTTy themes", () => {
  test("ships ten complete sourced palettes with accepted text contrast", () => {
    expect(themePresetNames).toEqual([
      "PiTTy Midnight",
      "Catppuccin Mocha",
      "Catppuccin Latte",
      "Tokyo Night Storm",
      "Gruvbox Dark",
      "Nord",
      "Dracula",
      "Rosé Pine Moon",
      "Kanagawa Wave",
      "Solarized Light",
    ]);
    for (const name of themePresetNames) {
      const palette = themePresets[name];
      expect(Object.keys(palette).sort()).toEqual([...themeColorTokens].sort());
      for (const token of themeColorTokens) expect(palette[token]).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(contrastWarnings(palette)).toEqual([]);
    }
  });

  test("uses the WCAG 2.2 luminance formula without rounding", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.478089, 6);
    const warningPalette = { ...themePresets["PiTTy Midnight"], text: "#777777", muted: "#777777" };
    const warnings = contrastWarnings(warningPalette);
    expect(warnings.map((warning) => warning.name)).toContain("primary text");
    expect(warnings.map((warning) => warning.name)).toContain("secondary text");
    expect(warnings.every((warning) => warning.ratio < 4.5)).toBe(true);
  });

  test("strictly parses and normalizes the complete config boundary", () => {
    expect(parseThemeConfig(config("PiTTy Midnight", { text: "#aabbcc" }))).toEqual(config("PiTTy Midnight", { text: "#AABBCC" }));
    const invalid: unknown[] = [
      null,
      [],
      {},
      { version: 2, theme: { preset: "PiTTy Midnight", overrides: {} } },
      { version: 1, theme: { preset: "PiTTy Midnight", overrides: {} }, extra: true },
      { version: 1, theme: { preset: "PiTTy Midnight", overrides: {}, extra: true } },
      { version: 1, theme: { preset: "Unknown", overrides: {} } },
      { version: 1, theme: { preset: "PiTTy Midnight" } },
      { version: 1, theme: { preset: "PiTTy Midnight", overrides: [] } },
      { version: 1, theme: { preset: "PiTTy Midnight", overrides: { unknown: "#FFFFFF" } } },
      { version: 1, theme: { preset: "PiTTy Midnight", overrides: { text: "#fff" } } },
      { version: 1, theme: { preset: "PiTTy Midnight", overrides: { text: 42 } } },
    ];
    for (const value of invalid) expect(parseThemeConfig(value)).toBeUndefined();
  });

  test("resolves exact user-global paths for supported platforms", () => {
    expect(themeConfigPath({ platform: "win32", home: "C:\\Users\\x", env: { APPDATA: "C:\\App" } })).toBe("C:\\App\\PiTTy\\settings.json");
    expect(themeConfigPath({ platform: "win32", home: "C:\\Users\\x", env: {} })).toBe("C:\\Users\\x\\AppData\\Roaming\\PiTTy\\settings.json");
    expect(themeConfigPath({ platform: "linux", home: "/home/x", env: { XDG_CONFIG_HOME: "/xdg" } })).toBe("/xdg/pitty/settings.json");
    expect(themeConfigPath({ platform: "linux", home: "/home/x", env: {} })).toBe("/home/x/.config/pitty/settings.json");
    expect(themeConfigPath({ platform: "darwin", home: "/Users/x", env: { XDG_CONFIG_HOME: "/xdg" } })).toBe("/xdg/pitty/settings.json");
    expect(themeConfigPath({ platform: "darwin", home: "/Users/x", env: {} })).toBe("/Users/x/Library/Application Support/PiTTy/settings.json");
  });

  test("treats a missing file as default and preserves malformed sources", async () => {
    const directory = await temporaryDirectory();
    const missingPath = join(directory, "missing.json");
    expect(await loadThemeConfig(missingPath)).toEqual({ document: defaultThemeConfig() });

    const malformedPath = join(directory, "malformed.json");
    await writeFile(malformedPath, "{broken\n", "utf8");
    const malformed = await loadThemeConfig(malformedPath);
    expect(malformed.document).toEqual(defaultThemeConfig());
    expect(malformed.warning).toContain(`repair ${malformedPath}`);
    expect(await readFile(malformedPath, "utf8")).toBe("{broken\n");

    const invalidPath = join(directory, "invalid.json");
    const invalidSource = JSON.stringify({ version: 1, theme: { preset: "Unknown", overrides: {} } });
    await writeFile(invalidPath, invalidSource, "utf8");
    const invalid = await loadThemeConfig(invalidPath);
    expect(invalid.document).toEqual(defaultThemeConfig());
    expect(invalid.warning).toContain(`repair ${invalidPath}`);
    expect(await readFile(invalidPath, "utf8")).toBe(invalidSource);
  });

  test("surfaces non-missing read failures for one startup warning", async () => {
    const deniedFileSystem: ThemeConfigFileSystem = {
      ...nodeThemeConfigFileSystem,
      readText: async () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); },
    };
    await expect(loadThemeConfig("/denied/settings.json", deniedFileSystem)).rejects.toThrow("permission denied");
  });

  test("writes atomically with private modes and reloads valid overrides", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "nested", "settings.json");
    const document = config("Nord", { accent: "#AABBCC" });
    await writeThemeConfig(document, path);
    expect((await loadThemeConfig(path)).document).toEqual(document);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, "nested"))).mode & 0o777).toBe(0o700);
    expect((await readdir(join(directory, "nested"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("keeps the prior file and cleans temporary data when atomic replace fails", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "settings.json");
    const original = `${JSON.stringify(defaultThemeConfig())}\n`;
    await writeFile(path, original, "utf8");
    const failingFileSystem: ThemeConfigFileSystem = {
      ...nodeThemeConfigFileSystem,
      replace: async () => { throw new Error("rename denied"); },
    };
    await expect(writeThemeConfig(config("Solarized Light"), path, failingFileSystem)).rejects.toThrow("rename denied");
    expect(await readFile(path, "utf8")).toBe(original);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("cleans the temporary path when the exclusive write fails", async () => {
    const removed: string[] = [];
    const failingFileSystem: ThemeConfigFileSystem = {
      ...nodeThemeConfigFileSystem,
      makeDirectory: async () => {},
      writeExclusive: async () => { throw new Error("write denied"); },
      remove: async (path) => { removed.push(path); },
    };
    await expect(writeThemeConfig(defaultThemeConfig(), "/tmp/pitty-test/settings.json", failingFileSystem)).rejects.toThrow("write denied");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/\.settings\..+\.tmp$/);
  });

  test("keeps style and renderer identity stable for equal palettes", () => {
    const controller = createThemeController({ isolated: true, initialPalette: themePresets["PiTTy Midnight"] });
    const calls: string[] = [];
    controller.attachRenderer({ setBackgroundColor: (color) => calls.push(color) });
    const revision = controller.revision();
    const mainStyle = controller.markdownStyle;
    const thinkingStyle = controller.thinkingMarkdownStyle;

    controller.apply(effectiveTheme("PiTTy Midnight"));
    expect(controller.revision()).toBe(revision);
    expect(controller.markdownStyle).toBe(mainStyle);
    expect(controller.thinkingMarkdownStyle).toBe(thinkingStyle);
    expect(calls).toEqual([themePresets["PiTTy Midnight"].background]);

    controller.apply(effectiveTheme("Solarized Light"));
    expect(controller.revision()).toBe(revision + 1);
    expect(controller.markdownStyle).not.toBe(mainStyle);
    expect(controller.thinkingMarkdownStyle).not.toBe(thinkingStyle);
    expect(controller.colors.background).toBe(themePresets["Solarized Light"].background);
    expect(calls.at(-1)).toBe(themePresets["Solarized Light"].background);
  });

  test("rolls runtime palette, styles, and renderer background back after persistence failure", async () => {
    const controller = createThemeController({ isolated: true, initialPalette: themePresets["PiTTy Midnight"] });
    const calls: string[] = [];
    controller.attachRenderer({ setBackgroundColor: (color) => calls.push(color) });
    const current = config("PiTTy Midnight");
    const next = config("Solarized Light", { accent: "#123456" });
    const beforeRevision = controller.revision();

    const failed = await commitThemeDocument(controller, current, next, async () => { throw new Error("disk full"); });
    expect(failed).toEqual({ ok: false, document: current, error: "disk full" });
    expect(controller.colors.background).toBe(themePresets["PiTTy Midnight"].background);
    expect(controller.colors.accent).toBe(themePresets["PiTTy Midnight"].accent);
    expect(controller.revision()).toBeGreaterThan(beforeRevision);
    expect(calls.slice(-2)).toEqual([themePresets["Solarized Light"].background, themePresets["PiTTy Midnight"].background]);

    const written: ThemeConfigDocument[] = [];
    const succeeded = await commitThemeDocument(controller, current, next, async (document) => { written.push(document); });
    expect(succeeded).toEqual({ ok: true, document: next });
    expect(written).toEqual([next]);
    expect(controller.colors.accent).toBe("#123456");
  });
});
