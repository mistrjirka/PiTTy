# Changelog

## 0.6.15

### Live compaction and timing

- The live one-round compaction panel can expand to show a bounded 12-line tail for each lane and collapse from the same header control; `Ctrl+O` includes it with other detail toggles.
- Tool timing now uses the median model-call Turn duration divided by each call's positive tool count, while raw tool execution timing remains separate.
- Serialized one-round progress frames and the current versioned completion details are validated without replacing Pi's native compaction.

## 0.6.14

### Timing, controls, and transcript layout

- Timing now reports per-LLM-call Turn duration separately from tool-call timing, making model and tool performance easier to compare.
- Added pause, resume, and stop controls for subagents, plus fork compatibility with `pi-rewind`.
- Compaction telemetry and boundary handling now stay compatible with the current Pi workflow.
- Expanded output follows the transcript first, with improved scrolling and tab layout; native screenshots cover the relevant terminal views.

## 0.6.13

### Pi executable resolution

- PiTTy no longer silently overrides the user's Pi executable with its bundled Pi CLI. When `PI_BIN` is not set, the launcher now lets Pi resolve `pi` from `PATH`, while explicit `PI_BIN` overrides remain supported.
- Updated the bundled Pi dependency to `0.84.4` and added launcher regression coverage for default and explicit executable resolution.

## 0.6.12

### One-round compaction: live AI text

- The `pi-one-round-compaction` panel now streams the real model text: the plugin's per-lane `delta` frames are appended verbatim (bounded to a 20k-character tail per lane, reset per run) and the live panel shows a three-line tail window under each lane status line, clipped with a `…` marker. Plain text while streaming — no partial-Markdown re-parsing.
- Lane text is tab-owned and cleared with the progress frame on completion, failure, process exit, or stale status.

### Stability

- Fixed the sudden `MaxListenersExceededWarning` from the terminal renderer: every scrollbox registers one long-lived `selection` listener on the shared renderer, and a conversation with 11+ expandable outputs/diffs crossed node's default 10-listener warning threshold. The renderer's listener limit is now raised at bootstrap.

## 0.6.11

### Reasoning rendering

- Streaming reasoning is now shown as plain text and rendered as Markdown only when the reasoning block actually finishes, so partially streamed fences and emphasis no longer re-parse and flicker while the model is still thinking.

### bun 1.4.0 compatibility

- bun 1.4 no longer applies the top-level `bunfig.toml` preload to `bun test`; the Solid JSX transform and the `solid-js` client-build redirect moved to a `[test] preload` entry plus an explicit `solid-js` alias preload, restoring the reactive client runtime (the SSR build executes effects eagerly and produced stray empty text nodes in `<box>` elements).
- The bun development pin moved to 1.4.0; the full test suite runs green under it.
- The diff-header action row reserves one cell so the scroll/collapse actions stay fully visible next to a long clamped path.

### pi-one-round-compaction integration

- Live two-lane progress from the `pi-one-round-compaction` extension (intent/implementation + execution/evidence, characters, state, elapsed) is shown in the compaction panel while it runs.
- The compacted-context card now reads the extension's `details` payload and shows its shape: parallel lanes and wall time, complete turns kept, whole-turn vs split-turn boundary, plus file/git and intent-workflow state in the completion data.

## 0.6.10

### Compaction card placement

- The compacted-context card now renders in the transcript flow as a regular message row, where the compaction notice is, instead of being pinned below the whole conversation. It stays with the scroll history when new messages arrive instead of disappearing.

## 0.6.9

### Forking and compaction

- Fix forking from a message opening a completely unrelated conversation: the pivot menu and row fork button now resolve the recipient session entry against the newest matching file entries at click time, and the provisional Pi process never inherits a stale `--continue`/`--resume` session when a session file is forced.
- Show a compacted-context card after compaction with the size change (e.g. `152K → ~32K`), the reason, how long the compaction took, and an expandable Markdown summary of what Pi kept; the card collapses its details until clicked.

### Timing metrics

- The Timing tool number is now the median of (turn time ÷ tool calls in that turn), so it reflects how much of a turn each tool round-trip actually costs instead of reporting the raw duration of the tool process.
- Turn time spans prompt processing through generation (TTFT included once, never added on top), and tool counts are kept even when individual per-call timings are incomplete.
- The model picker now shows the same Turn/Tool medians for every model that has run requests in this session.

## 0.6.8

### Statistics and dialogs

- The Timing section now shows two numbers for the selected model: median turn time and median tool-call time, hidden until that model has actually produced a request so switching models never shows the previous model's numbers.
- The Ctrl+P model picker moves one row from the highlighted model on arrow keys instead of jumping to the first or last entry, and Enter selects the highlighted model from the search box.
- Streaming thinking is pushed to the Markdown renderer at most every 100 ms and never while collapsed or hidden, removing the lag and flicker from long thinking blocks.

### README and screenshots

