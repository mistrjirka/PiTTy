# User intent

## Approved outcome

Settings provides approximately ten varied, readable presets and an in-app editor for every semantic PiTTy color. Theme changes apply immediately and persist as user-global PiTTy configuration.

## Approved decisions

- Ship ten interesting schemes covering common dark, light, warm, cool, muted, and vivid preferences.
- Derive preset combinations from established palette sources rather than inventing arbitrary values.
- Initial candidates approved in the outline: PiTTy Midnight, Catppuccin Mocha, Catppuccin Latte, Tokyo Night Storm, Gruvbox Dark, Nord, Dracula, Rosé Pine Moon, Kanagawa Wave, and Solarized Light.
- Every existing semantic color is editable in-app, including backgrounds, panels, borders, text levels, accents, statuses, thinking, tool backgrounds, diff background, and selection.
- Themes are user-global only; there are no project overrides.
- Valid changes apply immediately.
- Invalid intermediate values do not replace the active color.
- Provide contrast warnings and reset-to-preset recovery.
- PiTTy owns validated theme configuration; do not write theme data into Pi's settings.

## Accepted user excerpts

> “prepare some 10 color schemes with good colors covering usual needs”

> “named presets plus an in-app editor for every color”

The user selected global-only persistence and approved the complete theme outline.

## Rejected alternatives

- Presets without an in-app semantic color editor.
- Project-specific theme overrides.
- Storing PiTTy colors in Pi's `settings.json`.
- Accepting malformed color values into active renderer state.

## Unresolved questions

None.
