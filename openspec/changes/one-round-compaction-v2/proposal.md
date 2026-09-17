## Why

`pi-one-round-compaction` 0.4.x replaced its intent/workflow protocol with work-state audit + execution, progress v2, and completion details v6. PiTTy 0.6.20 only understands progress v1 and details v2/v4, so current live progress is not recognized and current completion metadata is dropped.

## What Changes

- Consume `pi-one-round-compaction.progress.v2` and render `audit` + `execution` live lanes.
- Parse completion details v6, including the derived lane output budget and current durable-source metadata.
- Keep historical progress v1 and details v2/v4 readable without using their intent/workflow fields in the current v2/v6 path.
- Preserve PiTTy's generic RPC fallback and ordinary compaction behavior when the optional integration is absent or malformed.

## Impact

Affects compaction telemetry parsing, extension-status routing, compaction-panel presentation, and focused parser/render tests. No Pi execution or compaction semantics change.
