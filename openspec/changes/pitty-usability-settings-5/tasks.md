## 1. Theme model and persistence

- [x] 1.1 Promote current color keys into a named complete `ThemePalette` contract and exact semantic token list.
- [x] 1.2 Add strict boundary parsing, platform config-path resolution, and atomic user-global PiTTy settings writes without a new dependency.
- [x] 1.3 Add safe startup fallback, one actionable malformed-config warning, and write-failure rollback.

## 2. Presets and runtime

- [x] 2.1 Implement the ten complete sourced presets and document upstream palette/style sources and semantic adaptation.
- [x] 2.2 Add one reactive theme controller for component colors, renderer background, and cached main/thinking Markdown styles.
- [x] 2.3 Migrate all hard-coded PiTTy semantic color reads to the active palette while preserving stable renderable/style references between theme changes.

## 3. Settings editor

- [x] 3.1 Add preset browsing with compact background/text/accent previews to the Settings hub.
- [x] 3.2 Add searchable editing for every semantic token with raw field buffers, exact hex validation, immediate valid apply, and reset.
- [x] 3.3 Add WCAG 2.2 relative-luminance checks, unrounded 4.5:1 preset acceptance, and non-blocking custom-color warnings for key text/background pairs.

## 4. Validation

- [x] 4.1 Add config tests for valid reload, malformed versions/presets/tokens/colors, platform paths, atomic failure, and rollback.
- [x] 4.2 Add dark/light render tests plus live preset/custom transitions across representative cards, dialogs, tools, thinking, Markdown, and selection.
- [x] 4.3 Retain and run the long streaming allocation regression to prove styles do not churn without a theme change.
- [x] 4.4 Run focused theme/config/render tests, `npm run typecheck`, `npm run check`, and `git diff --check` with explicit timeouts.
- [x] 4.5 Manually audit all ten presets in wide and constrained terminals, including contrast warnings and reset recovery.
