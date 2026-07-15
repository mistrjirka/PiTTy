# Implementer prompt: finish PiTTy 0.4.0

You are implementing PiTTy 0.4.0 in `mistrjirka/PiTTy`.

Work only on branch:

```text
feature/0.4.0-welcome-updates
```

A draft pull request already exists from that branch to `main`. Do not commit directly to `main`, merge the pull request, create a release, or move tags. Complete the implementation on the feature branch, run the full validation suite, and leave the PR ready for human review.

## Read first

Before changing code, read these files completely:

```text
docs/HANDOFF_0.4.0.md
openspec/project.md
openspec/specs/core-rpc-ui/spec.md
openspec/specs/optional-integrations/spec.md
openspec/specs/installers/spec.md
openspec/specs/plugin-compatibility/spec.md
README.md
CONTRIBUTING.md
```

Inspect the exact exported API of the installed `@earendil-works/pi-coding-agent` version before relying on an import. Prefer supported public exports. Do not copy Pi credentials or reimplement provider-specific OAuth protocols.

## Goal

Finish PiTTy 0.4.0 as a coherent release containing:

1. A welcome screen shown when no session was explicitly selected.
2. Current-project session discovery and resume selection.
3. A PiTTy-native `/resume` flow.
4. Provider connection management with `/login`, `/logout`, and `/providers`.
5. A `Connect provider` action on the welcome screen.
6. `pitty upgrade` with safe rollback.
7. A non-blocking startup notification when a newer stable PiTTy release exists.
8. Hardened POSIX and Windows installers.
9. Executable installer smoke tests rather than string-only tests.
10. Updated OpenSpec, README usage documentation, changelog, and screenshot placeholders.

The result must continue to work when `pi-subagents` and `@juicesharp/rpiv-todo` are absent. Missing optional integrations must never crash startup.

## Non-negotiable constraints

- Preserve Pi authentication, sessions, models, tools, extensions, skills, prompt templates, and settings.
- Keep Pi as the agent backend. Do not replace the current RPC architecture in this release.
- Keep generic rendering for unknown tools and extensions.
- Do not expose credentials in transcripts, toasts, errors, diagnostics, process arguments, shell history, or test snapshots.
- Do not log API keys, OAuth codes, access tokens, refresh tokens, authorization headers, or full auth callback URLs containing secrets.
- Never write secrets into Solid signals that are retained longer than the active prompt requires.
- Secret input must be masked.
- Authentication cancellation must abort pending network work.
- Do not require root, `sudo`, administrator mode, or machine-wide installation.
- Do not run real provider logins or access real user credentials in tests.
- Do not make release checking or installer tests depend on the public internet.
- Keep Linux, macOS, Windows, and WSL in scope.
- Preserve current CLI compatibility unless an explicit replacement is documented and tested.
- Do not remove the existing `--continue`, `--session`, `--model`, `--provider`, `--thinking`, or diagnostic options.

## Phase 0: baseline and version source

1. Pull the latest `main` into the feature branch without discarding branch work.
2. Run the current baseline:

```bash
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/bun/install.js
npm run typecheck
npm run test:unit
```

3. Record existing failures before changing code.
4. Introduce one canonical application version source. Avoid separately hardcoding the version in `package.json`, `src/index.tsx`, update checks, and UI labels.
5. Bump the release version to `0.4.0` in all required package/lock metadata.
6. Add or update OpenSpec change material for the complete 0.4.0 scope before implementation.

## Phase 1: startup root and welcome screen

### Startup behavior

When launched with neither `--continue` nor `--session`, PiTTy must show a welcome screen before starting a normal empty Pi RPC session.

Rules:

- `pitty -c` or `pitty --continue`: skip welcome and continue the newest session.
- `pitty --session <path|id>`: skip welcome and open that session.
- No session option: show welcome.
- Selecting `New session`: start a new persistent Pi session.
- Selecting a previous session: start Pi with `--session <path>` or switch through RPC after startup, whichever produces the cleaner and more reliable architecture.
- Cancelling the welcome screen exits cleanly without creating a session.

### Session discovery

Use Pi's supported session APIs, preferably `SessionManager.list(cwd)`, rather than reverse-engineering Pi's encoded session directory manually.

Show only sessions applicable to the current working directory by default. Each row should include:

- session name when present
- otherwise a normalized preview of the first user message
- relative modified time
- message count
- optional short session ID as secondary information

The screen needs:

- loading state
- empty state
- readable error state
- keyboard navigation
- mouse selection
- selected-row highlight
- `Enter` to open
- `Esc` to exit
- a visible `New session` action
- a visible `Connect provider` action

