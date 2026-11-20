import type { FoundersPackage } from "./founders-catalog.mjs";
export type PackageEntry = string | ({ source: string } & Record<string, unknown>);
export type FoundersSettings = Record<string, unknown> & { packages?: PackageEntry[] };
export type PlannedPackage = FoundersPackage & { oldSources: string[]; configured: boolean };
/** Saved per agent directory. An explicit CLI source takes precedence on the next run. */
export type SourcePreferences = Partial<Record<"skills" | "btw", string>>;
export interface FoundersReceipt {
  schemaVersion: 1;
  agents: Record<string, string>;
  sourcePreferences?: SourcePreferences;
}
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
  receipt: FoundersReceipt;
  skillCount: number;
}
export function hash(content: string | Buffer): string;
export function packageSource(entry: unknown): string | undefined;
/** Case-preserving GitHub cache path, without a Git ref or .git suffix. */
export function githubSourcePath(source: unknown): string | undefined;
export function githubSourceRef(source: unknown): string | undefined;
export function sourceIdentity(source: unknown, base?: string): string | undefined;
export function readSettings(file: string): { value: FoundersSettings; raw: string | undefined };
export function mergeFoundersPackages(settings: FoundersSettings, catalog: FoundersPackage[], base?: string): { settings: FoundersSettings; packages: PlannedPackage[] };
export function atomicWrite(file: string, content: string, mode?: number): void;
export function readFoundersReceipt(agentDir: string): { receiptFile: string; receipt: FoundersReceipt };
export function planAgents(bundleRoot: string, agentDir: string): AgentPlan;
export function installAgents(plan: AgentPlan, sourcePreferences?: SourcePreferences): boolean;
