## Why

Pi already sends string-widget updates through RPC, but PiTTy discards them. Extensions cannot display live text beside the editor, including progress, status and side answers.

## What Changes

- Accept any valid string-widget key before modal request routing.
- Keep replacement and removal state per conversation tab.
- Display above-editor and below-editor text with ANSI styles, wrapping and bounded scrolling.
- Preserve the editor draft and focus through updates, resizing and scrolling.
- Clear widgets at session and process boundaries without dropping replacement-session startup updates.
- Document the existing RPC contract and include reproducible production-component captures.

## Scope

No Pi RPC change, model request, session-file migration or BTW extension is included. Component factories and custom TUI overlays remain outside the string-widget protocol. A separate owned side-question extension is recommended after comparing existing implementations.

## Validation

Focused tests cover wire validation, replacement/removal, multiple tabs, open dialogs, session changes, process stops, actual text styling, wrapping, shrinking and editor focus. The preview checks normal, narrow and overflowing output through the production OpenTUI components. Isolated real-Pi checks exercise existing extension commands and verify that widget activity adds no conversation messages. Typecheck and the standard regression suite remain required.
