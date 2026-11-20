export interface FoundersPackage {
  id: string;
  source: string;
  names: string[];
  files: string[];
  replaces: string[];
  nodeMajor?: number;
  build?: string;
  version?: string;
  /** Honor an explicit source selection, including a changed ref in the same repository. */
  explicitSource?: boolean;
}
export const FOUNDERS_PACKAGES: FoundersPackage[];
export function foundersCatalog(overrides?: Record<string, string>): FoundersPackage[];
