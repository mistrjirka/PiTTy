# PiTTy 0.4.0 implementation handoff

This document describes the remaining work for the next PiTTy release. The branch `feature/0.4.0-welcome-updates` currently starts from the latest `main` and contains this planning document only. No unfinished application code is hidden on the branch.

## Current baseline

- Public repository: `mistrjirka/PiTTy`
- Current application version: `0.3.0`
- Primary platform: Linux / Arch / Konsole
- CI matrix: Ubuntu, macOS, Windows
- Pi transport: `pi --mode rpc`
- Optional integrations:
  - `npm:pi-subagents`
  - `npm:@juicesharp/rpiv-todo`
- Missing optional integrations already degrade gracefully: one informational notification, no crash, and plugin-specific panels remain hidden.
- The Windows RPC mock-launch issue and the timing-sensitive RPC test have already been fixed on `main`.

## Target release

Use `0.4.0` because the startup flow and executable interface change materially.

The release should add:

1. A welcome screen and resumable-session chooser.
2. `/resume` inside PiTTy.
3. `pitty upgrade` and update checks.
4. Hardened installers and executable installer tests.
5. Expanded usage documentation and screenshot placeholders.

## 1. Welcome screen and startup session selection

### Required behavior

When PiTTy is launched without `--continue` and without `--session`, it should not immediately drop the user into an empty transcript. Show a welcome screen first.

The welcome screen should contain:

- PiTTy name and one-line description.
- `New session` action.
- Recent sessions for the current working directory.
- Session name when present; otherwise the first user message.
- Relative modified time and message count.
- Loading state while session metadata is read.
- Empty state when no resumable sessions exist.
- Shortcut hints:
  - `Ctrl+P` model selector
  - `Ctrl+T` thinking effort
  - `Ctrl+S` sidebar
  - `Ctrl+R` request map once a session is open

Suggested layout:

```text
PiTTy
A fast terminal frontend for Pi

[ New session ]

Resume previous work
  Refactor authentication        8 min ago    42 messages
  Fix Windows CI                 yesterday    18 messages
  Initial project review         3 days ago   91 messages

Ctrl+P models   Ctrl+T thinking   Enter select   Esc quit
```

### Startup rules

- `pitty -c` or `pitty --continue`: skip welcome and continue the newest Pi session.
- `pitty --session <path|id>`: skip welcome and open that session.
- No session option: show welcome.
- Selecting `New session`: start Pi RPC without a session argument.
- Selecting a session: start Pi RPC with `--session <path>`.
- Cancelling the welcome screen should exit cleanly without creating a session.

### Recommended implementation

Introduce a root component that owns the startup state instead of mounting `App` directly.

Possible files:

```text
src/root.tsx
src/sessions/list.ts
src/ui/welcome.tsx
src/ui/session-selector.tsx
```

Use `SessionManager.list(cwd)` from `@earendil-works/pi-coding-agent` to discover current-project sessions. Do not duplicate Pi's directory encoding or JSONL parsing unless the SDK export becomes unavailable.

Do not spawn the Pi RPC process until the user chooses a session or `New session`. This prevents an unwanted empty session from being created merely by opening PiTTy.

### Acceptance criteria

- Launching plain `pitty` in a project with sessions shows the welcome screen.
- Launching plain `pitty` in a project without sessions shows a useful empty state.
- Choosing a session loads the correct transcript.
- Choosing `New session` opens an empty chat.
- `--continue` and `--session` retain their existing direct behavior.
- Keyboard and mouse selection both work.

## 2. In-application session selector and `/resume`

### Required behavior

Add a PiTTy-native `/resume` command. It should open the same session selector used by the welcome screen.

When a session is selected:

1. Ask for confirmation if the current agent is streaming.
2. Call the RPC `switch_session` command.
3. Reload `get_state`, `get_messages`, statistics, queues, subagent state, and message-window state.
4. Return focus to the prompt.

Also add a visible session action in an appropriate menu or status area later; `/resume` is the minimum required interface.

### RPC work

Add to `PiRpcClient`:

```ts
switchSession(sessionPath: string): Promise<{ cancelled?: boolean }>
```

The existing `loadCurrentSession()` logic in `src/app.tsx` can be reused after switching.

### Command autocomplete

Add local command metadata:

```text
/resume  Browse and open another session
```

Update `/help` and README controls accordingly.

### Acceptance criteria

