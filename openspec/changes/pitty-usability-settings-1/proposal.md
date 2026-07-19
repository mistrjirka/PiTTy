## Why

Navigating between the main chat and subagent inspectors currently destroys unfinished input, while PiTTy's local Alt+Enter queue dispatches one message per later turn and can flush after an abort. Users need predictable process-local input continuity without persisting sensitive prompt text or interfering with Pi-owned queues.

## What Changes

- Preserve unfinished main and per-subagent drafts across in-process navigation.
- Keep draft ownership at application scope and clear a steering draft only after successful delivery.
- Consolidate PiTTy-local ordinary Alt+Enter follow-ups into one prompt at `agent_settled`.
- Preserve queued content after abort or failed dispatch.
- Require confirmation before discarding a non-empty local queue during session switching.
- Keep ordinary Enter steering immediate and keep Pi-owned queues separate.

## Capabilities

### New Capabilities

- `input-continuity`: Process-local prompt draft ownership and safe consolidation of PiTTy-local follow-ups.

### Modified Capabilities

None.

## Impact

Primarily affects application input state, main and subagent editors, local pending-input presentation, session switching, and focused interaction/render tests. No prompt text is added to persistent storage and no external dependency changes.
