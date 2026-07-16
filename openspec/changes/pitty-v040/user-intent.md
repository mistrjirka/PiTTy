# User intent ledger (non-normative)

## Approved release direction

- Continue the planned 0.4.0 release, but remove its blocking welcome screen.
- Plain PiTTy startup must open the normal, immediately writable chat. A refined PiTTy logo replaces the welcome screen only as a passive empty-transcript state.
- The supplied `pitty_tail_icon.svg` is the canonical visual source. Its terminal rendering must be a refined glyph logo rather than direct SVG rendering or the current Minecraft-like proof-of-concept.
- Keep `/resume` as the in-application route to browse and switch sessions.

## Approved chat interaction requirements

- Keyboard input must keep reaching the main prompt after a non-input mouse click.
- Preserve a typed prompt draft when opening or closing the model selector. The current report may be visual occlusion rather than data loss, so the implementation must prove the actual behavior with a regression test before choosing a restore workaround. The selector must leave the prompt editor visibly usable rather than merely retaining a hidden draft.
- Command autocomplete must not overlap or hide the prompt editor.
- `Ctrl+O` is a global details toggle: if tools or thinking are open, collapse both; only expand both when both are collapsed. Individual thinking overrides are reset.
- Remove the dark/black left gap between the cyan assistant border and a thinking-only panel.
- Add local search to the model selector.

## Approved command-support boundary

- Expose Pi functionality available through the documented RPC protocol and continue showing RPC-provided extension, template, and skill commands.
- `/login` is not supported in PiTTy 0.4.0. When entered, do not forward it as a normal prompt or handle credentials. Show guidance: "Sorry, login is not supported in PiTTy yet. Run `pi` and use `/login` there; your credentials will then be available to PiTTy."
- Native API-key or web/OAuth login is deferred to a future release.

## Repository branding

- Commit the supplied SVG as a repository asset.
- Configure a GitHub social preview before public announcement; do not change the `mistrjirka` account avatar without separate approval.
- The current environment is not authenticated with `gh`; repository settings cannot be changed until the owner authenticates or supplies an appropriate token.

## Approved v0.3.3 slice

- Release the requested fixes and session/dashboard work as `v0.3.3` after full validation and `impl-check`.
- The empty-transcript view remains non-blocking but now includes the PiTTy logo, common commands, and recent sessions for the current directory; the main chat prompt remains immediately usable.
- `/sessions` and `/resume` are aliases for the same searchable current-directory session picker.
- Add a `pitty-resume` executable that starts the normal PiTTy application with that same picker open; do not implement a second picker.
- Search fields in the model and session pickers take focus immediately. Typing filters without a click, Up/Down navigates results, and selection or cancellation returns focus to the unchanged main chat draft.
- The subagent sidebar shows foreground and async agents, treats pending agents as active/queued, deduplicates resumed children, keeps inspector history stable, and removes the redundant Selected section.
- Pending steering/follow-up text must remain readable at constrained terminal heights.

## Approved completion scope

- Implement the full remaining update and upgrade path: cached startup notification, `pitty upgrade --check`, explicit-version upgrade, POSIX and PowerShell staged replacement with rollback, and local-fixture installer coverage.
- Parallel subagents must retain stable launch/index order in both sidebar and tool-call displays; changing activity timestamps must not reorder them.
- Each subagent display must show compact last-activity information without clipping the existing state or agent label.
- When slash-command suggestions are visible, unmodified Enter accepts the highlighted suggestion; a subsequent Enter executes the completed command.
- Ctrl+C clears a nonempty prompt draft and retains it in session-local input history; when the draft is empty, existing stream-abort and exit behavior remains unchanged.
- Up/Down restore older/newer session-local prompt history only when doing so does not interfere with multiline editing; cleared drafts are recoverable through that history.
- Installers detect optional Pi packages before prompting; they skip the prompt when all are present and offer only missing packages.
- Subagent detail and selected-child configuration displays use the child's reported model, context, and thinking level; missing child fields remain unknown rather than falling back to parent-session values.

## Explicitly deferred

- Full parity with Pi's direct interactive TUI, especially commands and components absent from RPC.
- PiTTy-owned credential storage, API-key entry, or OAuth/web login.
- GitHub social-preview upload and real terminal screenshot capture require maintainer/manual execution and remain release blockers until evidence is supplied.
