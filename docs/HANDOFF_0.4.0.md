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

Use `0.4.0` because the chat UI, model-selection workflow, and executable interface change materially.

The release should add:

1. Direct chat startup with a refined PiTTy logo empty state; no blocking welcome screen.
2. `/resume` inside PiTTy.
3. Durable main-chat interaction: focus, draft preservation, non-overlapping command suggestions, global details toggle, thinking layout, and unsupported-login guidance.
4. Search in the model selector without losing the main draft.
5. `pitty upgrade` and update checks.
6. Hardened installers and executable installer tests.
7. Expanded usage documentation, screenshot placeholders, and repository branding.

## 1. Direct startup and logo empty state

### Required behavior

Remove the planned welcome/session-selection screen. Plain `pitty` must start the existing chat UI directly, as it does in 0.3.0; it must not introduce a startup decision, block the prompt, or require a click before typing.

When a directly started session has no rendered conversation items, show a passive, centered PiTTy empty state in the transcript area. It is branding only, not an action surface: the main prompt remains visible, focused, and ready to accept input. Hide the empty state as soon as the first conversation item appears.

### Logo source and terminal treatment

- Commit the supplied source artwork as `docs/images/pitty-tail-icon.svg`. Preserve its title, description, view box, rounded path, and endpoint geometry as the canonical brand asset.
- Do **not** attempt to render the SVG in OpenTUI. The application is a terminal-cell renderer, not a browser SVG surface.
- Add a reusable `PittyLogo` terminal component, for example in `src/ui/logo.tsx`, derived from the asset and the supplied `pitty-logo-poc.tsx` reference. Use a compact and a wide layout selected from terminal dimensions.
- Refine the proof-of-concept away from its Minecraft-like appearance: avoid long `█`/heavy-box straight runs as the primary stroke. Prefer a small, restrained glyph composition with rounded/curved terminal glyphs where supported, two clearly separated square endpoints, one accent color, and a plain `PiTTy` wordmark. Keep every rendered line terminal-cell-width safe.
- Keep the logo purely decorative: no text input, mouse capture, startup state, or session-management responsibility belongs in the component.

### Startup rules

- `pitty -c` or `pitty --continue`: retain the existing direct-continue behavior.
- `pitty --session <path|id>`: retain the existing direct-session behavior.
- No session option: start Pi RPC and open the normal empty chat directly.
- `/resume` is the only 0.4.0 entry point for browsing and switching existing sessions.

### Recommended implementation

Do not add a root/welcome component or defer spawning Pi RPC for a startup choice. Add the logo empty state inside the existing transcript branch of `src/app.tsx`; it must coexist with the existing prompt and message-window behavior.

Possible files:

```text
src/ui/logo.tsx
src/app.tsx
test/render.test.tsx
docs/images/pitty-tail-icon.svg
```

### Acceptance criteria

- Plain `pitty` reaches a focused, writable main prompt without an intermediate welcome screen.
- `--continue` and `--session` retain their existing direct behavior.
- A new/empty conversation shows the refined PiTTy logo; the first conversation item removes it.
- The logo is legible at supported terminal sizes and does not cause horizontal overflow, clipping, or focus loss.
- The committed SVG is the canonical repository asset, even though the terminal view renders the glyph component.

## 2. In-application session selector and `/resume`

### Required behavior

Add a PiTTy-native `/resume` command. It should open a standalone current-project session selector; it is no longer part of startup.

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

### Command capability boundary

Continue merging local commands with the runtime `get_commands` response for Pi extension commands, prompt templates, and skills. Treat that response as authoritative for remote command availability. Pi's RPC protocol does not expose interactive built-in commands such as `/login`; do not imply full direct-TUI parity.

Add `/login` as a local autocomplete entry whose only behavior is the approved guidance to run `pi` and use `/login` there. It must never forward the command as a normal prompt, open an API-key/OAuth UI, read or write credentials, or log secrets. Native login is explicitly deferred beyond 0.4.0.

### Acceptance criteria

- `/resume` opens recent current-project sessions.
- Selecting a session updates the transcript without restarting the terminal application.
- Cancel leaves the current session unchanged.
- A failed switch produces a readable toast and does not corrupt the current UI.

## 3. Main-chat focus after mouse interaction

### Problem

The prompt receives keyboard input on initial launch, but clicking elsewhere can leave it unfocused. Subsequent typing then does not reach the main chat textarea. Existing explicit `prompt.focus()` calls cover startup and some dialog-close paths, but not the general mouse interaction path.

