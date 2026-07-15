# Open-source readiness

## Current architecture

PiTTy is a separate frontend that starts Pi with `--mode rpc`. The core conversation model and renderer are generic; specialized behavior is limited to optional integration boundaries.

### Generic compatibility

Without any PiTTy-specific adapter, the UI handles:

- user, assistant, thinking, tool-call, and tool-result messages
- streaming text/thinking/tool deltas
- arbitrary tool names and outputs
- extension commands, prompt templates, and skills from `get_commands`
- extension select/confirm/input/editor dialogs
- notifications, statuses, title changes, and editor prefilling

### Optional specialized integrations

1. `pi-subagents`
   - detects file-backed lifecycle artifacts
   - renders parallel children independently
   - exposes transcript inspection, pause, stop, and steering
2. `@juicesharp/rpiv-todo`
   - recognizes Todo tool snapshots and updates
   - renders active and completed work in a bounded sidebar panel

The integrations are detected at startup. When absent, PiTTy notifies once, hides their UI, disables polling, and keeps the generic RPC experience running.

## Known RPC limitation

Extensions that render arbitrary direct Pi TUI components cannot be reproduced exactly because RPC does not transmit those component trees. A plugin may still work through generic commands and tool events while its custom header/footer/editor/widget behavior is degraded.

## Integration direction

Further plugin-specific behavior should move toward an adapter registry:

```text
src/integrations/
  detect.ts
  generic-tools.ts
  pi-subagents.ts
  todo.ts
```

An adapter should be able to expose:

- package/data-shape detection
- optional tool decoration
- optional bounded sidebar panels
- optional controls and commands

The core renderer must remain the fallback.

## Installation and releases

The repository includes:

- `install.sh` / `uninstall.sh` for Linux, macOS, and WSL
- `install.ps1` / `uninstall.ps1` for native Windows
- optional integration prompts and noninteractive flags
- exact command, exit-code, and log-path diagnostics
- checksum verification where available
- cross-platform typecheck/unit-test CI
- tag-driven source release packaging

The current installer is source-based and installs a local Bun runtime. A future fully standalone binary remains desirable, but OpenTUI's preload and dynamic modules must first be proven reliable when compiled.

## Before first public release

- Create `mistrjirka/PiTTy` as a public GitHub repository.
- Push this prepared source tree to `main`.
- Confirm CI on Linux, macOS, and Windows.
- Test native Windows input, mouse, and alternate-screen restoration.
- Tag `v0.3.0` to create the first installer-compatible release assets.
- Add at least one screenshot or short demo recording.
- Verify optional package installation against current Pi releases.
