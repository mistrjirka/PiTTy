import type { FoundersPackage } from "./founders-catalog.mjs";
export interface FoundersOptions {
  appRoot?: string;
  agentDir?: string;
  sources?: Record<string, string>;
  catalog?: FoundersPackage[];
  check?: boolean;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  log?: (line: string) => void;
  packageManager?: {
    install(source: string): Promise<void>;
    getInstalledPath(source: string, scope: "user"): string | undefined;
  };
  runtimeReady?: (appRoot: string) => boolean;
  ensureRuntime?: (appRoot: string, env: NodeJS.ProcessEnv) => { status: string; reason?: string } | Promise<{ status: string; reason?: string }>;
  buildPackage?: (entry: FoundersPackage, directory: string) => void | Promise<void>;
}
export function parseFoundersArgs(args: string[], cwd?: string): { check: boolean; dryRun: boolean; help: boolean; sources: Record<string, string>; agentDir?: string };
export function packageReady(entry: FoundersPackage, directory: string | undefined): boolean;
export function managedRuntimeReady(appRoot: string): boolean;
export function setupFounders(options?: FoundersOptions): Promise<{ exitCode: number; changed: boolean }>;
export function main(args?: string[], options?: FoundersOptions): Promise<number>;
