## 1. Persisted correlation

- [x] 1.1 Add named boundary-validated persisted assistant tool-call metadata keyed by exact tool-call ID.
- [x] 1.2 Correlate initial tool results with matching names and arguments without changing live event handling.
- [x] 1.3 Add malformed, missing-ID, unmatched-call, unmatched-result, and parallel-same-tool regression cases.

## 2. Target and transcript reconstruction

- [x] 2.1 Apply artifact, persisted-argument, and meaningful-result precedence in the existing target builders.
- [x] 2.2 Omit metadata-free placeholders while preserving meaningful completed and file-backed targets.
- [x] 2.3 Add bounded validated child `sessionFile` transcript resolution through the existing conversation conversion path.
- [x] 2.4 Keep all non-file-backed historical targets structurally read-only.

## 3. Validation

- [x] 3.1 Add focused reconstruction tests for labels, model/context/thinking metadata, tools, missing artifacts, empty results, and transcript-source fallback.
- [x] 3.2 Run focused conversation, subagent, and render tests with explicit timeouts.
- [x] 3.3 Run `npm run typecheck`, `npm run check`, and `git diff --check` with explicit timeouts.
- [x] 3.4 Manually restart PiTTy against a fixture session and compare reconstructed targets with authoritative source messages/artifacts.
