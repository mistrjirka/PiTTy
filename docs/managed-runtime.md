# Managed Pi runtime

PiTTy installs a private copy of Pi and applies the version-pinned modules listed in `vendor/managed-fork-manifest.json`. The editable message queue changes both the coding-agent RPC/session layer and the agent-core queue. Shipping only the UI or only the RPC module is incomplete.

The installer checks the original module hashes before copying patches. Each declared module must exist before a previous installation can be reused. Installation stages the whole runtime before replacing its private directory. It does not modify global Pi, credentials, plugins, or session files.

## How PiTTy selects and uses it

Starting with v0.7.8, `pitty upgrade` stages a compatible Pi fork alongside the PiTTy update. On the next `pitty` launch, the update activates and PiTTy automatically uses its private fork. **No separate install command, configuration migration, or global Pi replacement is needed.** This also applies to a fresh PiTTy installation.

The bundled patch currently targets **Pi 1.6.0** and **pi-code-tool 0.6.2**. For these exact installed versions, PiTTy copies Pi and its dependencies to its own `fork-runtime/` directory and applies the tested session-memory, pending-message queue, and Python tool-dispatch patches. The existing `~/.pi/agent/settings.json`, credentials, installed packages, extensions and session files stay in place. The existing code-tool extension is redirected only inside the PiTTy child process, without modifying its original file or auto-approve behavior.

Python helpers use the tools enabled in the current Pi session, including their extension overrides, validation, and cancellation. The default helper set is `read`, `bash`, `edit`, and `write`. Enable `find`, `grep`, or `ls` in Pi's tool selection before using those helpers. Existing code-tool approval settings still apply.

Starting with v0.7.11, Python variables are saved as interpreter checkpoints. Later calls and restored sessions continue from that state without rerunning earlier code. Since v0.7.12, older v1/v2 snapshots are converted automatically on the next `code` call. The one-time conversion reconstructs saved Python code using recorded inputs and tool results, without repeating completed tool operations or asking for their approval again. Paused operations remain resumable. New tool requests run normally.

Old snapshots did not record direct file-read contents. Their conversion reads the current files through readonly mounts, as the old runtime did. If the saved code cannot be reconstructed, the original snapshot is preserved and the error gives the specific cause. Ordinary conversation messages remain usable. An incompatible change to helper type signatures or execution limits can still require `reset=true`, which clears Python variables and reloads saved tools. The private runtime installs its pinned interpreter from a checksum-verified dependency lock without changing the globally installed interpreter.

If the installed Pi or code-tool differs from the verified versions, PiTTy uses the unchanged global Pi and reports why. This does not block the PiTTy update. The managed fork is currently supported on Linux and macOS. To opt out, run `PITTY_USE_UPSTREAM_PI=1 pitty`; `PI_BIN=/path/to/pi` and `pitty --pi /path/to/pi` also override automatic selection.

For local source builds with matching upstream packages, run `npm run install:fork-runtime` once to prepare the managed runtime. The installer does not modify any global Pi configuration.

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

This rebuilds the declared Pi modules, including the session-memory, queue and side-question modules, into `vendor/pi-1.6.0/`. It records the source checkout's current Git commit in `pi.forkCommit` and refreshes every generated module hash. Use a clean source checkout so the recorded commit matches the packaged code. Review the source changes and generated diff together.

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