- Rewrote the README around what users need: how it looks, what it is, how it differs from Pi's TUI, install, and first steps, without capture-tooling details.
- Regenerated the native screenshot matrix at 140x44 cells (1400x1028) using the system monospace Konsole uses, so captures show a larger terminal without huge text.
- The native capture harness retries each state once on transient X11 startup races and cleans up per-state sockets.

## 0.6.7

### Request timing and native harness reliability

- Add a separate Timing sidebar section for settled request duration, model-to-first-tool latency, individual tool durations, and unioned wall time for parallel tools.
- Show bounded session-local medians for the active provider/model without changing the existing model-performance metrics.
- Harden native Kitty/X11 screenshot captures with exact empty-prompt validation, passive pane input isolation, safe focus handling, final recapture, and UID-scoped cleanup.

## 0.6.6

### Terminal layout and production screenshots

- Align tab controls consistently in the one-row tab strip and keep the layout stable at narrow widths.
- Fix wrapped diff layout so long lines remain readable without disrupting controls.
- Add a native production screenshot matrix covering the supported terminal views.

### Validation

- Direct Bun 1.4.0 browser-conditioned suite: 401 passed, 1 skipped, 0 failed.
- Typecheck, native screenshot generation, diagnostics, and `git diff --check` passed.

## 0.6.5

### Model performance history

- Persist bounded per-model TTFT and output-rate samples for 31 days with atomic replacement; model selectors show historical medians only when valid history exists.
- Attribute completed metrics to the provider/model reported at assistant message start, with a response-model fallback when the request model is unavailable.

### Structured diffs and terminal layout

- Normalize structured and nested readSeek results into the existing live, initial-history, and restored diff view while preserving legacy unified patches.
- Bound unusually large diff payloads with an explicit truncation marker and keep long diff paths from colliding with their controls.
- Keep the two-row tab strip's fork and new-session controls visible under constrained widths, and regenerate production previews with terminal-like font metrics.

### Validation

- Direct Bun 1.4.0 browser-conditioned suite: 399 passed, 1 skipped; typecheck, screenshot generation, and diff checks passed.

### Tabs and Fork

- `+` now opens a blank session reliably (strips inherited `--continue`/`--session` without touching fork session handling) and preserves `--` delimiter semantics.
- Fork picker now lists all forkable user messages and allows selecting any entry; keyboard and mouse selection work for any row, not just the first.
- Tab strip is height 2 with centered labels/icons, padded, and with active/inactive background differentiation.
- Fixed tab forking to use a provisional runtime so the original tab keeps its subagents alive and the new tab hydrates correctly.
- Fixed black chat on tab switch with per-tab inspector state, scroll and draft isolation, and correct active-tab activation.

### Validation

- Typecheck clean; full suite: 386 passed, 1 skipped; focused fork/tab tests passing.

## 0.6.3

### Truthful compaction telemetry

- Added an ephemeral, strictly validated compaction observer that reports factual lifecycle metadata without replacing Pi's native compaction.
- The active tab now shows truthful compaction activity, context size, summarized-message counts, and retained context-message counts when Pi provides them.
- Late or out-of-order telemetry cannot contaminate a newer compaction attempt, and telemetry remains isolated from extension UI queues.

### Transcript-first expanded output

- Expanded tool output and diffs keep ordinary wheel scrolling with the transcript.
- Explicit controls enter output/diff scroll mode, release it back to chat scrolling, and keep collapse beside the active scroll control.
- Added regression coverage for narrow layouts, tab-safe scroll restoration, tool-call correlation, repeated prompts, and mixed-ID results.

### Validation

- Typecheck clean; browser-conditioned suite: 380 passed, 1 skipped, 0 failures.
- Production compaction and delayed-status isolation smokes passed.
- Final implementation review passed with no confirmed findings.

## 0.6.2

### Responsive under sustained output

- Assistant `message_update` events are applied unchanged and in FIFO order within bounded 33 ms presentation batches, with synchronous flushes at lifecycle boundaries and shutdown.
- Cumulative Bash snapshots retain their 250 ms coalescing path, while final states and lifecycle events remain immediate.
- Transcript rendering now has a conversation-only revision domain, so statistics, subagent polling, badges, and tab-local UI no longer recompute unrelated message rows.
- Tool duration text refreshes once per second while the activity spinner remains smooth.

### Reliable tabs and forks

- Forks are prepared and hydrated on a provisional Pi runtime before activation. The source conversation keeps streaming, and failed or cancelled forks stop only the provisional process.
- Promoted fork runtimes receive future live updates, provisional runtimes are owned during shutdown, and delayed history responses cannot overwrite newer transcript events.
- Background history hydration, tab-local inspector state, post-layout transcript scrolling, fork-picker mouse/keyboard selection, and the stronger two-row tab strip have regression coverage.

### Validation

- Typecheck clean; full browser-conditioned suite: 366 passed, 1 platform-specific skip, 0 failures.
- Production TUI replay with 180 historical messages and 250 updates/second reduced input latency from 5.7 seconds on v0.6.1 to 12–28 ms.
- Multi-process smokes verified source-stream continuity, populated fork activation, post-fork live updates, cancellation behavior, inspector restoration, and provisional-process cleanup.

