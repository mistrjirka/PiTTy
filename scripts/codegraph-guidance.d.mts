export function compactCodegraphGuidance(source: string): { status: "current" | "needed" | "unrecognized"; source: string };
export function prepareCodegraphGuidance(directory: string | undefined, options?: { dryRun?: boolean }): { status: "absent" | "current" | "needed" | "unrecognized" | "updated"; changed: boolean };
