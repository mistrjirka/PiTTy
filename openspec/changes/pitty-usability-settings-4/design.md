## Context

`src/app.tsx` currently owns independent dialog flags and shortcuts for model selection, session selection, and thinking effort. `ModelSelector` and `SessionSelector` already implement searchable selection, focus recovery helpers already exist, and `PiRpcClient` already exposes model, thinking, session-switch, and `setSessionName()` operations. Ctrl+S currently toggles the sidebar and remains reserved for that behavior.

The hub must compose these controls rather than duplicate their data loading, filtering, or RPC mutations. Later theme and MCP slices need a stable place to add PiTTy-owned sections.

## Goals / Non-Goals

**Goals:**

- Add one discoverable keyboard and slash-command entry point.
- Reuse existing selectors and Pi RPC ownership.
- Support session switch/resume and current-session rename.
- Apply successful mutations immediately with clear loading/error state.
- Keep nested-dialog focus and back navigation predictable.

**Non-Goals:**

- Persisting model, thinking, or session state in PiTTy configuration.
- Rewriting selectors into a monolithic settings component.
- Adding themes or MCP behavior in this slice.
- Changing Ctrl+S sidebar behavior.

## Decisions

### The hub is navigation, not a second settings store

Add a focused `SettingsHub` that renders an ordered list of named `SettingsSectionDescriptor` values. Each descriptor contains a stable section ID, label, summary/current-value accessor, disabled reason, and open callback; App remains responsible for route state, RPC state, and mutation callbacks. The hub does not import Pi internals or arbitrary child components.

Model and session rows delegate to their existing selectors. Thinking effort delegates to the existing cycle/set path. Session rename uses `PiRpcClient.setSessionName()` and refreshes authoritative session state after success.

### Ctrl+X and `/settings` share one open path

Route Ctrl+X through the global keyboard handler only when no higher-priority text/dialog action owns the event. Register `/settings` in PiTTy's local command handling so both paths open the same hub state. Ctrl+S remains unchanged. The concise global footer retained by `pitty-usability-settings-3` is the discoverability surface for `Ctrl+X settings`; target-specific pause/stop hints remain inspector-only.

Escape returns from a nested view to the hub, then closes the hub. Closing restores focus to the editor or view that opened Settings through the existing focus recovery pattern.

### Changes apply immediately

There is no global Apply transaction. A row mutation shows a local busy state, invokes its existing RPC method, updates from authoritative state on success, and leaves an inline error with the prior value on failure. Session switching remains unavailable while Pi is actively streaming; renaming can remain available if the RPC process is healthy.

### UI state table

| State | Hub behavior |
| --- | --- |
| Closed | Existing chat keyboard behavior and focus |
| Open/idle | Rows show current model, effort, and session |
| Nested selector | Existing selector owns search and selection |
| Rename editing | Current name is editable with confirm/cancel |
| Row loading | Only the active row is disabled and marked busy |
| Row error | Hub stays open with actionable inline error |
| Agent streaming | Session switching is disabled with explanation |
| RPC unavailable | Pi-owned rows are disabled; Settings can still close safely |

## Stack contracts

This slice consumes the concise global footer from `pitty-usability-settings-3` and provides the ordered `SettingsSectionDescriptor` contract plus root/nested route behavior. `pitty-usability-settings-5` appends the Theme descriptor and owns its nested views; `pitty-usability-settings-6` appends the MCP descriptor and owns its nested views. Neither later slice duplicates the hub shell or Pi-owned rows.

## Risks / Trade-offs

- **Global Ctrl+X conflicts with focused text editing expectations** → Handle it at the established global shortcut layer and document it in the footer/help map.
- **Nested dialog flags drift apart** → Use one settings route/state and explicit back/close callbacks rather than multiple independent booleans.
- **Immediate changes fail halfway** → Treat each row as an independent transaction and retain the prior authoritative value on failure.
- **Later sections pressure the hub into a monolith** → Keep the shell responsible only for navigation and let theme/MCP slices own their focused views and persistence.
