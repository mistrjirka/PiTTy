## Context

PiTTy currently keeps a literal version only for CLI help and does not render it in the live TUI. Release automation validates a `v<version>` tag against `package.json`.

## Goals / Non-Goals

**Goals:**
- Show the current release version without requiring a command.
- Keep the CLI help banner and sidebar label aligned with `package.json`.
- Protect the rendered label with an existing OpenTUI render test.

**Non-Goals:**
- Add an About dialog, version command, update checker, or release mechanism beyond the existing tag-triggered workflow.

## Decisions

- Add a small shared version module that imports `package.json` with Bun’s supported JSON module syntax and exports its `version` value. Both CLI help and the sidebar use this module, avoiding independent literals and unnecessary prop drilling. Enable TypeScript JSON-module checking in `tsconfig.json`.
- Render a compact `PiTTy v<version>` line below the session name. The sidebar is visible by default and already presents session metadata, unlike the crowded footer hint row.
- Bump both package manifest and lockfile metadata to `0.3.1.1`, then tag the validated `main` commit as `v0.3.1.1`, which satisfies the existing release workflow.

## Risks / Trade-offs

- [The sidebar can be hidden with `--no-sidebar`] → The existing `--help` banner continues to show the version.
- [TypeScript cannot typecheck the JSON import without configuration] → Enable `resolveJsonModule` and verify with the repository typecheck.
- [A one-line metadata label reduces sidebar vertical space] → Use a single compact line and retain current layout behavior.
