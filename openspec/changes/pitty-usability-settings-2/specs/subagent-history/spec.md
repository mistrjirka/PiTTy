## ADDED Requirements

### Requirement: Persisted tool-call correlation
PiTTy SHALL correlate validated persisted assistant tool-call arguments with their tool results by exact `toolCallId` during initial conversation reconstruction.

#### Scenario: Matching arguments restore metadata
- **WHEN** a persisted assistant tool call and result share a valid `toolCallId`
- **THEN** the reconstructed tool item retains the validated tool name and arguments needed for subagent metadata derivation

#### Scenario: Parallel calls remain distinct
- **WHEN** multiple persisted calls use the same tool name but different tool-call IDs
- **THEN** each result receives only the arguments from its exact matching call

#### Scenario: Malformed call is ignored safely
- **WHEN** persisted assistant content contains a malformed tool-call block
- **THEN** PiTTy does not pass the malformed data into target construction and continues reconstructing other valid conversation items

#### Scenario: Tool call has no result
- **WHEN** a valid persisted assistant tool call has no matching tool result because the conversation ended or was interrupted
- **THEN** PiTTy retains no derived result metadata and does not fabricate a completed subagent target from the call alone

#### Scenario: Tool result has no call
- **WHEN** a valid persisted tool result has no matching assistant tool-call block
- **THEN** PiTTy keeps the result renderable as a generic tool item without guessing arguments or subagent identity

### Requirement: Authoritative target reconstruction
PiTTy SHALL create historical subagent targets only from matching valid file-backed artifacts, non-empty validated progress objects, or validated known identity/status/transcript/configuration/runtime-count evidence fields and SHALL apply explicit evidence precedence.

#### Scenario: Artifact restores file-backed target
- **WHEN** a persisted invocation matches a valid surviving status artifact
- **THEN** the target uses the artifact's run identity, activity, state, and control capability

#### Scenario: Persisted arguments restore requested identity
- **WHEN** validated tool-call arguments contain a custom label or child configuration not superseded by artifact metadata
- **THEN** PiTTy displays that requested identity and configuration on the reconstructed target

#### Scenario: Evidenced completed result remains inspectable
- **WHEN** a completed invocation without a file-backed control artifact contains a non-empty validated progress object or at least one validated known identity, status, transcript, configuration, exit, context, turn-count, or tool-count field
- **THEN** PiTTy exposes it as a read-only historical foreground target

#### Scenario: Empty invocation produces no placeholder
- **WHEN** an agent-like tool result has no non-empty validated progress object, no validated known evidence field, no transcript source, and no matching artifact
- **THEN** PiTTy does not create an inspectable generic foreground target

### Requirement: Historical transcript resolution
PiTTy SHALL resolve historical subagent transcripts from valid surviving artifact paths or validated child session-file references and SHALL keep transcript loading bounded.

#### Scenario: Artifact transcript is available
- **WHEN** a reconstructed file-backed target has a valid artifact transcript
- **THEN** the inspector shows the bounded child transcript through the existing conversation rendering path

#### Scenario: Child session file is available
- **WHEN** a read-only historical target contains a valid readable child `sessionFile` reference
- **THEN** the inspector shows a bounded transcript derived from that session file

#### Scenario: Transcript source is missing
- **WHEN** every authoritative transcript source has been deleted, is unreadable, or fails boundary validation
- **THEN** PiTTy reports history as unavailable without fabricating messages

### Requirement: Reconstructed control safety
PiTTy SHALL expose steering, pause, and stop controls only for active targets backed by valid file-control data.

#### Scenario: Foreground history remains read-only
- **WHEN** a historical foreground target has complete labels and transcript data but no valid control directory
- **THEN** PiTTy does not expose file-backed control actions for that target

#### Scenario: Active artifact target remains controllable
- **WHEN** a target is active and its validated artifact provides the required control directory
- **THEN** PiTTy preserves the existing steer, pause, and stop capabilities
