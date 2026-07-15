## ADDED Requirements

### Requirement: Current version is visible in the TUI
PiTTy SHALL display its current package version in the session section of the visible sidebar.

#### Scenario: Sidebar is shown
- **WHEN** PiTTy renders the sidebar
- **THEN** the session section shows `PiTTy v` followed by the version from package metadata

### Requirement: CLI help uses the package version
PiTTy SHALL use the same package version in its CLI help banner.

#### Scenario: Help is requested
- **WHEN** a user runs `pitty --help`
- **THEN** the banner shows `PiTTy v` followed by the version from package metadata
