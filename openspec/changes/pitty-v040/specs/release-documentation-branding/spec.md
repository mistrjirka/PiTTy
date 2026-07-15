## ADDED Requirements

### Requirement: Logo documentation and screenshots
PiTTy documentation SHALL display the canonical logo asset and describe direct startup, `/resume`, model controls, command guidance, diagnostics, upgrades, and uninstall. It SHALL reserve references for real terminal screenshots including the logo empty state and model selector.

#### Scenario: Public documentation review
- **WHEN** a user opens the repository README or usage guide
- **THEN** it describes the 0.4.0 flows and links to the canonical logo and screenshot references

### Requirement: Social-preview release check
Before public announcement, a maintainer SHALL configure and visually verify a repository social-preview image derived from the canonical artwork. The release process SHALL NOT alter the owner account avatar.

#### Scenario: Pre-announcement checklist
- **WHEN** a maintainer prepares the public release announcement
- **THEN** the checklist requires a verified social preview and confirms the account avatar was not changed
