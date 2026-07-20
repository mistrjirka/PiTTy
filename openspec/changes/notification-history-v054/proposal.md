## Why

Long PiTTy notifications, including command and diagnostic output, currently appear only as short-lived toast text. Users cannot read the full Markdown content after it disappears, making diagnostics such as `/ctx-doctor` difficult to investigate. PiTTy also needs a self-contained v0.5.4 release body so users can understand the release without following a changelog link.

## What Changes

- Retain all toast and extension notifications in a bounded, session-only in-memory history.
- Track unread/read state and order unread notifications before read notifications.
- Add a compact right-sidebar notification section that respects the priority of Todos and Subagents.
- Open a scrollable detail modal from a notification entry and render the complete text as Markdown.
- Preserve the existing transient toast behavior and expiration independently from history retention.
- Publish detailed v0.5.4 release notes directly in the GitHub release body.

## Capabilities

### New Capabilities

- `notification-history`: Session-only notification retention, unread/read ordering, compact sidebar access, and scrollable Markdown detail viewing.

### Modified Capabilities

<!-- No existing capability requirements change; extension notifications are covered by the new notification-history capability. -->

## Impact

- UI state and rendering in `src/app.tsx`, `src/types.ts`, `src/ui/sidebar.tsx`, and a new or extended notification detail component.
- New render tests for retention, ordering, expiration independence, sidebar bounds, modal scrolling, Markdown rendering, and read transitions.
- Plugin notification handling continues through the existing RPC path; no new dependency or persistence backend is required.
- Release metadata/workflow will publish detailed v0.5.4 notes alongside the generated archives.
