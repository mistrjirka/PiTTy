export interface FoundersRuntimeResult {
  status: string;
  reason?: string;
}
export interface FoundersRuntimeOptions {
  log?: (line: string) => void;
  ensureRuntime?: (appRoot: string, env: NodeJS.ProcessEnv) => FoundersRuntimeResult | Promise<FoundersRuntimeResult>;
  runCommand?: (command: string, args: string[], options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: "utf8";
    timeout: number;
    maxBuffer: number;
  }) => { status: number | null; error?: Error & { code?: string } };
}
/** Prepare a private matching base only when global Pi cannot support founders setup. */
export function ensureFoundersRuntime(appRoot: string, env?: NodeJS.ProcessEnv, options?: FoundersRuntimeOptions): Promise<FoundersRuntimeResult>;
