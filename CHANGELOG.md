# Changelog

## 0.4.2

- Thanks to @herm1t0 for the Windows support intent in PRs #3 and #4; added safer installation PATH management and launcher/runtime fixes.

## 0.4.1

- Added the asymmetric bracket-Pi logo and refreshed logo assets with rebuilt documentation.
- Authoritative deleted todo snapshots no longer leave tombstones in the todo view.
- Bounded slash-command suggestions stay above the prompt and keep the keyboard-selected row visible.
- Short queued/sent input states retain enough height to avoid unnecessary scrolling and highlighted-text overlap.
- Grouped active subagents first, preserving stable launch/index order within groups; activity timestamps are display-only.

## 0.4.0

- Added update checks and staged, rollback-safe upgrades, plus safer cross-platform installers and CI coverage.
- Added prompt controls and history, stable streaming/renderables, searchable session browsing and switching, and subagent metadata, activity, and ordering improvements.

## 0.3.3

- Added a non-blocking empty dashboard with terminal-safe branding and recent sessions.
- Added searchable `/sessions` and `/resume` flows plus the `pitty-resume` launcher.
- Added session switching through Pi RPC, foreground subagent visibility, resumed-child deduplication, and constrained-terminal interaction fixes.

## 0.3.1

- Added searchable model selection with visible draft preservation and keyboard list navigation.
- Made Ctrl+O toggle tool and thinking detail together, fixed thinking-only alignment, and restored prompt focus after chat clicks.
- Added local `/login` guidance for the unsupported RPC command.
- Stabilized optional-integration tests and require release validation before publishing archives.

## 0.3.0

- Renamed the project to PiTTy and added a portable `pitty` launcher.
- Added graceful optional-integration detection for `pi-subagents` and `@juicesharp/rpiv-todo`.
- Missing integrations now produce one informational notification and their panels remain hidden instead of showing empty plugin-specific UI.
- Disabled subagent artifact polling when the subagent package is absent.
- Added interactive/noninteractive Linux, macOS, WSL, and Windows installers with optional package prompts and readable failure diagnostics.
- Added uninstallers, checksum-aware release packaging, cross-platform CI, issue templates, contributing/security docs, and MIT licensing.
- Added OpenSpec project context and capability specifications.

## 0.2.5

- Added stable parallel-subagent selection, separate child entries, active/finished selector, and file-backed child steering.
- Hid the main chat editor while inspecting a subagent and made completed children read-only.

Earlier pre-release history is preserved in repository tags and release notes.
