## Context

`src/ui/theme.ts` currently exports one plain `colors` object and two module-created `SyntaxStyle` instances. Components import those values directly, and the renderer background is initialized separately. OpenTUI 0.4.3 supports reactive color props, `renderer.setBackgroundColor()`, and replacing a `SyntaxStyle`, but prior stability work requires style/renderable references not to churn on ordinary stream updates.

Theme configuration is untrusted file input. It must be validated once at the boundary and must remain separate from Pi's `settings.json`.

## Goals / Non-Goals

**Goals:**

- Provide ten distinct readable presets based on established palettes.
- Make every semantic color token editable and live-previewable.
- Persist valid user-global selection/overrides atomically.
- Keep renderer background, component colors, and Markdown styles synchronized.
- Recover safely from malformed configuration or unreadable custom choices.

**Non-Goals:**

- Project-specific themes.
- Changing Pi's own TUI theme.
- Importing arbitrary third-party theme files.
- Solving OpenTUI's separate alternate-screen resize repaint defect.

## Decisions

### One named semantic palette contract

Promote the existing color keys into a named `ThemePalette` contract and an exact `themeColorTokens` list. The contract includes backgrounds, panels, borders, text levels, accents/status colors, thinking background, tool backgrounds, diff background, and selection. Presets provide a complete value for every token; custom configuration stores a preset name plus partial known-token overrides.

Initial presets are PiTTy Midnight, Catppuccin Mocha, Catppuccin Latte, Tokyo Night Storm, Gruvbox Dark, Nord, Dracula, Rosé Pine Moon, Kanagawa Wave, and Solarized Light. Adapt semantic mappings from the projects' published palette/style guidance and record source links and attribution in repository documentation.

### PiTTy-owned strict configuration boundary

Store a versioned Settings document in the user configuration directory:

- Windows: `%APPDATA%\PiTTy\settings.json`
- Linux: `$XDG_CONFIG_HOME/pitty/settings.json`, falling back to `~/.config/pitty/settings.json`
- macOS: `$XDG_CONFIG_HOME/pitty/settings.json`, falling back to `~/Library/Application Support/PiTTy/settings.json`

Validate root, theme object, preset identity, override keys, and exact `#RRGGBB` values with a dedicated boundary parser; do not add a transitive validation dependency. Unknown/malformed PiTTy-owned theme fields do not enter runtime state. On invalid configuration, retain the default palette, surface one actionable warning, and preserve the file for user repair. Writes use a same-directory temporary file and atomic replacement.

### Reactive palette with stable style snapshots

Expose the active palette through a reactive theme controller. Existing color reads move to reactive palette access without creating per-render palette copies. When and only when the effective palette changes:

1. create one new main Markdown `SyntaxStyle` and one thinking style;
2. publish those stable style snapshots;
3. update the renderer background through the public API;
4. let reactive component props repaint from the same palette.

Ordinary message streaming reuses the current style references, preserving the existing allocation-stability contract.

### Immediate editor application

The Settings theme view lists presets with a compact preview and exposes every semantic token in a searchable editor. Selecting a preset applies and persists immediately. A custom field keeps its raw editing buffer, but only a complete valid hex value replaces the active token and writes configuration. Invalid intermediate input shows an inline error while the previous valid color remains active.

Contrast checks use the WCAG 2.2 relative-luminance formula without rounding and a fixed 4.5:1 threshold for primary and secondary terminal text against the backgrounds where those tokens are used. Incidental decorative/subtle tokens are reported separately but are not part of the shipped-preset acceptance threshold. Low contrast produces a warning, not a hard block, because every color remains intentionally configurable. Reset removes overrides and restores the selected preset.

### UI state table

| State | Behavior |
| --- | --- |
| Preset list | Ten sourced schemes with compact background/text/accent preview |
| Applying preset | Palette and renderer update immediately; write status is visible |
| Token list | Every semantic token is searchable and editable |
| Valid token input | Active preview and persisted override update immediately |
| Invalid token input | Raw input remains; prior valid runtime color remains |
| Low contrast | Warning identifies the affected text/background pair |
| Write failure | Runtime reverts to last persisted effective palette and error remains visible |
| Malformed startup config | PiTTy Midnight loads with one repair warning |
| Reset | Overrides clear and selected preset becomes authoritative |

## Stack contracts

This slice consumes the ordered `SettingsSectionDescriptor` and nested-route behavior from `pitty-usability-settings-4`. It appends one Theme section descriptor and owns all palette, config, preview, editor, and renderer-update behavior behind that route; it does not add a second Settings shell.

## Risks / Trade-offs

- **Light palettes expose assumptions in hard-coded colors** → Route all PiTTy color usage through the semantic palette and render-test both dark and light presets.
- **Immediate writes can fail after live preview** → Commit runtime state only with successful atomic persistence or revert to the last persisted palette on failure.
- **Frequent style recreation reintroduces native allocation failures** → Rebuild style snapshots only on effective theme changes and retain the long streaming-allocation regression.
- **Custom colors can be unreadable** → Warn on key contrast pairs and keep one-action reset available without forbidding deliberate choices.
