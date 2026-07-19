## 1. Draft ownership

- [x] 1.1 Add named process-local per-session main and per-target draft state in the application layer.
- [x] 1.2 Make the main prompt and subagent inspector controlled by the authoritative draft state.
- [x] 1.3 Clear only successfully delivered drafts and retain failed steering drafts.

## 2. Local follow-up batching

- [x] 2.1 Restrict Alt+Enter queueing to ordinary text and keep Pi-owned queues separate.
- [x] 2.2 Replace per-item `agent_end`/`agent_settled` flushing with one guarded merged dispatch at `agent_settled`.
- [x] 2.3 Preserve FIFO queue state through abort, concurrent arrivals, duplicate settle events, and RPC failure.
- [x] 2.4 Add discard confirmation before switching away from a session with local queued messages.

## 3. Validation

- [x] 3.1 Add focused state and render regressions for main/per-target navigation, success/failure clearing, merged dispatch, abort, command rejection, and session-switch confirmation.
- [x] 3.2 Run the focused tests for affected state, rendering, and RPC behavior with an explicit timeout.
- [x] 3.3 Run `npm run typecheck`, `npm run check`, and `git diff --check` with explicit timeouts.
- [x] 3.4 Manually smoke main/subagent navigation and Alt+Enter batching in a constrained terminal.
