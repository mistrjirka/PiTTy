## ADDED Requirements

### Requirement: Direct chat startup
PiTTy SHALL start the normal RPC-backed chat immediately for launches with no session option. It SHALL NOT show a blocking welcome screen, startup session chooser, or startup action that prevents typing.

#### Scenario: Plain launch
- **WHEN** a user starts `pitty` without `--continue` or `--session`
- **THEN** PiTTy starts the normal chat and the main prompt is writable without an intermediate choice

#### Scenario: Explicit session launch
- **WHEN** a user starts PiTTy with `--continue` or `--session`
- **THEN** PiTTy retains the existing direct session behavior

### Requirement: Informative empty-transcript dashboard
PiTTy SHALL show a non-blocking empty-transcript dashboard only while the normal transcript contains no rendered conversation items. The dashboard SHALL show the PiTTy logo, common commands, and recent sessions for the current directory without capturing the main prompt's keyboard focus. It SHALL disappear when the first transcript item is rendered.

#### Scenario: New empty conversation with sessions
- **WHEN** a directly started conversation has no rendered items and current-directory sessions are available
- **THEN** the transcript shows the logo, common commands, and recent sessions while the main prompt remains visible, focused, and writable

#### Scenario: Sessions are loading
- **WHEN** an empty transcript is visible while current-directory sessions are loading
- **THEN** the dashboard keeps its layout, shows a loading state in the session region, and leaves the main prompt usable

#### Scenario: No sessions or discovery failure
- **WHEN** current-directory session discovery is empty or fails
- **THEN** the dashboard shows an explicit empty or readable error state without blocking the prompt or changing the active session

#### Scenario: First transcript item
- **WHEN** a conversation item is rendered
- **THEN** PiTTy removes the empty-transcript dashboard without changing prompt focus or transcript behavior

### Requirement: Canonical bracket-pi logo
PiTTy SHALL use the asymmetric `[> π <]` bracket-pi mark as its canonical repository artwork, with exact light- and dark-background SVG assets. Terminal rendering SHALL use cell-safe half-block rasters derived from the same geometry rather than attempt direct SVG rendering.

#### Scenario: Repository documentation
- **WHEN** a maintainer or contributor needs the canonical logo
- **THEN** the light/dark SVG assets and branding guidance are available from repository content and the terminal UI uses the shared responsive Logo component

### Requirement: Responsive terminal logo
PiTTy SHALL select a wide raster, compact raster, micro `[> π <]` mark, or plain `PiTTy` wordmark according to available terminal dimensions without clipping dashboard content.

#### Scenario: Terminal is too small for a raster logo
- **WHEN** the transcript empty state cannot accommodate the wide or compact half-block raster
- **THEN** PiTTy shows the micro mark or plain wordmark without horizontal overflow or clipping
