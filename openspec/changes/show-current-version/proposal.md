## Why

Users cannot identify the running PiTTy release from the live TUI, making support and release verification less direct.

## What Changes

- Display PiTTy’s current package version in the sidebar when it is visible.
- Use the package metadata as the shared version source for the sidebar and CLI help.
- Release the completed change as `v0.3.2`.

## Capabilities

### New Capabilities
- `version-display`: PiTTy exposes its current release version in the live TUI and CLI help.

### Modified Capabilities
- None.

## Impact

- Affects `src/index.tsx`, `src/version.ts`, `src/ui/sidebar.tsx`, `tsconfig.json`, render tests, and package release metadata.
- No API, dependency, or RPC behavior changes.
