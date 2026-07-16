<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/pitty-terminal-mark-dark.svg">
    <img src="docs/images/pitty-terminal-mark.svg" width="250" alt="PiTTy terminal PTY Tail logo">
  </picture>
</p>

<h1 align="center">PiTTy</h1>

<p align="center">
  <strong>A fast, terminal-native OpenTUI frontend for the Pi coding agent.</strong>
</p>

<p align="center">
  Scrollable conversations · searchable sessions and models · rich tool output · optional subagent and Todo views
</p>

<p align="center">
  <a href="https://github.com/mistrjirka/PiTTy/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/mistrjirka/PiTTy/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/mistrjirka/PiTTy/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/mistrjirka/PiTTy?display_name=tag"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

## Install

### Linux, macOS, and WSL

```bash
curl -fsSL https://raw.githubusercontent.com/mistrjirka/PiTTy/main/install.sh | sh
```

Then start PiTTy in the current project:

```bash
pitty
```

The installer validates `node`, `npm`, and `pi`, downloads a versioned release, verifies checksums when available, installs PiTTy's local Bun runtime, and creates the `pitty` and `pitty-resume` launchers.

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/mistrjirka/PiTTy/main/install.ps1 -OutFile $env:TEMP\pitty-install.ps1
& $env:TEMP\pitty-install.ps1 -WithPlugins
```

<details>
<summary><strong>Installer options and manual source installation</strong></summary>

The POSIX installer can include or skip the optional integrations without prompting:

```bash
curl -fsSL https://raw.githubusercontent.com/mistrjirka/PiTTy/main/install.sh -o /tmp/pitty-install.sh
sh /tmp/pitty-install.sh --yes --with-plugins
sh /tmp/pitty-install.sh --without-plugins
```

Custom paths and versions are supported through installer flags or `PITTY_INSTALL_DIR`, `PITTY_BIN_DIR`, `PITTY_VERSION`, and `PITTY_REPO`.

To run directly from source:

```bash
git clone https://github.com/mistrjirka/PiTTy.git
cd PiTTy
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/bun/install.js
npm run typecheck
node bin/pitty.mjs
```

</details>

## What PiTTy is

PiTTy is an independent frontend for the [Pi coding agent](https://github.com/earendil-works/pi). It keeps Pi's authentication, providers, models, sessions, tools, skills, prompt templates, and extensions while replacing Pi's built-in interactive terminal interface with a scrollable and inspectable OpenTUI application.

It starts directly in the normal chat. An empty conversation shows a passive dashboard with the PTY Tail mark, common commands, and recent sessions while the prompt remains focused and writable.

<p align="center">
  <img src="docs/images/pitty-terminal-preview.svg" width="760" alt="PiTTy terminal-native PTY Tail logo preview">
</p>

The README artwork is a real SVG image matching the original double-line and dotted-curve design. The terminal UI uses the closest portable Unicode approximation because OpenTUI renders character cells rather than arbitrary vector paths. Details and source assets are in [Branding](docs/BRANDING.md).

## Highlights

| Area | What PiTTy adds |
|---|---|
| Conversation | Fixed prompt, independently scrollable transcript, Markdown output, collapsible thinking, and long-session windowing |
| Tools | Expandable tool cards, timings, readable errors, edit/write diffs, and a generic fallback for arbitrary Pi tools |
| Navigation | Searchable model selector, `/sessions` and `/resume`, request map, command autocomplete, and on-demand older history |
| Workflow | Immediate steering while Pi runs, editable local follow-ups, prompt-focus recovery, and diagnostics bundles |
| Optional views | Parallel subagent inspection and control plus active/completed Todo panels when their Pi packages are installed |

## Quick usage

```bash
pitty                              # start in the current directory
pitty -C /path/to/project          # choose a project directory
pitty -c                           # continue the newest Pi session
pitty --session /path/to/file.jsonl
pitty-resume -C /path/to/project   # open the session picker immediately
pitty --help
```

Inside PiTTy:

```text
/resume      browse and switch current-project sessions
/model       show or change the current model
/thinking    show or change reasoning effort
/commands    list Pi extensions, templates, and skills
/help        show PiTTy commands and controls
```

See the complete [usage and controls guide](docs/USAGE.md).

## Controls

| Key | Action |
|---|---|
| `Enter` | Submit; while Pi runs, steer immediately |
| `Shift+Enter` | Insert a newline |
| `Alt+Enter` | Queue an editable local follow-up |
| `Alt+Up` | Restore the latest local follow-up to the editor |
| Mouse wheel / `PgUp` / `PgDn` | Scroll the active transcript |
| `Ctrl+Home` / `Ctrl+End` | Jump to the beginning or latest message |
| `Ctrl+P` | Open the searchable model selector |
| `Ctrl+T` / `Shift+Tab` | Cycle thinking effort |
| `Ctrl+R` | Open the request map |
| `Ctrl+S` | Toggle the sidebar |
| `Ctrl+O` | Expand or collapse tool and thinking details |
| `Ctrl+I` | Open or close the selected subagent inspector |
| `F6` / `Shift+F6` | Select the next or previous subagent |
| `Esc` | Close the active dialog/inspector or abort the current Pi turn |

## Optional integrations

PiTTy works without extra Pi packages. These integrations add specialized panels when installed:

| Package | Adds |
|---|---|
| `npm:pi-subagents` | Parallel child-agent list, live transcript inspection, pause/stop, and steering |
| `npm:@juicesharp/rpiv-todo` | Bounded active and completed Todo panels |

```bash
pi install npm:pi-subagents
pi install npm:@juicesharp/rpiv-todo
```

Missing integrations produce one informational notification; their panels remain hidden and the generic chat continues normally.

## Compatibility

PiTTy's RPC layer handles standard user, assistant, thinking, tool-call, and tool-result events; arbitrary tools; Pi extension commands; prompt templates and skills; extension dialogs; notifications; status updates; terminal-title changes; and editor prefilling.

Pi extensions that render arbitrary direct TUI components cannot be reproduced exactly because those component trees are not serialized through RPC. Their commands and tool events can still work through PiTTy's generic fallback, while richer behavior requires an optional adapter.

See [Open-source readiness and architecture](docs/OPEN_SOURCE_READINESS.md).

## Diagnostics and privacy

Diagnostics are stored under:

```text
~/.local/state/pitty/
```

Normal RPC logs omit prompt text, tool output, and source contents; they retain metadata, lengths, and short hashes. Absolute paths and error snippets can still appear, so inspect bundles before sharing them.

```bash
npm run diagnostics
```

Do not publish Pi credentials, session transcripts, private source code, or unreviewed `--verbose-rpc-logs` output. Security reporting guidance is in [SECURITY.md](SECURITY.md).

## Development

```bash
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/bun/install.js
npm run typecheck
npm run test:unit
```

Larger public behavior changes should include an OpenSpec change under `openspec/changes/`. Contributor guidance is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- [Usage and controls](docs/USAGE.md)
- [Branding and logo assets](docs/BRANDING.md)
- [Architecture and compatibility](docs/OPEN_SOURCE_READINESS.md)
- [Documentation index](docs/README.md)
- [Changelog](CHANGELOG.md)

## Platform status

| Platform | Status |
|---|---|
| Linux | Primary development platform |
| macOS | Included in CI and supported by the POSIX installer |
| Windows | Included in CI and supported by `install.ps1`; terminal behavior still benefits from wider real-world testing |
| WSL | Supported through the POSIX installer and Linux runtime |

Tagged releases are packaged by GitHub Actions as `pitty-<version>.tar.gz`, `pitty-<version>.zip`, and `SHA256SUMS`.

## License

MIT. See [LICENSE](LICENSE).

PiTTy is not affiliated with the Pi or OpenCode maintainers.
