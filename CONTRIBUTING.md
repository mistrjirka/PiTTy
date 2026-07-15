# Contributing to PiTTy

1. Open an issue or add an OpenSpec change under `openspec/changes/` for behavior that affects public UI, RPC handling, integrations, or installers.
2. Install dependencies with `npm ci --ignore-scripts --no-audit --no-fund`, then run `node node_modules/bun/install.js`.
3. Run `npm run typecheck` and `npm run test:unit` before opening a pull request.
4. Keep the generic RPC renderer usable without optional integrations.
5. Do not commit session transcripts, credentials, diagnostic bundles, or generated `node_modules`.

UI tests use OpenTUI and may expose native runtime bugs on some Bun/platform combinations. Include terminal, OS, Bun, Pi, and OpenTUI versions when reporting rendering failures.