The model selector can also visually obscure the lower prompt on short terminals. Current evidence does not prove that it clears the textarea buffer, so a regression test must distinguish actual draft loss from visual occlusion before adding a restore workaround.

### Required behavior

- While no modal, model selector, prompt map, or subagent-inspector editor owns focus, keyboard text must go to the main chat textarea after any non-interactive transcript-area click.
- Clicking an interactive control must preserve that control's action; focus the prompt only after its action completes when that control does not intentionally own text input.
- Do not steal focus from extension input/editor dialogs, the model search field, or the subagent steering textarea.
- Existing close, cancel, selection, and `/resume` paths must still return focus to the main prompt.
- Opening, closing, or selecting a model must not submit, queue, replace, or clear an unsent main-prompt draft.
- Command suggestions must remain in layout flow above the prompt, be bounded for the terminal height, and never overlap or hide the prompt editor.
- `Ctrl+O` is a global details toggle: if tools or thinking are open, collapse both and reset individual overrides; only when both are collapsed, expand both.
- A thinking-only assistant panel must begin directly beside its cyan left border without a dark gutter.
- `/login` must be locally intercepted. Display: `Sorry, login is not supported in PiTTy yet. Run pi and use /login there; your credentials will then be available to PiTTy.` Do not forward it through RPC or handle credentials.

### Recommended implementation and validation

Centralize the policy in one named `focusMainPrompt()` helper in `src/app.tsx`, scheduled after the click/action so OpenTUI has completed its own pointer focus processing. Apply it at the transcript/background click boundary and reuse it from existing close paths rather than sprinkling new direct `prompt?.focus()` calls. Keep modal ownership checks in that helper or at its callers.

Add a render-level regression test that starts the app or a focused prompt harness, clicks a non-input transcript/background target using OpenTUI's mouse test support, then sends text and asserts that the prompt receives it. Cover a representative clickable transcript control and a modal/text-input exception. Add a model-selector test with a populated draft that checks textarea identity and content both while the modal is open and after it closes; test short terminal geometry separately. Add visual tests for bounded suggestions and a thinking-only row.

### Acceptance criteria

- Typing works immediately on launch and after clicking a non-input part of the main chat.
- Clicking a transcript action still performs that action and leaves the prompt ready for the next input when appropriate.
- Modal and secondary editor focus is not stolen.
- Opening or closing the model selector preserves an unsent draft and returns focus after close.
- Command suggestions do not overlap or hide a writable prompt in a constrained terminal.
- Ctrl+O globally collapses or expands both tool and thinking detail as specified.
- A thinking-only panel has no dark left gutter, and `/login` displays local Pi CLI guidance without an RPC prompt.
- The regression test fails without the focus-routing fix.

## 4. Searchable model selector

### Required behavior

Add a focused search textarea to the `Ctrl+P` model selector. It filters the already fetched, normalized model list locally as the user types; it must not issue another RPC request per keystroke.

- Match case-insensitively against provider, model id, and display name.
- Preserve the existing provider/id sort order within the filtered result.
- Reset selection to the first matching model when the query changes.
- Display the matched count and an explicit empty state. In the empty state, Enter must not select a stale model.
- `Esc` closes the selector and returns focus to the unchanged main prompt draft. Selecting a model retains the existing RPC behavior and also returns focus without submitting or clearing that draft.
- Mouse selection, arrow navigation, and Enter selection remain usable with the search field present.

### Recommended implementation and validation

Extend `src/ui/model-selector.tsx` rather than creating a second model-list abstraction. Export a small pure filtering helper with the existing `ModelChoice` type, then make the dialog own only the query and focus coordination. Update `src/app.tsx` only for dialog focus/close integration.

Add focused tests for provider/id/name matches, case insensitivity, no matches, and the rendered search/empty state. Extend the existing model selector render test for keyboard/mouse behavior if the OpenTUI harness supports it.

### Acceptance criteria

- A user can narrow a large model list by typing provider, id, or name.
- Clearing the query restores all normalized choices in the existing order.
- No match cannot select the prior model.
- Closing or selecting returns keyboard input to the main prompt.

## 5. Repository branding on GitHub

### Required behavior and constraint

