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

## Explicitly deferred

- Full parity with Pi's direct interactive TUI, especially commands and components absent from RPC.
- PiTTy-owned credential storage, API-key entry, or OAuth/web login.
