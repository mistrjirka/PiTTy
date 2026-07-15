## ADDED Requirements

### Requirement: Main prompt focus after non-input interaction
When no modal or secondary editor intentionally owns focus, PiTTy SHALL route keyboard input to the main prompt after a non-input interaction in the main chat area.

#### Scenario: Click transcript background
- **WHEN** a user clicks a non-input transcript or chat-background target
- **THEN** subsequent typed text enters the main prompt

#### Scenario: Secondary editor owns focus
- **WHEN** an extension editor, model search field, or subagent steering editor is active
- **THEN** PiTTy SHALL NOT steal focus for the main prompt

### Requirement: Prompt draft preservation across model selection
Opening, closing, or selecting a model from the model selector SHALL NOT clear, replace, submit, or queue the main prompt draft. The open selector SHALL reserve the main prompt's minimum visible editor region rather than obscuring it. PiTTy SHALL return focus to that draft after the selector closes or a selection completes.

#### Scenario: Close model selector with a draft
- **WHEN** a user opens then closes the model selector with unsent prompt text
- **THEN** the same unsent text remains in the main prompt and receives focus

#### Scenario: Select a model with a draft
- **WHEN** a user selects a model while the main prompt contains unsent text
- **THEN** PiTTy changes the model without submitting or clearing that text

#### Scenario: Short terminal selector
- **WHEN** a user opens the model selector in a constrained terminal with an unsent draft
- **THEN** PiTTy reduces or scrolls the selector content while keeping the prompt editor visible

### Requirement: Prompt-safe command suggestions
Command suggestions SHALL remain in normal layout flow above the main prompt and SHALL be bounded so the prompt retains its minimum visible editor height. Suggestions SHALL NOT overlap or hide prompt text.

#### Scenario: Command completion in a short terminal
- **WHEN** a user types a slash-command prefix in a constrained terminal
- **THEN** PiTTy caps or scrolls suggestions while preserving a visible writable prompt

### Requirement: Global detail toggle
Ctrl+O SHALL globally toggle tool output and thinking blocks together. If either category has globally visible detail, Ctrl+O SHALL collapse both and clear per-item expansion overrides; only when both categories are fully collapsed SHALL Ctrl+O expand both.

#### Scenario: Collapse mixed details
- **WHEN** tools or thinking are expanded, including through an individual override
- **THEN** Ctrl+O collapses all tool and thinking details

#### Scenario: Expand global details
- **WHEN** all tool and thinking details are collapsed
- **THEN** Ctrl+O expands both categories

### Requirement: Thinking-only panel alignment
A thinking-only assistant row SHALL render its thinking background directly adjacent to its cyan left border without an intervening dark gutter.

#### Scenario: Assistant streams only thinking
- **WHEN** an assistant row has thinking content and no answer content
- **THEN** the thinking panel aligns with the left accent border and no fake answer row appears

### Requirement: Unsupported login guidance
PiTTy SHALL intercept `/login` locally and display guidance that login is not yet supported in PiTTy and must be completed in the Pi CLI. It SHALL NOT forward `/login` to Pi RPC and SHALL NOT request, persist, or log credentials.

#### Scenario: User enters login
- **WHEN** a user submits `/login`
- **THEN** PiTTy displays the approved Pi CLI guidance without sending a credential-bearing RPC prompt
