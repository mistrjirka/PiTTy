## ADDED Requirements

### Requirement: Optional MCP adapter installation
PiTTy SHALL treat `pi-mcp-adapter` as an optional supported integration and SHALL keep core installation and runtime usable when the adapter is absent or installation fails.

#### Scenario: Fresh interactive installation
- **WHEN** the optional-integration step runs and `pi-mcp-adapter` is missing
- **THEN** the installer offers it under the existing plugin preference behavior

#### Scenario: Ordinary upgrade discovers new optional adapter
- **WHEN** an existing installation upgrades with plugin preference `ask` or `yes` and the adapter is missing
- **THEN** the upgrade offers or installs the adapter consistently with that stored preference

#### Scenario: User previously disabled optional plugins
- **WHEN** the stored plugin preference is `no`
- **THEN** an ordinary upgrade does not override that choice to install the adapter

#### Scenario: Settings installation succeeds
- **WHEN** the user confirms adapter installation in Settings and `pi install npm:pi-mcp-adapter` succeeds
- **THEN** PiTTy refreshes integration state and activates the adapter through controlled RPC restart

#### Scenario: Optional installation fails
- **WHEN** adapter installation fails
- **THEN** PiTTy remains usable and reports the package, command, exit status, and retained log path

### Requirement: Explicit MCP configuration scope
PiTTy SHALL manage only project `.mcp.json` and global `~/.config/mcp/mcp.json` through explicit scope selection and SHALL show the exact affected path and before/after entry preview before mutation.

#### Scenario: Project scope selected
- **WHEN** the user selects project scope
- **THEN** PiTTy reads and proposes changes only to `<cwd>/.mcp.json`

#### Scenario: Global scope selected
- **WHEN** the user selects global scope
- **THEN** PiTTy identifies that the change can affect other MCP hosts and proposes changes only to `~/.config/mcp/mcp.json`

#### Scenario: Preview is cancelled
- **WHEN** the user cancels the before/after preview
- **THEN** PiTTy writes no configuration file and leaves the server list unchanged

#### Scenario: Later source may override name
- **WHEN** a same-named server exists in a later-precedence adapter source
- **THEN** PiTTy warns that the edited definition may not become the effective definition

### Requirement: Bounded server management
PiTTy SHALL list, add, edit, and remove boundary-validated basic stdio and HTTP server definitions in the selected scope.

#### Scenario: Default global server list
- **WHEN** the user opens MCP Settings for the first time in a PiTTy process
- **THEN** PiTTy selects the global `~/.config/mcp/mcp.json` scope and shows only that scope's existing server list, Add server action, and per-server edit/remove actions without rendering an add or edit form

#### Scenario: Describe a selected-scope server truthfully
- **WHEN** the selected scope contains a stdio or HTTP server
- **THEN** PiTTy renders a compact row with its name, inferred transport, clipped command or URL summary, and `Configured in <scope> scope` status

#### Scenario: Later source overlaps a selected server
- **WHEN** PiTTy detects that a later direct adapter source defines the same selected-scope server name
- **THEN** PiTTy marks that row `Later source may override fields` without claiming the selected definition is inactive, wholly shadowed, or ineffective

#### Scenario: Open add form
- **WHEN** the user selects Add server from the selected-scope server list
- **THEN** PiTTy replaces the list view with an empty stdio/HTTP creation form whose cancel/back action returns to that list

#### Scenario: Open edit form
- **WHEN** the user selects Edit for a listed scoped server
- **THEN** PiTTy replaces the list view with a form prefilled from that server whose cancel/back action returns to that list

#### Scenario: Add stdio server
- **WHEN** the user confirms a non-empty command with valid string args, environment map, and optional cwd
- **THEN** PiTTy writes that stdio definition under the confirmed server name and scope

#### Scenario: Add HTTP server
- **WHEN** the user confirms a valid HTTP or HTTPS URL with valid headers/auth settings
- **THEN** PiTTy writes that HTTP definition under the confirmed server name and scope

