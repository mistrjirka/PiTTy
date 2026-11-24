/** Prepare the verified Pi base for founders setup without replacing global Pi. */
import { ensureManagedPi } from "./ensure-managed-pi.mjs";
import { preparePrivatePiBase } from "./private-pi-base.mjs";

export async function ensureFoundersRuntime(appRoot, env = process.env, options = {}) {
  return preparePrivatePiBase(appRoot, env, { ...options, ensureRuntime: options.ensureRuntime ?? ensureManagedPi });
}
