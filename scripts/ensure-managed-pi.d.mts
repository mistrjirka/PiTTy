/** Contract for the standalone installer used by the PiTTy upgrade path. */
export type ManagedPiInstallResult =
  | { status: "skipped"; reason: string }
  | { status: "unsupported"; reason: string }
  | { status: "ready" }
  | { status: "installed"; piVersion: string };

export declare function ensureManagedPi(
  appRoot: string,
  env?: NodeJS.ProcessEnv,
): ManagedPiInstallResult;
