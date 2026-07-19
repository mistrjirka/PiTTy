## Why

Restarted PiTTy sessions can lose custom subagent labels, tool arguments, configuration metadata, and transcript history because persisted assistant tool-call blocks are discarded during initial conversation reconstruction. The same weak reconstruction can fabricate empty inspectable foreground entries that have no authoritative child data.

## What Changes

- Preserve and correlate persisted assistant tool-call arguments by `toolCallId`.
- Reconstruct historical foreground and file-backed subagent identity from authoritative messages and surviving artifacts.
- Restore available labels, model/context/thinking metadata, tools, and transcript references.
- Use valid child session files as a historical transcript source when available.
- Omit targets that have neither meaningful persisted results/progress nor a matching artifact.
- Keep foreground targets read-only and retain explicit limits when temporary artifacts are gone.

## Capabilities

### New Capabilities

- `subagent-history`: Authoritative reconstruction of historical subagent identity, metadata, and inspectable transcript sources.

### Modified Capabilities

None.

## Impact

Affects persisted conversation parsing, subagent artifact/transcript readers, target construction, and focused reconstruction tests. It adds no dependency and does not change subagent execution or control protocols.
