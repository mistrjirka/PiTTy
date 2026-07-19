## ADDED Requirements

### Requirement: Process-local draft continuity
PiTTy SHALL keep authoritative unfinished main-prompt and per-subagent steering drafts in process-local application state and SHALL restore the matching draft when navigating between the main conversation and subagent inspectors.

#### Scenario: Main draft survives inspector navigation
- **WHEN** the user enters text in the main prompt, opens a subagent inspector, and returns to the main conversation in the same PiTTy process
- **THEN** the main prompt contains the unfinished text exactly as entered

#### Scenario: Steering drafts remain target-specific
- **WHEN** the user enters different unfinished steering text for two subagent targets and switches between their inspectors
- **THEN** each inspector restores only the draft associated with its stable target identity

#### Scenario: Drafts are not persisted
- **WHEN** PiTTy exits and starts again
- **THEN** unfinished main and steering drafts from the prior process are not restored from disk

#### Scenario: Input survives same-session RPC child restart
- **WHEN** PiTTy restarts only its Pi RPC child against the exact same session file without unmounting the App
- **THEN** the process-local main draft, per-target drafts, and local queued follow-ups remain unchanged

### Requirement: Steering draft delivery
PiTTy SHALL clear a subagent steering draft only after the steering request is accepted successfully.

#### Scenario: Successful steer clears one draft
- **WHEN** steering text is delivered successfully to the selected subagent
- **THEN** PiTTy clears that target's draft without clearing drafts for other targets

#### Scenario: Failed steer retains draft
- **WHEN** steering delivery fails
- **THEN** PiTTy keeps the complete steering draft available for correction or retry

### Requirement: Local follow-up consolidation
PiTTy SHALL queue ordinary Alt+Enter inputs locally and SHALL submit all items present at a qualifying `agent_settled` boundary as one user prompt in FIFO order.

#### Scenario: Multiple queued messages become one prompt
- **WHEN** two or more ordinary messages are queued and Pi emits `agent_settled` without an abort suppression
- **THEN** PiTTy sends one prompt containing the queued texts in FIFO order separated by blank lines

#### Scenario: Enter remains immediate steering
- **WHEN** Pi is working and the user submits ordinary text with Enter
- **THEN** PiTTy sends the text through the existing immediate steering path rather than adding it to the local batch

#### Scenario: New item arrives during dispatch
- **WHEN** a local batch is in flight and the user queues another ordinary message
- **THEN** the new message remains queued for a later settled boundary and is not added to the in-flight prompt

#### Scenario: Command-like input is not queued
- **WHEN** the user presses Alt+Enter for input beginning with `/`
- **THEN** PiTTy keeps the input in the editor and explains that command-like input must be submitted with Enter

### Requirement: Safe local queue recovery
PiTTy SHALL retain the complete local queue after user abort or failed batch dispatch and SHALL prevent duplicate dispatch from repeated completion events.

#### Scenario: Abort does not flush
- **WHEN** the user aborts active work and Pi subsequently emits `agent_settled`
- **THEN** PiTTy leaves all locally queued messages editable and sends no merged prompt

#### Scenario: Failed dispatch restores FIFO state
- **WHEN** the merged prompt request fails
- **THEN** PiTTy restores every snapshotted queue item in its original order and shows the failure

#### Scenario: Repeated settled event does not duplicate
- **WHEN** equivalent settled events are observed while one batch dispatch is already in flight
- **THEN** PiTTy sends the snapshotted batch at most once

### Requirement: Explicit session-switch discard
PiTTy SHALL require confirmation before switching sessions when the current session has locally queued messages.

#### Scenario: Cancel preserves current session
- **WHEN** the user cancels the discard confirmation
- **THEN** PiTTy remains in the current session with the local queue unchanged

#### Scenario: Confirm discards and switches
- **WHEN** the user confirms discarding the local queue
- **THEN** PiTTy clears that queue and continues through the existing session-switch flow

### Requirement: Pi queue isolation
PiTTy SHALL keep Pi-owned steering and follow-up queues distinct from PiTTy's local ordinary follow-up batch.

#### Scenario: Runtime queue update remains separate
- **WHEN** Pi emits a `queue_update`
- **THEN** PiTTy reflects the Pi-owned queue without copying its entries into, removing them through, or merging them with the local batch