#### Scenario: Replace duplicate name
- **WHEN** the selected scope already contains the proposed server name
- **THEN** PiTTy requires explicit replacement confirmation before changing that entry

#### Scenario: Remove server
- **WHEN** the user confirms removal of a selected scoped server
- **THEN** PiTTy removes only that scope's server key and preserves all other document content

#### Scenario: Invalid form
- **WHEN** a server name, command, URL, argument, environment value, header, or auth combination is invalid
- **THEN** PiTTy keeps the editor open with field-specific errors and does not show a writable preview

### Requirement: Safe shared-config mutation
PiTTy SHALL validate selected MCP files at the trust boundary, preserve unknown untouched content, detect preview/write races, and replace files atomically.

#### Scenario: Unknown content is preserved
- **WHEN** a valid config contains root keys, settings, imports, advanced server fields, or other server entries PiTTy does not manage
- **THEN** a confirmed mutation preserves that untouched content exactly in parsed JSON value semantics

#### Scenario: Root cannot be safely narrowed
- **WHEN** the selected file is malformed JSON or its root or `mcpServers` value is not an object
- **THEN** PiTTy reports a read-only error and does not rewrite the file

#### Scenario: File changes after preview
- **WHEN** the source file changes between preview and attempted write
- **THEN** PiTTy aborts the write and requires a refreshed preview

#### Scenario: Atomic replacement fails
- **WHEN** the temporary write or atomic replacement fails
- **THEN** PiTTy reports the failure and does not claim that the server change is active

### Requirement: Secret and execution safety
PiTTy SHALL avoid literal-secret fields in its MCP forms and SHALL warn before saving command definitions that execute with the user's permissions.

#### Scenario: Environment reference is used
- **WHEN** a server requires a secret-bearing environment or header value
- **THEN** PiTTy supports adapter-compatible `${NAME}`, `$env:NAME`, or `bearerTokenEnv` references without collecting a literal bearer token or client secret

#### Scenario: Sensitive environment key requires reference
- **WHEN** a stdio environment key name indicates a token, secret, password, API key, credential, or authorization value
- **THEN** PiTTy rejects a literal value and requires an adapter-compatible environment reference

#### Scenario: Non-secret literal environment value
- **WHEN** the user enters a literal value for an environment key that is not classified as sensitive
- **THEN** PiTTy warns that the value will be stored as plaintext and requires explicit confirmation before preview

#### Scenario: Stdio command preview
- **WHEN** a stdio server reaches confirmation
- **THEN** PiTTy shows the exact command and ordered arguments with an execution-authority warning

### Requirement: Same-session MCP activation
PiTTy SHALL activate successful adapter installation or config mutation by restarting Pi RPC against the exact current session while retaining App-owned drafts and local queue state.

#### Scenario: Idle activation succeeds
- **WHEN** Pi is idle and an MCP change is saved
- **THEN** PiTTy restarts Pi RPC with the authoritative current session file, refreshes state/messages/integrations, and marks the change active

#### Scenario: Busy activation is deferred
- **WHEN** Pi is streaming and an MCP change is saved
- **THEN** PiTTy marks activation pending and waits for `agent_settled` without aborting current work

#### Scenario: Deferred activation precedes local batch
- **WHEN** activation is pending and locally queued follow-ups exist at `agent_settled`
- **THEN** one settlement coordinator completes same-session restart and authoritative state refresh before it invokes the local merged follow-up dispatcher

#### Scenario: Restart fails
- **WHEN** same-session RPC restart fails
- **THEN** PiTTy reports that configuration is saved but inactive, retains drafts and queued follow-ups, and offers an explicit retry or application restart path

### Requirement: RPC compatibility boundary
PiTTy SHALL NOT invoke adapter custom `/mcp` or `/mcp setup` panels through current Pi RPC mode.

#### Scenario: User opens MCP Settings
- **WHEN** MCP management is requested through PiTTy
- **THEN** PiTTy uses its standard-config management views rather than sending `/mcp` or `/mcp setup` to Pi RPC
