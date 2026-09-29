# PiTTy 0.6.38 cold-start runtime

## Problem

PiTTy normally launches TypeScript/TSX source directly through Bun. On a cold loader/compiler cache this can delay application mounting and therefore delay spawning the Pi RPC child even though Pi itself initializes in only a few seconds.

Existing Git installations of the profiled subagent runtime also need an explicit update to receive its startup-only RPC timeout fix.

## Change

- Build PiTTy's local runtime during install/upgrade and prefer built entrypoints during normal launch.
- Pass the install root into the built runtime for non-bundled extension asset resolution.
- Retain source fallback for development/source checkouts.
- Refresh an already-installed profiled subagent runtime after a successful staged PiTTy upgrade.
- Preserve plugin mode through POSIX staged upgrades.

## Compatibility

Optional packages remain opt-in. Normal Pi RPC behavior and the diagnostics limits shipped in 0.6.37 are unchanged.
