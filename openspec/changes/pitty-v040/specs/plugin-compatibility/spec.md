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
