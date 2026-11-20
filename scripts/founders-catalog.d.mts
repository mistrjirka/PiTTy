export interface FoundersPackage {
  id: string;
  source: string;
  names: string[];
  files: string[];
  replaces: string[];
  nodeMajor?: number;
  build?: string;
  version?: string;
  /** Refresh the unpinned maintained source only. Forks, local sources and explicit refs retain their own versions. */
  minimumVersion?: { source: string; version: string };
  /** Honor an explicit source selection, including a changed ref in the same repository. */
  explicitSource?: boolean;
}
export const FOUNDERS_PACKAGES: FoundersPackage[];
export function foundersCatalog(overrides?: Record<string, string>): FoundersPackage[];
