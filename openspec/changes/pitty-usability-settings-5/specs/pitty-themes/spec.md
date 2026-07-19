## ADDED Requirements

### Requirement: Sourced theme presets
PiTTy SHALL provide ten complete named semantic palettes covering common dark/light, warm/cool, muted/vivid preferences and SHALL document the established palette sources used for adaptation.

#### Scenario: Preset list is available
- **WHEN** the user opens Theme settings
- **THEN** PiTTy lists PiTTy Midnight, Catppuccin Mocha, Catppuccin Latte, Tokyo Night Storm, Gruvbox Dark, Nord, Dracula, Rosé Pine Moon, Kanagawa Wave, and Solarized Light with compact previews

#### Scenario: Preset is complete
- **WHEN** any shipped preset is selected
- **THEN** it supplies a valid color for every semantic PiTTy color token without falling back to values from another preset

#### Scenario: Palette sources are documented
- **WHEN** a maintainer inspects PiTTy's theme documentation
- **THEN** the upstream palette/style source and PiTTy semantic adaptation are identifiable for every externally derived preset

### Requirement: Complete semantic color editing
PiTTy SHALL expose every semantic PiTTy color token through an in-app searchable editor and SHALL apply complete valid `#RRGGBB` changes immediately.

#### Scenario: Every token is present
- **WHEN** the user searches or browses custom Theme settings
- **THEN** backgrounds, panels, borders, text levels, accents/statuses, thinking, tool backgrounds, diff background, and selection tokens are all editable

#### Scenario: Valid color applies immediately
- **WHEN** the user enters a complete valid hex value for a token
- **THEN** PiTTy updates the affected live UI and persists the override without requiring a global Apply action

#### Scenario: Invalid intermediate input is isolated
- **WHEN** a color field contains an incomplete or invalid value
- **THEN** PiTTy keeps the raw field text and inline error while the previous valid runtime color remains active

#### Scenario: Reset restores preset
- **WHEN** the user resets custom colors
- **THEN** PiTTy removes all overrides and immediately restores the selected preset's complete palette

### Requirement: User-global validated persistence
PiTTy SHALL store the selected preset and custom overrides only in versioned user-global PiTTy configuration and SHALL validate file data before it enters runtime state.

#### Scenario: Valid configuration reloads
- **WHEN** PiTTy starts with a valid supported theme configuration
- **THEN** it restores the selected preset and valid overrides before rendering the interactive UI

#### Scenario: Configuration is not project-scoped
- **WHEN** the user runs PiTTy in different projects under the same user account
- **THEN** the same PiTTy theme configuration applies without reading project theme overrides

#### Scenario: Pi settings remain untouched
- **WHEN** theme settings change
- **THEN** PiTTy does not write theme data into Pi's `settings.json`

#### Scenario: Malformed configuration is safe
- **WHEN** the theme configuration has an invalid version, unknown preset, unknown token, or malformed color
- **THEN** PiTTy loads PiTTy Midnight, shows one actionable warning, and does not overwrite the malformed source automatically

#### Scenario: Atomic write fails
- **WHEN** PiTTy cannot atomically persist a valid theme change
- **THEN** it restores the last persisted effective palette and displays the write failure

### Requirement: Runtime theme consistency
PiTTy SHALL update the renderer background, reactive component colors, and main/thinking Markdown styles from one effective palette while retaining stable style references between theme changes.

#### Scenario: Preset changes runtime consistently
- **WHEN** the active preset changes successfully
- **THEN** the terminal background, panels, text, statuses, tools, thinking, selection, and Markdown syntax colors update from the same palette

#### Scenario: Streaming does not recreate styles
- **WHEN** assistant thinking or answer text receives repeated streaming updates without a theme change
- **THEN** PiTTy reuses the current Markdown style snapshots rather than allocating new styles per update

#### Scenario: Theme change replaces style once
- **WHEN** one valid effective palette change is committed
- **THEN** PiTTy creates and publishes one replacement main style and one replacement thinking style for that palette

### Requirement: Contrast guidance
PiTTy SHALL calculate contrast with the WCAG 2.2 relative-luminance formula and SHALL use an unrounded 4.5:1 threshold for primary and secondary terminal text against the backgrounds where each text token is used. PiTTy SHALL warn about lower contrast without preventing deliberate valid customization.

#### Scenario: Low contrast override
- **WHEN** a valid custom primary or secondary text/background combination has an unrounded contrast ratio below 4.5:1
- **THEN** PiTTy identifies the affected pair and measured ratio and keeps reset available while allowing the valid color choice

#### Scenario: Shipped preset readability
- **WHEN** shipped presets are validated
- **THEN** their primary and secondary text/background pairs have an unrounded contrast ratio of at least 4.5:1
