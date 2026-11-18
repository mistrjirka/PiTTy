# Runtime service boundaries

The OpenTUI `App` creates reactive signals and renders components. Process, input, compaction and session policies belong to separate controllers. Controllers accept small typed callback ports for UI changes, rather than importing UI components or constructing their own renderers.

| Owner | Responsibility |
| --- | --- |
| `tabs/runtime.ts` | Holds one tab's per-session state and subscribes to Pi events |
| `tabs/session-controller.ts` | Loads/replaces Pi conversation history and switches sessions; guards against history races with live events |
| `tabs/input-controller.ts` | Sends prompts, queues during compaction, dispatches deferred messages, handles abort suppression and failed sends |
| `tabs/slash-commands.ts` | Handles built-in `/` commands with a narrow statically typed runtime and explicit UI ports; unknown extension commands remain routed to Pi. Formats `/status` and uses inferred model descriptors instead of dynamic record casts |
| `tabs/command-catalog.ts` | Keeps a per-Pi RPC command snapshot and synchronizes extension/template/skill commands on startup, tab activation and slash-menu use, without rescanning filesystem resources. Local UI commands retain precedence. |
| `tabs/compaction-controller.ts` | Maintains per-tab compaction attempts, statuses, live lane text and completion |
| `tabs/extension-status-controller.ts` | Validates background-command and MCP status updates and ignores other sessions' task snapshots |
| `subagents/session-telemetry.ts` | Compatibility-only bounded reader for historical children that do not publish token usage |
| `subagents/session-tail.ts` | Reads a bounded append-only JSONL tail without copying a whole child transcript |
| `subagents/profiled.ts` | Projects validated child status; prefer producer `turnCount`, `toolCount`, `windowTokens` and `lastActivityAt` |
| `subagents/targets.ts` | Pure target selection/ownership projection of validated subagent runs |
| `app.tsx` | Owns SolidJS signals, dialogs, navigation, focus and rendering; invokes controllers |

## Communication flow

Pi RPC/events -> validated status and domain events -> per-tab controller -> state and callback -> SolidJS view.

Pi-subagent >=0.5.16 publishes optional v1 status counters and context usage on each child process. PiTTy consumes those directly, so a child working for many turns no longer looks `starting…` merely because its latest JSONL tool result exceeds 200 KiB. Older children use a bounded compatibility reader (4 MiB), skipping opaque tool-result rows. The subagent inspector reads only a bounded 24 MiB suffix rather than the entire file.

External JSON and unknown Pi extensions still require runtime validation. Internal controller state and tool parameter schemas should remain statically typed. Prefer small structural ports and discriminated unions to broad `Record<string, unknown>` casts outside transport boundaries.

## Safe follow-up refactors

The remaining large `App()` owns application navigation, settings, modal orchestration, and rendering. Extract by feature and retain current integration tests. Split large subagent target projections by typed run category rather than writing new state caches. Do not rewrite notification ordering or process lifecycle while extracting these controllers; both are sensitive to parent/child turn races.

## Command inventory

Pi RPC `get_commands` reports registered extension commands, prompt templates and skills, but not every command of Pi's interactive terminal. PiTTy only advertises UI commands it implements plus the live RPC registry. The entire catalog is available to scroll when typing `/`, alphabetically when no query is present. When `/` opens, it refreshes a per-tab command list if older than 30 seconds. Polling stops when the menu closes or Pi is streaming. `/commands [search]` refreshes immediately. Installing an extension or changing skill files still requires Pi to reload those resources before RPC can report the changes.

## Background shell continuity

The active Pi tab's validated `pitty.bg.v1` status feeds the sidebar and the live compaction panel. Only `state=running` jobs are shown in the compaction panel, with a viewport-bounded list and links to the existing task output dialog. PiTTy never invents process state from a saved checkpoint. One-round compaction v0.4.5 independently captures a bounded task roster for the **model checkpoint**. The PiTTy view does not mutate the running shell processes.
