## Context

PiTTy currently creates short-lived toasts in `App.toast()`, keeps at most three visible, and removes them after their timeout. The same path handles local errors/status messages and RPC extension `notify` events, but the full text is not retained or inspectable. The right sidebar already owns compact Subagents and Todos panels, and existing dialogs provide the positioned modal, close, focus, and scrollbox conventions.

The v0.5.4 release also needs an explicit release-body source rather than relying only on GitHub-generated notes or a changelog link.

## Goals / Non-Goals

**Goals:**

- Retain all notifications for the current PiTTy session, including their complete Markdown text.
- Show unread notifications above read notifications in a compact sidebar panel.
- Keep the panel smaller than the Todos and Subagents areas and allow it to collapse when space is insufficient.
- Open a scrollable Markdown detail dialog and mark the selected notification read.
- Preserve existing transient toast appearance and expiry independently of history.
- Publish versioned v0.5.4 release notes directly in the GitHub release body.

**Non-Goals:**

- Persisting notification history across restart.
- Adding a new notification backend or dependency.
- Adding a special `/ctx-doctor` command integration.
- Replacing the existing toast popup or changing unrelated sidebar priorities.

## Decisions

### Keep history in App-owned session state

The `App` component will own a bounded notification-history signal. The existing `toast()` closure is the single history handoff: every local toast and RPC extension `notify` call creates one history record and one transient popup entry. Expiry removes only the popup entry. A bounded in-memory cap prevents an unbounded session from growing indefinitely.

A separate record type will carry `id`, full `text`, `tone`, `createdAt`, and `read`; the existing `Toast` contract remains focused on visible popup lifecycle. This avoids coupling modal history semantics to popup expiry. The default history cap is 100 records, implemented as an internal constant; the oldest record is evicted when the cap is exceeded.

### Use stable unread/read ordering

The derived sidebar list will sort unread records first, then read records, preserving newest-first order within each group. Opening a record marks it read before opening its detail dialog. Records are not marked read merely because their popup expired.

### Reuse the Sidebar and PromptMapDialog visual conventions

The notification section will reuse the Sidebar’s bounded-height allocation and semantic theme colors. A dedicated notification detail dialog will reuse the existing absolute positioned panel, header/close, z-index, keyboard, and scrollbox conventions rather than adding a new modal framework. The detail body will use the existing OpenTUI Markdown renderer and the same post-render finalization lifecycle used by message Markdown.

### Protect higher-priority sidebar panels

Notifications will appear below Todos. When all three panels are visible, the available sidebar body is allocated 50% Subagents, 30% Todos, and 20% Notifications, with each visible panel receiving at least a header and one content row. When a panel is absent, its share is redistributed among the remaining panels without reversing the priority order. Todo and notification content scroll inside their allocated panels so free sidebar space is used rather than left blank. Notifications cannot exceed either higher-priority panel when both exist; if there is no room for its floor, they hide rather than reducing those allocations. The record field is consistently named `text`.

### Versioned release-body source

The repository will contain `.github/release-notes/v0.5.4.md`. Before publishing, the workflow will validate that this exact file exists for `v0.5.4`, copy it to a stable action input path, and pass it as the release body. For future tags without a matching file, the validation step may leave the body empty and retain GitHub-generated notes as a fallback. The changelog remains the repository history; the release body is the user-facing summary. The current workflow already enables `generate_release_notes`; the change improves body quality by prepending the curated v0.5.4 content rather than replacing a link-only body.

## Risks / Trade-offs

- [Risk] Long or sensitive notification text remains visible in memory for the session. → Keep the history bounded, provide explicit clear-on-restart semantics, and do not persist it.
- [Risk] A long Markdown record can be expensive to render. → Render it only in the detail dialog and keep the sidebar row one-line/compact.
- [Risk] Notification panel could compete with Subagents/Todos in short terminals. → Reserve their heights first and collapse notifications when no bounded space remains.
- [Risk] Release workflow can fail if the versioned notes file is missing. → Validate the file exists before invoking the release action and fail with a clear message.
- [Risk] OpenTUI Markdown can show incomplete initial content if finalized before its first frame. → Reuse the existing post-render finalization pattern rather than directly mounting completed Markdown as non-streaming.

## Migration Plan

No data migration is required. The feature starts with an empty history on every PiTTy process start. Release v0.5.4 will include the notification-history source and the detailed release-notes file; the workflow will publish the latter when the `v0.5.4` tag is pushed.

## Open Questions

None for the approved v0.5.4 scope.
