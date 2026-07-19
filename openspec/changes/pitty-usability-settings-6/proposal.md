## Why

Pi core intentionally has no built-in MCP, and `pi-mcp-adapter` provides the established runtime integration, but its `/mcp` and `/mcp setup` custom panels do not resolve in Pi RPC mode. PiTTy needs a safe supported path for optional installation and basic project/global server management without building a second MCP client.

## What Changes

- Recognize `pi-mcp-adapter` as a supported optional integration.
- Offer it during fresh installation, ordinary upgrades, and from Settings when missing.
- Add Settings views to list, add, edit, and remove basic stdio and HTTP servers.
- Manage project `.mcp.json` and global `~/.config/mcp/mcp.json` with explicit scope and before/after preview.
- Preserve unknown configuration keys, validate PiTTy-edited entries, and write atomically.
- Avoid literal-secret fields and warn about command execution authority.
- Restart Pi RPC against the same session after configuration changes, deferring while busy.
- Explicitly avoid adapter custom panels that are unsupported through current RPC.

## Capabilities

### New Capabilities

- `mcp-server-management`: Optional adapter installation and safe project/global MCP server configuration through Settings.

### Modified Capabilities

None.

## Impact

Affects optional integration detection, POSIX/PowerShell installer and upgrade fixtures, Settings composition, MCP config boundary code, Pi RPC restart lifecycle, and cross-platform CI. It uses the existing installed adapter contract and adds no PiTTy runtime MCP transport.
