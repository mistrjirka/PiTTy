# Managed Pi runtime

PiTTy installs a private copy of Pi and applies the version-pinned modules listed in `vendor/managed-fork-manifest.json`. The editable message queue changes both the coding-agent RPC/session layer and the agent-core queue. Shipping only the UI or only the RPC module is incomplete.

The installer checks the original module hashes before copying patches. Each declared module must exist before a previous installation can be reused. Installation stages the whole runtime before replacing its private directory. It does not modify global Pi, credentials, plugins, or session files.

## Founder setup on an older Pi installation

`pitty founders-setup` can prepare the exact supported Pi base when global Pi is older or unavailable. It downloads the pinned public package into a temporary prefix inside the PiTTy installation, validates the same original module hashes and startup behavior, and copies the prepared runtime into `fork-runtime/`. It removes the temporary prefix afterward. Global Pi and its settings stay unchanged.

This preparation runs only for the explicit founder setup command. Normal installation and upgrades retain their existing upstream fallback. Explicit upstream selections or explicit source-runtime overrides are respected.

## Source repositories

The source forks are [mistrjirka/pi](https://github.com/mistrjirka/pi) and [mistrjirka/pi-code-tool](https://github.com/mistrjirka/pi-code-tool). The manifest records each `forkRepository` and `forkCommit` alongside the generated file hashes.

## Rebuild the managed modules

Use the Pi source checkout that contains the queue changes and an unmodified installation matching the manifest's Pi version. The source changes must pass their targeted tests and the Pi repository checks before packaging.

```sh
node scripts/build-pi-queue-patches.mjs \
  --pi-source /path/to/pi-source \
  --upstream-pi-root /path/to/installed/pi-coding-agent
```

This rebuilds the declared Pi modules, including the session-memory, queue and side-question modules, into `vendor/pi-1.5.2/`. It records the source checkout's current Git commit in `pi.forkCommit` and refreshes every generated module hash. Use a clean source checkout so the recorded commit matches the packaged code. Review the source changes and generated diff together.

## Verify the packaged RPC process

Stage a private runtime in the PiTTy checkout:

```sh
node scripts/ensure-managed-pi.mjs --install-root "$PWD"
PITTY_TEST_MANAGED_RUNTIME="$PWD/fork-runtime/pi/dist/cli.js" \
  bun test --conditions=browser test/managed-queue-rpc.test.ts
```

The integration test runs the emitted RPC process with an isolated agent directory and a fake provider. It does not use a real model or the user's session. The normal unit suite skips this test unless the executable path is explicitly supplied.

The owned BTW extension has a separate integration check:

```sh
PITTY_TEST_MANAGED_RUNTIME="$PWD/fork-runtime/pi/dist/cli.js" \
PITTY_TEST_BTW_EXTENSION="/path/to/pi-btw/index.ts" \
  bun test --conditions=browser test/managed-btw-rpc.test.ts
```

It checks founder-setup runtime readiness, immediate command acknowledgment during a main response, independent cancellation, and questions during compaction. Both the release manifest and installed runtime record the side-question protocol version. Founder setup checks that capability before activating its package settings.

Build PiTTy after the client checks pass:

```sh
npm run typecheck
bun run build:runtime
```

A running Pi process keeps its already-loaded code. Start a new PiTTy process to use a newly installed runtime.