Suggested layout:

```text
PiTTy
A fast terminal frontend for Pi

[ New session ]   [ Connect provider ]

Resume previous work
  Refactor authentication       8 min ago      42 messages
  Fix Windows CI                yesterday      18 messages
  Initial project review        3 days ago     91 messages

Ctrl+P models   Ctrl+T thinking   Enter select   Esc quit
```

Do not start background subagent artifact polling while the welcome screen is active.

### Startup model and thinking controls

`Ctrl+P` on the welcome screen should open a model selector backed by the same Pi model catalog/auth state used for provider management. A selected startup model must be passed to the Pi RPC process when the user starts or resumes a session.

`Ctrl+T` should cycle the startup thinking level and show the current value before the session starts.

If loading the model runtime fails, the user must still be able to start Pi with its normal defaults.

## Phase 2: PiTTy-native session resume

Add `/resume` to local command choices and help.

Required behavior:

- `/resume` opens the same current-project session selector used by the welcome screen.
- It must work from an active PiTTy session.
- Refuse or ask for confirmation when the current session is streaming or has pending local follow-ups.
- Use Pi RPC `switch_session` with the selected absolute session path.
- After switching, reload messages, state, stats, session name, model, thinking level, queues, windowing state, and subagent context.
- Reset inspector/dialog state that belongs to the prior session.
- Do not leave stale transcript items from the previous session.
- If an extension cancels the switch, preserve the current session and report that the switch was cancelled.
- Add a shortcut for the resume selector only when it does not conflict with existing terminal conventions. Document it if added.

Add a typed `switchSession(sessionPath)` method to `PiRpcClient` rather than sending an untyped raw command from the UI.

## Phase 3: provider connection and authentication

### Why this must be implemented outside current Pi RPC

Pi's native `/login` and `/logout` are built-in interactive-mode commands. Current Pi RPC exposes no login/logout/auth-status command, and `get_commands` does not include built-in TUI commands. PiTTy therefore must use Pi's public authentication/model runtime API directly for this release.

Do not send `/login` as a normal RPC prompt and pretend it is supported.

### Required commands and entry points

Implement:

```text
/providers
/login
/login <provider-id>
/logout
/logout <provider-id>
```

Also expose `Connect provider` on the welcome screen. In an active session, the provider manager should be reachable from `/providers` and `/login`.

### Runtime integration

Use Pi's public model/auth APIs where available, centered around `ModelRuntime` and its supported provider/auth methods. Inspect the exact installed package exports first.

Expected capabilities include equivalents of:

- provider enumeration
- provider auth capabilities (`api_key`, `oauth`, or both)
- `getProviderAuthStatus(providerId)`
- `listCredentials()`
- `login(providerId, authType, interaction)`
- `logout(providerId)`
- runtime/model refresh after auth changes

Do not directly edit `~/.pi/agent/auth.json` except through Pi's credential storage/runtime APIs.

Respect Pi profile and agent-directory overrides such as `PI_CODING_AGENT_DIR` and `PI_PROFILE` by relying on Pi's own config helpers/defaults rather than constructing `~/.pi/agent` paths manually.

### Provider manager UI

Show a searchable list with:

- provider display name
- provider ID
- authentication methods supported
- status: connected/stored, environment, runtime, or not configured
- number of currently available models when inexpensive to calculate

Example:

```text
Connect provider

  ChatGPT Plus/Pro (Codex)      OAuth       Not connected
  Claude Pro/Max                OAuth       Connected
  GitHub Copilot                OAuth       Not connected
  OpenRouter                    API key     Environment
  OpenCode Go                   API key     Stored
```

Provider names and capabilities must come from Pi's provider definitions rather than a hardcoded four-provider allowlist. A provider without interactive login support may be displayed as ambient/config-only with clear instructions instead of a broken login action.

### Auth interaction UI

Implement Pi's authentication interaction contract completely.

Supported prompt types:

- `text`
- `secret`
- `select`
- `manual_code`

Supported notification/event types:

- informational text and links
- authorization URL
- device code with verification URI, expiry and polling status
- progress messages

Requirements:

- `secret` is masked and never copied into transcript/history/logging.
- `manual_code` supports callback-code fallback flows.
- `select` uses a proper list selector.
- Authorization URLs are selectable/copyable.
- Attempting to open the system browser is optional convenience, never required for completion.
- Device codes are clearly separated from ordinary text and easy to copy.
- A cancel action aborts the whole login with `AbortController`.
- Per-prompt abort signals are respected.
- Progress replaces or updates one auth status region instead of flooding the transcript.
- Auth UI is modal and cannot accidentally submit its contents as an agent prompt.

