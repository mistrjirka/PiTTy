# Compaction ownership and notification delivery

## Problem

The managed Pi runtime invokes every compaction handler and retains the last result. Two installed compactors can therefore summarize the same context twice, with a later result replacing the first. A custom message that requests a new turn can also start the main agent while compaction is still changing its context.

## Behavior

- Invoke compaction handlers in registration order until one returns a summary or cancels. Empty results fall through. Cancellation guards must be registered before the compactor they guard.
- Keep all post-compaction notifications active so providers can rebuild their state after the checkpoint is saved.
- Queue custom messages that request a turn while compaction is active. Start work only after successful compaction has installed the new context.
- Preserve pending user input and custom messages when manual compaction is cancelled or fails. Keep existing steering and follow-up ordering and deliver each message once.
- Ship the source changes through the existing managed-runtime manifest and checksums. Keep explicit upstream overrides and existing session formats.

## Verification

Use an offline provider to hold compaction while a user message and a subagent notification arrive. Assert that the main agent stays idle until compaction ends, the first checkpoint survives, and pending messages are delivered once. Cover cancellation and test both source and compiled managed-runtime paths. Run the existing release checks before publishing.