## 0.6.1

0.6.0 moved conversations into independent runtimes, but several UI reads still depended on plain mutable fields and some tab controls bypassed the full activation path. The result was visible: Ctrl+P could claim the initial tab was still starting forever, model/thinking/context values went stale, and diff expansion changed state without repainting. This release fixes those ownership and reactivity paths.

### Tabs use one activation path

- The boot runtime now marks itself ready only after state and conversation history have loaded. Ctrl+P opens normally after that point.
- Clicking a tab, creating one with `+`, closing the active tab, and Ctrl+Tab cycling all run the same activation work: restore the target draft, reset its message window, refresh its state and statistics, select its extension queue, and repaint the sidebar.
- Boot callbacks stay attached to the boot runtime even if another tab becomes active during a slow startup.
- Application shutdown flushes and stops every tab runtime, not only the active process.

### Sidebar state follows the active Pi process

- Session, model, thinking level, context tokens/percentage, subagent runs, and request performance now subscribe to the per-tab revision signal.
- Background events update their owning runtime without repainting the active tab. Switching tabs immediately shows the stored values for the selected process and refreshes them.
- State refreshes are single-flight per runtime. A delayed response can no longer write one tab's model, thinking level, or context statistics into a tab selected while that RPC was in flight.
- The sidebar reports the last successful model request as `TTFT 1.8s · 42 tok/s`. TTFT measures request start to the first text or thinking delta; generation speed uses reported output tokens over the remaining generation time. Missing or invalid timing is omitted.

### Tool and subagent controls repaint correctly

- Diff, tool-output, and thinking expanders react on the first click.
- Expansion is offered only when it reveals content that the collapsed preview did not already show.
- Subagent tool cards show agent, model, mode, result, elapsed time, and a separate task-gist line without duplicated duration or raw workflow JSON.

### Extension dialogs stay with their tab

- Extension UI requests use a FIFO queue per runtime. Background requests add a badge; activating that tab reveals its next request.
- Interactive dialogs remember the runtime that opened them and send the response through that runtime's Pi client, even after other tabs have produced events.
- Switching away hides the dialog without dropping it. Switching back resumes the queued request. Closing a tab removes its queue.

### CI and documentation

- The launcher fixture now compares canonical paths, fixing the macOS `/var/...` versus `/private/var/...` CI failure, and isolates inherited `PI_BIN` values.
- README screenshots are generated by starting the production `src/index.tsx` application in tmux against a deterministic mock Pi RPC process. The committed conversation and model-picker captures use the real transcript, tool-card, dialog, prompt, footer, and sidebar components.
- Fork-entry refresh failures are logged and disable fork affordances instead of crashing the conversation.

### Validation

- Typecheck clean; 354 tests passed, 1 PowerShell-only test skipped on Linux, 0 failures.
- Focused rendering and subagent validation: 150 passed.
- Real-TUI smoke: created a second tab through `+`, completed its startup, and opened Ctrl+P in that tab without a readiness toast.
## 0.6.0

### Independent Conversation Tabs

- New tab strip above the transcript: open multiple conversations side by side, each backed by its own live Pi process that keeps streaming in the background; `+` opens a fresh session tab, `×` closes a tab (stopping only its process), Ctrl+Tab / Ctrl+Shift+Tab cycle, cap of 8 tabs with an actionable toast.
- Switching tabs rebinds the UI instantly without restarting anything; only the active tab drives status, polling, dialogs, and keyboard flows; extension prompts arriving on background tabs queue behind a badge and surface on activation.
- Prompt drafts, expansion state, and prompt history are private to each tab; switching never deletes the text you were typing.

### Fork Conversations From Any Message

- Cyan `⑂ fork` affordance on user messages, plus a fork symbol in the tab strip opening a searchable picker of fork points; forking branches before the selected message into a new active tab while the original conversation is preserved as a background tab.
- Streaming tabs ask for confirmation first; the tab cap is checked before forking so the original conversation can never be stranded.

### Reliability Fixes From Real Multi-Tab Use

- Ctrl+P and model selection now work reliably on freshly opened tabs: readiness gating, a global model cache that opens the dialog instantly, silent refresh, and single-flight fetching.
- Expand/collapse toggles (including "see diff") respond on first click again — per-tab state changes now trigger UI updates.
- App exit stops every tab's Pi process; closing a tab disposes its runtime completely.

### Subagent Tool Clarity

- Subagent launch blocks render `agent · model · mode` plus a task gist instead of raw JSON, show outcome-first terminal states (`✓ completed · took 2m 10s`, `✗ failed`), and summarize workflow child counts.
- The expand hint appears only when expanding genuinely reveals more content.
- Sidebar rows show `starting…` instead of a fabricated `0 tools` until counts exist.

### Generated Screenshots In The README

- Deterministic fixture-based screenshots (conversation, tabs, fork picker) generated via `bun run screenshots` into embedded SVGs committed under `docs/screenshots/`, displayed directly in README.md.

### Validation

