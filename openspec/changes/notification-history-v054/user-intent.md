# User Intent

## Approved scope

- Target release: PiTTy v0.5.4.
- Notification history is session-only; it is discarded when PiTTy restarts.
- Capture all PiTTy toasts, including RPC extension `notify` messages and long command or diagnostic output.
- New notifications are unread; read notifications appear below unread notifications.
- Add a notification section to the right sidebar. It must not become larger than the Todos or Subagents sections, which are more important, but Todos and Notifications must receive proportional minimum space and stretch into otherwise unused sidebar height.
- Clicking a notification opens a modal with the complete notification rendered as Markdown and scrollable for investigation.
- The v0.5.4 GitHub release must contain detailed release notes directly in the release body, not only a link to CHANGELOG.md.

## Accepted interpretation

The notification popup remains transient, while the in-memory history retains the full text after popup expiration. Opening a notification marks it read. The feature does not add disk persistence, a database, or a separate `/ctx-doctor` integration; existing toast/extension notification paths are the source of records.

## Out of scope

- Persisting notifications across restart.
- Replacing the existing toast system.
- Making the notification panel compete with or displace Todos/Subagents space.
- Implementing unrelated command execution changes.
