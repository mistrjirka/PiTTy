## Why

Model, thinking-effort, and session controls exist as separate shortcuts and dialogs, making them difficult to discover and leaving no coherent place for upcoming PiTTy-owned theme and MCP settings. A small reusable hub can expose the existing controls without creating a second runtime source of truth.

## What Changes

- Add a Ctrl+X and `/settings` entry point while preserving Ctrl+S for the sidebar.
- Present model, thinking effort, and session controls in one navigable Settings hub.
- Reuse existing model/session selectors and Pi RPC methods.
- Add current-session rename through the existing `set_session_name` RPC method.
- Apply successful settings changes immediately and surface errors inline.
- Provide stable keyboard/mouse navigation and focus restoration for nested settings views.
- Establish one ordered settings-section descriptor contract for the later theme and MCP slices.

## Capabilities

### New Capabilities

- `settings-hub`: Discoverable reusable settings navigation backed by existing Pi-owned runtime controls.

### Modified Capabilities

None.

## Impact

Affects application keyboard/command routing, dialog state, model/session selector composition, session naming UI, and focused render/RPC tests. It changes no Pi protocol and adds no dependency.
