# Plugin compatibility specification

## Generic support

- Extension commands, prompt templates, and skills returned by Pi RPC SHALL appear in command suggestions.
- Standard extension dialog requests (`select`, `confirm`, `input`, `editor`) SHALL be supported.
- Fire-and-forget extension notifications, status text, title changes, and editor-prefill requests SHALL be handled where meaningful.
- Arbitrary tool events SHALL render through the generic tool renderer.

## Known limitations

- Direct Pi TUI component factories cannot be reproduced through RPC when Pi does not expose their structure.
- TUI-only header, footer, custom editor, theme, and custom-component APIs may be ignored or degraded.
- Rich plugin-specific panels and controls require an explicit PiTTy integration adapter.

## Adapter direction

Future adapters SHOULD expose detection, tool decoration, sidebar panels, and controls without changing the core conversation model.