### Refreshing the running Pi process

Writing credentials through a separate `ModelRuntime` instance does not guarantee that the already-running RPC process reloads its in-memory credential/model state.

Implement an explicit, safe refresh strategy:

- Before login/logout during an active session, require Pi to be idle.
- Capture the active session file/path and startup arguments.
- Complete the login/logout through Pi's auth API.
- Restart the Pi RPC child against the same session file when required so the provider/model catalog and credentials are reloaded.
- Rehydrate the UI exactly as after normal startup.
- Preserve the current session and unsent editor text.
- Never restart while a tool or model response is running.
- If restart fails, show a clear recovery message and retain the credential change; do not corrupt the session.

When on the welcome screen, simply refresh the startup model/provider state after login without starting an agent session.

### Logout behavior

- `/logout` without an argument opens the provider selector filtered to connected/stored providers.
- Ask for confirmation.
- Remove only the selected provider credential through Pi's API.
- Environment-provided credentials cannot be deleted by PiTTy; explain that the environment variable must be removed instead.
- Refresh/restart as described above.

### Authentication tests

Use a fake provider/runtime. Test:

- provider status rendering
- API-key login
- OAuth URL flow
- device-code flow
- manual-code flow
- select prompt
- cancellation
- per-prompt cancellation
- logout confirmation
- ambient credential behavior
- auth failure and retry
- no secret content in logs, transcript items, thrown error snapshots, or diagnostic bundles
- RPC restart/reload after auth mutation

No test may contact a real provider.

## Phase 4: update checks and `pitty upgrade`

### Startup update notification

After the main UI or welcome screen mounts, check asynchronously for a newer stable GitHub Release.

Requirements:

- never block startup
- use `releases/latest`
- ignore drafts/prereleases naturally through that endpoint
- timeout in roughly 2–3 seconds
- cache the check for 24 hours
- semantic version comparison, not lexical comparison
- no toast when current version is equal or newer
- network/API failure is silent in UI and debug-only in diagnostics
- support `PITTY_NO_UPDATE_CHECK=1`
- add `--no-update-check`

Example notification:

```text
PiTTy 0.4.1 is available. Run `pitty upgrade`.
```

### Upgrade commands

Implement at least:

```text
pitty upgrade
pitty upgrade --check
pitty upgrade --version 0.4.0
pitty --version
```

Prefer handling launcher-level subcommands in `bin/pitty.mjs` before starting OpenTUI.

`upgrade --check` must not mutate files. Define and document useful exit codes.

Use the installer belonging to the currently installed PiTTy release or shared local upgrade logic. Do not pipe an uninspected remote shell script directly into a shell. Preserve configured install/bin paths.

Upgrade default behavior must not reinstall, remove, or change optional Pi packages. Provide an explicit option when the user wants plugin reconciliation.

## Phase 5: installer hardening

### Shared safety model

Both installers must:

1. Resolve/download the requested release.
2. Download checksums.
3. Verify the selected asset strictly when checksum data exists.
4. Extract to a temporary location.
5. Validate required files:
   - `package.json`
   - `package-lock.json`
   - `bin/pitty.mjs`
   - `src/index.tsx`
6. Install dependencies into a sibling staging directory.
7. Install the local Bun runtime.
8. Validate staging with at least `pitty --help`.
9. Rename the old installation to a backup.
10. Move staging into place.
11. Validate the installed launcher.
12. Remove the backup only after success.
13. Restore the backup automatically on any post-swap failure.

Never remove Pi settings, credentials, sessions, or optional Pi packages during an upgrade.

### POSIX installer

Fix and test:

- useful errors for release 404, rate limit, transport failure and missing asset
- logs outside temporary cleanup paths
- strict checksum asset matching
- spaces/non-ASCII paths
- read-only install/bin directory detection
- rollback on npm, Bun, validation and move failure
- no `sudo`
- a clear unprivileged Pi installation hint when `pi` is missing

Optional plugin installation failures must be readable but nonfatal by default because PiTTy works without those packages. Preserve compatibility with the existing plugin-related flags; add a clearly named strict mode if a nonzero exit is desired.

### Windows installer

Fix the existing bug first: create `$Temp` before downloading into it.

Also implement/test:

- staging/backup/rollback equivalent to POSIX
- strict archive validation
- persistent logs
- paths with spaces/non-ASCII characters
- current-user PATH offer/removal without administrator rights
- Windows PowerShell 5.1 and PowerShell 7 compatibility, or explicitly document a narrower supported minimum
- plugin failures nonfatal by default

### Uninstallers

- remove only PiTTy-owned files
- keep optional Pi packages by default
- explicit option to remove supported optional packages
- Windows can remove only the PATH entry that PiTTy previously added

## Phase 6: executable installer tests and CI

Replace/supplement string-presence installer tests with real behavior tests using temporary directories and mocked commands/local fixtures.

Do not use the public network.

POSIX cases:

- latest release
- explicit version
- checksum success and mismatch
- missing asset
- malformed archive
- npm failure rollback
- Bun failure rollback
- staging validation failure rollback
- paths with spaces
- plugin accepted/declined/already installed/failed
- upgrade preserves old install on failure

Windows cases:

- temporary directory creation
- ZIP extraction and validation
- rollback
- user PATH handling
- plugin behavior
- paths with spaces

CI requirements:

- Ubuntu, macOS and Windows typecheck/unit tests
- shell syntax checks
- PowerShell syntax check
- installer smoke-test jobs
- release workflow validates typecheck/unit tests before publishing assets
- release source/lock scan for internal registry URLs or private package hosts

Keep the OpenTUI native cleanup caveat isolated from deterministic core/installer tests. A flaky native renderer cleanup must not hide failures in auth, sessions, updates or installer logic.

## Phase 7: documentation and screenshots

Update README with:

- concise product description
- install instructions for Linux/macOS/WSL and Windows
- first-run welcome/session behavior
- provider connection guide
- `/login`, `/logout`, `/providers`, `/resume`
- model/thinking shortcuts
- `pitty upgrade` and update-check controls
- optional integrations and graceful fallback
- troubleshooting for Pi missing, PATH, GitHub release errors and installer log locations
- uninstallation

Create screenshot placeholders without claiming they are real screenshots:

```text
docs/images/welcome-screen.png
docs/images/main-chat.png
docs/images/model-selector.png
docs/images/provider-login.png
docs/images/subagent-inspector.png
```

Until real captures exist, use a `docs/images/README.md` capture checklist and HTML comments in the main README rather than broken image links. Real terminal screenshots should be captured later from PiTTy itself; do not generate misleading mock screenshots and present them as authentic.

Update:

- `CHANGELOG.md`
- OpenSpec specs/change records
- `docs/HANDOFF_0.4.0.md` to mark implemented items and retain only genuine follow-ups
- CLI help
- command autocomplete/help output

## Required validation

Run from a clean checkout of the feature branch:

```bash
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/bun/install.js
npm run typecheck
npm run test:unit
```

Also run:

- targeted auth tests
- targeted session/welcome tests
- targeted update/version tests
- POSIX installer smoke tests
- Windows installer smoke tests in CI or an appropriate Windows environment
- `sh -n install.sh uninstall.sh`
- PowerShell parser/syntax validation
- manual Linux smoke test of welcome, resume, provider list and a non-secret mock auth flow

Do not claim Windows/macOS behavior was manually verified unless it actually was. Distinguish CI validation from real terminal testing.

## Definition of done

The branch is ready for review only when all of these are true:

- No explicit session option opens the welcome screen.
- `--continue` and `--session` bypass it.
- Sessions for the current project are selectable.
- `/resume` switches sessions without stale UI state.
- `/providers`, `/login`, and `/logout` work through Pi's auth APIs.
- OAuth/API-key prompts are complete and cancellable.
- Secrets never enter transcript or diagnostics.
- Auth changes are visible to the running Pi process through a tested refresh/restart strategy.
- `pitty upgrade --check` is non-mutating.
- `pitty upgrade` is rollback-safe.
- New-release notification is asynchronous and cached.
- Both installers preserve a working old installation after failure.
- Optional plugins remain optional and failures are readable/nonfatal by default.
- Real installer behavior tests exist.
- README/OpenSpec/changelog are current.
- Version is consistently `0.4.0`.
- TypeScript and all deterministic tests pass.

## Final response expected from the implementer

When finished, provide:

1. A concise architecture summary.
2. Exact files changed.
3. Commands/tests run and their results.
4. Platform validation matrix distinguishing CI from manual testing.
5. Security review focused on credentials and updater execution.
6. Remaining known limitations.
7. Any upstream Pi RPC feature request that would simplify future auth support.
8. Confirmation that no tag, release, merge or direct `main` push was performed.