- Typecheck clean; full suite green: 349 tests passed, 1 platform-specific skipped, 0 failures.
## 0.5.26

### Supervisor Dialogues Are Now Visible

- Child subagent questions arrive as custom messages that PiTTy previously dropped silently; they now render as a distinct question card showing the asking agent, the reason, and the full wrapped question text, with the reply hint separated as muted footer text.
- `subagent_supervisor` tool calls render with action-derived labels (for example `→ reply <agent>`, pending supervisor requests, supervisor status) and show the full reply message instead of a truncated JSON argument slice.
- Other extension custom messages render as muted typed notices instead of disappearing; `display: false` messages remain hidden.

### Reliable Expand/Collapse

- Clicking a collapsed tool output row or its hint now toggles expansion the same as the header row; expanded output remains click-to-select and does not collapse on click.
- Collapsed previews are bounded so the right-aligned hint never touches the output text; expand/collapse hints are styled as actions.
- Toggle handlers are unified on mouse-down.

### Prompt Paste Tokens

- Clicking a pasted-text token expands exactly that block; multiple paste blocks are supported and clicks elsewhere in the input keep normal cursor behavior instead of expanding the first block.
- Tokens gain boundary whitespace when inserted next to text, which disappears again when the block expands or is deleted.
- Wrapped-line clicks resolve through the editor's visual-to-logical line mapping, so clicks always act on the token actually under the cursor or fail closed.

### Validation

- Typecheck clean; full suite passes with 327 tests passed, 1 platform-specific test skipped, and one pre-existing environment-dependent launcher fixture failure unrelated to this release.
## 0.5.25

### UI Responsiveness Under High-Volume Tool Output

- Intermediate `tool_execution_update` events are coalesced per tool call with a 50 ms flush window, so long-running commands streaming hundreds of cumulative-output updates no longer saturate the UI thread, delay the heartbeat, or block typing and scrolling.
- Final tool results apply immediately; pending updates flush before lifecycle events, extension dialogs, and cleanup so event ordering and output content are preserved.
- Updates without a tool call id bypass coalescing; the pending map is bounded to 512 distinct tool calls and flushes before exceeding the bound.
- The footer reports truthful `ready`/`working` status at the readiness boundary instead of a stale status until the next refresh.

### Live Subagent Polling Efficiency

- Subagent refresh, activity precedence, and JSONL tail parsing are consolidated into shared helpers, removing duplicated polling logic.
- Parsed transcript records are cached by file mtime and size in a bounded LRU cache; the 750 ms poller no longer re-reads megabytes of unchanged transcripts every tick, and the inspector invalidates on file or step activity changes.
- Live transcript discovery for running children without status/session paths is preserved.

### Validation

- Full suite passes with 324 tests passed and 1 platform-specific test skipped; typecheck clean.

## 0.5.24

### Pi Runtime Alignment

- PiTTy now bundles Pi coding agent 0.84.3, including the current `opencode-go` model registry.
- Installed PiTTy launches its bundled Pi CLI on every platform while preserving explicit `PI_BIN` overrides; PiTTy upgrades therefore keep the Pi runtime aligned.

### Live Subagent Inspector

- Live running subagent transcripts now retain stable row identities, preventing inspector jumps during updates.
- Running workflow artifacts are discovered within the owning session scope with verified names, timestamps, and fail-closed ambiguity handling.

### Validation

- Full validation passes with 316 tests passed and 1 platform-specific test skipped; typecheck clean.

## 0.5.23

### Bordered Answer Tables

- Answer markdown tables now use bordered grid styling with content-width columns, padded cells, word wrapping, and selectable cells.
- Thinking markdown tables retain their existing columns styling.

### Validation

- Focused render tests and the full `npm run check` validation pass.

## 0.5.22

### Subagent Inspector Failure Transparency

- Failed subagent children now show their terminal failure reason (for example `Provider finish_reason: network_error`) prominently in the inspector instead of only a generic `workflow/failed` status.
- Workflow children resolve model, thinking level, and context window from the child metadata artifact when the workflow event omits them, using exact workflow/agent/index identity matching; ambiguous matches are ignored rather than misattributed.
- Error-only assistant transcript records render as visible error entries instead of being dropped silently.
- The synthetic `[prompt redacted]; live Prompt Audit only.` privacy marker written by pi-subagents is no longer displayed as a user message; real prompts are unaffected.

### Validation

- Added regressions for exact marker filtering, error-record rendering, and fail-closed metadata enrichment.
- Full validation passes with 308 tests passed and 1 platform-specific test skipped; typecheck clean.
## 0.5.21

### Slow Startup Resilience

- Slow Pi extension and session initialization now uses explicit session-load timeouts under a separate bounded startup deadline instead of failing at the ordinary 30-second RPC timeout.
- A qualitative startup panel reports the current phase and elapsed time without exposing extension notifications or status content.
- Periodic refreshes are single-flight, delayed refresh responses no longer mark a live Pi process disconnected, and prompt input stays disabled until conversation restoration completes.

### Automatic Compaction

