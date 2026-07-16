## ADDED Requirements

### Requirement: Unsupported built-in command guidance
PiTTy SHALL identify `/login` as unsupported in its RPC UI and SHALL provide local Pi CLI guidance rather than forwarding it as a remote command or attempting to reproduce credential entry.

#### Scenario: Login is submitted
- **WHEN** a user submits `/login` in PiTTy
- **THEN** PiTTy explains that login must be completed with `pi` and does not send the command to RPC

### Requirement: Active-first stable subagent presentation
PiTTy SHALL group active subagents before inactive subagents in the sidebar, selector, and corresponding tool-call display. Within each active-state group, parallel children SHALL retain launch/index order. Last-activity timestamps SHALL be display-only and SHALL NOT be used as a sort key.

#### Scenario: Parallel children report activity out of order
- **WHEN** parallel children in the same active-state group emit updates at different times
- **THEN** their displayed order remains their launch/index order and each row updates its own last-activity label

#### Scenario: A child changes active state
- **WHEN** an inactive child becomes active or an active child finishes
- **THEN** it moves to the appropriate active-first group while peers within each group retain their launch/index order

### Requirement: Child configuration display
PiTTy SHALL display a selected child's reported model, context usage/window, and thinking level in child detail/configuration views. It SHALL show an unknown value when child metadata is unavailable and SHALL NOT substitute the parent session's values.

#### Scenario: Child model differs from parent
- **WHEN** a subagent reports a model or thinking level different from the parent session
- **THEN** its detail/configuration display shows the child-reported values
