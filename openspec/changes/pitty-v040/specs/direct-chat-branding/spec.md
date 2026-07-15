## ADDED Requirements

### Requirement: Direct chat startup
PiTTy SHALL start the normal RPC-backed chat immediately for launches with no session option. It SHALL NOT show a blocking welcome screen, startup session chooser, or startup action that prevents typing.

#### Scenario: Plain launch
- **WHEN** a user starts `pitty` without `--continue` or `--session`
- **THEN** PiTTy starts the normal chat and the main prompt is writable without an intermediate choice

#### Scenario: Explicit session launch
- **WHEN** a user starts PiTTy with `--continue` or `--session`
- **THEN** PiTTy retains the existing direct session behavior

### Requirement: Terminal logo empty state
PiTTy SHALL show a passive PiTTy logo empty state only while the normal transcript contains no rendered conversation items. The empty state SHALL not capture mouse or keyboard input and SHALL disappear when the first item is rendered.

#### Scenario: New empty conversation
- **WHEN** a directly started conversation has no rendered items
- **THEN** the transcript shows the PiTTy logo while the main prompt remains visible and focused

#### Scenario: First transcript item
- **WHEN** a conversation item is rendered
- **THEN** PiTTy removes the empty-state logo without changing prompt focus or transcript behavior

### Requirement: Canonical logo source
PiTTy SHALL commit the supplied PiTTy tail SVG as its canonical repository artwork. Terminal rendering SHALL use a terminal-cell-safe glyph component derived from that artwork rather than attempt direct SVG rendering.

#### Scenario: Repository documentation
- **WHEN** a maintainer or contributor needs the canonical logo
- **THEN** the SVG is available from repository content and terminal UI uses a separate glyph rendering

### Requirement: Constrained-terminal logo fallback
PiTTy SHALL use a plain PiTTy wordmark instead of a clipped glyph logo when terminal dimensions cannot accommodate the compact glyph layout.

#### Scenario: Terminal is too small for the compact glyph
- **WHEN** the transcript empty state is rendered below the compact logo's supported dimensions
- **THEN** PiTTy shows the plain wordmark without horizontal overflow or clipping
