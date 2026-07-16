# Contributing to PiTTy

[← Project README](README.md) · [Documentation index](docs/README.md) · [Architecture](docs/OPEN_SOURCE_READINESS.md)

Contributions should preserve PiTTy's generic RPC experience even when no optional integration is installed.

## Before changing behavior

Open an issue or add an OpenSpec change under `openspec/changes/` when work affects public UI, RPC handling, integrations, installers, release behavior, or compatibility guarantees.

Small documentation corrections, tests, and narrowly scoped internal refactors usually do not need a separate proposal.

## Development setup

```bash
git clone https://github.com/mistrjirka/PiTTy.git
cd PiTTy
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/bun/install.js
```

Run PiTTy from source with:

```bash
npm run start
```

## Validation

Before opening a pull request, run:

```bash
npm run typecheck
npm run test:unit
```

UI-specific changes should also run:

```bash
npm run test:ui
```

The OpenTUI render suite can expose native Bun or TreeSitter cleanup failures on some platform combinations. When reporting one, include the terminal, operating system, Bun, Pi, and OpenTUI versions along with the failing command.

## Pull requests

A useful pull request should include:

- a focused summary of user-visible behavior;
- relevant tests or an explanation of why none are needed;
- screenshots or captured terminal frames for meaningful layout changes;
- documentation updates for commands, controls, installers, branding, or compatibility changes;
- no unrelated generated or local files.

## Repository safety

Do not commit:

- Pi credentials or authentication files;
- session transcripts;
- diagnostic bundles;
- private project source or fixtures;
- generated `node_modules`;
- verbose RPC logs containing prompts or tool output.

See [SECURITY.md](SECURITY.md) for sensitive reports.
