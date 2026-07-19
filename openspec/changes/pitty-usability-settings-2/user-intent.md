# User intent

## Approved outcome

After PiTTy restarts, historical subagents show the most accurate labels, tools, metadata, and transcript history that can be reconstructed from authoritative persisted Pi messages and surviving subagent artifacts.

## Approved decisions

- Reconstruct assistant tool-call arguments by `toolCallId`; do not infer labels from transcript prose.
- Preserve custom foreground labels when the persisted tool call contains them.
- File-backed async children remain authoritative when matching artifacts survive.
- A target without authoritative progress, results, transcript, or matching artifact must not become an inspectable `foreground subagent` placeholder.
- Historical recovery is best-effort when OS-temporary artifacts have been deleted; PiTTy must not claim impossible recovery.
- Foreground targets remain read-only; only valid active file-backed targets are steerable.

## Accepted restatement

The user approved the design that restores labels and history “where authoritative data survives” and never creates synthetic empty children.

## Rejected alternatives

- Fabricating generic children from tool names alone.
- Guessing child labels from surrounding prose.
- Promising recovery after required temporary status/transcript artifacts no longer exist.

## Unresolved questions

None.
