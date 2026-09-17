## Context

The plugin's current RPC status key is `pi-one-round-compaction.progress.v2`. Its live payload has no `mode` or `intentWorkflow` fields and exposes exactly two lanes: `audit` and `execution`. Completion details are version 6 and likewise contain no intent/workflow state.

## Decisions

- Treat progress v2/details v6 as the current protocol and validate them strictly against their current fields.
- Keep separate historical v1/v2/v4 parsers so previously persisted sessions remain inspectable.
- Use a union at the PiTTy adapter boundary; the live panel chooses `audit` for v2 and `intent` only for historical v1 frames.
- Intercept both the current `.progress.v2` status key and the historical `.progress.v1` key so machine-readable JSON never leaks into the generic status line.
- Preserve bounded per-lane streamed text independently for `audit`, historical `intent`, and `execution`.

## Risks / Trade-offs

- Historical compatibility leaves legacy type names in the adapter. They are version-gated and cannot satisfy the current v2/v6 parser.
- Strict v6 parsing will hide plugin-specific metadata if the plugin changes its wire shape again; generic compaction rendering remains available.
