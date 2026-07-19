## ADDED Requirements

### Requirement: Compact subagent allocation
PiTTy SHALL render active subagent targets with rich detail, render completed or inactive targets as one-line rows, and allocate space freed by compact rows to the Todo panel when Todos are visible.

#### Scenario: Inactive rows release height
- **WHEN** one or more subagent targets become completed or inactive while Todos are visible
- **THEN** those targets use one-line rows and the Todo panel receives the released sidebar height

#### Scenario: Active row retains context
- **WHEN** a target is active
- **THEN** its sidebar row retains state and current activity detail sufficient to distinguish ongoing work

#### Scenario: Content exceeds available height
- **WHEN** compact subagent rows or Todo rows exceed their allocated panel height
- **THEN** the relevant panel remains bounded and scrollable without overflowing the sidebar

#### Scenario: Target order remains stable
- **WHEN** targets change activity state
- **THEN** active targets precede inactive targets and peers retain launch/run/index order rather than being sorted by activity timestamp

### Requirement: Explicit subagent navigation
PiTTy SHALL make the inspected or controlled target explicit when multiple subagents exist.

#### Scenario: One target opens directly
- **WHEN** exactly one inspectable subagent exists and the user presses Ctrl+I
- **THEN** PiTTy opens that target's inspector directly

#### Scenario: Multiple targets open chooser
- **WHEN** multiple inspectable subagents exist and the user presses Ctrl+I
- **THEN** PiTTy opens the existing subagent chooser before entering an inspector

#### Scenario: F6 cycles predictably
- **WHEN** the user presses F6 or Shift+F6
- **THEN** PiTTy moves through targets in the stable displayed order

### Requirement: Contextual subagent actions
PiTTy SHALL display pause and stop actions only where the selected target and its control capability are explicit.

#### Scenario: Active file-backed inspector shows actions
- **WHEN** the inspector displays an active file-backed target that supports pause or stop
- **THEN** the inspector shows only the applicable concise action hints

#### Scenario: Read-only inspector hides actions
- **WHEN** the inspector displays a foreground or otherwise read-only target
- **THEN** PiTTy does not show pause or stop hints for that target

#### Scenario: Sidebar hint remains readable
- **WHEN** the sidebar is rendered at its supported width
- **THEN** it contains no clipped target-specific action string such as the prior `Ctrl+Sh…` fragment

### Requirement: Consistent assistant-card spacing
PiTTy SHALL use one consistent content baseline and symmetric horizontal spacing for thinking and assistant-answer sections, with thinking backgrounds aligned to the common card right edge.

#### Scenario: Thinking-only message
- **WHEN** an assistant message contains only single-line or multiline thinking
- **THEN** the thinking header and content use the same one-cell left and right inset

#### Scenario: Thinking and answer message
- **WHEN** an assistant message contains both thinking and an answer
- **THEN** both sections begin on the same content baseline and the presence of the answer does not change thinking padding

#### Scenario: Answer-only message
- **WHEN** an assistant message contains only answer text
- **THEN** the text remains separated from the left border by the common content inset

#### Scenario: Collapsed thinking message
- **WHEN** thinking is collapsed
- **THEN** its header and preview preserve the same horizontal alignment as expanded thinking

#### Scenario: Streaming transition
- **WHEN** an assistant message transitions from thinking to streaming answer to final Markdown
- **THEN** the horizontal geometry remains stable without a padding jump
