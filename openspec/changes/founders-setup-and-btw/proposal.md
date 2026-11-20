# Founder setup and side questions

## Why

The existing optional package installer does not install the complete owned plugin
set or the user's curated skills and agents. A separate side-question extension
also needs a safe provider request path and a text widget that works over RPC.

## Changes

- Add `pitty founders-setup`, with check and dry-run modes.
- Add an explicit founder setup option to first-install scripts.
- Install the verified plugin catalog, including managed code-tool, memory,
  subagent, compaction, DoppelClaude, background commands and the owned BTW extension.
- Install selected skills and agents from a separate public, forkable repository.
- Remember selected forks or local checkouts across setup runs.
- Prepare the exact supported Pi base inside an isolated temporary prefix when
  an older global Pi cannot supply the managed runtime. Keep global Pi unchanged.
- Select skills by authorship and substantive customization, with provenance.
- Omit model pins from exported agents, preserving other instructions.
- Publish one temporary BTW result through the existing generic string-widget API.
- Preserve the main conversation, tool execution, cancellation and provider
  continuation state when an independent question runs.
- Keep existing conversations readable without a session-file migration.

## Boundaries

The wiki migration includes only verified selected skills, agents and their required
references. It excludes unrelated wiki content, credentials, logs and session files.
Source removal follows verified destination publication. Existing custom agent files,
unrelated packages and user model defaults are preserved.

Provider-specific side questions require an explicit tool-free capability. Missing
capabilities or unsafe snapshots produce a visible error instead of a normal agent turn.
Cache reuse is possible when the effective prefix matches. Offline tests do not prove
provider cache savings.

## Validation

Test installer planning, idempotence, alias replacement, failed installation before
configuration changes, custom agent collisions and model-free exports in isolated
directories. Test side-question cancellation, session changes, incomplete tool groups,
effective provider routing and immediate RPC command acknowledgment with fake providers.
Run PiTTy typecheck and unit tests, the affected Pi checks, and an actual managed-runtime
RPC smoke test without paid model calls.
