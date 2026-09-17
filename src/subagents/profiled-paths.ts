import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const PROFILED_RUNTIME_ROOT_PREFIX = "pi-profiled-subagents-";

function relativeChild(root: string, candidate: string): string | undefined {
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  return relative;
}

/**
 * Validate one profile-runtime control directory without requiring the textual
 * temp path to already be canonical. macOS commonly exposes the same temp tree
 * through an alias such as /tmp -> /private/tmp (and /var -> /private/var).
 *
 * The temp-root alias is allowed, but neither the runtime root nor the control
 * directory itself may be a symlink. The control directory must also remain a
 * direct child of one `pi-profiled-subagents-*` runtime root after realpath
 * resolution, so the alias exception cannot be used to escape the temp tree.
 */
export function safeProfiledControlDir(candidate: string, tmpDir = os.tmpdir()): string | undefined {
  const logicalTmp = path.resolve(tmpDir);
  const logicalCandidate = path.resolve(candidate);
  const logicalRelative = relativeChild(logicalTmp, logicalCandidate);
  if (!logicalRelative) return undefined;

  const parts = logicalRelative.split(path.sep);
  if (parts.length !== 2 || !parts[0]?.startsWith(PROFILED_RUNTIME_ROOT_PREFIX) || !parts[1]) return undefined;
  const logicalRuntimeRoot = path.join(logicalTmp, parts[0]);

  try {
    const rootStat = fs.lstatSync(logicalRuntimeRoot);
    const controlStat = fs.lstatSync(logicalCandidate);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return undefined;
    if (!controlStat.isDirectory() || controlStat.isSymbolicLink()) return undefined;

    const realTmp = fs.realpathSync(logicalTmp);
    const realRuntimeRoot = fs.realpathSync(logicalRuntimeRoot);
    const realCandidate = fs.realpathSync(logicalCandidate);

    const realRootRelative = relativeChild(realTmp, realRuntimeRoot);
    if (!realRootRelative || realRootRelative.includes(path.sep) || realRootRelative !== parts[0]) return undefined;

    const realControlRelative = relativeChild(realRuntimeRoot, realCandidate);
    if (!realControlRelative || realControlRelative.includes(path.sep) || realControlRelative !== parts[1]) return undefined;
  } catch {
    return undefined;
  }

  return logicalCandidate;
}