- `/resume` opens recent current-project sessions.
- Selecting a session updates the transcript without restarting the terminal application.
- Cancel leaves the current session unchanged.
- A failed switch produces a readable toast and does not corrupt the current UI.

## 3. `pitty upgrade`

### Desired command interface

```bash
pitty upgrade
pitty upgrade --check
pitty upgrade --version 0.4.0
pitty upgrade --with-plugins
pitty upgrade --without-plugins
```

`pitty upgrade` should use the same release source and installation paths as the installer.

### Recommended architecture

Do not duplicate the installer logic in JavaScript. Add an installed metadata file, for example:

```text
<PITTY_INSTALL_DIR>/install.json
```

Suggested fields:

```json
{
  "version": "0.4.0",
  "repo": "mistrjirka/PiTTy",
  "installDir": "...",
  "binDir": "...",
  "pluginMode": "yes|no|unknown",
  "installedAt": "ISO timestamp"
}
```

The launcher should recognize `upgrade` before starting OpenTUI and invoke the platform installer:

- Linux/macOS/WSL: download `install.sh` to a temporary file, then execute it with explicit paths and options.
- Windows: download and execute `install.ps1` with explicit paths and options.

Never execute a remote script without first saving it locally. Print the URL and the local temporary path in verbose/error output.

### Upgrade safety

- Download and verify the new archive before touching the current installation.
- Install into a sibling staging directory.
- Run a lightweight validation from staging:
  - package metadata exists
  - Bun runtime exists
  - `pitty --help` succeeds
- Rename the current install to a backup.
- Move staging into place.
- Remove backup only after validation.
- On failure, restore the backup automatically.
- Never remove user Pi settings, sessions, or optional packages.

### Acceptance criteria

- Upgrading from an older release preserves the launcher and optional Pi packages.
- Failed dependency installation leaves the previous PiTTy usable.
- `pitty upgrade --check` changes nothing and returns a useful exit status.
- Installing an explicit version works even when it is not the latest release.

## 4. Startup update notification

### Required behavior

At startup, PiTTy should check for a newer stable GitHub Release without delaying the UI.

Example toast:

```text
PiTTy 0.4.1 is available. Run `pitty upgrade`.
```

### Constraints

- Run asynchronously after the UI mounts.
- Use a short network timeout, approximately 2–3 seconds.
- Failure must be silent in the UI and debug-only in logs.
- Cache the result and check at most once every 24 hours.
- Do not notify for an equal or older version.
- Ignore drafts and prereleases by using GitHub's `releases/latest` endpoint.
- Add a disable mechanism, for example:
  - `PITTY_NO_UPDATE_CHECK=1`
  - `--no-update-check`

### Suggested files

```text
src/update/check.ts
src/update/version.ts
test/update.test.ts
```

Implement a small semver comparator internally or use a lightweight dependency. Do not compare versions lexically.

## 5. Installer hardening

The current installers are usable but need another review before being advertised as broadly cross-platform.

### POSIX `install.sh`

Required improvements:

- Keep all error logs outside the temporary directory so cleanup never deletes diagnostics.
- Distinguish GitHub API 404, rate limiting, network failure, and missing assets in error text.
- Verify checksum by default when `SHA256SUMS` exists.
- Treat a checksum download that succeeds but lacks the selected asset as an error, not only a warning.
- Add explicit staging/backup/rollback behavior for upgrades and reinstalls.
- Preserve the prior installation until the new launcher passes validation.
- Validate that the extracted archive contains `package.json`, `bin/pitty.mjs`, and `src/index.tsx`.
- Detect a read-only install or bin directory before downloading dependencies.
- Keep installation unprivileged by default; never suggest `sudo npm install -g` for PiTTy.
- When `pi` is missing, provide a clear Pi installation hint rather than attempting an implicit privileged install.
- Make optional plugin failure semantics explicit:
  - PiTTy installation succeeds.
  - Return code `2` only when the user explicitly requested strict plugin installation, or document the current behavior prominently.

### Windows `install.ps1`

Important existing issue to fix first:

- `$Temp` is assigned but the directory is not created before `Invoke-WebRequest` writes the archive. Add `New-Item -ItemType Directory -Force -Path $Temp`.

Additional improvements:

- Implement staging/backup/rollback equivalent to POSIX.
- Validate archive structure before installation.
- Add the bin directory to the user PATH when approved, or offer a precise command to do it.
- Avoid machine-wide changes and administrator requirements.
- Preserve logs after all failures.
- Test paths containing spaces and non-ASCII characters.
- Confirm behavior on Windows PowerShell 5.1 and PowerShell 7, or document the supported minimum.