- Prompt acknowledgement timers pause while an automatic compaction is active and resume with the ordinary timeout after `compaction_end`, preventing false timeout errors while compaction continues.

### Validation

- Added deterministic delayed-startup, startup UI, refresh single-flight, and automatic-compaction regressions.
- Full validation passes with 306 tests passed and 1 platform-specific test skipped; a restarted TUI smoke reached ready after a 45-second simulated Pi initialization delay.

## 0.5.20

### pi-subagents 0.50.0 Workflow Compatibility

- All children of a `workflowScript` run now appear in the tool call's subagents section instead of only one: foreground workflow children are matched by tool-call identity, and result entries are indexed by the child run id embedded in the child session file path.
- Subagent entries resolve their transcripts when pi-subagents 0.50 omits `transcriptPath` from workflow steps: the transcript path (and child run id) is derived from the child session file layout and verified to exist before display. Applies to workflow steps and mission-backed children, including custom session directories (resolved from the parent session file).
- Interrupted or partially recorded workflows no longer lose session/transcript data: result entries are matched by child run id instead of by position.
- When one child run yields several result entries (e.g. resumed runs), the lowest-indexed entry is the representative.

### Validation

- Added 10 regression tests covering child ownership, transcript derivation, pending-transcript, custom-session-dir, project-scoped, and interrupted-workflow cases; full unit suite and typecheck pass.

## 0.5.19

### Mission-Backed Workflow Visibility

- Mission-backed foreground workflow children remain visible live even when chat progress is disabled, with exact session/workflow identities and terminal/persisted reconciliation that avoids duplicate rows.
- Child session and transcript access is preserved, including stable selected-transcript behavior across updates.
- Upstream-valid `paused` and `stopped` child rows remain visible but inactive and read-only.
- Legacy `details.results` and `details.progress` foreground compatibility is preserved.

### Inspector Navigation

- `Ctrl+Arrow` cycles inspector selections without changing native word navigation in the main prompt.

### Validation

- Added regression coverage and completed a restarted production smoke test for the workflow projection and inspector behavior.

## 0.5.18

### Subagent Workflow Visibility

- Workflow-backed foreground child runs now appear immediately from live workflow traces and remain visible on completion without duplicate rows.
- Legacy foreground `results` and `progress` details remain supported.

## 0.5.17

### Codex Usage History

- Retention extended to a 31-day moving window so the sidebar shows a stable last-month average instead of dropping to zero after a Codex reset or a short gap.
- History is now written atomically (temp file + rename), so a concurrent PiTTy instance can no longer read a partial file, discard the real history, and blank the average.
- Each poll re-reads the latest on-disk history before recording, so multiple running PiTTy instances append to (rather than overwrite) each other's samples.
- The `avg %/day` line now appears as soon as any rate exists instead of being hidden until 20h of history accumulated.

## 0.5.16

### Compaction Drafts

- Prompt text submitted while context compaction is running now remains in the editor until the queued message is delivered.
- A newer draft typed while the queued message is waiting is preserved instead of being cleared after compaction.

### Subagent Activity

- Subagent last-activity timestamps and transcript refreshes now use substantive tool activity instead of streaming-only updates.

## 0.5.15

### Release Packaging

- Republished the 0.5.14 diff-wrapping fix with fresh release archives after the v0.5.14 `pitty-0.5.14.tar.gz` / `SHA256SUMS` download assets were unusable for `pitty upgrade`.

## 0.5.14

### Diff Rendering

- Long lines in expanded tool diffs now wrap onto the next row instead of being clipped at the diff window edge.

### Regression Coverage

- Added a narrow-viewport render test that a long expanded diff line continues across rows rather than overflowing.

## 0.5.13

### Prompt History vs Slash Suggestions

- Slash-command suggestions now only appear when the caret is at the end of the prompt, so ArrowUp/Down can browse prompt history when the caret is elsewhere.
- Restoring a history entry places the caret at the start (deferred past editor cursor callbacks) so further Up/Down presses keep browsing history instead of being stolen by autocomplete.
- Moving the caret back to the end of a `/command` still brings slash autocomplete back.

### Regression Coverage

- Added tests that `filterCommandChoices` respects cursor offset (hidden mid-prompt, shown at end).

## 0.5.12

### Collapsed Paste Blocks

- Large multiline or long pastes in the main prompt collapse into a compact editable token while the full content is preserved for submission.
- Paste insertion preserves the cursor/selection position and leaves the cursor after the collapsed token.
- Backspace, Delete, and modified deletion remove a collapsed token as one unit instead of leaving a partially deleted placeholder behind.
- Removed the duplicate external paste preview so the token is rendered only in the actual prompt editor and cannot overlap the prompt placeholder.

### Regression Coverage

- Added focused tests for paste thresholds, expansion, atomic deletion, and token cleanup.

## 0.5.11

### Codex Runout Projection

