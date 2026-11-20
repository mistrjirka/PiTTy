# User input, tab scrolling and skill selection

## Why

Normal Enter can already deliver queued input during compaction and release a foreground background-capable command. A parent blocked in `agent_wait` still waits for the child or timeout. The separate Alt+Enter follow-up shortcut is no longer wanted. The user also reports unexpected transcript jumps after opening another tab, and has removed ten skills from the public package selection.

## Changes

- Remove the Alt+Enter follow-up shortcut and its hints. Prevent the editor library's default Alt+Enter submit action from replacing it. Keep normal Enter submission, Shift+Enter newlines and pending-message editing.
- End active same-session `agent_wait` calls when accepted ordinary steering input arrives. Return current child state and explain the interruption without stopping child agents or aborting the whole turn.
- Preserve explicitly deferred follow-up messages, extension-generated input, normal wait completion, timeouts, parent cancellation and older Pi versions that do not emit the optional input event.
- Keep delayed first-tab startup history and scheduled scrolling scoped to that runtime. Derive active UI readiness from the selected runtime so another ready tab survives the first tab's startup failure. Preserve normal following and intentional navigation.
- Require the revised public skills package with seven remaining skills. Remove only the ten user-rejected skills, restore their private wiki sources, and leave the eleven agent profiles unchanged. Do not add skills without approval.

## Boundaries

Existing conversations and saved queue modes remain readable. The work does not terminate child agents or unrelated commands when new input arrives. It does not change model defaults, credentials or existing custom agent profiles.

## Validation

- Reproduce removed Alt+Enter behavior with the actual terminal renderer under legacy and Kitty key protocols. Verify normal Enter, Shift+Enter and pending-message edits.
- Test accepted input, ignored input sources/modes, cancellation and cleanup around active waits. Use an actual managed Pi RPC process with a fake provider to prove prompt delivery while child work remains active, without paid model calls.
- Add a reproducible scroll regression for the confirmed tab-jump cause and run the UI suite.
- Validate the reduced skills manifest and private wiki builds. Verify cached founder setup updates to the revised package.
- Run PiTTy typecheck, unit tests, UI checks and runtime build before release.


## Verified outcome

- The delayed-startup regression loads 200 first-tab history rows after activating another tab. The active window now stays at index 0 instead of being reset to 80, and its scroll, commands, focus and status remain unchanged.
- Both terminal key protocols suppress Alt+Enter while preserving Enter, Shift+Enter and pending edits. Footer-width coverage uses the current text rather than old shortcut widths.
- The real managed-Pi RPC fixture launches one actual child process. Accepted user input ends the active wait, reaches the parent model and leaves the same child PID running. Rejected, handled, duplicate and deferred input do not interrupt it. A later wait completes normally.
- pi-subagent 0.5.26 passes 444 tests and TypeScript. Published Pi 0.87.1 loads the optional hook without requiring the newer behavior.
- A real founder update changes the canonical bundle from 17 skills at 0.1.0 to 7 at 0.2.0 and subagents from 0.5.25 to 0.5.26. All eleven agent hashes and modification times stay unchanged. Discovery has no diagnostics or model pins. Check and repeat are idempotent.
- Automatic cache refresh protects source edits and unpublished commits. It accepts generated npm files, explicit pins, older forks/local checkouts and a clean detached checkout returning to the maintained source. Its update target matches Pi's origin-tracking behavior.
- All ten removed skills are restored privately from their original sources. Public manifest validation and six tests pass. The private wiki passes twenty-eight tests and both renderer checks.
- Final PiTTy typecheck and full enabled integration suite pass: 1,160 tests, 5,495 assertions, zero failures. One PowerShell-only fixture is skipped on Linux. The release build and versioned launcher help pass.

This fixes the reproduced delayed-startup jump. Streaming text, widget changes and turn completion did not reproduce an additional scrolling failure, so those paths are unchanged.
