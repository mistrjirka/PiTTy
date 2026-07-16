## 1. Direct chat, branding, and sessions

- [x] 1.1 Add the canonical PiTTy SVG repository asset and a tested terminal-cell-safe logo component with compact, wide, and constrained-terminal wordmark layouts.
- [x] 1.2 Render the non-blocking empty-transcript dashboard with logo, common commands, and a stable loading/available/empty/error current-directory session region while preserving direct RPC startup and an immediately focused main prompt.
- [x] 1.3 Add current-project session listing and one reusable searchable selector shared by `/sessions`, `/resume`, the empty dashboard, and `pitty-resume`, with loading, empty, selection, cancellation, and streaming-confirmation states.
- [x] 1.4 Add documented `switch_session` RPC support, both command aliases, the `pitty-resume` launcher/install/uninstall path, state reload, error handling, picker autofocus, and main-prompt focus restoration.
- [x] 1.5 Add focused render/unit coverage for direct startup, constrained-logo fallback, dashboard session states, immediate picker keyboard input/navigation, selector cancellation, streaming confirmation decline/settle behavior, successful/unsupported/failed session switch, and launcher/install/uninstall behavior.

## 2. Chat interaction controls

- [ ] 2.1 Add a named main-prompt focus policy that preserves secondary editor/modal ownership and returns focus after non-input chat interactions.
- [ ] 2.2 Add a regression harness for main-prompt draft identity/content and visible editor geometry across model-selector open, close, and model selection; resolve actual buffer loss or modal occlusion from that evidence.
- [ ] 2.3 Bound command suggestions above the prompt so constrained terminals retain a visible writable editor and add layout coverage.
- [ ] 2.4 Implement the global Ctrl+O details toggle, including reset of tool and thinking per-item overrides, and update control/help text.
- [ ] 2.5 Align thinking-only panels with the assistant left border and add a visual regression test.
- [ ] 2.6 Intercept `/login` locally, show the approved Pi CLI guidance, and add it to command suggestions without forwarding it through RPC.

## 3. Searchable model selector

- [ ] 3.1 Add a pure normalized-model filtering helper with provider/id/display-name matching and no-match handling.
- [x] 3.2 Ensure the selector-local search editor explicitly takes focus on mount, supports typing and keyboard list navigation without a click, retains matched-count/empty state and selection reset, and restores chat focus after selection/cancel.
- [x] 3.3 Add tests for filtering, stale-selection prevention, immediate typing/navigation, draft preservation, and focus restoration.

## 4. Update and upgrade safety

- [ ] 4.1 Add version comparison, cached asynchronous latest-release check, disable controls, and focused update tests.
- [ ] 4.2 Add installed metadata and `pitty upgrade --check` using the installer release source and explicit version options.
- [ ] 4.3 Implement POSIX staged installation, checksum/archive/directory preflight, validation, backup, rollback, and retained diagnostics.
- [ ] 4.4 Implement equivalent PowerShell staging/rollback behavior, including temporary-directory creation and user-scoped PATH guidance.
- [ ] 4.5 Add local-fixture installer behavior tests and CI coverage for success, failure, paths with spaces, plugins, and rollback.

## 5. Documentation and release completion

- [ ] 5.1 Document direct startup, `/resume`, interaction controls, model search, unsupported `/login` guidance, diagnostics, upgrade, and uninstall.
- [ ] 5.2 Add screenshot references and real terminal captures with the canonical logo asset.
- [ ] 5.3 Configure and visually verify the repository social-preview image after maintainer GitHub authentication; do not change the owner avatar.
- [ ] 5.4 Run typecheck, unit/UI tests, installer behavior tests, cross-platform CI, and manual Arch/Konsole and Windows Terminal checks before version bump and release.

## 6. v0.3.3 stabilization and release

- [x] 6.1 Merge foreground tool progress with async subagent artifacts, count pending children as active/queued, deduplicate resumed children while preserving inspector transcripts, and keep foreground controls read-only.
- [x] 6.2 Remove the redundant sidebar Selected section and preserve pending steering/follow-up text at constrained terminal heights with production-component regression coverage.
- [x] 6.3 Complete the approved dashboard/session/focus slice, run full validation and `impl-check`, resolve verified findings, bump to `0.3.3`, push `main`, publish tag `v0.3.3`, and verify release archives plus checksums.