- Codex "runs out" ETA now uses the wall-clock multi-day/week average burn rate (idle time included) instead of preferring the last-hour spike whenever recent usage exists. A busy hour no longer collapses the projection into a false panic ETA while the true week pace would still be days away.
- The last-hour `+X%/h` delta remains on the sidebar summary line for short-horizon context, but it no longer drives the runout timestamp or the "runs out before reset" warning.

### Regression Coverage

- Added a unit test that a last-hour burst is ignored when projecting runout from the idle-inclusive average rate.

## 0.5.10

### Memory Access from Settings

- Added a "Memory" entry to Settings (`Ctrl+X`), so the memory browser is reachable without `Ctrl+M`. Several terminals (e.g. Konsole without the Kitty keyboard protocol enabled) send `Ctrl+M` as a plain Enter keystroke and can never trigger the shortcut, so it previously looked like memory browsing "did nothing" there.
- Escaping out of Memory when opened from Settings now returns to the Settings root list instead of leaving the dialog stuck open or dropping back to the main chat.
- Updated the in-app `/help` text and docs to point at Settings > Memory (or `/memory`) as the reliable fallback when `Ctrl+M` isn't distinguishable from Enter on a given terminal.

## 0.5.9

### Memory Browser

- Added a Memory browser (`/memory`, or `Ctrl+M` on terminals that report it distinctly from Enter) for the `pi-hermes-memory` extension: search across global Memory/User/Failures notes and the current project's memory, and remove individual entries with a confirmation step.
- Reads and edits the extension's own Markdown files directly (no RPC support exists for this), and refuses to delete an entry if the underlying file changed since it was loaded, to avoid clobbering a concurrent writer.
- Added `pi-hermes-memory` to optional-integration detection so the browser can point you at installing it when it's missing.

### Compaction Reliability

- Messages sent while Pi is compacting no longer hang waiting on a request that the agent won't answer until compaction ends. PiTTy now tracks `isCompacting` from `compaction_start`/`compaction_end` events, queues any message typed during that window locally, and flushes it automatically once compaction finishes.
- `/compact` now warns instead of starting a second overlapping compaction if one is already running.
- The RPC client no longer misroutes a response that arrives after its own client-side timeout already fired; it's now logged and dropped instead of being resolved against a stale (or reused) request id.

### Codex Usage Tracking

- Fixed the last-hour usage delta being computed from a stale sample (e.g. after PiTTy was closed for a long time), which could report a misleading burn rate. The delta is now left unset unless a sample from within the last hour is actually available.

### Regression Coverage

- Added unit tests for memory parsing/removal, the compaction queuing state machine, RPC late-response handling, and the Codex usage anchor fix.

## 0.5.8

### Codex Usage Tracking

- The sidebar's Codex rate-limit rows now show remaining percentage alongside used percentage, e.g. `5h: 32% used (68% left, +4.1%/h)`.
- Added a persisted local history of Codex usage samples (`~/.local/state/pitty/codex-usage-history.json`, or under `$XDG_STATE_HOME`) so consumption speed and reset behavior can be tracked across restarts.
- Added a last-hour consumption delta, a multi-day average burn rate (once at least ~20h of history is retained), and a projected runout time computed from the current pace.
- The reset/runout row turns a warning color when the projected runout would land before the window's own reset, so you can see at a glance whether you're on pace to exhaust a window early.
- Window resets are never counted as "negative consumption": a drop in used percentage (or a new reset timestamp) marks a fresh epoch instead of skewing the rate calculation.

### Compaction Timeout Fix

- `/compact` no longer surfaces a scary "Timed out waiting for Pi response to compact." error on sessions where compaction legitimately takes longer than the 10-minute client-side timeout. Pi streams `compaction_start`/`compaction_end` events independently of the request/response pair, so a client-side ack timeout is now treated as a benign, still-running compaction rather than a failure.

### Regression Coverage

- Added unit tests for Codex usage history persistence, reset-epoch-aware rate/delta/runout calculations, and formatting.

## 0.5.7

### Subagent Sidebar & Ordering

- The subagent list is now ordered by launch time, newest run on top, instead of grouping active runs first.
- Inactive/finished subagents no longer show a live "time since activity" timer; the row just shows the state icon and label once the subagent stops.
- Subagent header drops turn count; icon + state label now compact into one line, freeing space for tool/path context.
- The subagent inspector header and model/context/thinking line were compacted into single icon-prefixed rows (`⏱`, `⏳`, `▤`, `◆`) so detail panes fit more information per line.

### Todo Detail Dialog

- Clicking a todo in the sidebar now opens a detail dialog (Esc to close) instead of only showing a clipped one-line summary.
- Each todo row is now a single line with a status icon (🟢 active · 🟡 pending · 🔴 blocked · ✔ done) instead of a title line plus a separate status word line.
- Header now summarizes counts: "N pending · N active · N done".

### Notifications Panel

- Added tone icons (❌ error · ⚠️ warning · ✅ success · 🔔 info) to notification rows for faster scanning.

### Prompt and Pending Input Fixes

