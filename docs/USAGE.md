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
| `Alt+Up` | Edit the last pending message |
| `Up` / `Down` on an empty single-line prompt | Browse session-local prompt history |
| `Ctrl+C` with a nonempty draft | Clear the draft and save it to prompt history |
| Mouse wheel / `PgUp` / `PgDn` | Scroll the active transcript |
| `Ctrl+Home` / `Ctrl+End` | Jump to the beginning or latest message |
| `Ctrl+P` | Open the searchable model selector |
| `Ctrl+X` | Open Settings |
| `Ctrl+T` / `Shift+Tab` | Cycle thinking effort |
| Click a Thinking heading | Toggle one thinking block |
| `Ctrl+R` | Open the request map |
| `Ctrl+M` | Browse, search, and remove persistent memory (requires `pi-hermes-memory`; on terminals that can't report it distinctly from Enter, use Settings > Memory or `/memory` instead) |
| `Ctrl+S` | Toggle the sidebar |
| `Ctrl+O` | Expand or collapse tool and thinking details globally |
| `Ctrl+I` / click a subagent | Open or close the subagent inspector |
| `F6` / `Shift+F6` | Select the next or previous subagent |
| `Ctrl+A` | Pause a selected running legacy `pi-subagents` child |
| Click `▶ Resume` | Resume a selected paused legacy `pi-subagents` child |
| `Ctrl+Shift+A` | Stop the selected active controllable subagent (both supported runtimes) |
| `Ctrl+Shift+L` | Create a diagnostics bundle |
| `Esc` | Cancel a pending-message edit, close the active dialog/inspector, or abort the current Pi turn |
| `Ctrl+C` twice from an empty draft | Exit PiTTy |

## Sessions

Use `/sessions` or `/resume` to search sessions associated with the current project. Selecting a session reloads its conversation inside the same PiTTy process. If Pi is currently streaming, PiTTy asks before switching.

The `pitty-resume` launcher is useful when choosing an existing session is the primary task:

```bash
pitty-resume -C /path/to/project
```

## Settings

`Ctrl+X` opens Settings. Model and Thinking effort control the active Pi session. **Compaction** selects the method and the action before cache expiry. Cache-aware compaction is the default. Choose **Two-model extension** to use `pi-one-round-compaction` when that extension is loaded. Installing the extension does not select it. The selected method applies to manual, automatic, and cache-expiry compaction.

**Before cache expiry** defaults to **Compact before expiry**. **Keep cache warm** refreshes a supported cache without compacting. **Off** disables expiry maintenance. Existing explicit cache-warming preferences are preserved. `/autocompact off` also pauses expiry compaction. Pi waits for a safe boundary and defers maintenance while you type. An unsupported method shows its reason.

**Claude account for new tabs** saves the profile used by the next tab or fork. Existing tabs keep their account. The footer reads usage from the active tab's provider query, with a profile-bound fallback for older runtimes. It labels both the 5-hour and weekly windows. `?` means unknown, and failed reads keep the last measurement marked stale with its age. Selecting another account does not relabel the active tab's numbers.

**Subagent models** lists every `@mistrjirka/pi-subagent` profile. Opening a profile shows its Model and Thinking level. In the Two-model extension mode, Compaction also exposes that extension's Model and Thinking settings. Changes apply to the next compaction or spawned child without a restart.

Compaction thinking is written to the top-level setting and to both the `audit` and `execution` lanes. This matters because the extension pins the audit lane to its own `medium` default, so a top-level-only change never reached it. The row shows the effective value for each lane when they differ.

The extension model and thinking controls edit the extension's own configuration — `one-round-compaction.json` in the Pi agent directory and `subagentProfiles` in `settings.json` — and preserve every other key, including per-lane compaction model overrides. Each row names the effective value and its source (`profile` means the agent's own `.md` frontmatter pins the value, so changing shared defaults alone will not move it — set the value on that agent instead). When a project-level `.pi/` configuration already overrides a value, PiTTy updates that file; otherwise it updates the global configuration. Thinking pickers list only the levels the selected model accepts, plus `off`.

## Models and thinking effort

`Ctrl+P` opens a searchable model selector. Search matches provider, model identifier, and display name. The list opens immediately and then syncs with Pi: a `syncing with Pi…` line shows while it refreshes, and a `sync failed — showing cached list` line when Pi cannot be reached. Closing or selecting a model returns focus to the unchanged chat draft.

Context windows are Pi's per-provider numbers (`openai/gpt-6.1-sol` reports 272k while the Codex entry reports 500k). PiTTy shows them as reported; pick the provider entry with the window you need.

Use `Ctrl+T`, `Shift+Tab`, or `/thinking` to change Pi's reasoning effort. Available levels depend on the selected provider and model.

## Follow-ups and steering

On PiTTy's managed runtime, `Enter` interrupts the current model request and delivers your correction. A running Python call yields a handle so Pi can respond while its current tool finishes. Completed tool operations are preserved. The script can pause before its next tool call and resume from its saved state.

Follow-up messages keep their queue behavior. During compaction, new messages wait until the saved context is ready. If a slash suggestion is visible, `Enter` accepts that suggestion first. `Alt+Enter` has no action in the main editor and leaves the draft unchanged.

The **Pending input** panel above the editor shows messages that Pi has not started processing:

| Action | Result |
| --- | --- |
| Click **Edit**, click the message text, or press `Alt+Up` | Open a pending message in the editor |
| Press `Enter` while editing | Save the changed message in its queue position |
| Click **Cancel edit** or press `Esc` while editing | Discard the edit and restore your previous draft |
| Click **Cancel** beside a pending message | Remove that message without stopping the current turn |
| Click **Combine next** | Join that message and its next neighbor with a blank line |

