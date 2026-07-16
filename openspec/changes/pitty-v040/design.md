## Context

PiTTy is a Solid/OpenTUI terminal frontend that launches Pi in RPC mode. Pi owns agent execution, sessions, models, provider credentials, extension commands, prompt templates, and skills. The current application already has a stable main textarea, transcript renderer, model selector, RPC command client, installer scripts, and bounded render tests.

The 0.4.0 handoff originally proposed a blocking welcome screen. The accepted direction keeps direct chat startup and uses branding only as an empty transcript state. The same release also combines several interaction fixes in the shared `App`/UI control layer and expands release/install safety.

## Goals / Non-Goals

**Goals:**

- Preserve Pi as the source of truth while making its documented RPC surface discoverable and usable in PiTTy.
- Keep the main prompt visible, focused when appropriate, and draft-safe during transient UI states.
- Make detail expansion and model selection predictable on mouse and keyboard.
- Make upgrades and reinstallations atomic from the user's perspective.
- Use the supplied logo as the canonical repository asset and a terminal-safe visual source.

**Non-Goals:**

- Reproduce Pi's direct interactive TUI or its private component APIs.
- Implement PiTTy-owned API-key entry, OAuth, browser login, credential persistence, or `/logout`.
- Forward unsupported built-in commands such as `/login` to Pi RPC.
- Add a startup session chooser or require a startup click before typing.

## Decisions

### Keep direct startup; render branding as a passive empty state

The existing `App` continues to start Pi RPC immediately. `src/app.tsx` owns whether no conversation items are rendered; `src/ui/logo.tsx` owns only responsive terminal glyph presentation. The supplied SVG is committed as documentation/repository source, but is not rendered directly in a terminal cell grid.

The empty transcript renders a non-blocking dashboard: logo, a compact common-command reference, and recent current-directory sessions. Session discovery starts asynchronously and does not delay prompt focus. The fixed dashboard region keeps the same layout while session data is loading, available, empty, or failed; only its session content changes. When transcript items exist, the dashboard disappears.

Alternative considered: a root welcome component that delayed RPC startup. Rejected because it adds a startup decision and contradicts the approved direct-chat flow.

### Use one session source and one picker across all entry points

`SessionManager.list(cwd)` from the pinned Pi SDK is the current-directory session source because RPC exposes switching but no session-list command. A small session module maps public `SessionInfo` values into the UI's named session-choice contract. `src/ui/session-selector.tsx` owns transient search and keyboard selection; `src/app.tsx` owns loading, switching, confirmation, state reload, and prompt focus.

`/sessions` and `/resume` open the same picker. `pitty-resume` invokes the normal PiTTy launcher with an internal startup-picker option rather than implementing another UI. Selection sends the documented RPC `switch_session` command, then reloads the current state through the existing `loadCurrentSession()` path. Cancellation or failure preserves the active transcript. The empty-state dashboard reuses the same loaded choices and selection path.

Alternative considered: invoke Pi's native `--resume` TUI. Rejected because that picker requires terminal stdin/stdout and conflicts with PiTTy's RPC pipes.

### Treat prompt integrity as a tested state contract

`src/app.tsx` owns one main-prompt focus helper and the current draft state. Opening a modal transfers focus but must not clear or overwrite the main draft; closing/selection returns focus only after the modal unmounts. Model and session search editors explicitly focus themselves after mounting so typing works without a click; Tab/Shift+Tab and Up/Down preserve intentional search/list ownership. A regression harness must distinguish actual buffer loss from an absolute modal visually covering the editor before adding restore state.

The command suggestion panel remains in normal layout flow directly above a reserved-height prompt region. It is capped to the available vertical space and never overlays the textarea. The model selector uses the same reserved prompt region: on short terminals, its selectable content shrinks or scrolls instead of covering the editor.

Alternative considered: restoring a saved draft on every modal close. Rejected because it can resurrect text that a submit/queue action intentionally cleared.

### Make Ctrl+O a global details toggle