- Shift+Enter now reliably inserts a newline (instead of submitting) on terminals that report it as a bare linefeed without the Kitty keyboard protocol.
- The pending input panel keeps a fixed height and clips long queued/steering/follow-up lines to one row each, instead of letting them wrap and push the layout around.
- Conversation compaction now uses a 10-minute request timeout instead of the default 30 seconds, since summarizing large sessions can legitimately take that long.

### Regression Coverage

- Updated sidebar and inspector rendering tests to match the new ordering, icon format, and removed activity timer phrasing.

## 0.5.6

### Subagent Ownership for Parallel Spawns

- Subagent lists now render under the tool call that actually spawned them, not an earlier unrelated subagent tool call. A two-pass owner algorithm assigns runs by explicit `runId`/`toolCallId` first, then falls back to a global nearest-match within a 30-second window, 1:1, so a later parallel spawn no longer attaches its children to an earlier subagent call.
- Runs outside the window or with no unambiguous closest call stay hidden instead of attaching to the wrong tool call.

### Thinking Effort Filtering by Model Capability

- The Ctrl+X thinking effort selector now shows only the levels the current model supports, using the model's `thinkingLevelMap`. `null` entries hide unsupported levels, and `xhigh`/`max` require explicit opt-in.
- A model exposing only `high` and `max` (e.g. GLM) no longer shows `minimal` and `low`.

### Model Selector Full-Height List

- The Ctrl+P model selector list now fills the available modal height and keeps the scroll indicator visible when options overflow, instead of using a fixed half-height with no continuation indication.

### Prompt Shift+Enter and Auto-Expand

- Shift+Enter inserts a newline in the prompt and the prompt auto-expands to the text height within its min/max bounds. The key bindings and auto-grow configuration were already in place; this release documents and validates the behavior.

### Regression Coverage

- Added tests for nearest-match ownership (parallel spawn, outside-window drop, non-subagent tool call), and for `visibleThinkingLevels` across reasoning-disabled, mapless, holey, and empty-map cases.

## 0.5.5

### Mouse Selection for Model Selector

- OpenTUI Select has no built-in mouse handling. Clicking a model row now maps the pointer Y coordinate (including scrollOffset for scrolled lists) to the visible option index and selects it immediately, matching the same pattern as the thinking-level and settings selectors.
- The panel overlay no longer steals keyboard focus back to the list when you click the search box. The focus-fix handler now stops propagation so both the search and select retain correct cursor placement.

### Persistent Working Indicator

- The Working indicator now stays visible for the entire agent turn, including while the model is streaming thinking content or calling tools. Previously its visibility was gated on the last conversation item not being a "streaming" assistant or tool — so it vanished exactly when users expect to see it.
- Internally the production simplification is `showWorkingIndicator = streaming`; the old heuristic with three conditions and explicit streaming-item exclusions is removed.

### Regression Coverage

- Added a mouse-click test that renders the model selector, finds the target row in the character frame, clicks its coordinate, and verifies `onSelect` fires with the correct model.

## 0.5.4

### Notification History and Investigation

- Retained every PiTTy toast, including RPC extension `notify` messages, in bounded session-only history while preserving complete Markdown text after transient popups expire.
- Added unread/read tracking with unread-first and newest-first ordering within each group.
- Added a compact notification section below Todos, with proportional Subagents > Todos > Notifications allocation, panel floors, and safe hiding on short terminals.
- Added semantic lifecycle-tone colors and a scrollable Markdown detail modal; opening a notification marks it read without persisting it.

### Subagent Visibility and Rendering

- Main chat now renders each logical subagent once; later updates replace the existing entry instead of displaying duplicates.
- Foreground and asynchronous representations of the same subagent are merged while distinct parallel child indexes remain separate.
- Preserved the subagent Markdown finalization, live viewport-culling, lifecycle-state border, and OpenCode-style navigation fixes.

### Context Tools and Interrupt Recovery

- Forwarded abort signals to the context-mode MCP bridge and added cancellation, child termination, and automatic respawn recovery.
- Added a bounded 50-second timeout for `ctx_search` while keeping `ctx_execute` unbounded.
- Added single-flight Ctrl-C abort handling and force-close escalation when an abort remains pending.

### Regression Coverage

- Added coverage for notification retention and eviction, ordering, panel floors, clickable rows, full Markdown details, one-owner subagent rendering, parallel-child identity, bridge recovery, and interrupt decisions.

## 0.5.3

### Rendering Stability

- Fixed Markdown content above a live response intermittently blinking or disappearing in long conversations.
- Disabled viewport culling only for the live main conversation, avoiding stale geometry while streaming messages change height.
- Finalized completed Markdown after its first rendered frame while preserving immediate streaming text fallback.

### Subagent Navigation

- Added OpenCode-style Ctrl+Down inspection and arrow-key navigation inside the subagent inspector.
- Added Ctrl+Left/Right cycling and Ctrl+Up return-to-chat aliases.
- Updated footer, sidebar, and inspector hints to show only relevant controls for the available targets.

### Testing

- Added regression coverage for Markdown finalization, navigation shortcuts, and target-count hints.

## 0.5.2

### Performance Optimizations

