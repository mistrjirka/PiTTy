export type PiCommand = {
  executable: string;
  args: string[];
};

export function isJavaScriptEntry(executable: string): boolean {
  return /\.(?:cjs|mjs|js)$/i.test(executable);
}

export function resolvePiCommand(executable: string, args: string[] = [], nodeExecutable = process.env.PITTY_NODE_EXECUTABLE ?? "node"): PiCommand {
  if (!isJavaScriptEntry(executable)) return { executable, args };
  return { executable: nodeExecutable, args: [executable, ...args] };
}

export function resolveDefaultPiExecutable(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_BIN ?? "pi";
}
