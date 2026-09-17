## 1. Current protocol support

- [x] 1.1 Add progress-v2 parsing and route the `.progress.v2` status key.
- [x] 1.2 Render live `audit` + `execution` lanes and accumulate their streamed text.
- [x] 1.3 Add details-v6 parsing and expose current budgeting metadata.

## 2. Compatibility and validation

- [x] 2.1 Retain historical v1/v2/v4 parsing behind explicit version branches.
- [x] 2.2 Add parser and OpenTUI regression coverage for current v2/v6 payloads.
- [x] 2.3 Run PiTTy typecheck, focused parser/render tests, and the full suite; the compaction change passes. The full suite retains two unrelated baseline failures reproduced on untouched `origin/main` (POSIX installer fixture and RPC startup-timeout timing test).
