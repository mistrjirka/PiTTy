## ADDED Requirements

### Requirement: Safe upgrade command
PiTTy SHALL provide `pitty upgrade`, `pitty upgrade --check`, and an explicit-version upgrade path that use the same release source and install paths as the installer.

#### Scenario: Check for an upgrade
- **WHEN** a user runs `pitty upgrade --check`
- **THEN** PiTTy reports update availability without changing the installation

#### Scenario: Failed staged upgrade
- **WHEN** a download, dependency install, or staged validation fails during upgrade
- **THEN** the previous PiTTy installation remains usable and the failure identifies the retained log path

### Requirement: Non-blocking update notification
After UI mount, PiTTy SHALL check for a newer stable GitHub Release without delaying the UI. It SHALL cache a successful or unsuccessful check for one hour and support disabling the check. Successful caches are scoped to the local PiTTy version that was checked; a cached newer release may notify without another network request.

#### Scenario: New stable release
- **WHEN** a newer non-prerelease release is discovered
- **THEN** PiTTy shows a non-blocking notification with the `pitty upgrade` command

#### Scenario: Update check failure
- **WHEN** the update request times out or fails
- **THEN** PiTTy keeps the UI usable and records only diagnostic information
