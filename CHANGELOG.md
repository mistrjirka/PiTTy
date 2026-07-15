# Changelog

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
