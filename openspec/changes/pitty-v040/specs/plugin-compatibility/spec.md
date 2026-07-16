## ADDED Requirements

### Requirement: Unsupported built-in command guidance
PiTTy SHALL identify `/login` as unsupported in its RPC UI and SHALL provide local Pi CLI guidance rather than forwarding it as a remote command or attempting to reproduce credential entry.

#### Scenario: Login is submitted
- **WHEN** a user submits `/login` in PiTTy
- **THEN** PiTTy explains that login must be completed with `pi` and does not send the command to RPC

### Requirement: Stable parallel subagent presentation
PiTTy SHALL preserve parallel child launch/index order in the sidebar and corresponding tool-call display while activity changes. It SHALL show each child's compact last-activity information without using that timestamp as a sort key.

#### Scenario: Parallel children report activity out of order
- **WHEN** two parallel children emit updates at different times
- **THEN** their displayed order remains their launch/index order and each row updates its own last-activity label

### Requirement: Child configuration display
PiTTy SHALL display a selected child's reported model, context usage/window, and thinking level in child detail/configuration views. It SHALL show an unknown value when child metadata is unavailable and SHALL NOT substitute the parent session's values.

#### Scenario: Child model differs from parent
- **WHEN** a subagent reports a model or thinking level different from the parent session
- **THEN** its detail/configuration display shows the child-reported values
