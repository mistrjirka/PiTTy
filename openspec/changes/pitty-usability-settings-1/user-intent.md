# User intent

## Approved outcome

PiTTy preserves unfinished main and per-subagent steering drafts while the user navigates inside the running process. PiTTy also consolidates locally queued ordinary follow-ups into one message at the latest safe Pi boundary.

## Approved decisions

- Normal Enter remains immediate steering while Pi is working.
- Only Alt+Enter creates PiTTy-local queued follow-ups.
- Locally queued ordinary messages are merged and sent once at `agent_settled`, not `agent_end`.
- Drafts survive navigation only and are never written to disk or restored after PiTTy exits.
- Failed steering retains the relevant draft.
- User abort must not flush the local queue.
- Switching sessions with a non-empty local queue requires confirmation before discarding it.
- Pi-owned steering and follow-up queues remain separate read-only runtime state.

## Accepted restatement

> Enter stays immediate steering; Alt+Enter messages are locally merged.

> Drafts survive navigation only and are never written to disk.

The user approved the complete outline containing these boundaries.

## Rejected alternatives

- Persisting prompt drafts on disk.
- Making ordinary Enter steering wait in the local batch.
- Sending one queued item per turn indefinitely.
- Merging Pi-owned control/steering inputs into PiTTy's ordinary follow-up batch.

## Unresolved questions

None.
