# User intent

## Approved outcome

Ctrl+X opens a reusable Settings hub for Pi-owned model, thinking-effort, and session controls without replacing or duplicating their existing implementations.

## Approved decisions

- Ctrl+X opens Settings.
- Ctrl+S keeps its existing sidebar-toggle behavior.
- `/settings` opens the same hub.
- Reuse existing model, thinking-effort, and session selectors/RPC methods.
- Session settings support switch/resume and renaming the current session.
- Settings changes apply immediately rather than waiting for a global Apply action.
- Pi remains the source of truth for model, thinking effort, and session state.
- Nested settings views restore focus predictably when closed.

## Accepted user excerpts

> “make ctrl-x open settings then”

For session behavior the user changed the initial answer and concluded:

> “B would be much better”

The user selected immediate settings application and approved the full outline.

## Rejected alternatives

- Reassigning Ctrl+S away from the sidebar.
- Reimplementing model/session/thinking selectors inside one large settings component.
- Persisting Pi-owned runtime choices in a separate PiTTy source of truth.
- A global Apply/Cancel transaction for ordinary settings rows.

## Unresolved questions

None.
