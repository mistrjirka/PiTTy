## 1. Optional adapter integration

- [x] 1.1 Extend named optional-integration status/detection with `pi-mcp-adapter` and refresh detection after runtime installation.
- [x] 1.2 Add the adapter to POSIX and PowerShell optional package lists while preserving ask/yes/no upgrade preference.
- [x] 1.3 Add confirmed Settings installation through resolved `pi install npm:pi-mcp-adapter` execution with non-fatal structured failure reporting.

## 2. MCP config boundary

- [x] 2.1 Add named project/global config scope and basic stdio/HTTP form types without importing adapter internals.
- [x] 2.2 Add unknown-JSON boundary narrowing that preserves untouched root/server values and refuses unsafe roots.
- [x] 2.3 Add server-name/form validation, required references for sensitive environment keys, confirmed plaintext warnings for other literals, duplicate/delete confirmation, and execution warnings.
- [x] 2.4 Add source re-read race detection and same-directory atomic replacement.

## 3. Settings management views

- [x] 3.1 Add adapter-missing, installing, failed, and ready states to the Settings hub.
- [x] 3.2 Add scoped server list plus stdio/HTTP add/edit/remove forms.
- [x] 3.3 Add explicit path and before/after preview with global-impact and later-precedence warnings.

## 4. Same-session activation

- [x] 4.1 Add a reusable PiRpcClient restart lifecycle that resets expected-stop state and replaces startup session selection with the authoritative current session file.
- [x] 4.2 Refresh messages, state, statistics, commands, and integration detection after restart without losing App-owned drafts or queue state.
- [x] 4.3 Defer activation while streaming and extend one App settlement coordinator to complete restart/refresh before invoking local merged follow-up dispatch.
- [x] 4.4 Preserve queued input and expose saved-but-inactive recovery when restart fails.

## 5. Validation

- [x] 5.1 Add config tests for both scopes, stdio/HTTP validation, unknown-key preservation, malformed roots, duplicates, deletion, race detection, and atomic failure.
- [x] 5.2 Add RPC lifecycle integration tests proving exact persisted session → restart → refreshed transcript continuity and failure recovery.
- [x] 5.3 Extend POSIX/PowerShell installer coverage and assert adapter offer/install/skip/failure contract strings.
- [x] 5.4 Add Settings render tests for install/config/preview/activation states and assert `/mcp` custom panels are never invoked.
- [x] 5.5 Run focused MCP/integration/RPC/installer tests, `npm run typecheck`, `npm run check`, and `git diff --check` with explicit timeouts.
- [ ] 5.6 Run Windows, Linux, and macOS CI plus a bounded local smoke with a harmless fixture MCP server and same-session restart.

## 6. List-first management refinement

- [x] 6.1 Render selected-scope MCP servers as the default list-only view with Add, Edit, and Delete actions.
- [x] 6.2 Render add and edit forms only after their explicit action, and return to the scoped list on cancel/back.
- [x] 6.3 Add list/form transition and scope-list render coverage without changing config mutation or activation behavior.

## 7. Configured-server list refinement

- [x] 7.1 Default the MCP Settings scope to Global and keep explicit scope switching available.
- [x] 7.2 Replace the space-separated server names with compact rows showing inferred transport, clipped definition summary, selected-scope configuration, and known later-source overlap.
- [x] 7.3 Replace unverified active-connection wording and add render coverage for the refined list states.
- [ ] 7.4 Run focused MCP/UI validation, manual terminal smoke, review, full local checks, then release through the existing CI gate.
