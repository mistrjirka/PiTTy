# PiTTy

PiTTy is a fast, independent OpenTUI frontend for the [Pi coding agent](https://github.com/earendil-works/pi). It keeps Pi's authentication, models, sessions, tools, skills, prompt templates, and extensions while replacing the built-in interactive terminal interface with a scrollable, inspectable UI.

PiTTy is not affiliated with the Pi or OpenCode maintainers.

## Highlights

- Fixed prompt with independently scrollable transcript and optional sidebar.
- Windowed long-session rendering with on-demand older history.
- Markdown assistant output and collapsible Markdown thinking.
- Distinct expandable tool cards with timings, errors, and edit/write diffs.
- Searchable model and current-project session selectors with immediate keyboard focus.
- Non-blocking empty-chat dashboard with common commands and recent sessions.
- Request map, command autocomplete, extension dialogs, editable local follow-up queue, and diagnostics.
- Generic fallback rendering for arbitrary Pi tools and extension commands.

## Optional integrations

PiTTy works without additional Pi packages. Two integrations add richer views:

| Package | Adds |
|---|---|
| `npm:pi-subagents` | Parallel child-agent list, live transcript inspection, pause/stop, and steering |
| `npm:@juicesharp/rpiv-todo` | Scrollable active/completed Todo panel |

At startup PiTTy detects them through `pi list`, Pi settings, and known package locations. Missing packages produce one informational notification; their panels are hidden and the main UI continues normally.

Install them manually at any time:

```bash
pi install npm:pi-subagents
pi install npm:@juicesharp/rpiv-todo
```

## Installation

### Linux, macOS, and WSL

After the first GitHub release is published:

```bash
curl -fsSL https://raw.githubusercontent.com/mistrjirka/PiTTy/main/install.sh | sh
```

The installer offers the optional integrations interactively. Noninteractive examples:

```bash
curl -fsSL https://raw.githubusercontent.com/mistrjirka/PiTTy/main/install.sh -o /tmp/pitty-install.sh
sh /tmp/pitty-install.sh --yes --with-plugins
sh /tmp/pitty-install.sh --without-plugins
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/mistrjirka/PiTTy/main/install.ps1 -OutFile $env:TEMP\pitty-install.ps1
& $env:TEMP\pitty-install.ps1 -WithPlugins
```

The installers:

- validate `node`, `npm`, and `pi`
- download a versioned release archive
- verify SHA-256 when release checksums are available
- install the local Bun runtime
- create `pitty` and `pitty-resume` launchers
- optionally install supported Pi packages
- print the failed command, exit code, log path, and recent output when something fails

Custom paths are supported through command-line flags or `PITTY_INSTALL_DIR`, `PITTY_BIN_DIR`, `PITTY_VERSION`, and `PITTY_REPO`.

### Manual source installation

```bash
git clone https://github.com/mistrjirka/PiTTy.git
cd PiTTy
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/bun/install.js
npm run typecheck
node bin/pitty.mjs -C /path/to/project --continue
```

## Usage

```bash
pitty -C /path/to/project --continue
pitty --session /path/to/session.jsonl
pitty-resume -C /path/to/project
pitty --help
```

Useful options:

```text
-C, --cwd <dir>       working directory
-c, --continue        continue the newest Pi session
--session <path>      open a specific Pi session
-m, --model <id>      choose a model
--provider <id>       choose a provider
--thinking <level>    set Pi thinking level
--pi <path>           use a non-default Pi executable
--no-sidebar          start without the sidebar
--session-picker      open the searchable session picker on startup
--log-dir <dir>       override diagnostic log directory
--no-logs             disable diagnostics
--verbose-rpc-logs    include RPC content; may contain prompts/source
```

Inside PiTTy, use `/sessions` or `/resume` to search and switch current-project sessions.

## Controls

| Key | Action |
|---|---|
| Enter | Submit; while Pi runs, steer immediately |
| Shift+Enter | Insert newline |
| Alt+Enter | Queue local follow-up |
| Alt+Up | Restore latest local follow-up to editor |
| Mouse wheel / PgUp / PgDn | Scroll active transcript |
| Ctrl+Home / Ctrl+End | Jump to start/end |
| Ctrl+P | Open model selector |
| Ctrl+T / Shift+Tab | Cycle thinking effort |
| Click Thinking | Collapse/expand one thinking block |
| Ctrl+R | Open request map |
| Ctrl+S | Toggle sidebar |
| Ctrl+O | Expand/collapse tool output globally |
| F6 / Shift+F6 | Select next/previous subagent |
| Ctrl+I / click subagent | Open/close subagent inspector |
| Ctrl+A | Pause selected running subagent |
| Ctrl+Shift+A | Stop selected active subagent |
| Ctrl+Shift+L | Create diagnostic bundle |
| Esc | Close dialog/inspector or abort current Pi turn |

## Plugin compatibility

The generic RPC layer supports:

- standard Pi user, assistant, thinking, and tool-result messages
- arbitrary tools through a generic card
- extension commands, prompt templates, and skills returned by Pi
- `select`, `confirm`, `input`, and `editor` extension dialogs
- notifications, status text, terminal title changes, and editor prefilling

Pi extensions that rely on direct custom TUI components cannot be reproduced exactly because those components are not serialized through RPC. Specialized plugin panels and controls belong behind optional PiTTy adapters; the generic transcript remains the fallback.

See [docs/OPEN_SOURCE_READINESS.md](docs/OPEN_SOURCE_READINESS.md) and [openspec/project.md](openspec/project.md).

## Diagnostics

Logs are stored by default under:

```text
~/.local/state/pitty/
```

Normal RPC logs omit prompt text, tool output, and source contents; they retain event metadata, lengths, and short hashes. Absolute paths and error snippets can still appear, so review bundles before sharing.

```bash
npm run diagnostics
```

Do not share Pi credentials, session transcripts, or unreviewed `--verbose-rpc-logs` output publicly.

## Development

```bash
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/bun/install.js
npm run typecheck
npm run test:unit
```

OpenSpec is included under `openspec/`. Add larger changes under `openspec/changes/<name>/` before implementation.

The OpenTUI render test can trigger a native TreeSitter/Bun cleanup crash on some systems; unit tests and TypeScript checking are separated so CI and contributors can still validate the non-native core reliably.

## Release and platform status

- Linux: primary development platform.
- macOS: included in CI and supported by the POSIX installer.
- Windows: included in CI and supported by `install.ps1`; terminal-specific behavior still needs broader real-world testing.
- WSL: uses the POSIX installer and Linux runtime.

Tagged releases are packaged by GitHub Actions as `pitty-<version>.tar.gz`, `pitty-<version>.zip`, and `SHA256SUMS`.

## License

MIT. See [LICENSE](LICENSE).
