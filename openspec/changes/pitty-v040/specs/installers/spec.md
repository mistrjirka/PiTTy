## ADDED Requirements

### Requirement: Atomic install and upgrade replacement
Installers and upgrades SHALL validate a release archive and a staged installation before replacing an existing installation. The expected digest SHALL be the selected asset entry in `SHA256SUMS` from the exact selected GitHub Release fetched over HTTPS. They SHALL retain the previous installation as a rollback backup until staged validation succeeds and SHALL restore it automatically after a post-backup failure. This checksum check detects accidental or in-transit corruption; signed release verification is not part of 0.4.0 and a compromised release remains outside its threat model.

#### Scenario: Validation succeeds
- **WHEN** a release archive matches its selected asset entry in the exact-release `SHA256SUMS` and the staged launcher passes validation
- **THEN** the installer replaces the old installation and removes the backup only after success

#### Scenario: Post-backup failure
- **WHEN** staged dependency setup or launcher validation fails after the existing install is backed up
- **THEN** the installer restores the prior install and reports the retained diagnostic log

### Requirement: Archive and directory preflight
Installers SHALL validate archive structure, writable install/bin directories, and selected checksum presence before dependency installation. The PowerShell installer SHALL create its temporary directory before downloading assets.

#### Scenario: Malformed archive
- **WHEN** an archive lacks required PiTTy files
- **THEN** the installer fails before changing the existing installation

#### Scenario: Windows temporary download
- **WHEN** the PowerShell installer downloads a release asset
- **THEN** its temporary directory exists before the download begins

### Requirement: Executable installer behavior coverage
The repository SHALL run local-fixture behavior tests for installer success, checksum failure, missing assets, paths with spaces, optional-plugin outcomes, and rollback failures without live network access.

#### Scenario: Induced dependency failure
- **WHEN** an installer behavior test makes dependency installation fail
- **THEN** the test verifies that the prior installation remains launchable

### Requirement: Installed optional-package detection
Before prompting to install optional Pi packages, installers SHALL inspect the installed package list. They SHALL skip the prompt when every optional package is already present and SHALL offer only missing packages otherwise.

#### Scenario: Optional packages are already installed
- **WHEN** `pi list` confirms that every recommended optional package is installed
- **THEN** the installer reports that state and does not prompt for optional-package installation
