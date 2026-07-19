## Context

Pi 0.80.7 intentionally has no built-in MCP. Installed `pi-mcp-adapter` 2.11.0 documents standard project `.mcp.json` and global `~/.config/mcp/mcp.json` sources, shallow server precedence, stdio/HTTP definitions, and environment interpolation. Its `/mcp` and `/mcp setup` handlers await completion callbacks from `ctx.ui.custom()`, while Pi RPC documents that custom UI returns `undefined`; bounded RPC smokes therefore hung without a correlated response. Non-custom status/tool commands work, but there is no documented add-server RPC method.

The supported boundary is to manage the adapter's documented files and restart the Pi RPC child so the same session loads the new adapter state.

## Goals / Non-Goals

**Goals:**

- Make the adapter discoverable and optionally installable without making it a core dependency.
- Safely manage basic stdio and HTTP entries in explicit project/global scope.
- Preserve uncontrolled config content outside the exact entry being changed.
- Activate changes through a controlled same-session RPC restart.
- Keep queued prompts/drafts safe across deferred restart.

**Non-Goals:**

- Implementing an MCP transport or tool proxy in PiTTy.
- Reproducing the adapter's custom TUI panels.
- Managing every advanced adapter setting in the first slice.
- Storing literal API keys, bearer tokens, or client secrets through the PiTTy form.
- Mutating Pi-specific override files or imported host configurations.

## Decisions

### Treat the adapter as an optional integration

Extend existing integration detection with `pi-mcp-adapter`. Add it to the selectable optional package list used by POSIX and PowerShell installers. Ordinary upgrades continue to respect the persisted plugin preference: `ask` offers newly missing supported integrations, `yes` installs them, and `no` does not override the user's choice.

When missing at runtime, Settings offers a confirmed `pi install npm:pi-mcp-adapter` operation through the existing Pi command resolution rather than a shell string. Installation failure is non-fatal and reports command, exit status, and log path. Successful installation triggers the same controlled RPC restart used for config activation.

### Edit only documented standard scopes

PiTTy owns management views for:

- project: `<cwd>/.mcp.json`
- global: `~/.config/mcp/mcp.json`

The adapter also reads Pi-specific override files and imports, but PiTTy does not mutate them. The UI identifies when a same-named server may be overridden by a later-precedence source.

Parse each selected file as unknown JSON. Require an object root and object `mcpServers` before business logic; preserve every unknown root key, server key, and untouched server value. Only the edited server is replaced with a boundary-validated PiTTy form value. Write a same-directory temporary file and atomically replace the target after an explicit before/after preview.

### Support bounded stdio and HTTP forms

Use named form/result types.

- Stdio: non-empty command, ordered string args, environment string map, and optional cwd.
- HTTP: valid `http:`/`https:` URL, string headers, auth mode (`oauth`, `bearer`, or disabled), and optional `bearerTokenEnv`.

The adapter expands `${NAME}` and `$env:NAME` in environment/header values and reads `bearerTokenEnv` from the process environment. The UI defaults to those references and does not expose literal `bearerToken`, OAuth client-secret, or arbitrary secret fields. Environment keys matching a deterministic case-insensitive sensitive-name policy (`token`, `secret`, `password`, `api key`, `credential`, or `authorization`) require a reference value. Other literal environment values remain available for non-secret flags/configuration but show a plaintext-storage warning and require explicit confirmation. A command form shows an explicit warning that it executes with the user's permissions.

List, add, edit, and remove operate only in the selected scope. Duplicate names require replacement confirmation. Delete removes only that scope's key and preserves the rest of the document.

### Restart the same Pi session through a reusable client lifecycle

Add a named Pi RPC restart operation that:

1. records the authoritative current `sessionFile`;
2. stops the child without treating the expected exit as a crash;
3. resets lifecycle flags and replaces prior `--continue`/`--session` startup selection with exact `--session <current file>`;
4. starts the same client/EventEmitter so App listeners remain attached;
5. refreshes state/messages/stats and integration detection.

Drafts remain App-owned under the contract from `pitty-usability-settings-1` and survive because the App component is not unmounted and the restart loads the exact same `sessionFile`. If Pi is streaming, persist the config but mark activation pending until `agent_settled`. App handles that boundary through one settlement coordinator: it first performs pending restart and authoritative refresh, then invokes slice 1's local batch dispatcher. Listener registration order is not used as a sequencing mechanism. If restart fails, the coordinator does not dispatch the local batch; it retains the queue and reports that the config is saved but not active.

### UI state table

| State | Behavior |
| --- | --- |
| Adapter missing | Explain optional integration and offer confirmed install |
| Installing | Disable duplicate install; show progress |
| Install failed | Core UI remains usable; show command/log detail |
| Server list | Default Global-scope list-only view with compact per-server name, inferred stdio/HTTP transport, clipped command/URL summary, selected-file configuration status, and Add/Edit/Delete actions; no form fields |
| Later direct-source overlap | Keep the selected-file row visible and warn that later fields may override it; do not claim effective or runtime status |
| Adding server | Separate empty stdio/HTTP form; cancel/back returns to the scoped list |
| Editing stdio | Separate prefilled form with command warning and args/env/cwd validation; cancel/back returns to the scoped list |
| Editing HTTP | Separate prefilled form with URL/auth/header validation and environment-secret guidance; cancel/back returns to the scoped list |
| Invalid config file | Read-only error; do not rewrite or discard unknown data |
| Preview | Show scope, path, and before/after selected entry |
| Saved while idle | Restart same session, refresh, and report restart completion without claiming a verified adapter connection |
| Saved while busy | Mark restart pending until settled |
| Restart failed | Config remains saved; queue/drafts remain; show recovery action |

## Stack contracts

This slice consumes App-owned draft/local-queue state and the settled-boundary dispatcher from `pitty-usability-settings-1`, plus the ordered `SettingsSectionDescriptor` and nested-route behavior from `pitty-usability-settings-4`. It appends one MCP descriptor, owns adapter/config/restart state behind that route, and extends the App settlement coordinator rather than adding an independent competing `agent_settled` handler. It does not depend on theme internals from slice 5 despite following it in serialized delivery order.

## Risks / Trade-offs

- **Global config affects other MCP hosts** → Make scope/path explicit and require a mutation preview.
- **Configured commands execute arbitrary code** → Require confirmation and display the exact command/arguments before saving.
- **Uncontrolled config contains schema PiTTy does not understand** → Preserve unknown content and refuse mutation when the root/server map cannot be safely narrowed.
- **External edits race with preview/write** → Re-read immediately before atomic replacement and abort if the source changed.
- **Restart loses session or queued input** → Restart with exact authoritative `sessionFile`, retain App-owned drafts/queue, and test persisted-session → restart → refreshed transcript end to end.
- **Adapter changes its documented file contract** → Pin behavior to detected supported adapter versions and keep the boundary behind one adapter-config module.
