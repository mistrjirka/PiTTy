# Core RPC UI specification

## Requirements

### Pi process

- The application SHALL launch the configured Pi executable using `--mode rpc`.
- Pi startup or protocol failures SHALL be surfaced in the transcript and diagnostic log without corrupting the terminal state.
- The frontend SHALL preserve existing Pi session, provider, model, thinking, tool, skill, template, and extension behavior exposed through RPC.

### Transcript

- User, assistant, thinking, tool, and system messages SHALL have stable identities.
- Streaming updates SHALL update existing rows rather than create duplicates.
- The initial rendered history SHALL be bounded and older messages SHALL be loadable on demand.
- Thinking and assistant prose SHALL support Markdown rendering.

### Tools

- Unknown tools SHALL render using a generic card.
- Tool cards SHALL correlate start, update, and end events by tool-call id.
- Long output SHALL be collapsed by default and independently scrollable only after expansion.
- Edit/write tools MAY expose a collapsible diff when sufficient details are available.
