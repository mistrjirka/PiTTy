## ADDED Requirements

### Requirement: Local model filtering
The model selector SHALL provide a focused search input that filters already fetched normalized model choices locally and case-insensitively by provider, model id, and display name.

#### Scenario: Match by provider, id, or name
- **WHEN** a user types a matching search query
- **THEN** PiTTy displays only matching models in the existing normalized sort order

#### Scenario: Clear query
- **WHEN** a user clears the model search query
- **THEN** PiTTy restores all normalized model choices without another RPC request

### Requirement: Safe selection after filtering
The model selector SHALL reset selection to the first matching choice when its query changes and SHALL render a non-selectable empty state when no models match.

#### Scenario: Query has no matches
- **WHEN** a search query has no matching models
- **THEN** Enter does not select a stale previously visible model

#### Scenario: Query changes selection
- **WHEN** a query changes from one result set to another
- **THEN** keyboard selection targets the first choice in the new result set

### Requirement: Modal focus lifecycle
The model search input SHALL own keyboard focus while the selector is open. Escape, cancel, or successful selection SHALL restore focus to the unchanged main prompt draft after the selector closes.

#### Scenario: Escape from search
- **WHEN** a user presses Escape while model search is active
- **THEN** PiTTy closes the selector and focuses the preserved main prompt draft