Combine is available only for consecutive messages with the same delivery mode. Messages stay separate unless you choose Combine.

The original message remains queued while you edit. If Pi starts processing it before you save or cancel the message, the action reports that it is no longer queued. An unsuccessful save keeps your edited text in the editor. It does not rewrite conversation history or resend the text automatically.

You can send more messages during manual or automatic compaction. Pi acknowledges and displays them in the queue, then processes them after compaction. The editor clears after queue acceptance, so another Enter does not duplicate the same draft.

With `pi-bg-bash` installed and PiTTy's managed runtime, accepted new input moves running foreground commands to the background. The same process keeps running, and its output remains available. Any explicit command timeout keeps its original deadline.

These RPC queue controls require PiTTy's managed Pi runtime. When you explicitly select an older Pi executable, local follow-ups remain editable and messages sent during compaction wait locally. Messages already queued inside that older runtime remain read-only.

## Tool timing

Tool rows show elapsed time and any declared command timeout. Bash timeouts use seconds, so a `7200`-second limit appears as `2h 0m`. A **wait up to** value limits a polling call, not the running task.

## Optional integration views

PiTTy remains fully usable without these packages:

```bash
pi install git:github.com/mistrjirka/pi-subagent
# Legacy runtime also supported: pi install npm:pi-subagents
pi install git:github.com/mistrjirka/pi-one-round-compaction
# Alternative compaction engine: pi install npm:pi-smart-compact
pi install npm:pi-web-access
pi install npm:pi-diet-semble
pi install npm:pi-hermes-memory
# MCP configuration from Settings: pi install npm:pi-mcp-adapter
```

`@mistrjirka/pi-subagent` adds profile-driven child-agent and nested-tree inspection, waiting-state visibility, steering, and stop controls. Legacy `pi-subagents` remains supported and additionally exposes its pause/resume controls. `pi-hermes-memory` backs the Memory browser with persistent global and project memory. `pi-web-access` adds web search and page-fetch tools, `pi-diet-semble` adds semantic code search, and `pi-one-round-compaction` adds one-round parallel compaction with streamed lane progress. `pi-smart-compact` remains supported as an alternative compaction engine and reports coarse compaction progress in PiTTy's existing surface.

### MCP servers

MCP works with Pi's built-in support (Pi 0.99 or newer) and with `pi-mcp-adapter`; the adapter is only needed on older Pi versions. Settings > MCP servers edits the active backend's own files:

- **Built-in MCP**: `~/.pi/agent/mcp.json` for every project and `.pi/mcp.json` for one project. Pi connects enabled servers at session start, so saved changes apply after PiTTy restarts the Pi session.
- **Adapter**: `~/.config/mcp/mcp.json` and `.mcp.json`.

If `-builtin:mcp` is still in `settings.json` (left behind by the adapter), Settings shows **Enable built-in MCP**; it removes that entry from the global and project settings and restarts the session. OAuth sign-in for HTTP servers is handled by Pi itself (`/mcp` in the Pi TUI, or `pi mcp login <server>`).

With the adapter, the sidebar shows `MCP <connected>/<enabled> connected` and hovering the row floats a tooltip-style card with the connected server names to its left; nothing below moves. Servers the adapter has cached but not connected — its deferred startup path — count as enabled but not connected until something uses them; the row falls back to the adapter's footer counts in that state. With built-in MCP, Pi does not expose live connection state to the host, so the sidebar shows `MCP <enabled> servers` and hovering floats the same kind of card with the enabled names, noting that Pi manages connections.

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

### The status bar lost a usage tracker

The footer shows Claude, Codex, and OpenCode usage only while everything fits in one row. When space runs out, the key hints step down first (`ctrl+o details` disappears) and only then do usage summaries shrink. A missing Codex segment with no `sync failed` notice and no fetch failure in the diagnostics log usually means the row was full; widen the terminal. If `~/.pi/agent/auth.json` has no `openai-codex` OAuth entry, the Codex segment is hidden until the next `/login`.

A `·stale 3h32m` marker on the Claude segment means cswap's live usage needs a relogin, so PiTTy shows the last fetched usage and its age instead of claiming the login expired. The model itself keeps working through Pi's own credentials.

### Terminal rendering looks wrong

Use a modern monospace terminal font with box-drawing support. Very small terminals fall back to the plain `PiTTy` wordmark to avoid clipping.

Image attachments in tool results appear as bounded inline previews, not Base64 text. PiTTy asks OpenTUI to choose Kitty graphics, Sixel, or Unicode blocks according to detected terminal capabilities. The `details` control enlarges the preview and shows any additional images. tmux can hide graphics capabilities: when passthrough is disabled or the outer terminal lacks a supported image protocol, the Unicode-block fallback is expected. PiTTy does not change tmux settings.

### Login is unavailable

Run the regular `pi` interface, complete `/login`, exit Pi, and start PiTTy again.

### Background jobs

Install `pi install npm:pi-bg-bash` to enable the optional background shell tools. While a Pi session is active, the right sidebar shows up to 100 current or recent jobs. Select a job to inspect its original command, current status, and scrollable output. **Older**, **Newer**, and **Latest** navigate 64-KiB output pages. **Analyze with Pi** is opt-in and sends the selected page to Pi. The viewer is read-only and does not consume the `bash_output` cursor.
