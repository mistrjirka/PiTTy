## Context

The sidebar previously subtracted fixed row counts and still undercounted reserved header/footer space. The local regression patch makes the subagent region flex into real remaining height, but all target cards still reserve rich multi-line rows and the long `Ctrl+I inspect · Ctrl+A pause · Ctrl+Shift+A stop` hint truncates at sidebar width. Ctrl+I silently opens the current selection, usually the first active target, when parallel agents exist.

Assistant cards also combine outer `paddingLeft=0`, `paddingRight=1`, and a thinking box whose left padding depends on whether an answer exists. This causes the screenshot-visible baseline and right-background mismatch.

## Goals / Non-Goals

**Goals:**

- Preserve useful detail for active work while making inactive history compact.
- Give Todo content all space freed by compact rows.
- Make the target of subagent inspection and destructive controls explicit.
- Give thinking and answer content one consistent visual grid.
- Keep layout stable across resizing and streaming transitions.

**Non-Goals:**

- Changing target identity, order, activity semantics, or control capability.
- Solving OpenTUI's alternate-screen full-repaint defect.
- Redesigning tool, user, or pending-input cards beyond required alignment.

## Decisions

### Content-aware sidebar allocation

Keep fixed header/footer rows structural. Render active targets with the existing rich detail and completed/inactive targets as one-line rows. When Todos are visible, cap the subagent panel at its compact content need within available space and give the Todo panel the remaining flexible height. When no Todos exist, the subagent panel can consume the available body.

Both panels retain bounded scroll behavior when their content exceeds allocated height. Stable active-first order and launch/run/index peer order remain unchanged.

### Context-aware control hints

Ctrl+I opens the sole target directly. With multiple targets it opens the existing selector so the target is explicit before entering the inspector. F6 continues stable next/previous cycling.

Remove the long sidebar action footer. Show pause/stop actions only inside the inspector and only when the selected target is an active file-backed target supporting that action. Read-only foreground targets show no destructive-control hint.

### Sibling content wrappers align assistant cards

The assistant outer border owns no conditional horizontal padding. A thinking wrapper and an answer wrapper each own symmetric one-cell horizontal padding. The thinking wrapper's background spans the card width, including its padding, so it reaches the same right edge as other cards. The header, collapsed preview, expanded Markdown, streaming text, and final Markdown all inherit the same content baseline.

### UI state table

| State | Subagent area | Todo area | Assistant card |
| --- | --- | --- | --- |
| Active target | Rich multi-line row | Remaining height | Unchanged unless message visible |
| Inactive/completed target | One-line row | Gains reclaimed height | Unchanged unless message visible |
| Multiple targets + Ctrl+I | Selector opens | Stable | Stable |
| Read-only inspector | No pause/stop hint | Stable | Stable |
| Thinking only | N/A | N/A | One-cell symmetric content padding |
| Thinking plus answer | N/A | N/A | Both sections share baseline |
| Collapsed thinking | N/A | N/A | Header and preview share baseline |
| Streaming answer | N/A | N/A | Same answer wrapper; no geometry jump |

## Stack contracts

This slice consumes the authoritative target identity, metadata, order inputs, and control capability from `pitty-usability-settings-2`. It provides the concise global footer and explicit inspector action surfaces consumed by `pitty-usability-settings-4`; later Settings work may add global discovery text but must not restore target-specific pause/stop hints outside the inspector.

## Risks / Trade-offs

- **Rapid active/inactive transitions change row height** → Keep row identities stable and assert geometry through reactive render updates.
- **Very short terminals cannot show both panels meaningfully** → Preserve minimum structural rows and bounded scrolling rather than overflowing the sidebar.
- **Moving hints makes shortcuts less discoverable from the main view** → Keep concise Ctrl+I/F6 wording in the global footer while placing target-specific controls in the inspector.
- **Markdown renderables react differently from text renderables** → Test collapsed, expanded, streaming, and final states at narrow and wide widths.