**Viewport Culling Enabled Across All Scrollboxes**

- Enabled `viewportCulling={true}` on all scrollbox components, reducing render overhead for long conversations
- Affected components: main chat view, message tool outputs, todo panel, command suggestions, MCP settings, sidebar, subagent inspector, pending input panel
- OpenTUI's viewport culling now skips rendering offscreen children while maintaining layout calculations
- Verified compatibility with `scrollChildIntoView`, `stickyScroll`, and text selection for visible items

**Streaming and Conversation Model Improvements**

- Fixed working indicator gap: the "Working..." indicator now correctly shows when transitioning from assistant text output to tool calls
  - Previously, the indicator would disappear between message completion and tool execution start
  - Now checks `last.status === "streaming"` instead of checking for text content presence
- Fixed tool timeout display: timeouts are now correctly displayed in seconds instead of milliseconds
  - Tool arguments with `timeout: 30` (30 seconds) now display as "timeout 30s" instead of "timeout 30ms"
  - Added automatic conversion from seconds to milliseconds for values < 1000

### UX Improvements

**Command Execution Fix**

- Pressing Enter on a complete command (e.g., "/help ") now executes it immediately instead of just selecting it from the suggestion list
- Previously required pressing Enter twice: once to select, once to execute
- Now detects complete commands (starting with "/" and containing a space) and executes them directly

**OpenCode-Style Keyboard Shortcuts**

- Added Ctrl+Left/Right shortcuts for cycling through subagents (in addition to existing F6/Shift+F6)
  - Ctrl+Right: cycle to next subagent
  - Ctrl+Left: cycle to previous subagent
- Provides more intuitive keyboard navigation for managing multiple subagents

### Testing

- All 187 tests passing (2 pre-existing installer test failures unrelated to these changes)
- Test suite requires `--conditions=browser` flag for correct SolidJS browser build (already configured in package.json scripts)

## 0.5.1

- Check for new stable releases hourly instead of daily, so recently published upgrades are discovered sooner.

## 0.5.0

- Added process-local drafts, Alt+Enter follow-up batching, and truthful queued subagent steering guidance.
- Restored historical subagent views and made the conversation/sidebar layout more compact and inspectable.
- Added the Settings hub for Pi-authoritative model, thinking, and session controls.
- Added ten persistent PiTTy themes with contrast checks and complete token editing.
- Added optional, safe MCP configuration management with explicit project/global scopes, previewed atomic writes, same-session restart, and a Global-default compact configured-server list.

## 0.4.3

- Fixed startup update notifications after upgrading PiTTy by scoping successful update-check caches to the local version.

## 0.4.2

- Thanks to @herm1t0 for the Windows support intent in PRs #3 and #4; added safer installation PATH management and launcher/runtime fixes.

## 0.4.1

- Added the asymmetric bracket-Pi logo and refreshed logo assets with rebuilt documentation.
- Authoritative deleted todo snapshots no longer leave tombstones in the todo view.
- Bounded slash-command suggestions stay above the prompt and keep the keyboard-selected row visible.
- Short queued/sent input states retain enough height to avoid unnecessary scrolling and highlighted-text overlap.
- Grouped active subagents first, preserving stable launch/index order within groups; activity timestamps are display-only.

## 0.4.0

- Added update checks and staged, rollback-safe upgrades, plus safer cross-platform installers and CI coverage.
- Added prompt controls and history, stable streaming/renderables, searchable session browsing and switching, and subagent metadata, activity, and ordering improvements.

## 0.3.3

- Added a non-blocking empty dashboard with terminal-safe branding and recent sessions.
- Added searchable `/sessions` and `/resume` flows plus the `pitty-resume` launcher.
- Added session switching through Pi RPC, foreground subagent visibility, resumed-child deduplication, and constrained-terminal interaction fixes.

## 0.3.1

- Added searchable model selection with visible draft preservation and keyboard list navigation.
- Made Ctrl+O toggle tool and thinking detail together, fixed thinking-only alignment, and restored prompt focus after chat clicks.
- Added local `/login` guidance for the unsupported RPC command.
- Stabilized optional-integration tests and require release validation before publishing archives.

## 0.3.0

- Renamed the project to PiTTy and added a portable `pitty` launcher.
- Added graceful optional-integration detection for `pi-subagents` and `@juicesharp/rpiv-todo`.
- Missing integrations now produce one informational notification and their panels remain hidden instead of showing empty plugin-specific UI.
- Disabled subagent artifact polling when the subagent package is absent.
- Added interactive/noninteractive Linux, macOS, WSL, and Windows installers with optional package prompts and readable failure diagnostics.
- Added uninstallers, checksum-aware release packaging, cross-platform CI, issue templates, contributing/security docs, and MIT licensing.
- Added OpenSpec project context and capability specifications.

## 0.2.5

- Added stable parallel-subagent selection, separate child entries, active/finished selector, and file-backed child steering.
- Hid the main chat editor while inspecting a subagent and made completed children read-only.

Earlier pre-release history is preserved in repository tags and release notes.
