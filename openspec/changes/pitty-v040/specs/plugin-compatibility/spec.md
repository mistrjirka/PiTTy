## ADDED Requirements

### Requirement: Unsupported built-in command guidance
PiTTy SHALL identify `/login` as unsupported in its RPC UI and SHALL provide local Pi CLI guidance rather than forwarding it as a remote command or attempting to reproduce credential entry.

#### Scenario: Login is submitted
- **WHEN** a user submits `/login` in PiTTy
- **THEN** PiTTy explains that login must be completed with `pi` and does not send the command to RPC
