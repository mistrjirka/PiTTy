## ADDED Requirements

### Requirement: Shared session browsing
PiTTy SHALL provide `/sessions` and `/resume` aliases that open the same searchable current-project session selector without changing the active session before selection. The `pitty-resume` executable SHALL start the normal PiTTy application with this same selector open rather than implement a separate picker.

#### Scenario: Open selector from a command
- **WHEN** an idle user submits `/sessions` or `/resume`
- **THEN** PiTTy displays available current-project sessions and keeps the active session unchanged

#### Scenario: Open selector from pitty-resume
- **WHEN** a user starts `pitty-resume`
- **THEN** PiTTy starts its normal RPC-backed application and opens the shared current-project session selector

#### Scenario: Picker takes focus
- **WHEN** the session selector opens
- **THEN** its search input receives focus without a mouse click, typing filters sessions, and Up/Down navigation can move through results

#### Scenario: Cancel selection
- **WHEN** a user cancels the session selector
- **THEN** PiTTy retains the current transcript and returns focus to the unchanged main prompt draft

#### Scenario: No resumable sessions
- **WHEN** current-project session discovery returns no sessions
- **THEN** PiTTy displays an explicit empty state without changing the active session

#### Scenario: Session discovery fails
- **WHEN** current-project session discovery fails
- **THEN** PiTTy preserves the active session and displays a readable error state

### Requirement: RPC session switching
After a user selects a session from the picker or empty-transcript dashboard, PiTTy SHALL use Pi's documented RPC session-switch command and reload the state, messages, statistics, queues, subagent state, and message window before accepting subsequent input.

#### Scenario: Successful switch
- **WHEN** a user selects a resumable session and Pi does not cancel the switch
- **THEN** PiTTy renders the selected session data and returns focus to the unchanged main prompt draft

#### Scenario: Cancelled or failed switch
- **WHEN** Pi cancels the session switch or the RPC request fails
- **THEN** PiTTy preserves the active UI state and shows a readable status or toast

#### Scenario: Configured Pi does not support session switching
- **WHEN** the RPC switch request reports that the configured Pi does not support `switch_session`
- **THEN** PiTTy preserves the active session and tells the user that session switching requires a Pi version with RPC support for that command

### Requirement: Streaming switch confirmation
PiTTy SHALL ask for confirmation before requesting a session switch while the current agent is streaming.

#### Scenario: Streaming user selects a session
- **WHEN** a user chooses a session while Pi is streaming
- **THEN** PiTTy requires confirmation before sending the switch request

#### Scenario: User declines streaming confirmation
- **WHEN** a user declines a streaming switch confirmation
- **THEN** PiTTy returns to the session selector without sending a switch request or changing the active session

#### Scenario: Stream settles during confirmation
- **WHEN** Pi settles while a streaming switch confirmation is open
- **THEN** PiTTy retains the selected session and updates the confirmation so the user can switch without interrupting an active stream

#### Scenario: Queued but not streaming session
- **WHEN** Pi has queued messages but reports that it is not streaming when a user selects a session
- **THEN** PiTTy follows the normal selection path because the confirmation requirement applies only to active streaming
