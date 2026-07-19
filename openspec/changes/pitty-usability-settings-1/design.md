## Context

The main textarea is unmounted while a subagent is inspected, and the inspector owns one target-agnostic local steering value. `promptText` mirrors editor content but is not authoritative restored state. PiTTy's `LocalQueuedMessage[]` currently flushes one FIFO entry from both `agent_end` and `agent_settled`, while Pi's steering and follow-up queues arrive separately through `queue_update`.

The change must preserve sensitive drafts only in memory, keep Pi-owned queues untouched, and avoid sending queued work after a user abort.

## Goals / Non-Goals

**Goals:**

- Give each active session an authoritative main draft and per-`SubagentTarget.key` steering drafts.
- Restore the correct draft whenever the main view or an inspector remounts.
- Merge all currently queued ordinary follow-ups into one prompt at the latest safe boundary.
- Preserve exact queue content through abort and transport failure.

**Non-Goals:**

- Persisting drafts or local queues across PiTTy process restarts.
- Replacing `PromptHistory` or Pi's steering/follow-up queue semantics.
- Merging slash commands, subagent control operations, or other non-ordinary inputs.

## Decisions

### Application state owns drafts

Keep named process-local draft state at App scope, keyed by active session identity, with a main draft and a map keyed by stable `SubagentTarget.key`. Editors receive value/accessor and update callbacks instead of owning the authoritative text.

This reuses stable target identity and avoids overloading `PromptHistory`, whose contract is submitted prompt navigation rather than unfinished editor state. On a successful steer, clear only the delivered target's draft; on failure, retain it.

### Only Alt+Enter creates the local batch

Normal Enter continues through the existing immediate send/steer path. Alt+Enter accepts only ordinary text; command-like input beginning with `/` remains in the editor and receives a concise instruction to submit with Enter. Pi-owned `queue_update` data remains display-only and is never merged with local entries.

### Dispatch at `agent_settled`

Remove `agent_end` as a local flush trigger. On `agent_settled`, snapshot all currently queued ordinary items, join their text with two newline characters, and issue one normal prompt. Items added after the snapshot belong to the next batch.

Track one dispatch transaction so duplicate settle events cannot send the same batch twice. Remove the snapshot from visible queue state during dispatch and restore it in original FIFO order if the RPC request fails.

### Abort suppresses automatic dispatch

An explicit user abort marks the current completion boundary as non-dispatching. When the corresponding settled event arrives, PiTTy retains the local queue and clears the suppression marker without sending it.

### Session switching is explicit

A non-empty local queue blocks immediate switching and opens a confirmation naming the number of messages that will be discarded. Cancel keeps the current session and queue. Confirm discards that session's queue and continues through the existing session switch path. Process-local draft state remains partitioned by session identity and is discarded when PiTTy exits.

## Stack contracts

This slice provides App-owned input state and one explicit settled-boundary queue dispatcher to later slices. Restarting only the Pi RPC child against the exact current `sessionFile` must not remount App or replace this state. `pitty-usability-settings-6` composes its deferred restart ahead of the dispatcher through a single settlement coordinator; it does not register a competing independent `agent_settled` flush path.

## Risks / Trade-offs

- **Duplicate or out-of-order settle events** → Guard dispatch with one in-flight batch identity and remove only the snapshotted items.
- **RPC accepts a prompt but disconnects before acknowledging it** → Preserve current PiRpcClient acknowledgement semantics and log the ambiguity; do not silently manufacture success.
- **A user expects queued slash commands to work** → Reject them at queue time with an actionable Enter instruction rather than changing command parsing by concatenation.
- **Process-local maps grow during many session switches** → Keep only states touched during the current process and clear all state on process exit; no disk growth occurs.
