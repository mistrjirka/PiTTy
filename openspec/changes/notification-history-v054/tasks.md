## 1. Session notification state

- [ ] 1.1 Define the named session notification record contract and bounded in-memory store helpers for creation, unread/read ordering, marking read, and cap enforcement.
- [ ] 1.2 Integrate the existing App toast/extension-notify path so every notification creates a history record while popup expiry removes only the transient toast.

## 2. Sidebar and detail UI

- [ ] 2.1 Add a compact notification-history sidebar section that prioritizes Subagents and Todos, orders unread rows above read rows, and collapses safely in short terminals.
- [ ] 2.2 Add the scrollable notification detail modal using existing dialog conventions and full Markdown rendering, with Escape/close handling and read-state updates.
- [ ] 2.3 Make notification rows clickable: clicking a row SHALL mark it read and open its detail modal; Escape and the modal close control SHALL close the modal while preserving history, without changing existing toast, prompt, subagent, or Todo controls.

## 3. Regression coverage

- [ ] 3.1 Test REQ-NOTIFY-001: all-toast retention, full-text preservation, popup-expiry independence, 100-record oldest-first eviction, and session reset semantics.
- [ ] 3.2 Test REQ-NOTIFY-002 through REQ-NOTIFY-004: unread/read ordering, opening marks read, empty/short-terminal sidebar bounds, clickable rows, modal scrolling, and Markdown output.
- [ ] 3.3 Run typecheck, focused UI tests, and the full available test suite; record environment-only failures separately.

## 4. v0.5.4 release integration

- [ ] 4.1 Confirm the existing subagent Markdown/scroll and active-border fixes are included in the v0.5.4 release scope and tests.
- [ ] 4.2 Bump package metadata and update CHANGELOG.md with the complete v0.5.4 changes.
- [ ] 4.3 Complete REQ-NOTIFY-005: add detailed versioned release notes and update the GitHub release workflow to publish them directly in the release body, failing early when the notes file is missing.
- [ ] 4.4 Validate the release artifacts, commit, tag v0.5.4, push, and verify CI and the published GitHub release.
