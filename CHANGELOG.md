# Changelog

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
