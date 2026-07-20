## ADDED Requirements

### Requirement: REQ-NOTIFY-001 — Session notifications are retained independently of popup expiry

PiTTy SHALL retain every notification produced by the existing toast and extension-notify paths in a bounded in-memory session history. The default cap SHALL be 100 records and SHALL be an internal constant, not a persisted or user-configurable setting. Each record SHALL preserve its full `text`, tone, creation time, unread/read state, and stable identifier. When the cap is exceeded, PiTTy SHALL discard the oldest history record. Expiring a transient toast SHALL NOT remove its history record.

#### Scenario: Long extension notification remains available after popup expiry

- **WHEN** an extension emits a long Markdown notification and its transient toast expires
- **THEN** the full notification remains available in the current PiTTy session

#### Scenario: History is reset after restart

- **WHEN** PiTTy is restarted
- **THEN** the notification history starts empty and no prior notification is loaded from disk

#### Scenario: History is bounded

- **WHEN** the session receives more than 100 notifications
- **THEN** PiTTy removes the oldest history records and retains at most 100 records

### Requirement: REQ-NOTIFY-002 — Notification history orders unread records before read records

The notification history SHALL display unread records before read records, with newest records first within each group. New records SHALL start unread. Opening a record for inspection SHALL mark that record read.

#### Scenario: New unread notification appears above read records

- **WHEN** a new notification arrives after older notifications have been read
- **THEN** the new notification appears in the unread group above all read records

#### Scenario: Opening a notification marks it read

- **WHEN** the user opens a notification from the history
- **THEN** the notification is marked read and is ordered below remaining unread notifications

### Requirement: REQ-NOTIFY-003 — Sidebar notification history remains compact

The right sidebar SHALL expose notification history only when records exist and SHALL place it below the Todos section. When all three panels are present, PiTTy SHALL allocate the available sidebar body space proportionally: Subagents 50%, Todos 30%, and Notifications 20%, subject to a header-and-one-row floor for each visible panel. With fewer visible panels, PiTTy SHALL redistribute the available space while preserving the order Subagents > Todos > Notifications. Todos and Notifications SHALL use their allocated space for scrollable content rather than leaving unused sidebar space. Notifications SHALL NOT be taller than either higher-priority panel when both are present; when no room exists for its floor, the notification section SHALL be hidden without reducing higher-priority panel allocations.

#### Scenario: No notification section exists initially

- **WHEN** PiTTy starts and no toast or extension notification has been produced
- **THEN** the sidebar does not show a notification section

#### Scenario: Notification panel fits alongside higher-priority panels

- **WHEN** the sidebar has enough remaining height for notification rows
- **THEN** the notification section shows unread/read rows in its proportional allocated space without exceeding either higher-priority panel

#### Scenario: Short terminal preserves higher-priority panels

- **WHEN** the sidebar has insufficient remaining height for notification rows
- **THEN** Subagents and Todos remain within their existing bounds and notifications collapse to a compact indicator or are hidden

### Requirement: REQ-NOTIFY-004 — Notification detail is fully readable as Markdown

Selecting a notification SHALL open a modal containing its complete `text` rendered as Markdown. Clicking a sidebar row SHALL mark that record read and open its detail. The modal SHALL support vertical scrolling and SHALL close through the established Escape/close controls without losing the session history.

#### Scenario: User investigates long diagnostic output

- **WHEN** the user clicks a notification containing multiple Markdown paragraphs or code blocks
- **THEN** PiTTy opens the detail modal, renders the complete Markdown content, and allows the user to scroll through it

#### Scenario: User closes notification detail

- **WHEN** the user presses Escape or the modal close control
- **THEN** PiTTy closes the modal and preserves the notification’s read state and history record

### Requirement: REQ-NOTIFY-005 — v0.5.4 publishes detailed release notes

The v0.5.4 GitHub release SHALL publish a detailed release body from a versioned repository release-notes file. The release workflow SHALL fail before publishing if the expected notes file is missing, and the body SHALL summarize the user-visible changes rather than only linking to CHANGELOG.md.

#### Scenario: v0.5.4 release body is self-contained

- **WHEN** the v0.5.4 tag release workflow succeeds
- **THEN** the published GitHub release body contains the detailed v0.5.4 change summary and does not consist only of a changelog link

#### Scenario: Missing release notes blocks publication

- **WHEN** the v0.5.4 tag has no matching `.github/release-notes/v0.5.4.md` file
- **THEN** the workflow fails during validation before creating or updating the GitHub release
