# Using PiTTy

[← Back to README](../README.md) · [Documentation index](README.md)

PiTTy starts the normal Pi chat immediately. A new empty session shows the logo, common commands, and recent sessions without taking focus away from the prompt.

## Launching PiTTy

```bash
pitty                              # current directory
pitty -C /path/to/project          # another project directory
pitty -c                           # continue the newest session
pitty --session /path/to/file.jsonl
pitty-resume -C /path/to/project   # open the session picker immediately
```

### Command-line options

| Option | Purpose |
| --- | --- |
| `-C, --cwd <dir>` | Set the working directory |
| `-c, --continue` | Continue the newest Pi session |
| `--session <path>` | Open a specific session file |
| `-m, --model <id>` | Select a model |
| `--provider <id>` | Select a provider |
| `--thinking <level>` | Set the initial thinking level |
| `--pi <path>` | Use a non-default Pi executable |
| `--no-sidebar` | Start with the sidebar hidden |
| `--session-picker` | Open the session picker at startup |
| `--log-dir <dir>` | Override the diagnostics directory |
| `--no-logs` | Disable file diagnostics |
| `--verbose-rpc-logs` | Include RPC contents; may expose prompts or source |

Run `pitty --help` for the launcher-supported list in the installed version.

## Commands inside PiTTy

Type `/` to open command suggestions. PiTTy merges its local commands with extension commands, prompt templates, and skills reported by Pi.

| Command | Purpose |
| --- | --- |
| `/help` | Show PiTTy commands and controls |
| `/commands` | List Pi extension, template, and skill commands |
| `/sessions` | Browse and resume current-project sessions |
| `/resume` | Alias for `/sessions` |
| `/model` | Show or change the active model |
| `/models` | List available models |
| `/thinking` | Show or change reasoning effort |
| `/thoughts` | Expand or collapse thinking blocks |
| `/prompts` or `/map` | Open the request map |
| `/memory` | Browse, search, and remove persistent memory (requires `pi-hermes-memory`) |
| `/compact` | Compact conversation context |
| `/new` | Start a new Pi session |
| `/name` | Set the session name |
| `/tools` | Expand or collapse tool output |
| `/sidebar` | Enable or disable the sidebar |
| `/settings` or `/status` | Show current UI and Pi settings |

`/login` is not implemented through Pi's current RPC interface. PiTTy displays guidance to run `pi` directly and use `/login` there; the resulting Pi credentials are then available to PiTTy.

## Keyboard and mouse controls

| Input | Action |
| --- | --- |
| `Enter` | Insert the highlighted slash suggestion first; otherwise submit or send immediate steering |
| `Shift+Enter` | Insert a newline |
| `Alt+Enter` | Queue an editable local follow-up |
| `Alt+Up` | Restore the latest local follow-up to the editor |
| `Up` / `Down` on an empty single-line prompt | Browse session-local prompt history |
| `Ctrl+C` with a nonempty draft | Clear the draft and save it to prompt history |
| Mouse wheel / `PgUp` / `PgDn` | Scroll the active transcript |
| `Ctrl+Home` / `Ctrl+End` | Jump to the beginning or latest message |
| `Ctrl+P` | Open the searchable model selector |
| `Ctrl+T` / `Shift+Tab` | Cycle thinking effort |
| Click a Thinking heading | Toggle one thinking block |
| `Ctrl+R` | Open the request map |
| `Ctrl+M` | Browse, search, and remove persistent memory (requires `pi-hermes-memory`) |
| `Ctrl+S` | Toggle the sidebar |
| `Ctrl+O` | Expand or collapse tool and thinking details globally |
| `Ctrl+I` / click a subagent | Open or close the subagent inspector |
| `F6` / `Shift+F6` | Select the next or previous subagent |
| `Ctrl+A` | Pause the selected running file-controlled subagent |
| `Ctrl+Shift+A` | Stop the selected active file-controlled subagent |
| `Ctrl+Shift+L` | Create a diagnostics bundle |
| `Esc` | Close the active dialog/inspector or abort the current Pi turn |
| `Ctrl+C` twice from an empty draft | Exit PiTTy |

## Sessions

Use `/sessions` or `/resume` to search sessions associated with the current project. Selecting a session reloads its conversation inside the same PiTTy process. If Pi is currently streaming, PiTTy asks before switching.

The `pitty-resume` launcher is useful when choosing an existing session is the primary task:

```bash
pitty-resume -C /path/to/project
```

## Models and thinking effort

`Ctrl+P` opens a searchable model selector. Search matches provider, model identifier, and display name. Closing or selecting a model returns focus to the unchanged chat draft.

Use `Ctrl+T`, `Shift+Tab`, or `/thinking` to change Pi's reasoning effort. Available levels depend on the selected provider and model.

## Follow-ups and steering

While Pi is running:

- If a slash suggestion is visible, `Enter` accepts the highlighted suggestion first.
- Otherwise, `Enter` sends text immediately as steering.
- `Alt+Enter` keeps text in PiTTy's local editable follow-up queue.
- `Alt+Up` restores the newest local queued item to the editor.

Items already sent to Pi through RPC can be displayed but cannot be edited afterward.

## Optional integration views

PiTTy remains fully usable without these packages:

```bash
pi install npm:pi-subagents
pi install npm:@juicesharp/rpiv-todo
```

`pi-subagents` adds child-agent selection, live transcript inspection, steering, pause, and stop controls. `rpiv-todo` adds bounded active and completed Todo panels.

## Updates and upgrades

PiTTy checks GitHub Releases asynchronously at startup; set `PITTY_NO_UPDATE_CHECK=1` to disable it. Use `pitty upgrade --check` to inspect the available version, or `pitty upgrade --version <version>` for an explicit target. Upgrades require the selected archive's SHA-256 entry in `SHA256SUMS`, stage replacement in a sibling `.pending` directory, activate on the next normal start, and roll back if activation validation fails.

## Subagent ordering

Active and queued subagents are grouped first. Within each group, launch/index order remains stable; activity updates do not reorder peers.

## Diagnostics

Normal logs are written under `~/.local/state/pitty/`. Create a shareable archive with:

```bash
npm run diagnostics
```

Review the archive before sharing it. Normal RPC logs omit full prompt, source, and tool-output contents, but paths and error snippets may remain. `--verbose-rpc-logs` can contain sensitive material.

## Common troubleshooting

### PiTTy cannot find Pi

Confirm that the Pi executable is available:

```bash
pi --version
```

Use `pitty --pi /path/to/pi` when Pi is installed outside `PATH`.

### Optional panels are missing

Run the corresponding `pi install` command above, then restart PiTTy. Missing optional integrations are intentionally nonfatal.

### Terminal rendering looks wrong

Use a modern monospace terminal font with box-drawing support. Very small terminals fall back to the plain `PiTTy` wordmark to avoid clipping.

### Login is unavailable

Run the regular `pi` interface, complete `/login`, exit Pi, and start PiTTy again.
