## Why

Fixed-height subagent rows and ambiguous global controls consume sidebar space that should belong to Todos, while assistant thinking and answer cards use conditional padding that produces visibly inconsistent left and right edges. The presentation needs to remain clear across parallel-agent, narrow-terminal, and streaming states.

## What Changes

- Keep active subagent rows informative while collapsing completed/inactive rows to one line.
- Allocate all reclaimed sidebar height to Todos when Todo content exists.
- Make Ctrl+I select explicitly when multiple subagents exist and move pause/stop hints into the inspector.
- Remove clipped or target-ambiguous sidebar action text.
- Normalize thinking and assistant-answer card padding and right-edge alignment across content states.
- Preserve active-first stable subagent order and bounded sidebar geometry.

## Capabilities

### New Capabilities

- `conversation-layout`: Responsive sidebar allocation, explicit subagent navigation controls, and consistent assistant-card spacing.

### Modified Capabilities

None.

## Impact

Affects sidebar, Todo, subagent selector/inspector, assistant message rendering, keyboard routing, and render regressions at constrained dimensions. It changes no data contract or dependency.
