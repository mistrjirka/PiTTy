## Context

Initial conversation reconstruction currently keeps tool results but drops persisted assistant tool-call blocks and arguments, leaving matching results with `args: undefined`. `foregroundTargets()` has historically treated tool names matching agent-like words as sufficient evidence, while async restoration depends on status/transcript artifacts under temporary run directories. Ordinary child results can also reference a `sessionFile` that is not read by the current artifact-only transcript path.

Persisted Pi session JSON and subagent artifacts are trust boundaries. Reconstruction must validate them before deriving typed internal state.

## Goals / Non-Goals

**Goals:**

- Correlate persisted assistant tool calls and results by exact tool-call identity.
- Reuse persisted arguments for labels and child configuration when present.
- Prefer surviving file-backed run artifacts for authoritative runtime/control state.
- Expose the best valid transcript source without inventing missing history.
- Eliminate metadata-free inspectable placeholders.

**Non-Goals:**

- Recovering deleted OS-temporary files.
- Inferring labels from prose or positional similarity.
- Making synthetic foreground targets steerable.
- Replacing pi-subagents artifact formats or execution behavior.

## Decisions

### Preserve validated tool-call metadata during initial reconstruction

Extend the persisted-message boundary parser so assistant tool-call blocks produce correlation metadata keyed by `toolCallId`. Tool-result reconstruction reuses the matching tool name and validated arguments. Keep a named internal type for this correlation instead of passing unvalidated session JSON through target builders.

Exact identity is required because multiple parallel calls can use the same tool name and similar arguments.

### Use explicit evidence precedence

Construct targets with this precedence:

1. A matching valid file-backed status artifact owns run identity, active state, timestamps, control capability, and artifact transcript paths.
2. Persisted tool-call arguments own requested label/agent/model/context/thinking metadata when the artifact does not provide a stronger value.
3. A completed result can produce a read-only foreground historical target only when it contains a non-empty validated progress object or a known validated evidence field: non-empty `agent`, `label`, `status`, `transcriptPath`, `sessionFile`, `model`, or `thinking`; or finite `exitCode`, `contextWindow`, `turnCount`, or `toolCount`.
4. A tool name, empty acknowledgement, unmatched call, or metadata-free result alone produces no target.

An explicitly present empty progress list is evidence only when one of the listed result fields independently proves a completed invocation. Empty `results: []` acknowledgements without surviving status data are not proof of a child.

### Add a bounded transcript-source resolver

Use the existing artifact transcript reader first for file-backed runs. For historical foreground/completed targets, accept a validated `sessionFile` reference from authoritative result data and parse it through the existing conversation conversion path with the same bounded item limit. Invalid, missing, or unreadable files yield an explicit unavailable state rather than a fabricated transcript.

### Keep control capability structural

Only active targets backed by valid control directories are steerable, pausable, or stoppable. Reconstructed foreground targets remain read-only regardless of how complete their displayed metadata is.

## Stack contracts

This slice consumes the existing persisted conversation/tool and artifact inputs and provides authoritative `SubagentTarget` identity, labels, metadata, transcript sources, ordering inputs, and control capability. `pitty-usability-settings-3` may change presentation density and navigation but must not reinterpret this evidence contract.

## Risks / Trade-offs

- **Persisted session variants differ across Pi versions** → Validate known block shapes at the boundary and ignore malformed blocks without weakening already valid messages.
- **Tool-call IDs are absent in old data** → Keep those results renderable as generic tools but do not guess metadata correlation.
- **An artifact and persisted arguments disagree** → Prefer artifact runtime identity/state while retaining persisted requested labels only where the artifact has no authoritative value.
- **Child session files are large** → Reuse bounded transcript conversion and avoid loading unbounded history into the UI.
