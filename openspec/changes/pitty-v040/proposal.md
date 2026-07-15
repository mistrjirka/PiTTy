## Why

PiTTy 0.3.0 provides a capable RPC terminal UI but has interaction defects that interrupt typing, lacks a practical way to find models, and planned a blocking startup screen that users do not want. The 0.4.0 release should instead make the existing chat reliably usable, visibly branded, resilient to installation/update failures, and explicit about the limits of Pi's RPC surface.

## What Changes

- Remove the planned blocking welcome screen; keep direct startup and add a passive PiTTy logo empty state.
- Add `/resume` session browsing and switching without restarting the terminal UI.
- Make the main prompt retain drafts across the model selector, recover focus after non-input mouse interaction, and remain visible beside bounded command suggestions.
- Add local search to the model selector, and make `Ctrl+O` globally toggle tool and thinking detail while fixing thinking-only panel alignment.
- Preserve Pi RPC command compatibility and show safe local guidance for unsupported `/login` rather than forwarding it or handling credentials.
- Add release update/upgrade support and harden installers with staging, rollback, and executable behavior tests.
- Add the canonical logo asset, documentation/screenshot work, and a manual GitHub social-preview release check.

## Capabilities

### New Capabilities
- `direct-chat-branding`: Direct chat startup and a terminal-safe PiTTy logo empty state.
- `session-resume`: PiTTy-native session selection and RPC session switching.
- `chat-interaction-controls`: Prompt focus and draft retention, bounded command suggestions, global details toggle, thinking-panel layout, and unsupported-command guidance.
- `model-selector-search`: Local model-list search with safe focus and selection behavior.
- `upgrade-and-update-notification`: Safe upgrade command and non-blocking update availability notification.
- `release-documentation-branding`: Canonical logo documentation, release screenshots, and repository social-preview completion check.

### Modified Capabilities
- `installers`: Require staged validation and rollback behavior, preserved diagnostics, and executable installer coverage.
- `plugin-compatibility`: Specify capability-aware handling of RPC-exposed commands and local guidance for unsupported built-in `/login`.

## Impact

- UI: `src/app.tsx`, `src/ui/message.tsx`, `src/ui/model-selector.tsx`, command suggestions, new logo/session/update modules, and render tests.
- RPC: `PiRpcClient` gains only documented session/update-related calls; Pi remains the execution, session, provider, and credential source of truth.
- Install/release: POSIX and PowerShell installers, launcher, CI, documentation, and release assets.
- Dependencies: no credential or OAuth dependency is added in 0.4.0; any future native login work requires a separate security-reviewed change.
