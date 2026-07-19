## 1. Settings shell

- [x] 1.1 Add a focused Settings hub with an ordered named `SettingsSectionDescriptor` contract and context-aware loading/error state.
- [x] 1.2 Route Ctrl+X and local `/settings` to the same hub while preserving Ctrl+S sidebar behavior.
- [x] 1.3 Implement nested back/close behavior and restore the originating chat/editor focus.

## 2. Reused Pi controls

- [x] 2.1 Compose the existing model selector and authoritative model mutation path into the Model row.
- [x] 2.2 Compose the existing thinking-effort controls and RPC mutation path into the Thinking row.
- [x] 2.3 Compose the existing session selector/switch path into the Session row and disable disruptive switching while streaming.
- [x] 2.4 Add focused current-session rename using `PiRpcClient.setSessionName()` and authoritative refresh.

## 3. Validation

- [x] 3.1 Add render and keyboard tests for closed, root, nested, loading, error, streaming, RPC-unavailable, and readable global-footer discovery states.
- [x] 3.2 Add RPC regressions for immediate model/effort/session mutations and rename success/failure.
- [x] 3.3 Run focused settings/render/RPC tests, `npm run typecheck`, `npm run check`, and `git diff --check` with explicit timeouts.
- [x] 3.4 Manually smoke Ctrl+X, `/settings`, mouse navigation, nested Escape behavior, and focus restoration in a constrained terminal.
