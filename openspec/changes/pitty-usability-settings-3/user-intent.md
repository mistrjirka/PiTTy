# User intent

## Approved outcome

The sidebar gives reclaimed subagent space to Todos, subagent actions clearly identify their target, and assistant/thinking cards use consistent readable spacing.

## Approved decisions

- Active subagents retain richer multi-line detail.
- Completed and inactive subagents collapse to compact one-line rows.
- Todos receive all height reclaimed by compacting subagents.
- With one subagent, Ctrl+I opens it directly; with multiple subagents, Ctrl+I opens the chooser.
- Pause/stop actions and hints appear only in the explicit inspector context.
- Remove the clipped sidebar hint containing the unreadable `Ctrl+Sh…` fragment.
- Preserve stable active-first ordering and run/launch/index order within groups.
- Thinking-only, thinking-plus-answer, and normal assistant text share a consistent left baseline and symmetric spacing.
- The thinking background reaches the same right edge as other conversation cards.

## Accepted user excerpts

> “give the TODOs all the space that is no longer needed for the agents”

> “the thinking has a margin on the right ... and it has inconsistent paddings”

The user selected the recommended multi-target Ctrl+I chooser behavior and approved the complete presentation outline.

## Rejected alternatives

- Keeping fixed-height inactive subagent cards.
- Letting controls silently target the first active parallel child.
- Preserving clipped global action hints.
- Applying conditional thinking padding based on whether an answer exists.

## Unresolved questions

None.
