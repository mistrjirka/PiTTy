/**
 * Optional PiTTy RPC adapter for a recognized unbundled Pi installation.
 * Activated in the Pi process by `node --import=<this file>`. No global files
 * are modified. If Pi updates its RPC handler, source validation fails closed
 * and the normal get_messages compatibility fallback still works.
 */
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { patchPiRpcSource } from "./patch-source.mjs";

const target = process.env.PITTY_DISPLAY_RPC_MODE_PATH;
if (target) {
  const targetUrl = pathToFileURL(target).href;
  const helperUrl = new URL("./messages.mjs", import.meta.url).href;
  registerHooks({
    load(url, context, nextLoad) {
      const original = nextLoad(url, context);
      if (url !== targetUrl || original.format !== "module" || original.source === undefined) return original;
      const text = typeof original.source === "string" ? original.source : Buffer.from(original.source).toString("utf8");
      const source = patchPiRpcSource(text, helperUrl);
      if (source === undefined) {
        process.stderr.write("PiTTy: Pi RPC compact history adapter is unavailable for this version; falling back to normal RPC.\n");
        return original;
      }
      return { ...original, source };
    },
  });
}
