## ADDED Requirements

### Requirement: Settings entry points
PiTTy SHALL open the same Settings hub from Ctrl+X and the local `/settings` command while preserving Ctrl+S as the sidebar toggle.

#### Scenario: Ctrl+X opens Settings
- **WHEN** no higher-priority dialog action owns the key event and the user presses Ctrl+X
- **THEN** PiTTy opens the Settings hub

#### Scenario: Slash command opens Settings
- **WHEN** the user submits `/settings`
- **THEN** PiTTy opens the same Settings hub without forwarding the command to Pi

#### Scenario: Ctrl+S remains sidebar shortcut
- **WHEN** the user presses Ctrl+S outside a higher-priority dialog action
- **THEN** PiTTy toggles the sidebar and does not open Settings

#### Scenario: Main footer advertises Settings
- **WHEN** the main global footer is rendered at a supported width
- **THEN** it includes a concise readable `Ctrl+X settings` hint without restoring target-specific pause or stop text to the main sidebar

### Requirement: Pi-owned settings composition
PiTTy SHALL expose model, thinking-effort, and session controls through existing selectors and Pi RPC methods, with Pi remaining the authoritative state owner.

#### Scenario: Model row reuses selector
- **WHEN** the user opens the Model row
- **THEN** PiTTy presents the existing searchable model selector and applies selection through the existing model RPC path

#### Scenario: Thinking effort changes
- **WHEN** the user selects a supported thinking effort
- **THEN** PiTTy applies it through the existing Pi RPC method and refreshes the displayed authoritative value

#### Scenario: Session switch reuses selector
- **WHEN** the user opens the Session row and chooses another session while switching is permitted
- **THEN** PiTTy delegates to the existing session selector and switch RPC path

### Requirement: Session rename
PiTTy SHALL allow the current session display name to be changed through Pi's `set_session_name` RPC operation.

#### Scenario: Rename succeeds
- **WHEN** the user confirms a valid current-session name and Pi accepts the request
- **THEN** PiTTy refreshes and displays the authoritative session name immediately

#### Scenario: Rename fails
- **WHEN** Pi rejects or cannot complete the rename request
- **THEN** PiTTy keeps the prior session name and shows the error without closing Settings

### Requirement: Immediate per-setting application
PiTTy SHALL apply each successful setting mutation immediately and SHALL not require a global Apply action.

#### Scenario: Row mutation is in progress
- **WHEN** one setting mutation is awaiting an RPC response
- **THEN** PiTTy marks only that row busy and prevents duplicate submission for that row

#### Scenario: Row mutation fails
- **WHEN** a setting mutation fails
- **THEN** PiTTy retains the prior authoritative value and shows an actionable inline error

### Requirement: Settings focus and navigation
PiTTy SHALL provide predictable keyboard/mouse navigation, nested back behavior, and focus restoration across Settings states.

#### Scenario: Escape leaves nested view
- **WHEN** a nested selector or editor is open and the user presses Escape
- **THEN** PiTTy returns to the Settings hub with the originating row selected

#### Scenario: Escape closes hub
- **WHEN** the root Settings hub is open and the user presses Escape
- **THEN** PiTTy closes Settings and restores focus to the prior chat view or editor

#### Scenario: Session switching while streaming
- **WHEN** Pi is actively streaming
- **THEN** the Session switch action is disabled with a concise explanation while non-disruptive Settings navigation remains available

#### Scenario: RPC unavailable
- **WHEN** Pi RPC is unavailable
- **THEN** Pi-owned setting rows are disabled, the failure is visible, and the user can close Settings normally