### Uninstallers

- Keep optional packages installed by default.
- Add an explicit optional flag to remove supported Pi packages.
- Remove only files owned by PiTTy.
- Offer removal of the PATH entry on Windows if the installer added it.

## 6. Executable installer tests

The current installer tests only inspect script text. Replace or supplement them with behavior tests.

### POSIX smoke tests

Run the installer against a local fake release server or mocked commands in `PATH`.

Test at least:

- latest release resolution
- explicit version
- checksum success
- checksum mismatch
- missing archive
- npm failure with preserved old installation
- Bun installation failure with preserved old installation
- paths containing spaces
- plugin accepted, declined, already installed, and failed
- `--without-plugins`
- upgrade rollback

Recommended tools:

- temporary directories
- fixture archive generated during the test
- fake `curl`, `npm`, `node`, and `pi` executables
- no real network access

### Windows smoke tests

Use a PowerShell test script or Pester where practical. At minimum execute the installer in GitHub Actions using mocked commands and a local fixture archive.

### CI improvements

- Keep `sh -n install.sh` and `sh -n uninstall.sh`.
- Add PowerShell syntax validation.
- Add installer behavior jobs.
- Make the Release workflow run typecheck and unit tests before publishing assets, or depend on a reusable validation workflow.
- Scan release sources and lock files for internal registry URLs.

## 7. Documentation and screenshots

### Usage guide

Expand README or add `docs/USAGE.md` covering:

- startup welcome flow
- new session vs continue vs resume
- queue and steering behavior
- thinking and model controls
- tool expansion and diffs
- subagent inspector and steering
- optional integrations
- diagnostics and privacy
- upgrade and uninstall

### Screenshot placeholders

Add these files or references:

```text
docs/images/welcome-screen.png
docs/images/main-chat.png
docs/images/tool-diff.png
docs/images/model-selector.png
docs/images/subagent-inspector.png
```

Actual screenshots from Konsole are preferred over generated mockups because terminal glyph width, colours, and mouse affordances need to match the real application. Add placeholders in README now; replace them with real captures before the public announcement.

Suggested capture settings:

- 1440×900 or similar 16:10 viewport
- dark terminal theme
- hide private project paths and prompts
- use a small public/demo repository
- include one screenshot with parallel subagents

## 8. OpenSpec changes

Add an OpenSpec change package before implementation:

```text
openspec/changes/pitty-0.4.0/
  proposal.md
  tasks.md
  specs/
    welcome-and-sessions/spec.md
    upgrades/spec.md
    installer-hardening/spec.md
```

The task list should map directly to this handoff and be updated as implementation proceeds.

## 9. Suggested implementation order

1. Fix and test the Windows installer temporary-directory bug.
2. Add installer staging, validation, rollback, and executable smoke tests.
3. Add update-version utilities and `pitty upgrade --check`.
4. Add full `pitty upgrade`.
5. Add the non-blocking startup update notification.
6. Implement session-listing utilities.
7. Add the welcome/root component and direct startup rules.
8. Add `/resume` using RPC `switch_session`.
9. Add documentation and screenshot placeholders.
10. Run CI on all platforms and perform real manual tests on Arch/Konsole and Windows Terminal.
11. Bump to `0.4.0`, update changelog, tag, and publish only after the Release workflow validates the commit.

## 10. Definition of done

The change is ready to merge when:

- TypeScript passes.
- Unit tests pass on Linux, macOS, and Windows.
- Installer behavior tests pass without network access.
- A clean install works on Linux.
- An upgrade from `0.3.0` preserves a usable previous installation on induced failure.
- Windows installer creates its temp directory and completes in Windows CI.
- Plain `pitty` shows welcome without creating an unwanted session.
- `pitty -c` and `pitty --session` bypass welcome.
- `/resume` switches sessions correctly.
- Startup update checks are cached, non-blocking, and suppressible.
- README includes the new flows and screenshot placeholders.
- Release assets contain no internal package-registry URLs.

## 11. Known non-goals for 0.4.0

- Recreating Pi's full interactive `/tree` UI.
- Deleting or renaming sessions from PiTTy.
- Automatic background installation of updates.
- Auto-installing Pi with elevated privileges.
- Reproducing arbitrary direct-TUI extension components that Pi RPC does not serialize.
