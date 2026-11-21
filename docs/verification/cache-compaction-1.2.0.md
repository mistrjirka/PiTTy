# Cache compaction and usage verification

## Scope

PiTTy 1.2.0 adds per-tab Claude usage and configurable cache maintenance. The default method is cache-aware. The default maintenance action is compaction before cache expiry. Explicit older warming or off preferences remain effective.

## Completed checks

| Area | Result | What it proves |
| --- | --- | --- |
| One-round extension | Typecheck and 84 tests passed | Method selection preserves legacy hosts, configuration, artifacts, concurrency and cancellation |
| Packaged Pi runtime | 30 checks passed, no skips | Runtime installation, two isolated usage profiles, refreshes, unknown values, error redaction, expiry timer, pending tools, late input and compaction ownership |
| Native provider | Three builds, TypeScript, Biome and 493 offline tests passed | Account binding, request-prefix preservation, fork isolation, summary validation and quota endpoint access policy |
| Pi core | Required check, bundle build, 74 compaction regressions and 6 usage tests passed | Safe idle/tool boundaries, cancellation, retained input, observed TTL and RPC reads |
| PiTTy suite | Typecheck passed; 1203 tests passed, 38 optional/platform tests skipped | Application and installer regression coverage |
| UI suite | 144 tests passed | Layout and interaction regressions |
| Extension update safety | 43 checks passed | Missing-file updates preserve local and unpublished Git work |
| Terminal UI | Both source and built-app tmux runs passed | Profile choice, new tab launch, live/stale/unknown usage, method settings and typing protection |
| Generic Anthropic serializer | Offline request inspection passed | System prompt, tools and original message blocks remain in the summary request prefix |

The final packaged run includes the real `pi-bg-bash@0.6.0` process-continuity test. Managed runtime tests skipped by the general suite were run separately with the built runtime.

## Reproduction

Run Pi core's required `npm run check` and the explicit cache, side-question, provider-usage and compaction regression files.

Run the one-round extension's `npm run check`.

Run PiTTy's `npm run typecheck`, `npm run test:unit` and `npm run test:ui`. Build the managed runtime from the committed Pi source with `scripts/build-pi-queue-patches.mjs` and `scripts/ensure-managed-pi.mjs`.

Set `PITTY_TEST_MANAGED_RUNTIME` to that runtime's `dist/cli.js` and run `test/managed-cache-usage-rpc.test.ts` and `test/managed-queue-rpc.test.ts`. Set `PITTY_TEST_BG_BASH_EXTENSION` to the installed background-shell extension for its integration case.

Run `scripts/check-cache-policy-terminal.ts` for the terminal interaction test. Set `PITTY_TEST_APP_ENTRY=dist/index.js` after building to test the release bundle.

## Measurement limits

All test profile names and usage values are synthetic. The terminal and managed-runtime checks launch real processes, but do not contact Anthropic.

Native SDK wire tests use SDK `0.3.310` with CLI `2.1.310`, a localhost Messages endpoint and a throwaway configuration. They check exact original message content, system text, model, tools, thinking and cache-control policy. They also check a 64000-token registered summary allowance, zero extra title-generation requests, retained tool completion and cache-creation to cache-read-only timing continuity. Synthetic cache counters do not prove a real cache hit. A credentialed Claude account is required to measure the actual hit rate and compare real five-hour and weekly usage.

The SDK normally reuses its usage snapshot for up to 60 seconds. After a failed native fetch it can return older seeded data without exposing that failure in the public result. `observedAt` records receipt of a control read or rate event, not a guaranteed fresh server measurement. An explicit user override of `pathToClaudeCodeExecutable` can select a binary outside the tested SDK/CLI combination.

The forced `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` flag blocked the native quota endpoint. Source inspection of the pinned CLI confirmed that gate. The provider now uses separate telemetry, error-reporting, update and title-generation opt-outs. Explicit user traffic restrictions remain effective.

Native SDK internal quota retries have no safe application barrier. This release compacts at idle or tool-result boundaries. It does not interrupt a model request that is still retrying inside the SDK.

## Cross-platform follow-up

The 1.2.0 release workflow and Linux/macOS CI passed. Windows CI found one new test assertion that used Unix path separators. Version 1.2.1 changes that assertion to use the platform path API. The application and managed-runtime behavior is unchanged by this follow-up.
