# User intent

## Approved outcome

Settings can install the optional MCP adapter and safely manage basic MCP server definitions at project or global scope without depending on adapter UI that is unavailable in Pi RPC mode.

## Approved decisions

- Offer both project `.mcp.json` and global `~/.config/mcp/mcp.json` scopes.
- Show the selected scope, affected path, and before/after preview before writing.
- Support listing, adding, editing, and removing basic stdio and HTTP server entries.
- Preserve unknown existing config keys and write atomically.
- Avoid literal secrets; prefer environment references.
- Warn that configured commands execute with the user's permissions.
- If `pi-mcp-adapter` is missing, Settings offers to install it.
- Offer `pi-mcp-adapter` as an optional integration during fresh installation and ordinary upgrades, respecting the existing plugin preference.
- Do not invoke `/mcp` or `/mcp setup` over RPC because their custom panels do not resolve there.
- After config mutation, restart/rebind Pi RPC to the same session; if Pi is busy, defer restart until settled.

## Accepted user excerpts

> “its kinda like optional dependencies you can choose to install it”

> “it should be also offered to be installed during the update”

The user chose both project and global scope and approved the full MCP outline.

## Feasibility boundary

Pi RPC documentation states `ctx.ui.custom()` returns `undefined` in RPC mode. `pi-mcp-adapter` 2.11.0 wraps `/mcp` and `/mcp setup` custom panels in promises resolved only by panel completion callbacks, and bounded RPC smokes produced no command response. Standard adapter config editing plus controlled restart is the supported initial boundary.

## Rejected alternatives

- Calling the adapter's custom management panels through RPC.
- Building a second MCP transport/client in PiTTy.
- Hard-coding secrets in config.
- Mutating global config without explicit scope selection and preview.

## Superseded presentation decision

The earlier combined list-and-form presentation is superseded. It made the MCP screen dense and obscured the existing server list.

## Approved list-first refinement

The user approved a list-only MCP landing view. It shows existing scoped servers with **Edit** and **Delete**, plus **Add server**. The add or prefilled edit form appears only after the corresponding action; its cancel/back action returns to the server list.

## Accepted user excerpts

> “the mcp servers settings should just show the list of existing server and only if the user clicks on add server then the form should show”

> “do it”

## Approved server-list refinement

The user approved Global as the initial MCP scope and requested a clearer existing-server list with each server's type, useful definition summary, and status. The list must not remain a space-separated name string.

PiTTy does not have adapter runtime status through its current RPC boundary, so the approved implementation reports only selected-file configuration and known later-source overlap. It must not label a server active, effective, or connected without an adapter status observation.

## Accepted user excerpts

> “you can give information about what type of server it is and id its active please set the global sxope as deafult”

> “after you implement this please release it”

## Unresolved questions

None.
