## Why

Messages already queued in Pi cannot be edited or cancelled from PiTTy. Input can wait behind compaction or a long foreground command. Bash timeouts are displayed with the wrong unit.

## What Changes

- Expose pending-message Edit, Cancel, and Combine next controls. Keep message identities, queue order, and explicit delivery modes.
- Accept input during manual and automatic compaction. Keep a rejected draft and reject edits to messages already consumed.
- Reject stale queue snapshots so consumed or removed messages cannot reappear.
- On accepted RPC input, use the optional pi-bg-bash adapter to promote the same foreground process. Retain its output, task handle, and original timeout deadline.
- Interpret Bash timeout values as seconds. Label polling windows separately and do not guess unknown units.
- Deliver the matching managed Pi modules with PiTTy v0.7.9. Older explicit runtimes keep local queue controls.

## Impact

PiTTy input controls, RPC transport, conversation state, timing display, and the managed Pi runtime change together. Optional background behavior stays behind the pi-bg-bash adapter.

## Validation

Focused Linux tests cover editor actions, repeated submissions, RPC failures, compaction, startup hydration, stale queue revisions, and timing renders. Real-runtime integration verifies one background launch, the same process ID, preserved structured output, and the original deadline. Release build, typecheck, and regression checks remain required by the existing release workflow.
