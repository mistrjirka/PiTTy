import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type OptionalIntegration = {
  packageName: string;
  installed: boolean;
  detectedBy: string[];
};

export type OptionalIntegrationStatus = {
  subagents: OptionalIntegration;
  todos: OptionalIntegration;
  piListError?: string | undefined;
};

function flattenStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const item of value) flattenStrings(item, output);
  else if (value && typeof value === "object") for (const item of Object.values(value as Record<string, unknown>)) flattenStrings(item, output);
  return output;
}

function readJsonStrings(file: string): string[] {
  try {
    return flattenStrings(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return [];
  }
}

function hasPackage(haystack: string, packageName: string): boolean {
  const normalized = haystack.toLowerCase();
  const unscoped = packageName.replace(/^@[^/]+\//, "").toLowerCase();
  return normalized.includes(packageName.toLowerCase()) || normalized.includes(unscoped);
}

export function detectOptionalIntegrations(options: { piExecutable?: string; cwd?: string } = {}): OptionalIntegrationStatus {
  const piExecutable = options.piExecutable ?? "pi";
  const cwd = options.cwd ?? process.cwd();
  const sources: Array<{ name: string; text: string }> = [];
  let piListError: string | undefined;

  for (const file of [
    path.join(os.homedir(), ".pi", "agent", "settings.json"),
    path.join(cwd, ".pi", "settings.json"),
    path.join(os.homedir(), ".pi", "agent", "npm", "package.json"),
  ]) {
    const strings = readJsonStrings(file);
    if (strings.length) sources.push({ name: file, text: strings.join("\n") });
  }

  const moduleRoots = [
    path.join(os.homedir(), ".pi", "agent", "npm", "node_modules"),
    path.join(cwd, ".pi", "npm", "node_modules"),
  ];
  const filesystemChecks: Record<string, string[]> = {
    "pi-subagents": moduleRoots.map((root) => path.join(root, "pi-subagents")),
    "@juicesharp/rpiv-todo": moduleRoots.map((root) => path.join(root, "@juicesharp", "rpiv-todo")),
  };

  const detect = (packageName: string): OptionalIntegration => {
    const detectedBy = sources.filter((source) => hasPackage(source.text, packageName)).map((source) => source.name);
    for (const candidate of filesystemChecks[packageName] ?? []) {
      try {
        if (fs.existsSync(candidate)) detectedBy.push(candidate);
      } catch {}
    }
    return { packageName, installed: detectedBy.length > 0, detectedBy: [...new Set(detectedBy)] };
  };

  let subagents = detect("pi-subagents");
  let todos = detect("@juicesharp/rpiv-todo");

  // Local settings/filesystem checks are immediate and cover normal installs.
  // Fall back to `pi list` only when something is still unknown, and keep the
  // timeout short so optional package detection cannot make startup feel hung.
  if (!subagents.installed || !todos.installed) {
    try {
      const result = spawnSync(piExecutable, ["list"], {
        cwd,
        encoding: "utf8",
        timeout: 2_500,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: "1" },
      });
      const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
      if (result.status === 0) {
        sources.push({ name: "pi list", text });
        subagents = detect("pi-subagents");
        todos = detect("@juicesharp/rpiv-todo");
      } else {
        piListError = text || `pi list exited with status ${result.status ?? "unknown"}`;
      }
    } catch (error) {
      piListError = error instanceof Error ? error.message : String(error);
    }
  }

  return { subagents, todos, ...(piListError ? { piListError } : {}) };
}
