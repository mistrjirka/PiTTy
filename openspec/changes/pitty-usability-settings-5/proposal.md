## Why

PiTTy currently exports one static palette and static Markdown `SyntaxStyle` instances, so users cannot adapt contrast, background, or accents to their environment. The approved Settings hub needs varied readable presets and complete semantic customization without storing PiTTy presentation data in Pi's settings.

## What Changes

- Add ten sourced presets spanning dark/light, warm/cool, muted/vivid preferences.
- Make all existing semantic PiTTy colors reactively themeable at runtime.
- Add a Settings theme browser and in-app editor for every semantic color token.
- Apply valid changes immediately, show contrast warnings, and provide reset recovery.
- Persist one user-global preset plus overrides in PiTTy-owned validated configuration.
- Rebuild and reuse stable Markdown syntax styles only when the active palette changes.
- Document palette sources and adaptation.

## Capabilities

### New Capabilities

- `pitty-themes`: Runtime theme presets and complete validated user-global semantic color customization.

### Modified Capabilities

None.

## Impact

Affects theme ownership, renderer background setup, all color-consuming UI components, Markdown style access, Settings composition, cross-platform config paths, and render/config tests. No package dependency is added.
