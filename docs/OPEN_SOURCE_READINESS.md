# Architecture and open-source readiness

[← Back to README](../README.md) · [Documentation index](README.md)

PiTTy is a separate OpenTUI frontend that starts the Pi coding agent in RPC mode. The repository is public, MIT-licensed, packaged through tagged GitHub releases, and tested on Linux, macOS, and Windows.

## Architecture

```text
PiTTy OpenTUI
    │
    ├── generic conversation and tool renderer
    ├── model/session selectors and local UI commands
    ├── diagnostics and message-window state
    ├── optional integration adapters
    │
    └── Pi process running with --mode rpc
```

The core UI does not depend on the optional packages. PiTTy launches Pi with the user's existing configuration, authentication, models, sessions, tools, skills, prompt templates, and extensions.

## Generic RPC compatibility

Without a PiTTy-specific adapter, the UI handles:

- user, assistant, thinking, tool-call, and tool-result events;
- streaming text, thinking, and tool deltas;
- arbitrary tool names and outputs through a generic card;
- extension commands, prompt templates, and skills returned by Pi;
- extension `select`, `confirm`, `input`, and `editor` dialogs;
- notifications, status text, terminal-title changes, and editor prefilling.

This generic path must remain usable when every optional integration is absent.

## Optional specialized integrations

| Package | Specialized behavior |
|---|---|
| `npm:pi-subagents` | File-backed child lifecycle detection, independent child entries, transcript inspection, steering, pause, and stop |
| `npm:@juicesharp/rpiv-todo` | Active and completed Todo snapshots rendered in bounded sidebar panels |

PiTTy detects these packages at startup. Missing integrations cause one informational notification, hide their specialized panels, disable unnecessary polling, and leave the normal chat usable.

Future integrations should remain behind an adapter boundary rather than introducing package-specific assumptions into the generic renderer.

## Known RPC boundary

Pi extensions can render custom component trees inside Pi's direct TUI. Those component trees are not serialized through the current RPC protocol, so PiTTy cannot reproduce arbitrary extension-owned headers, footers, editors, or widgets exactly.

Such extensions may still work through their commands and tool events. PiTTy displays them through the generic transcript unless a specialized adapter exists.

Authentication has the same boundary: native interactive `/login` is not exposed through current Pi RPC. PiTTy directs users to complete `/login` in the regular Pi interface and then reuses Pi's resulting credentials.

## Diagnostics and privacy

Normal PiTTy RPC logs retain event metadata, sizes, timings, and short hashes while omitting full prompt text, source contents, and tool output. This reduces accidental exposure but does not make diagnostic bundles automatically safe to publish: absolute paths and error snippets may remain.

Never commit or attach:

- Pi credentials or authentication files;
- private session transcripts;
- source code from non-public projects;
- unreviewed diagnostics bundles;
- `--verbose-rpc-logs` output.

See [SECURITY.md](../SECURITY.md) for reporting guidance.

## Installation and releases

The repository includes:

- `install.sh` and `uninstall.sh` for Linux, macOS, and WSL;
- `install.ps1` and `uninstall.ps1` for native Windows;
- interactive and noninteractive optional-package selection;
- checksum verification when release checksums are available;
- readable failed-command, exit-code, log-path, and recent-output diagnostics;
- tag-driven `.tar.gz`, `.zip`, and `SHA256SUMS` release assets;
- a Linux, macOS, and Windows CI matrix.

The current installer is source-based and installs a local Bun runtime alongside PiTTy. A fully standalone binary would require reliable packaging of OpenTUI's native and dynamically loaded components.

## Platform status

| Platform | Status |
|---|---|
| Linux | Primary development platform |
| macOS | CI-tested and supported by the POSIX installer |
| Windows | CI-tested and supported by PowerShell; broader terminal testing remains useful |
| WSL | Supported through the POSIX installer and Linux runtime |

## Contribution expectations

Public UI, RPC, installer, integration, or release behavior should be described through OpenSpec before or alongside implementation. Changes should preserve the generic fallback and pass:

```bash
npm run typecheck
npm run test:unit
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) and the [documentation index](README.md).
