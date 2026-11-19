/**
 * Resolve a specific pi-code-tool module to PiTTy's private fork in this
 * child process only. Global Pi settings, extensions, and sessions are intact.
 */
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const replacement = process.env.PITTY_CODE_TOOL_REPLACEMENT;
if (replacement) {
  const targetUrl = pathToFileURL(replacement).href;
  const installedCodeTool = /\/(?:npm\/node_modules\/)?pi-code-tool\/dist\/pi\/extension\.js$/;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (
        resolved.url !== targetUrl &&
        installedCodeTool.test(new URL(resolved.url).pathname)
      ) {
        if (process.env.PITTY_DEBUG_CODE_TOOL_RESOLUTION === "1") {
          process.stderr.write("PiTTy code-tool module replaced: " + resolved.url + "\n");
        }
        return { ...resolved, url: targetUrl };
      }
      return resolved;
    },
  });
}
