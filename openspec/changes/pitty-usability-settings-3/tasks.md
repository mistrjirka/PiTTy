## 1. Sidebar density and controls

- [x] 1.1 Render active targets with rich detail and completed/inactive targets as stable one-line rows.
- [x] 1.2 Make the subagent area content-sized and bounded when Todos exist, with Todos consuming all remaining sidebar height.
- [x] 1.3 Route Ctrl+I directly for one target and through the existing chooser for multiple targets while preserving F6 order.
- [x] 1.4 Remove clipped sidebar controls and show pause/stop hints only in applicable explicit inspectors.

## 2. Assistant-card alignment

- [x] 2.1 Replace conditional assistant/thinking padding with sibling thinking and answer wrappers using a shared symmetric inset.
- [x] 2.2 Align the thinking background with the common card right edge without changing stable renderable identity.

## 3. Validation

- [x] 3.1 Add render tests for active/inactive transitions, Todo reallocation, constrained heights, one/multiple-target Ctrl+I behavior, and contextual action hints.
- [x] 3.2 Add render tests for single-line, multiline, collapsed, thinking-plus-answer, answer-only, streaming, and final Markdown spacing.
- [x] 3.3 Exercise a wide → short → wide terminal resize sequence and assert panel/card geometry.
- [x] 3.4 Run focused render/subagent tests, `npm run typecheck`, `npm run check`, and `git diff --check` with explicit timeouts.
- [x] 3.5 Manually compare the three reported screenshot states in the local terminal UI.