The global state decides whether all detail is open. If tools or thinking are currently open, Ctrl+O collapses both and resets individual tool/thinking overrides; if both are fully collapsed, it expands both. Individual mouse controls remain local. `MessageView` receives resolved state only and retains no competing global state.

The thinking panel's background is placed against the assistant border for thinking-only messages; answer padding remains local to the answer branch so it does not introduce a dark left gutter.

### Keep model search local to fetched normalized choices

`normalizeModelChoices` remains the trust boundary for RPC model payloads. `src/ui/model-selector.tsx` owns a transient query, filtering pure normalized `ModelChoice` values by provider, id, and display name. It resets selection when the result set changes and renders a non-selectable empty state. It never refetches models per keystroke or writes to the main prompt.

### Use a capability-aware command boundary

PiTTy merges local commands with `get_commands` results, which are the extension/template/skill commands documented by Pi RPC. Local command dispatch owns explicit guidance for `/login`: it displays the accepted message and does not send credentials or an unsupported built-in command across RPC. Unknown commands keep the current prompt forwarding behavior so future RPC-supported commands are not blocked.

Alternative considered: a native login modal. Deferred because Pi RPC explicitly excludes built-in login and PiTTy must not independently implement or persist credentials without a separate security-reviewed change.

### Use staged installer replacement and explicit release checks

Installers and `pitty upgrade` share release source, selected version, install paths, and optional-plugin mode through installed metadata. A candidate installation is downloaded with its selected asset entry in the exact GitHub Release `SHA256SUMS` over HTTPS, checksum/structure-validated, installed into a sibling staging directory, smoke-validated, then atomically swapped with the prior install retained as a rollback backup. This detects accidental or in-transit corruption, not a compromised GitHub Release; release signing is intentionally out of scope. Tests use local fixture releases and mocked tools; no live release network is required.

### Keep repository branding scoped

The SVG lives in repository content and documentation. GitHub social-preview upload is a manual release task because GitHub CLI's repository edit command has no social-preview upload option. A social card is rasterized separately; the owner avatar remains unchanged.

## Risks / Trade-offs

- [Modal appears to clear the prompt but only obscures it] → Add an open/close test that asserts textarea identity, draft content, and visual geometry before choosing a fix.
- [OpenTUI focus changes after pointer dispatch] → Schedule prompt refocus after the action and test modal/editor exceptions.
- [Long command lists crowd a short terminal] → Cap visible suggestions using available height and preserve the prompt's minimum height.
- [Session discovery is slower or fails] → Keep the dashboard/picker container stable, preserve prompt input, and render explicit loading, empty, or readable error content.
- [Plugin-specific foreground subagent progress changes] → Parse progress defensively, keep async lifecycle artifacts as fallback, and treat malformed details as non-fatal.
- [Pi's RPC surface changes across versions] → Treat documented `get_commands` output as authoritative at runtime, preserve the active session on unsupported RPC calls, and keep unsupported built-ins as local guidance.
- [Upgrade failure leaves a broken launcher] → Validate the staged launcher before replacing the old install and restore the backup on every post-backup failure.
- [Checksum asset and release are both compromised] → 0.4.0 does not claim signed-release authenticity; document this threat-model limit and keep installation source restricted to the selected GitHub Release over HTTPS.
- [Logo glyph width varies by terminal] → Use terminal-cell-safe glyphs, compact/wide layouts, a constrained-terminal wordmark fallback, and render tests at constrained dimensions.

## Migration Plan

1. Land each change behind existing direct startup and RPC interfaces; no persisted data migration is needed for chat interactions.
2. Add installed metadata only when the upgrade implementation is ready; missing metadata keeps existing installation behavior and produces guidance rather than deletion.
3. Publish the SVG and documentation before manual social-preview configuration.
4. If an upgrade fails after staging, restore the previous directory and launcher before reporting failure.

## Open Questions

- None for 0.4.0. Native credential and OAuth support is intentionally deferred to a future, separately reviewed change.
