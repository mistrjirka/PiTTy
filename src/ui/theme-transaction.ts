import type { ThemeConfigDocument } from "../config/theme-config.ts";
import { effectiveTheme, type ThemeController } from "./theme.ts";

export type ThemeDocumentWriter = (document: ThemeConfigDocument) => Promise<void>;
export type ThemeCommitResult =
  | { ok: true; document: ThemeConfigDocument }
  | { ok: false; document: ThemeConfigDocument; error: string };

export async function commitThemeDocument(
  controller: ThemeController,
  current: ThemeConfigDocument,
  next: ThemeConfigDocument,
  write: ThemeDocumentWriter,
): Promise<ThemeCommitResult> {
  controller.apply(effectiveTheme(next.theme.preset, next.theme.overrides));
  try {
    await write(next);
    return { ok: true, document: next };
  } catch (error) {
    controller.apply(effectiveTheme(current.theme.preset, current.theme.overrides));
    return {
      ok: false,
      document: current,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