Use the committed SVG as PiTTy's canonical branding asset and add it to the README or usage documentation where GitHub can render it. A GitHub repository itself has no independent avatar/logo setting: its visible avatar is the owner account or organization avatar. Do not change the `mistrjirka` account avatar as part of this release without separate, explicit approval because it affects every repository owned by that account.

Configure the repository's social-preview image manually in GitHub **repository Settings → Social preview → Edit** using a raster export of the canonical SVG. GitHub recommends a PNG, JPG, or GIF under 1 MB and at least 640×320 (ideally 1280×640), so use a social-card composition rather than the raw square icon. The installed `gh repo edit` command has no logo or social-preview flag; do not rely on an undocumented `gh api` call.

This environment's `gh` session is currently unauthenticated, so no GitHub settings can be changed until the repository owner runs `gh auth login` (or supplies a suitable `GH_TOKEN`) and approves the scope. Treat that as release-preparation work, not a code-path blocker.

### Acceptance criteria

- The SVG is committed and displayed from repository content in GitHub-rendered documentation.
- A maintainer has configured and visually checked the social preview before the public announcement.
- The personal-account avatar is unchanged unless separately approved.

## 6. `pitty upgrade`

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

## 7. Startup update notification

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

## 8. Installer hardening

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

## 9. Executable installer tests

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

## 10. Documentation, screenshots, and repository branding

### Usage guide

Expand README or add `docs/USAGE.md` covering:

- direct startup and the logo empty state
- continue vs `/resume`
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
docs/images/empty-chat-logo.png
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

## 11. OpenSpec changes

Add an OpenSpec change package before implementation:

```text
openspec/changes/pitty-v040/
  proposal.md
  tasks.md
  specs/
    branding-and-sessions/spec.md
    chat-input-focus/spec.md
    model-selector-search/spec.md
    upgrades/spec.md
    installer-hardening/spec.md
```

The task list should map directly to this handoff and be updated as implementation proceeds.

## 12. Suggested implementation order

1. Fix and test the Windows installer temporary-directory bug.
2. Add installer staging, validation, rollback, and executable smoke tests.
3. Add update-version utilities and `pitty upgrade --check`.
4. Add full `pitty upgrade`.
5. Add the non-blocking startup update notification.
6. Implement session-listing utilities and `/resume` using RPC `switch_session`.
7. Commit the canonical SVG, implement the refined terminal logo empty state, and keep direct startup unchanged.
8. Fix and regression-test main-chat focus, draft preservation, bounded command suggestions, global Ctrl+O detail controls, thinking-only alignment, and local `/login` guidance.
9. Add and test model-selector search without draft loss or stale selection.
10. Add documentation and screenshot placeholders; configure and verify GitHub social preview after authenticating `gh` or through repository Settings.
11. Run CI on all platforms and perform real manual tests on Arch/Konsole and Windows Terminal.
12. Bump to `0.4.0`, update changelog, tag, and publish only after the Release workflow validates the commit.

## 13. Definition of done

The change is ready to merge when:

- TypeScript passes.
- Unit tests pass on Linux, macOS, and Windows.
- Installer behavior tests pass without network access.
- A clean install works on Linux.
- An upgrade from `0.3.0` preserves a usable previous installation on induced failure.
- Windows installer creates its temp directory and completes in Windows CI.
- Plain `pitty` opens the direct chat with a focused prompt and the logo empty state; it has no welcome screen.
- `pitty -c` and `pitty --session` retain direct behavior.
- `/resume` switches sessions correctly.
- A click in the main chat does not strand keyboard input outside the prompt; modal/editor exceptions retain their own focus.
- Opening, closing, or selecting from the model selector preserves an unsent draft; command suggestions never overlap the prompt.
- Ctrl+O is a global tool-and-thinking details toggle, thinking-only panels have no dark left gutter, and `/login` gives local Pi CLI guidance without credential handling.
- The model selector filters locally by provider, id, and name without stale selection.
- Startup update checks are cached, non-blocking, and suppressible.
- README includes the new flows, canonical logo, and screenshot placeholders; a maintainer has verified the GitHub social preview.
- Release assets contain no internal package-registry URLs.

## 14. Known non-goals for 0.4.0

- Recreating Pi's full interactive `/tree` UI.
- Deleting or renaming sessions from PiTTy.
- Automatic background installation of updates.
- Auto-installing Pi with elevated privileges.
- Changing the `mistrjirka` account avatar as repository branding.
- Reproducing arbitrary direct-TUI extension components that Pi RPC does not serialize.
