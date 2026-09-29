import * as path from "node:path";

export function resolveBundledPiExtensionPath(appRoot: string | undefined, importMetaDir: string): string {
  const sourceRoot = appRoot ? path.join(appRoot, "src") : importMetaDir;
  return path.join(sourceRoot, "pi-extensions", "compaction-observer.mjs");
}
