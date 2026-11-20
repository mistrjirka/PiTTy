import type { FoundersPackage } from "./founders-catalog.mjs";
export type PackageEntry = string | ({ source: string } & Record<string, unknown>);
export type FoundersSettings = Record<string, unknown> & { packages?: PackageEntry[] };
export type PlannedPackage = FoundersPackage & { oldSources: string[]; configured: boolean };
export interface PlannedAgent {
  name: string;
  filename: string;
  destination: string;
  content: string;
  sha256: string;
  action: "present" | "install" | "update" | "preserve";
  current: string | undefined;
  symlink: boolean;
}
export interface AgentPlan {
  agents: PlannedAgent[];
  receiptFile: string;
  receipt: { schemaVersion: 1; agents: Record<string, string> };
  skillCount: number;
}
export function hash(content: string | Buffer): string;
export function packageSource(entry: unknown): string | undefined;
export function sourceIdentity(source: unknown, base?: string): string | undefined;
export function readSettings(file: string): { value: FoundersSettings; raw: string | undefined };
export function mergeFoundersPackages(settings: FoundersSettings, catalog: FoundersPackage[], base?: string): { settings: FoundersSettings; packages: PlannedPackage[] };
export function atomicWrite(file: string, content: string, mode?: number): void;
export function planAgents(bundleRoot: string, agentDir: string): AgentPlan;
export function installAgents(plan: AgentPlan): void;
